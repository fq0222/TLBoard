/**
 * Passkey 无用户名认证集成测试。
 * 职责：真实签名和隔离 PostgreSQL schema 验证认证、计数器、JWT 与 Express 边界。
 * 参数：仅使用本地数据库配置；直接调用处理链，不启动服务器，不修改真实用户。
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const express = require('express');
const { Pool } = require('pg');
const config = require('../config');
const PasskeyService = require('../services/user/passkey-service');
const authService = require('../services/user/auth-service');
const { DISABLE_REASONS } = require('../services/shared/renew-policy');

/** 构造测试认证器；持有私钥以产生真实签名，公钥按 COSE 编码保存。 */
class TestAuthenticator {
  /** id 可覆盖以构造未知凭据，其余密钥在每个实例独立生成。 */
  constructor(id = crypto.randomBytes(32).toString('base64url')) {
    this.id = id;
    const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    this.privateKey = pair.privateKey;
    this.jwk = pair.publicKey.export({ format: 'jwk' });
  }

  /** 将公开 EC 坐标转为 COSE；仅供隔离测试插入凭据。 */
  async publicKey() {
    const { isoCBOR } = await import('@simplewebauthn/server/helpers');
    return Buffer.from(isoCBOR.encode(new Map([[1, 2], [3, -7], [-1, 1],
      [-2, Buffer.from(this.jwk.x, 'base64url')], [-3, Buffer.from(this.jwk.y, 'base64url')]])));
  }

  /** 构造同一认证器的真实 none 注册证明；options 的固定挑战被签入客户端数据。 */
  async registrationResponse(options) {
    const { isoCBOR } = await import('@simplewebauthn/server/helpers');
    const idBytes = Buffer.from(this.id, 'base64url');
    const length = Buffer.alloc(2);
    length.writeUInt16BE(idBytes.length);
    const authData = Buffer.concat([crypto.createHash('sha256').update('tl.lolok.dpdns.org').digest(),
      Buffer.from([0x5d]), Buffer.alloc(4), Buffer.alloc(16), length, idBytes, await this.publicKey()]);
    const attestation = isoCBOR.encode(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
    return { id: this.id, rawId: this.id, type: 'public-key', clientExtensionResults: {}, response: {
      clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge,
        origin: 'https://tl.lolok.dpdns.org', crossOrigin: false })).toString('base64url'),
      attestationObject: Buffer.from(attestation).toString('base64url'), transports: ['internal']
    } };
  }

  /** 为 options 签署断言；overrides 用于来源、UV、计数器、签名和 handle 的拒绝分支。 */
  response(options, overrides = {}) {
    const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get',
      challenge: overrides.challenge || options.challenge,
      origin: overrides.origin || 'https://tl.lolok.dpdns.org', crossOrigin: false }));
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(overrides.counter || 0);
    const authenticatorData = Buffer.concat([
      crypto.createHash('sha256').update(overrides.rpId || 'tl.lolok.dpdns.org').digest(),
      Buffer.from([overrides.flags ?? 0x1d]), counter
    ]);
    const signature = crypto.sign('sha256', Buffer.concat([authenticatorData,
      crypto.createHash('sha256').update(clientData).digest()]), this.privateKey);
    if (overrides.invalidSignature) signature[signature.length - 1] ^= 1;
    return { id: this.id, rawId: this.id, type: 'public-key', clientExtensionResults: {}, response: {
      clientDataJSON: clientData.toString('base64url'), authenticatorData: authenticatorData.toString('base64url'),
      signature: signature.toString('base64url'), userHandle: overrides.userHandle ?? null
    } };
  }
}

/** 校验公开认证失败完全一致；错误不能根据未知凭据、重放或签名变化。 */
function authenticationFailure(error) {
  assert.equal(error.isLegacyBusinessError, true);
  assert.equal(error.statusCode, 401);
  assert.equal(error.code, 2109);
  assert.equal(error.message, 'Passkey 登录失败，请重试或使用密码登录');
  assert.equal(error.data, null);
  return true;
}

