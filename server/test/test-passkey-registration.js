/**
 * Passkey 注册服务集成测试。
 * 职责：使用真实 bcrypt、WebAuthn 验证器和随机 PostgreSQL schema 验证业务边界。
 * 参数：仅读取本地数据库配置；模拟认证器产生 none 证明，不连接或修改真实业务用户。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const config = require('../config');

/** 校验统一业务异常；code/status 为预期结果，错误数据不得泄漏协议内容。 */
function businessError(code, status = 400) {
  return error => {
    assert.equal(error.isLegacyBusinessError, true);
    assert.equal(error.code, code);
    assert.equal(error.statusCode, status);
    assert.equal(error.data, null);
    return true;
  };
}

/** 校验公开密钥只含四个安全字段；row 为服务返回值。 */
function assertPublic(row) {
  assert.deepEqual(Object.keys(row).sort(), ['created_at', 'id', 'last_used_at', 'name']);
}

/**
 * 构建真实 WebAuthn none 证明；options 提供挑战，overrides 用于错误来源/RP/UV/挑战测试。
 * 核心分支：flags 可移除 UV，credentialId 可复用以覆盖唯一约束；不输出原始协议数据。
 */
async function registrationResponse(options, overrides = {}) {
  const { isoCBOR } = await import('@simplewebauthn/server/helpers');
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const key = isoCBOR.encode(new Map([[1, 2], [3, -7], [-1, 1],
    [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
  const id = overrides.credentialId || crypto.randomBytes(32).toString('base64url');
  const idBytes = Buffer.from(id, 'base64url');
  const length = Buffer.alloc(2);
  length.writeUInt16BE(idBytes.length);
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(overrides.counter || 0);
  const authData = Buffer.concat([
    crypto.createHash('sha256').update(overrides.rpId || 'tl.lolok.dpdns.org').digest(),
    Buffer.from([overrides.flags ?? 0x45]), counter, Buffer.alloc(16), length, idBytes, key
  ]);
  const attestationObject = isoCBOR.encode(new Map([
    ['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]
  ]));
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create',
    challenge: overrides.challenge || options.challenge,
    origin: overrides.origin || 'https://tl.lolok.dpdns.org', crossOrigin: false })).toString('base64url');
  return { id, rawId: id, type: 'public-key', clientExtensionResults: {},
    response: { clientDataJSON, attestationObject: Buffer.from(attestationObject).toString('base64url'), transports: ['internal'] } };
}

/** 执行隔离测试；缺少服务时明确 RED，所有路径最终关闭连接池并清理随机 schema。 */
async function run() {
  const servicePath = path.join(__dirname, '../services/user/passkey-service.js');
  assert.ok(fs.existsSync(servicePath), 'PasskeyService 不存在');
  const PasskeyService = require(servicePath);
  const { up } = require('../db/migrations/033-passkeys');
  const schema = `passkey_registration_test_${crypto.randomBytes(8).toString('hex')}`;
  const control = new Pool({ ...config.database, connectionTimeoutMillis: 5000 });
  let pool;
  try {
    await control.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ ...config.database, options: `-c search_path=${schema}`, max: 8 });
    await pool.query('CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT NOT NULL, password_hash TEXT NOT NULL)');
    await up(pool);
    const password = 'Test-only-passkey-2026';
    const hash = await bcrypt.hash(password, 4);
    const userIds = [];
    for (let index = 0; index < 8; index++) {
      userIds.push((await pool.query('INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
        [`registration-${index}@example.test`, hash])).rows[0].id);
    }
    const [userId, otherId, duplicateId, concurrentId] = userIds;
    const service = new PasskeyService({ db: { pool } });
    const fixedNow = () => 1792000000;
    const clockInjected = new PasskeyService({ db: { pool }, now: fixedNow });
    assert.equal(clockInjected.now, fixedNow, '构造函数保留可选秒级 now 依赖以兼容后续服务');
    const empty = await service.listForUser(userId);
    assert.deepEqual(empty, { list: [], limit: 2, remaining: 2 });
    await assert.rejects(service.createRegistrationOptions(userId, { password: 'wrong' }), businessError(2101));
    await assert.rejects(service.createRegistrationOptions(userId, {}), businessError(2101));
    await assert.rejects(service.createRegistrationOptions(999999, { password }), businessError(2108, 404));
    assert.equal(Number((await pool.query('SELECT COUNT(*) AS count FROM webauthn_challenges')).rows[0].count), 0);
    for (const name of ['x'.repeat(51), 9, {}]) {
      await assert.rejects(service.createRegistrationOptions(userId, { password, name }), businessError(2102));
    }
    console.log('PASS 密码校验、用户不存在与名称校验均在生成挑战前执行');

    const first = await service.createRegistrationOptions(userId, { password, name: '  ' });
    assert.equal(first.options.rp.id, 'tl.lolok.dpdns.org');
    assert.equal(first.options.authenticatorSelection.residentKey, 'required');
    assert.equal(first.options.authenticatorSelection.userVerification, 'required');
    assert.equal(first.options.attestation, 'none');
    assert.equal(first.options.timeout, 120000);
    assert.deepEqual(first.options.excludeCredentials, []);
    const challenge = (await pool.query('SELECT * FROM webauthn_challenges WHERE id = $1', [first.ceremony_id])).rows[0];
    assert.equal(Number(challenge.expires_at) - Number(challenge.created_at), 120);
    assert.equal(challenge.user_id, userId);
    assert.equal(challenge.type, 'registration');
    assert.equal(challenge.challenge, first.options.challenge);
    const firstResponse = await registrationResponse(first.options, { flags: 0x5d, counter: 7 });
    const firstKey = await service.verifyRegistration(userId, { ceremony_id: first.ceremony_id, response: firstResponse, name: '  ' });
    assertPublic(firstKey);
    assert.equal(firstKey.name, 'Passkey 1');
    await assert.rejects(service.verifyRegistration(userId, { ceremony_id: first.ceremony_id, response: firstResponse }), businessError(2104));
    const stored = (await pool.query('SELECT * FROM user_passkeys WHERE id = $1', [firstKey.id])).rows[0];
    assert.equal(stored.credential_id, firstResponse.id);
    const { isoCBOR, parseAuthenticatorData } = await import('@simplewebauthn/server/helpers');
    const decodedAttestation = isoCBOR.decodeFirst(Buffer.from(firstResponse.response.attestationObject, 'base64url'));
    const authenticator = parseAuthenticatorData(decodedAttestation.get('authData'));
    assert.deepEqual(stored.public_key, Buffer.from(authenticator.credentialPublicKey));
    assert.equal(Number(stored.counter), 7);
    assert.deepEqual(stored.transports, ['internal']);
    assert.equal(stored.device_type, 'multiDevice');
    assert.equal(stored.backed_up, true);
    console.log('PASS 固定注册策略、120 秒挑战、真实证明验证、安全返回和默认名称');

    const second = await service.createRegistrationOptions(userId, { password, name: '旧名' });
    assert.deepEqual(second.options.excludeCredentials.map(item => item.id), [firstResponse.id]);
    assert.deepEqual(second.options.excludeCredentials[0].transports, ['internal']);
    assert.equal(second.options.user.id, first.options.user.id);
    const secondKey = await service.verifyRegistration(userId, { ceremony_id: second.ceremony_id,
      response: await registrationResponse(second.options), name: '新'.repeat(50) });
    assert.equal(secondKey.name, '新'.repeat(50));
    const secondStored = (await pool.query('SELECT * FROM user_passkeys WHERE id = $1', [secondKey.id])).rows[0];
    assert.equal(Number(secondStored.counter), 0);
    assert.equal(secondStored.device_type, 'singleDevice');
    assert.equal(secondStored.backed_up, false);
    const listing = await service.listForUser(userId);
    assert.equal(listing.limit, 2);
    assert.equal(listing.remaining, 0);
    listing.list.forEach(assertPublic);
    await assert.rejects(service.createRegistrationOptions(userId, { password }), businessError(2103));
    console.log('PASS 排除已有凭据、稳定 user handle、verify 重命名及 50 字符边界和数量上限');

    for (const overrides of [{ origin: 'https://evil.example.test' }, { rpId: 'evil.example.test' },
      { flags: 0x41 }, { challenge: 'wrong-challenge' }]) {
      const ceremony = await service.createRegistrationOptions(otherId, { password });
      const response = await registrationResponse(ceremony.options, overrides);
      await assert.rejects(service.verifyRegistration(otherId, { ceremony_id: ceremony.ceremony_id, response }), businessError(2105));
      await assert.rejects(service.verifyRegistration(otherId, { ceremony_id: ceremony.ceremony_id, response }), businessError(2104));
    }
    const malformed = await service.createRegistrationOptions(otherId, { password });
    await assert.rejects(service.verifyRegistration(otherId, { ceremony_id: malformed.ceremony_id, response: {} }), businessError(2105));
    await assert.rejects(service.verifyRegistration(otherId, { ceremony_id: malformed.ceremony_id, response: {} }), businessError(2104));
    const expired = await service.createRegistrationOptions(otherId, { password });
    await pool.query('UPDATE webauthn_challenges SET expires_at = FLOOR(EXTRACT(EPOCH FROM NOW())) - 1 WHERE id = $1', [expired.ceremony_id]);
    await assert.rejects(service.verifyRegistration(otherId, { ceremony_id: expired.ceremony_id,
      response: await registrationResponse(expired.options) }), businessError(2104));
    const wrongOwner = await service.createRegistrationOptions(otherId, { password });
    const ownerResponse = await registrationResponse(wrongOwner.options);
    await assert.rejects(service.verifyRegistration(duplicateId, { ceremony_id: wrongOwner.ceremony_id, response: ownerResponse }), businessError(2104));
    assert.equal((await service.verifyRegistration(otherId, { ceremony_id: wrongOwner.ceremony_id, response: ownerResponse })).name, 'Passkey 1');
    console.log('PASS 真实验证器拒绝错误 Origin/RP ID/UV/挑战，失败仍消费挑战，过期与跨用户挑战无效');

    const badName = await service.createRegistrationOptions(duplicateId, { password, name: '有效名' });
    await assert.rejects(service.verifyRegistration(duplicateId, { ceremony_id: badName.ceremony_id,
      response: await registrationResponse(badName.options), name: 'x'.repeat(51) }), businessError(2102));
    await assert.rejects(service.verifyRegistration(duplicateId, { ceremony_id: badName.ceremony_id,
      response: {} }), businessError(2104));
    const duplicate = await service.createRegistrationOptions(duplicateId, { password });
    await assert.rejects(service.verifyRegistration(duplicateId, { ceremony_id: duplicate.ceremony_id,
      response: await registrationResponse(duplicate.options, { credentialId: firstResponse.id }) }), businessError(2106, 409));
    assert.deepEqual((await service.listForUser(duplicateId)).list, []);
    console.log('PASS verify 阶段拒绝超长名称且消费挑战，重复 Credential ID 返回统一冲突错误');

    const ceremonies = await Promise.all([0, 1, 2].map(() => service.createRegistrationOptions(concurrentId, { password })));
    const responses = await Promise.all(ceremonies.map(item => registrationResponse(item.options)));
    await service.verifyRegistration(concurrentId, { ceremony_id: ceremonies[0].ceremony_id, response: responses[0] });
    const races = await Promise.allSettled([1, 2].map(index => service.verifyRegistration(concurrentId,
      { ceremony_id: ceremonies[index].ceremony_id, response: responses[index] })));
    assert.equal(races.filter(result => result.status === 'fulfilled').length, 1);
    businessError(2103)(races.find(result => result.status === 'rejected').reason);
    const raceList = await service.listForUser(concurrentId);
    assert.deepEqual(raceList.list.map(item => item.name).sort(), ['Passkey 1', 'Passkey 2']);
    assert.equal(raceList.remaining, 0);
    const replay = await service.createRegistrationOptions(userIds[4], { password });
    const replayResponse = await registrationResponse(replay.options);
    const replayRace = await Promise.allSettled([0, 1].map(() => service.verifyRegistration(userIds[4],
      { ceremony_id: replay.ceremony_id, response: replayResponse })));
    assert.equal(replayRace.filter(result => result.status === 'fulfilled').length, 1);
    businessError(2104)(replayRace.find(result => result.status === 'rejected').reason);
    console.log('PASS 并发剩余名额只有一个注册成功，默认名称在事务内生成，同挑战只能消费一次');

    await assert.rejects(service.deleteForUser(userId, firstKey.id, 'wrong'), businessError(2101));
    await assert.rejects(service.deleteForUser(otherId, firstKey.id, password), businessError(2107, 404));
    assert.equal((await service.listForUser(userId)).list.length, 2);
    const deleted = await service.deleteForUser(userId, firstKey.id, password);
    assertPublic(deleted);
    assert.equal(deleted.id, firstKey.id);
    assert.equal((await service.listForUser(userId)).remaining, 1);
    await assert.rejects(service.deleteForUser(userId, firstKey.id, password), businessError(2107, 404));
    console.log('PASS 删除重新验证密码、严格归属校验、安全返回和幂等不存在错误');
    console.log('PASS Passkey 注册服务全部集成测试通过');
  } finally {
    if (pool) await pool.end();
    try {
      assert.match(schema, /^passkey_registration_test_[a-f0-9]{16}$/);
      await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await control.end();
    }
  }
}

run().catch(error => {
  // 不输出凭据、公钥、挑战、完整响应或连接参数；仅记录安全断言摘要。
  console.error('FAIL Passkey 注册服务:', error.code || error.name, error.message.split('\n')[0]);
  process.exitCode = 1;
});
