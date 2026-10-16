/**
 * Passkey 数据层集成测试。
 * 职责：在随机 PostgreSQL schema 中验证迁移、事务并发与查询结果，不接触业务表。
 * 参数：使用本地数据库配置；所有随机 schema 均在 finally 中校验名称后清理。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const config = require('../config');

/** 执行测试；迁移缺失时先失败，已有实现时仅连接隔离测试 schema。 */
async function run() {
  const migrationPath = path.join(__dirname, '../db/migrations/033-passkeys.js');
  assert.ok(fs.existsSync(migrationPath), '缺少 Passkey 数据库迁移 033-passkeys.js');
  const { up } = require(migrationPath);
  const PasskeyRepository = require('../repositories/passkey-repository');
  const { initTables } = require('../db/schema/tables');
  const { createIndexes } = require('../db/schema/indexes');
  const { deleteUserLocalRelatedData } = require('../repositories/user-repository');
  const suffix = crypto.randomBytes(8).toString('hex');
  const schemaNames = ['fresh', 'migrated', 'rollback'].map(kind => `passkey_test_${suffix}_${kind}`);
  const control = new Pool({ ...config.database, connectionTimeoutMillis: 5000 });
  const pools = [];
  try {
    for (const schema of schemaNames) {
      await control.query(`CREATE SCHEMA "${schema}"`);
      pools.push(new Pool({ ...config.database, options: `-c search_path=${schema}`, max: 8 }));
    }
    const [fresh, migrated, rollback] = pools;
    await initTables(fresh, { info() {} });
    await createIndexes(fresh, { info() {} });
    await migrated.query('CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT NOT NULL)');
    await up(migrated);
    await up(migrated);
    const freshColumns = await inspectPasskeyColumns(fresh);
    assert.deepEqual(await inspectPasskeyColumns(migrated), freshColumns);
    assert.ok(freshColumns.some(row => row.table_name === 'users' && row.column_name === 'webauthn_user_id'));
    assert.ok(freshColumns.some(row => row.table_name === 'user_passkeys' && row.column_name === 'public_key' && row.udt_name === 'bytea'));
    assert.ok(freshColumns.some(row => row.table_name === 'user_passkeys' && row.column_name === 'transports' && row.udt_name === 'jsonb'));
    const freshConstraints = await inspectConstraints(fresh);
    assert.deepEqual(await inspectConstraints(migrated), freshConstraints);
    assert.ok(freshConstraints.some(row => row.definition.includes('ON DELETE CASCADE')));
    assert.deepEqual(await inspectIndexes(migrated), await inspectIndexes(fresh));
    console.log('PASS 数据库结构：全新 schema、幂等迁移、字段、约束和索引一致');

    await rollback.query('CREATE TABLE users (id SERIAL PRIMARY KEY)');
    await rollback.query('CREATE TABLE user_passkeys (id INTEGER)');
    await assert.rejects(up(rollback));
    const rolledBack = await rollback.query("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'webauthn_user_id'");
    assert.equal(rolledBack.rows.length, 0);
    console.log('PASS 迁移失败回滚，不遗留部分字段');

    assert.equal(config.webauthn.rpId, process.env.WEBAUTHN_RP_ID || 'tl.lolok.dpdns.org');
    assert.equal(config.webauthn.origin, process.env.WEBAUTHN_ORIGIN || 'https://tl.lolok.dpdns.org');
    assert.equal(config.webauthn.maxPasskeys, 2);
    assert.ok(config.webauthn.rpName);
    const repository = new PasskeyRepository({ pool: fresh });
    const user = (await fresh.query("INSERT INTO users (email, password_hash) VALUES ('passkey-one@example.test', 'test-only') RETURNING id")).rows[0];
    const user2 = (await fresh.query("INSERT INTO users (email, password_hash) VALUES ('passkey-two@example.test', 'test-only') RETURNING id")).rows[0];
    await fresh.query("INSERT INTO users (email, password_hash) VALUES ('no-passkeys@example.test', 'test-only')");
    const handles = await Promise.all(Array.from({ length: 6 }, () => repository.getOrCreateUserHandle(user.id)));
    assert.equal(new Set(handles).size, 1);
    assert.match(handles[0], /^[A-Za-z0-9_-]{43}$/);
    const handleClient = await fresh.connect();
    try {
      assert.equal(await repository.getOrCreateUserHandle(user.id, handleClient), handles[0]);
    } finally {
      handleClient.release();
    }
    await assert.rejects(repository.getOrCreateUserHandle(999999), { code: 'USER_NOT_FOUND' });
    console.log('PASS 稳定 user handle：并发只生成一次，支持专用连接');

    const results = await Promise.allSettled([0, 1, 2, 3].map(index => repository.insertCredentialWithinLimit(credential(user.id, `device-${index}`))));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
    assert.ok(results.filter(result => result.status === 'rejected').every(result => result.reason.code === 'PASSKEY_LIMIT_REACHED'));
    const ownKeys = await repository.listUserPasskeys(user.id);
    assert.equal(ownKeys.length, 2);
    assert.ok(ownKeys.every(row => !('credential_id' in row) && !('public_key' in row)));
    const key = (await fresh.query('SELECT * FROM user_passkeys WHERE user_id = $1 ORDER BY id', [user.id])).rows[0];
    const authKey = await repository.findCredentialForAuthentication(key.credential_id);
    assert.equal(authKey.user_id, user.id);
    assert.deepEqual(authKey.public_key, Buffer.from([1, 2, 3]));
    assert.equal(await repository.findCredentialForAuthentication('missing'), null);
    await repository.updateAuthenticationState({ passkeyId: key.id, counter: 12, backedUp: true });
    const authenticated = await repository.findCredentialForAuthentication(key.credential_id);
    assert.equal(Number(authenticated.counter), 12);
    assert.equal(authenticated.backed_up, true);
    assert.ok(Number(authenticated.last_used_at) > 0);
    await assert.rejects(repository.insertCredentialWithinLimit(credential(999999, 'missing')), { code: 'USER_NOT_FOUND' });
    console.log('PASS 数量上限：并发注册最多两个，认证状态持久化且列表隐藏敏感字段');

    const challenge = await repository.createChallenge({ type: 'registration', userId: user.id, challenge: 'test-only-registration' });
    assert.equal(Number(challenge.expires_at) - Number(challenge.created_at), 120);
    assert.equal(await repository.consumeChallenge({ id: challenge.id, type: 'authentication', userId: user.id }), null);
    assert.equal(await repository.consumeChallenge({ id: challenge.id, type: 'registration', userId: user2.id }), null);
    assert.equal(await repository.consumeChallenge({ id: 'missing', type: 'registration', userId: user.id }), null);
    const consumed = await Promise.all([0, 1].map(() => repository.consumeChallenge({ id: challenge.id, type: 'registration', userId: user.id })));
    assert.equal(consumed.filter(Boolean).length, 1);
    const expired = await repository.createChallenge({ type: 'authentication', challenge: 'test-only-expired' });
    await fresh.query('UPDATE webauthn_challenges SET expires_at = 1 WHERE id = $1', [expired.id]);
    assert.equal(await repository.consumeChallenge({ id: expired.id, type: 'authentication' }), null);
    const discoverable = await repository.createChallenge({ type: 'authentication', challenge: 'test-only-discoverable' });
    assert.equal(await repository.consumeChallenge({ id: discoverable.id, type: 'authentication', userId: user.id }), null);
    assert.ok(await repository.consumeChallenge({ id: discoverable.id, type: 'authentication' }));
    const boundary = await repository.createChallenge({ type: 'authentication', challenge: 'test-only-boundary' });
    // 固定事务时间在数据库连接内，精确覆盖 expires_at 等于当前秒仍有效的边界。
    const boundaryClient = await fresh.connect();
    try {
      await boundaryClient.query('BEGIN');
      await boundaryClient.query('UPDATE webauthn_challenges SET expires_at = FLOOR(EXTRACT(EPOCH FROM NOW())) WHERE id = $1', [boundary.id]);
      assert.ok(await new PasskeyRepository({ pool: boundaryClient }).consumeChallenge({ id: boundary.id, type: 'authentication' }));
      await boundaryClient.query('COMMIT');
    } finally {
      boundaryClient.release();
    }
    console.log('PASS 挑战消费：ID、类型、用户、到期边界、匿名认证和并发单次使用');

    // 用数据库内的确定时间覆盖过期清理边界，不依赖真实时钟等待。
    const cleanupClient = await fresh.connect();
    try {
      await cleanupClient.query('BEGIN');
      const cleanupRepository = new PasskeyRepository({ pool: cleanupClient });
      await cleanupClient.query('DELETE FROM webauthn_challenges WHERE expires_at < FLOOR(EXTRACT(EPOCH FROM NOW()))');
      await cleanupClient.query(`INSERT INTO webauthn_challenges (id, type, challenge, expires_at)
        SELECT 'cleanup-expired-' || number, 'authentication', 'expired-fixture', 1 FROM generate_series(1, 205) number`);
      const live = await cleanupRepository.createChallenge({ type: 'authentication', challenge: 'live-fixture' });
      assert.equal(Number((await cleanupClient.query('SELECT COUNT(*) AS count FROM webauthn_challenges WHERE expires_at = 1')).rows[0].count), 105,
        '每次签发必须有界清理最多 100 条过期匿名挑战');
      const exactBoundary = await cleanupRepository.createChallenge({ type: 'registration', userId: user.id, challenge: 'boundary-fixture' });
      await cleanupClient.query('UPDATE webauthn_challenges SET expires_at = FLOOR(EXTRACT(EPOCH FROM NOW())) WHERE id = $1', [exactBoundary.id]);
      await cleanupRepository.createChallenge({ type: 'authentication', challenge: 'trigger-cleanup' });
      assert.equal(Number((await cleanupClient.query('SELECT COUNT(*) AS count FROM webauthn_challenges WHERE expires_at = 1')).rows[0].count), 0);
      assert.ok(await cleanupRepository.consumeChallenge({ id: live.id, type: 'authentication' }), '有效匿名挑战必须保留');
      assert.ok(await cleanupRepository.consumeChallenge({ id: exactBoundary.id, type: 'registration', userId: user.id }), '等于当前秒的有效挑战不得误删');
      await cleanupClient.query('COMMIT');
    } catch (error) {
      await cleanupClient.query('ROLLBACK');
      throw error;
    } finally {
      cleanupClient.release();
    }
    console.log('PASS 每次签发有界清理 100 条过期匿名挑战，重复签发排空积压，有效及到期边界挑战保留');

    await assert.rejects(repository.insertCredentialWithinLimit({ ...credential(user2.id, 'duplicate'), credentialId: key.credential_id }), { code: '23505' });
    assert.equal((await repository.listUserPasskeys(user2.id)).length, 0);
    const secondKey = await repository.insertCredentialWithinLimit(credential(user2.id, 'search-needle'));
    await repository.insertCredentialWithinLimit(credential(user2.id, 'other-key'));
    const grouped = await repository.listAdminUsersWithPasskeys({ keyword: 'search-needle', page: 1, limit: 1 });
    assert.equal(grouped.total, 1);
    assert.equal(grouped.list[0].user_id, user2.id);
    assert.equal(grouped.list[0].email, 'passkey-two@example.test');
    assert.equal(Number(grouped.list[0].passkey_count), 2);
    assert.equal(grouped.list[0].passkey_limit, 2);
    assert.equal(grouped.list[0].passkeys.length, 2);
    assert.ok(grouped.list[0].passkeys.every(row => !('credential_id' in row) && !('public_key' in row)));
    const firstPage = await repository.listAdminUsersWithPasskeys({ page: 1, limit: 1 });
    const secondPage = await repository.listAdminUsersWithPasskeys({ page: 2, limit: 1 });
    assert.equal(firstPage.total, 2);
    assert.equal(firstPage.list.length, 1);
    assert.notEqual(firstPage.list[0].user_id, secondPage.list[0].user_id);
    assert.equal((await repository.listAdminUsersWithPasskeys({ keyword: 'passkey-one@' })).list[0].user_id, user.id);
    assert.equal((await repository.listAdminUsersWithPasskeys({ keyword: String(user.id) })).list[0].user_id, user.id);
    assert.equal((await repository.listAdminUsersWithPasskeys({ keyword: '%_' })).total, 0);
    assert.equal((await repository.listAdminUsersWithPasskeys({ page: 99, limit: 1 })).list.length, 0);
    console.log('PASS 管理端分组查询：按用户分页、名称命中返回全部密钥、字面搜索');

    assert.equal(await repository.deleteOwnedCredential(user.id, secondKey.id), null);
    assert.ok(await repository.deleteOwnedCredential(user2.id, secondKey.id));
    assert.equal(await repository.deleteOwnedCredential(user2.id, secondKey.id), null);
    const remaining = await repository.listUserPasskeys(user2.id);
    assert.ok(await repository.deleteCredentialByAdmin(remaining[0].id));
    assert.equal(await repository.deleteCredentialByAdmin(remaining[0].id), null);
    const localDb = {
      /** 将项目删除清单的问号参数转换为 pg 参数，仅供隔离 schema 测试使用。 */
      prepare(sql) {
        return {
          /** 执行删除清单 SQL；params 为该条语句的有序绑定参数。 */
          async run(...params) {
            let index = 0;
            const result = await fresh.query(sql.replace(/\?/g, () => `$${++index}`), params);
            return { changes: result.rowCount };
          }
        };
      }
    };
    const deleted = await deleteUserLocalRelatedData(localDb, { id: user.id, email: 'passkey-one@example.test' });
    assert.equal(deleted.user_passkeys, 2);
    assert.ok(deleted.webauthn_challenges > 0);
    assert.equal(deleted.users, 1);
    console.log('PASS 删除归属校验、管理端删除和本地用户关联记录显式清理');

    await repository.insertCredentialWithinLimit(credential(user2.id, 'cascade-test'));
    await repository.createChallenge({ type: 'registration', userId: user2.id, challenge: 'test-only-cascade' });
    await fresh.query('DELETE FROM users WHERE id = $1', [user2.id]);
    assert.equal((await repository.listUserPasskeys(user2.id)).length, 0);
    assert.equal(Number((await fresh.query('SELECT COUNT(*) AS count FROM webauthn_challenges WHERE user_id = $1', [user2.id])).rows[0].count), 0);
    console.log('PASS 重复凭据事务回滚和用户外键级联兜底');
    console.log('PASS Passkey Repository 全部集成测试通过');
  } finally {
    await Promise.all(pools.map(pool => pool.end()));
    try {
      for (const schema of schemaNames) {
        assert.match(schema, /^passkey_test_[a-f0-9]{16}_(fresh|migrated|rollback)$/);
        await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      }
    } finally {
      await control.end();
    }
  }
}