/**
 * 在内存调用完整 Express 请求链；app 为实际路由应用，options 提供地址、方法、Token 和请求体。
 * 核心分支：使用 Node 请求/响应对象，覆盖 end 捕获 JSON 并触发 finish，使真实限流器可记录结果。
 */
async function request(app, url, { method = 'POST', token, body = {}, ip = '192.0.2.10', host = 'evil.example.test' } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    Object.defineProperty(socket, 'remoteAddress', { value: ip });
    const req = new http.IncomingMessage(socket);
    req.url = url;
    req.method = method;
    req.headers = { host, 'x-forwarded-host': host, 'x-forwarded-proto': 'http' };
    if (token) req.headers.authorization = `Bearer ${token}`;
    req.body = body;
    const res = new http.ServerResponse(req);
    res.end = function (chunk) {
      this.emit('finish');
      try { resolve({ status: this.statusCode, body: JSON.parse(String(chunk)), headers: this.getHeaders() }); }
      catch (error) { reject(error); }
      return this;
    };
    app.handle(req, res, reject);
  });
}

/**
 * 执行认证/路由测试；缺少认证方法时先明确 RED，最终始终关闭连接池并清理随机 schema。
 * 核心分支：业务数据库完全隔离，登录 IP 记录仅在 HTTP 成功测试时替换外部副作用。
 */
async function run() {
  assert.equal(typeof PasskeyService.prototype.createAuthenticationOptions, 'function', '缺少无用户名认证选项方法');
  assert.equal(typeof PasskeyService.prototype.verifyAuthentication, 'function', '缺少认证验证方法');
  const routerPath = path.join(__dirname, '../routes/user/passkeys.js');
  assert.ok(fs.existsSync(routerPath), '缺少 Passkey 用户端路由');
  const schema = `passkey_auth_test_${crypto.randomBytes(8).toString('hex')}`;
  const control = new Pool({ ...config.database, connectionTimeoutMillis: 5000 });
  let pool;
  try {
    await control.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ ...config.database, options: `-c search_path=${schema}`, max: 8 });
    await pool.query(`CREATE TABLE plans (id SERIAL PRIMARY KEY, name TEXT);
      CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT NOT NULL, password_hash TEXT NOT NULL,
        plan_id INTEGER, expire_at BIGINT, enabled INTEGER, disable_reason TEXT, payment_count INTEGER)`);
    await require('../db/migrations/033-passkeys').up(pool);
    await pool.query("INSERT INTO plans (name) VALUES ('认证套餐')");
    const password = 'Authentication-test-2026';
    const hash = await bcrypt.hash(password, 4);
    const user = (await pool.query(`INSERT INTO users
      (email, password_hash, plan_id, expire_at, enabled, payment_count)
      VALUES ('auth@example.test', $1, 1, 0, 1, 1) RETURNING *`, [hash])).rows[0];
    const service = new PasskeyService({ db: { pool } });
    const authenticator = new TestAuthenticator();
    const handle = await service.repository.getOrCreateUserHandle(user.id);
    const key = await service.repository.insertCredentialWithinLimit({ userId: user.id, name: '同步密钥',
      credentialId: authenticator.id, publicKey: await authenticator.publicKey(), counter: 0,
      transports: ['internal'], deviceType: 'multiDevice', backedUp: true });
    const ceremony = await service.createAuthenticationOptions();
    assert.equal(ceremony.options.rpId, 'tl.lolok.dpdns.org');
    assert.equal(ceremony.options.userVerification, 'required');
    assert.equal(ceremony.options.timeout, 300000);
    assert.equal(Object.hasOwn(ceremony.options, 'allowCredentials'), false);
    const stored = (await pool.query('SELECT * FROM webauthn_challenges WHERE id = $1', [ceremony.ceremony_id])).rows[0];
    assert.equal(stored.type, 'authentication');
    assert.equal(stored.user_id, null);
    assert.equal(Number(stored.expires_at) - Number(stored.created_at), 300);
    console.log('PASS 无用户名选项省略 allowCredentials，固定 RP、UV 与匿名五分钟挑战');

    const payload = { ceremony_id: ceremony.ceremony_id, response: authenticator.response(ceremony.options, { userHandle: handle }) };
    const login = await service.verifyAuthentication(payload);
    assert.deepEqual(Object.keys(login).sort(), ['expires_in', 'token', 'user']);
    assert.equal(login.expires_in, 604800);
    assert.deepEqual(login.user, { id: user.id, email: 'auth@example.test', plan_name: '认证套餐', expire_at: '0', enabled: 1 });
    const decoded = jwt.verify(login.token, config.user.jwtSecret);
    assert.deepEqual(Object.keys(decoded).sort(), ['email', 'exp', 'iat', 'id', 'plan_id']);
    assert.equal(decoded.id, user.id);
    assert.equal(decoded.plan_id, 1);
    const passwordLogin = await authService.login({ prepare() { return { get() { return { ...user, plan_name: '认证套餐' }; } }; } },
      { email: user.email, password });
    assert.deepEqual(passwordLogin.user, login.user);
    assert.equal(passwordLogin.expires_in, login.expires_in);
    const passwordJwt = jwt.verify(passwordLogin.token, config.user.jwtSecret);
    assert.equal(decoded.exp - decoded.iat, passwordJwt.exp - passwordJwt.iat);
    let credential = await service.repository.findCredentialForAuthentication(authenticator.id);
    assert.equal(Number(credential.counter), 0);
    assert.ok(Number(credential.last_used_at) > 0);
    assert.equal(credential.backed_up, true);
    await assert.rejects(service.verifyAuthentication(payload), authenticationFailure);
    console.log('PASS Credential ID 识别用户，真实 0→0 签名、最近使用时间和密码兼容 JWT');

    const errors = [{ origin: 'https://evil.example.test' }, { rpId: 'evil.example.test' }, { flags: 0x19 },
      { challenge: 'wrong-challenge' }, { invalidSignature: true }, { userHandle: 'wrong-user' }];
    for (const overrides of errors) {
      const item = await service.createAuthenticationOptions();
      await assert.rejects(service.verifyAuthentication({ ceremony_id: item.ceremony_id,
        response: authenticator.response(item.options, overrides) }), authenticationFailure);
      assert.ok((await pool.query('SELECT used_at FROM webauthn_challenges WHERE id = $1', [item.ceremony_id])).rows[0].used_at);
    }
    const expired = await service.createAuthenticationOptions();
    await pool.query('UPDATE webauthn_challenges SET expires_at = 1 WHERE id = $1', [expired.ceremony_id]);
    await assert.rejects(service.verifyAuthentication({ ceremony_id: expired.ceremony_id,
      response: authenticator.response(expired.options) }), authenticationFailure);
    const unknown = await service.createAuthenticationOptions();
    await assert.rejects(service.verifyAuthentication({ ceremony_id: unknown.ceremony_id,
      response: new TestAuthenticator().response(unknown.options) }), authenticationFailure);
    assert.ok((await pool.query('SELECT used_at FROM webauthn_challenges WHERE id = $1', [unknown.ceremony_id])).rows[0].used_at);
    console.log('PASS 真实验证器拒绝 Origin/RP/UV/挑战/签名/handle 错误，未知凭据及过期统一响应');

    for (const state of [{ enabled: 0, disable_reason: DISABLE_REASONS.ADMIN, payment_count: 1, denied: true },
      { enabled: 0, disable_reason: null, payment_count: 0, denied: true },
      { enabled: 0, disable_reason: DISABLE_REASONS.TRAFFIC_LIMIT, payment_count: 1 },
      { enabled: 0, disable_reason: DISABLE_REASONS.EXPIRED, payment_count: 1 }]) {
      await pool.query('UPDATE users SET enabled = $2, disable_reason = $3, payment_count = $4 WHERE id = $1',
        [user.id, state.enabled, state.disable_reason, state.payment_count]);
      const item = await service.createAuthenticationOptions();
      const attempt = service.verifyAuthentication({ ceremony_id: item.ceremony_id, response: authenticator.response(item.options) });
      if (state.denied) await assert.rejects(attempt, error => error.code === 2003);
      else assert.ok((await attempt).token);
    }
    await pool.query('UPDATE users SET enabled = 1, disable_reason = NULL, payment_count = 1 WHERE id = $1', [user.id]);
    console.log('PASS 管理员禁用与未支付拒绝，流量/到期暂停仍可登录续费');

    const counterCeremony = await service.createAuthenticationOptions();
    await service.verifyAuthentication({ ceremony_id: counterCeremony.ceremony_id,
      response: authenticator.response(counterCeremony.options, { counter: 7, flags: 0x0d }) });
    credential = await service.repository.findCredentialForAuthentication(authenticator.id);
    assert.equal(Number(credential.counter), 7);
    assert.equal(credential.backed_up, false);
    const stale = await service.createAuthenticationOptions();
    await assert.rejects(service.verifyAuthentication({ ceremony_id: stale.ceremony_id,
      response: authenticator.response(stale.options, { counter: 7 }) }), authenticationFailure);
    // 两个独立挑战均可合法验证，但凭据更新必须保留旧计数器条件。
    const updates = await Promise.all([8, 9].map(counter => service.repository.updateAuthenticationState({
      passkeyId: key.id, counter, expectedCounter: 7, backedUp: true })));
    assert.equal(updates.filter(Boolean).length, 1);
    const currentCounter = Number((await service.repository.findCredentialForAuthentication(authenticator.id)).counter);
    assert.ok([8, 9].includes(currentCounter));
    const race = await service.createAuthenticationOptions();
    const racePayload = { ceremony_id: race.ceremony_id,
      response: authenticator.response(race.options, { counter: currentCounter + 1 }) };
    const replay = await Promise.allSettled([0, 1].map(() => service.verifyAuthentication(racePayload)));
    assert.equal(replay.filter(item => item.status === 'fulfilled').length, 1);
    authenticationFailure(replay.find(item => item.status === 'rejected').reason);
    console.log('PASS 非零计数器增长、回退拒绝、数据库 CAS 防覆盖和并发挑战单次消费');

    const webauthn = await import('@simplewebauthn/server');
    const concurrent = await Promise.all([0, 1].map(() => service.createAuthenticationOptions()));
    let release;
    let verified = 0;
    const gate = new Promise(resolve => { release = resolve; });
    // 保留真实签名验证，仅在验证完毕时屏障同步，确保两个请求读到相同旧计数器。
    const concurrentService = new PasskeyService({ db: { pool }, webauthn: {
      async verifyAuthenticationResponse(options) {
        const result = await webauthn.verifyAuthenticationResponse(options);
        if (++verified === 2) release();
        await gate;
        return result;
      }
    } });
    const counterRace = await Promise.allSettled(concurrent.map((item, index) => concurrentService.verifyAuthentication({
      ceremony_id: item.ceremony_id, response: authenticator.response(item.options, { counter: currentCounter + 2 + index })
    })));
    assert.equal(counterRace.filter(item => item.status === 'fulfilled').length, 1);
    authenticationFailure(counterRace.find(item => item.status === 'rejected').reason);
    console.log('PASS 两个独立挑战同时签名成功后，服务 CAS 竞争只允许一个签发 JWT');

    const app = express();
    app.locals.db = { pool };
    app.use('/api/admin/passkeys', require('../routes/admin/passkeys'));
    require('../bootstrap/register-user-routes')(app, { error() {} });
    const base = '/api/user/auth';
    for (const [url, method] of [['/passkeys', 'GET'], ['/passkeys/registration/options', 'POST'],
      ['/passkeys/registration/verify', 'POST'], ['/passkeys/1', 'DELETE']]) {
      assert.equal((await request(app, base + url, { method })).status, 401);
    }
    const token = authService.issueLoginResult({ ...user, plan_name: '认证套餐' }).token;
    // 配置缺失或不合法必须阻断所有入口；固定请求 Host 不能补全可信部署配置。
    const originalWebauthn = config.webauthn;
    const originalEnvironment = process.env.NODE_ENV;
    const adminToken = jwt.sign({ id: 45, username: 'config-test-admin' }, config.admin.jwtSecret);
    const pendingRegistration = await service.createRegistrationOptions(user.id, { password });
    const pendingAuthentication = await service.createAuthenticationOptions();
    const invalidConfigurations = [
      undefined, null, {},
      { rpId: undefined }, { rpId: null }, { rpId: '' }, { rpId: 42 },
      { rpId: 'https://tl.lolok.dpdns.org' }, { rpId: 'tl.lolok.dpdns.org:443' },
      { rpId: 'tl..lolok.dpdns.org' }, { rpId: '-tl.lolok.dpdns.org' },
      { rpId: 'tl_lolok.dpdns.org' }, { rpId: '127.0.0.1' },
      { origin: undefined }, { origin: null }, { origin: '' }, { origin: 42 },
      { origin: 'invalid-origin' }, { origin: 'http://tl.lolok.dpdns.org' },
      { origin: 'ftp://tl.lolok.dpdns.org' }, { origin: 'https://tl.lolok.dpdns.org:443' },
      { origin: 'https://tl.lolok.dpdns.org:8443' }, { origin: 'https://tl.lolok.dpdns.org/path' },
      { origin: 'https://tl.lolok.dpdns.org?unsafe=1' }, { origin: 'https://tl.lolok.dpdns.org#fragment' },
      { origin: 'https://user:password@tl.lolok.dpdns.org' },
      { origin: 'https://other.example.test' }, { origin: 'https://sub.tl.lolok.dpdns.org' },
      // 固定配额/TTL 与 RP 名称也属于部署安全边界，忽略文件漏字段时必须拒绝。
      ...[undefined, null, 0, 1, 3, -1, NaN, Infinity, '2'].map(maxPasskeys => ({ maxPasskeys })),
      ...[undefined, null, 0, 299, 301, -1, NaN, Infinity, '300'].map(challengeTtlSeconds => ({ challengeTtlSeconds })),
      ...[undefined, null, '', '   ', 42].map(rpName => ({ rpName }))
    ];
    const endpoints = [
      [base + '/passkeys', 'GET', token, {}],
      [base + '/passkeys/registration/options', 'POST', token, { password }],
      [base + '/passkeys/registration/verify', 'POST', token,
        { ceremony_id: pendingRegistration.ceremony_id, response: { id: 'valid', response: {} } }],
      [base + '/passkeys/' + key.id, 'DELETE', token, { password }],
      [base + '/passkey/login/options', 'POST', undefined, {}],
      [base + '/passkey/login/verify', 'POST', undefined,
        { ceremony_id: pendingAuthentication.ceremony_id, response: { id: 'valid', response: {} } }],
      ['/api/admin/passkeys', 'GET', adminToken, {}],
      ['/api/admin/passkeys/' + key.id, 'DELETE', adminToken, {}]
    ];
    const challengeCount = Number((await pool.query('SELECT COUNT(*) AS count FROM webauthn_challenges')).rows[0].count);
    try {
      process.env.NODE_ENV = 'production';
      for (const [index, invalid] of invalidConfigurations.entries()) {
        // 每组使用独立合成身份，避免服务不可用响应累积到密码失败限流窗口。
        const configToken = authService.issueLoginResult({ ...user, id: 9000 + index }).token;
        config.webauthn = invalid === undefined || invalid === null || Object.keys(invalid).length === 0
          ? invalid : { ...originalWebauthn, ...invalid };
        for (const [url, method, endpointToken, body] of endpoints) {
          const result = await request(app, url, { method, token: endpointToken === token ? configToken : endpointToken, body,
            ip: `192.0.2.${100 + index}`, host: 'tl.lolok.dpdns.org' });
          assert.equal(result.status, 503, `配置 ${index} 的 ${method} ${url} 必须返回服务不可用`);
          assert.equal(result.body.code, 2110);
          assert.equal(result.body.message, 'Passkey 服务暂不可用，请使用密码登录或联系管理员');
          assert.equal(result.body.data, null);
        }
      }
      assert.equal(Number((await pool.query('SELECT COUNT(*) AS count FROM webauthn_challenges')).rows[0].count), challengeCount,
        '错误部署配置不能签发任何挑战');
      const pending = await pool.query('SELECT used_at FROM webauthn_challenges WHERE id = ANY($1::text[])',
        [[pendingRegistration.ceremony_id, pendingAuthentication.ceremony_id]]);
      assert.equal(pending.rows.length, 2);
      assert.ok(pending.rows.every(row => row.used_at === null), '配置错误不得消费尚未验证的挑战');
      config.webauthn = originalWebauthn;
      const validProduction = await request(app, base + '/passkey/login/options', { ip: '192.0.2.199' });
      assert.equal(validProduction.status, 200);
      assert.equal(validProduction.body.data.options.rpId, 'tl.lolok.dpdns.org');
      assert.equal((await pool.query('SELECT id FROM user_passkeys WHERE id = $1', [key.id])).rows.length, 1);
      console.log('PASS RP/Origin、非空 RP 名称、固定上限 2 和 TTL 300 校验令用户六入口和管理两入口一致返回 503；有效配置恢复正常');
      process.env.NODE_ENV = 'development';
      config.webauthn = { ...originalWebauthn, rpId: 'localhost', origin: 'http://localhost:5173' };
      const localOptions = await new PasskeyService({ db: { pool } }).createAuthenticationOptions();
      assert.equal(localOptions.options.rpId, 'localhost');
      console.log('PASS 开发环境仍允许 localhost HTTP 和显式端口，不影响本地验证');
    } finally {
      config.webauthn = originalWebauthn;
      if (originalEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalEnvironment;
    }
    // 签发额度累计成功响应，不能由 verify 的失败计数或成功认证清空。
    const quotaIp = '203.0.113.50';
    for (let index = 0; index < 20; index++) {
      assert.equal((await request(app, base + '/passkey/login/options', { ip: quotaIp })).status, 200);
    }
    const countBeforeQuota = Number((await pool.query('SELECT COUNT(*) AS count FROM webauthn_challenges')).rows[0].count);
    const quotaBlocked = await request(app, base + '/passkey/login/options', { ip: quotaIp });
    assert.equal(quotaBlocked.status, 429, '公开 options 必须限制成功签发次数，不能无限插入挑战');
    assert.equal(quotaBlocked.body.code, 1003);
    assert.ok(Number(quotaBlocked.headers['retry-after']) > 0);
    assert.ok(Number(quotaBlocked.headers['retry-after']) <= 60);
    assert.equal(Number((await pool.query('SELECT COUNT(*) AS count FROM webauthn_challenges')).rows[0].count), countBeforeQuota);
    assert.equal((await request(app, base + '/passkey/login/options', { ip: '203.0.113.51' })).status, 200);
    assert.equal((await request(app, base + '/passkey/login/verify', { ip: quotaIp, body: {} })).status, 400);
    console.log('PASS 匿名 options 单 IP 每分钟最多签发 20 次，成功也占额度，拒绝不写库、IP 和 verify 窗口独立');
    const validationUser = (await pool.query(`INSERT INTO users
      (email, password_hash, plan_id, expire_at, enabled, payment_count)
      VALUES ('validation@example.test', $1, 1, 0, 1, 1) RETURNING *`, [hash])).rows[0];
    const validationToken = authService.issueLoginResult(validationUser).token;
    assert.equal((await request(app, base + '/passkeys', { method: 'GET', token })).body.data.list.length, 1);
    for (const [url, method, body] of [['/passkeys/registration/options', 'POST', {}],
      ['/passkeys/registration/verify', 'POST', { ceremony_id: 'valid', response: {} }],
      ['/passkeys/not-a-number', 'DELETE', { password }], ['/passkeys/0', 'DELETE', { password }]]) {
      const result = await request(app, base + url, { method, token: validationToken, body });
      assert.equal(result.status, 400);
      assert.equal(result.body.code, 1001);
      assert.equal(result.body.data, null);
    }
    const enrollment = await request(app, base + '/passkeys/registration/options', { token, body: { password, name: '路由密钥' } });
    assert.equal(enrollment.status, 200);
    const secondAuthenticator = new TestAuthenticator();
    const registered = await request(app, base + '/passkeys/registration/verify', { token, body: {
      ceremony_id: enrollment.body.data.ceremony_id, name: '路由密钥',
      response: await secondAuthenticator.registrationResponse(enrollment.body.data.options)
    } });
    assert.equal(registered.status, 200);
    assert.deepEqual(Object.keys(registered.body.data).sort(), ['created_at', 'id', 'last_used_at', 'name']);
    const deleteUrl = base + '/passkeys/' + registered.body.data.id;
    assert.equal((await request(app, deleteUrl, { method: 'DELETE', token, body: { password: 'wrong' } })).body.code, 2101);
    assert.equal((await request(app, deleteUrl, { method: 'DELETE', token, body: { password } })).status, 200);
    assert.equal((await request(app, base + '/passkeys', { method: 'GET', token })).body.data.remaining, 1);
    // 名称属于消费挑战后的业务校验；失败后即使更正名称也不能重放同一挑战。
    for (const name of ['长'.repeat(51), { invalid: true }]) {
      const badNameCeremony = await service.createRegistrationOptions(user.id, { password });
      const response = await new TestAuthenticator().registrationResponse(badNameCeremony.options);
      const body = { ceremony_id: badNameCeremony.ceremony_id, response, name };
      const invalidName = await request(app, base + '/passkeys/registration/verify', { token, body });
      assert.equal(invalidName.status, 400);
      assert.equal(invalidName.body.code, 2102, 'HTTP 名称错误必须经过消费挑战后的业务校验');
      const corrected = await request(app, base + '/passkeys/registration/verify', {
        token, body: { ...body, name: '已更正' }
      });
      assert.equal(corrected.body.code, 2104);
    }
    console.log('PASS HTTP 注册 verify 的名称业务错误先消费挑战，更正名称也不能重放');

    const protectedUsers = (await pool.query(`INSERT INTO users
      (email, password_hash, plan_id, expire_at, enabled, payment_count) VALUES
      ('limited@example.test', $1, 1, 0, 1, 1), ('isolated@example.test', $1, 1, 0, 1, 1) RETURNING *`, [hash])).rows;
    const limitedToken = authService.issueLoginResult(protectedUsers[0]).token;
    const isolatedToken = authService.issueLoginResult(protectedUsers[1]).token;
    // 成功选项请求不占额度；失败请求在两条接口间交替，并更换 IP 和伪造 body.userId。
    for (let index = 0; index < 5; index++) {
      assert.equal((await request(app, base + '/passkeys/registration/options', {
        token: limitedToken, body: { password }, ip: '192.0.2.50'
      })).status, 200);
      const disposable = await service.repository.insertCredentialWithinLimit({ userId: protectedUsers[0].id,
        name: `临时删除测试 ${index}`, credentialId: `${authenticator.id}-${index}`,
        publicKey: await authenticator.publicKey(), counter: 0, transports: ['internal'],
        deviceType: 'multiDevice', backedUp: true });
      assert.equal((await request(app, base + '/passkeys/' + disposable.id, {
        method: 'DELETE', token: limitedToken, body: { password }, ip: '192.0.2.50'
      })).status, 200);
    }
    for (let index = 0; index < 3; index++) {
      const result = await request(app, index % 2 ? base + '/passkeys/1' : base + '/passkeys/registration/options', {
        method: index % 2 ? 'DELETE' : 'POST', token: limitedToken,
        body: { password: 'wrong', userId: index + 800 }, ip: `192.0.2.${60 + index}`
      });
      assert.equal(result.status, 400);
      assert.equal(result.body.code, 2101);
      if (index === 0) {
        // 成功请求不应清空之前已累计的密码失败。
        assert.equal((await request(app, base + '/passkeys/registration/options', {
          token: limitedToken, body: { password }
        })).status, 200);
      }
    }
    for (const [url, method] of [['/passkeys/registration/options', 'POST'], ['/passkeys/1', 'DELETE']]) {
      const blocked = await request(app, base + url, { method, token: limitedToken,
        body: { password, userId: protectedUsers[1].id }, ip: '192.0.2.99' });
      assert.equal(blocked.status, 429, '密码复验两条接口必须共享用户失败窗口');
      assert.ok(Number(blocked.headers['retry-after']) > 0);
    }
    assert.equal((await request(app, base + '/passkeys/registration/options', {
      token: isolatedToken, body: { password }, ip: '192.0.2.99'
    })).status, 200);
    const independentFailure = await request(app, base + '/passkeys/1', {
      method: 'DELETE', token: isolatedToken, body: { password: 'wrong' }, ip: '192.0.2.99'
    });
    assert.equal(independentFailure.body.code, 2101);
    console.log('PASS 密码复验按可信用户 ID 共享失败窗口，交替接口/换 IP/伪造用户不可绕过，成功不计数且不同用户隔离');
    const publicOptions = await request(app, base + '/passkey/login/options');
    assert.equal(publicOptions.status, 200);
    assert.equal(publicOptions.body.data.options.rpId, 'tl.lolok.dpdns.org');
    assert.equal(Object.hasOwn(publicOptions.body.data.options, 'allowCredentials'), false);
    const wrongHost = await request(app, base + '/passkey/login/verify', { ip: '192.0.2.11', body: {
      ceremony_id: publicOptions.body.data.ceremony_id,
      response: authenticator.response(publicOptions.body.data.options, { counter: currentCounter + 2,
        origin: 'https://evil.example.test' }) } });
    assert.equal(wrongHost.status, 401);
    assert.equal(wrongHost.body.code, 2109);
    console.log('PASS 最终 API 前缀、管理接口 JWT、参数脱敏校验及 Host/转发头不能改变来源');

    const ipLocation = require('../services/shared/ip-location-service');
    const record = ipLocation.recordUserIpLocation;
    const recorded = [];
    ipLocation.recordUserIpLocation = async (...args) => { recorded.push(args.slice(1)); };
    try {
      // options 成功占独立签发额度；verify 成功不占失败额度，登录 IP 应异步记录。
      for (let index = 0; index < 5; index++) {
        const options = await request(app, base + '/passkey/login/options', { ip: '192.0.2.20' });
        assert.equal(options.status, 200);
        const result = await request(app, base + '/passkey/login/verify', { ip: '192.0.2.20', body: {
          ceremony_id: options.body.data.ceremony_id,
          response: authenticator.response(options.body.data.options, { counter: currentCounter + 5 + index }) } });
        assert.equal(result.status, 200);
        assert.equal(result.body.data.user.id, user.id);
      }
      assert.equal(recorded.length, 5);
      assert.deepEqual(recorded[0], [user.id, 'login', '192.0.2.20']);
      for (let index = 0; index < 3; index++) {
        const failure = await request(app, base + '/passkey/login/verify', { ip: '192.0.2.30', body: {} });
        assert.equal(failure.status, 400);
        assert.equal(failure.body.data, null);
      }
      const blocked = await request(app, base + '/passkey/login/verify', { ip: '192.0.2.30', body: {} });
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers['retry-after']) > 0);
      assert.equal((await request(app, base + '/passkey/login/options', { ip: '192.0.2.30' })).status, 200);
      assert.equal((await request(app, '/api/user/login', { ip: '192.0.2.30', body: {} })).status, 400);
      console.log('PASS 独立 IP 失败限流、Retry-After、成功不计数和登录 IP 异步记录');
    } finally { ipLocation.recordUserIpLocation = record; }

    const revoked = await service.createAuthenticationOptions();
    await service.repository.deleteOwnedCredential(user.id, key.id);
    await assert.rejects(service.verifyAuthentication({ ceremony_id: revoked.ceremony_id,
      response: authenticator.response(revoked.options, { counter: currentCounter + 20 }) }), authenticationFailure);
    console.log('PASS 已撤销凭据统一失败，Passkey 无用户名认证全部集成测试通过');
  } finally {
    if (pool) await pool.end();
    try {
      assert.match(schema, /^passkey_auth_test_[a-f0-9]{16}$/);
      await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally { await control.end(); }
  }
}

run().catch(error => {
  // 断言可能包含协议数据，只报告安全位置和错误类型，不输出完整错误对象。
  console.error('FAIL Passkey 认证:', error.code || error.name,
    error.stack?.split('\n').find(line => line.includes('test-passkey-authentication.js'))?.trim() || '认证方法缺失');
  process.exitCode = 1;
});