/** 读取 Passkey 相关列的实际数据库元数据，pool 必须绑定隔离 schema。 */
async function inspectPasskeyColumns(pool) {
  return (await pool.query(`SELECT table_name, column_name, udt_name, is_nullable, column_default
    FROM information_schema.columns WHERE table_schema = current_schema()
    AND (table_name IN ('user_passkeys', 'webauthn_challenges') OR (table_name = 'users' AND column_name = 'webauthn_user_id'))
    ORDER BY table_name, ordinal_position`)).rows;
}

/** 读取 Passkey 约束，避免全新安装与迁移具有不同外键或唯一性规则。 */
async function inspectConstraints(pool) {
  return (await pool.query(`SELECT c.relname AS table_name, pg_get_constraintdef(k.oid) AS definition
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relname IN ('user_passkeys', 'webauthn_challenges')
    ORDER BY table_name, definition`)).rows;
}

/** 读取功能索引并去除隔离 schema 差异，pool 为测试连接池。 */
async function inspectIndexes(pool) {
  return (await pool.query(`SELECT indexname, replace(indexdef, schemaname || '.', '') AS definition FROM pg_indexes
    WHERE schemaname = current_schema() AND (tablename IN ('user_passkeys', 'webauthn_challenges') OR indexname = 'idx_users_webauthn_user_id')
    ORDER BY indexname`)).rows;
}

/** 构造唯一测试凭据；userId 为归属用户，name 用于管理员名称搜索。 */
function credential(userId, name) {
  return { userId, name, credentialId: crypto.randomBytes(24).toString('base64url'), publicKey: Buffer.from([1, 2, 3]), counter: 0, transports: ['internal'], deviceType: 'multiDevice', backedUp: false };
}

run().catch(error => {
  // 不输出数据库参数或凭据内容，失败时仅输出断言位置和错误类型。
  console.error('FAIL Passkey Repository:', error.code || error.name, error.message.split('\n')[0]);
  process.exitCode = 1;
});
