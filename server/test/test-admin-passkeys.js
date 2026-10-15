/**
 * 管理端 Passkey 集成测试。
 * 职责：使用随机 PostgreSQL schema 验证真实鉴权、校验、用户分组分页、搜索和单密钥撤销。
 * 安全边界：只写隔离测试 schema；直接执行 Express router，不监听端口、不启动业务服务器。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const config = require('../config');

/**
 * 直接执行真实路由；db 为隔离数据库，token 为测试 JWT，method/url 为请求参数。
 * 核心分支：通过响应桩接收 JSON，路由未命中返回 404；不创建 HTTP 服务。
 */
function request(router, db, token, method = 'GET', url = '/') {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url, 'http://test.invalid');
    const query = {};
    for (const key of parsed.searchParams.keys()) {
      const values = parsed.searchParams.getAll(key);
      query[key] = values.length > 1 ? values : values[0];
    }
    const req = {
      method, url, originalUrl: url, headers: token ? { authorization: `Bearer ${token}` } : {},
      query, app: { locals: { db } }
    };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; }
    };
    router.handle(req, res, error => error ? reject(error) : resolve({ status: 404, body: null }));
  });
}

/** 检查公开响应；value 为 JSON 可序列化对象，所有 WebAuthn 材料字段均不得出现。 */
function assertSafe(value) {
  const serialized = JSON.stringify(value);
  for (const forbidden of ['credential_id', 'credentialId', 'public_key', 'publicKey', 'counter',
    'transports', 'webauthn_user_id', 'userHandle', 'attestationObject', 'clientDataJSON']) {
    assert.ok(!serialized.includes(`"${forbidden}"`), `响应不得包含 ${forbidden}`);
  }
}

/** 捕获当前操作日志；operation 是异步操作，finally 始终恢复全局 console。 */
async function captureLogs(operation) {
  const originals = { log: console.log, warn: console.warn, error: console.error };
  const logs = [];
  for (const level of Object.keys(originals)) console[level] = (...args) => logs.push(args.join(' '));
  try {
    return { result: await operation(), logs: logs.join('\n') };
  } finally {
    Object.assign(console, originals);
  }
}

/** 插入合成凭据；pool 为隔离连接池，userId/name 为归属与显示名，不使用真实认证材料。 */
async function insertKey(pool, userId, name) {
  return (await pool.query(`
    INSERT INTO user_passkeys (user_id, name, credential_id, public_key, counter, transports, device_type, backed_up)
    VALUES ($1, $2, $3, $4, 7, '["internal"]', 'singleDevice', false) RETURNING id
  `, [userId, name, crypto.randomBytes(16).toString('base64url'), Buffer.from([1, 2, 3])])).rows[0].id;
}

/** 按需求运行测试；模块缺失先 RED，完整实现后在隔离 schema 验证并清理所有测试数据。 */
async function run() {
  const routePath = path.join(__dirname, '../routes/admin/passkeys.js');
  assert.ok(fs.existsSync(routePath), '缺少管理端 Passkey 路由 server/routes/admin/passkeys.js');
  const router = require(routePath);
  const AdminPasskeyService = require('../services/admin/passkey-service');
  const { up } = require('../db/migrations/033-passkeys');
  const schema = `admin_passkey_test_${crypto.randomBytes(8).toString('hex')}`;
  const control = new Pool({ ...config.database, connectionTimeoutMillis: 5000 });
  let pool;
  try {
    await control.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ ...config.database, options: `-c search_path=${schema}`, max: 3 });
    await pool.query('CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT NOT NULL)');
    await up(pool);
    const db = { pool };
    const token = jwt.sign({ id: 45, username: 'passkey-test-admin' }, config.admin.jwtSecret, { expiresIn: '5m' });
    const userToken = jwt.sign({ id: 45, email: 'user@example.test' }, config.user.jwtSecret, { expiresIn: '5m' });
    for (const method of ['GET', 'DELETE']) {
      const url = method === 'GET' ? '/' : '/1';
      for (const invalidToken of [undefined, 'invalid-token', userToken]) {
        assert.equal((await request(router, db, invalidToken, method, url)).status, 401);
      }
    }
    console.log('PASS 管理员鉴权：列表与撤销拒绝匿名、无效和用户端 Token');

    for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=no', 'page=',
      'limit=0', 'limit=101', 'limit=1.5', 'limit=no', 'limit=', 'page=9007199254740992',
      'page=1&page=2', 'limit=1&limit=2', 'keyword=one&keyword=two']) {
      assert.equal((await request(router, db, token, 'GET', `/?${query}`)).status, 400, query);
    }
    for (const id of ['0', '-1', '1.5', 'no', '9007199254740992']) {
      assert.equal((await request(router, db, token, 'DELETE', `/${id}`)).status, 400, id);
    }
    assert.equal((await request(router, db, token, 'GET', '/?limit=100')).status, 200);
    console.log('PASS 参数校验：页码、1–100 条数、正整数 ID 和安全整数边界');

    await pool.query("INSERT INTO users (email) VALUES ('first@example.test'), ('second@example.test'), ('empty@example.test')");
    const firstKey = await insertKey(pool, 1, '家用电脑');
    const secondKey = await insertKey(pool, 1, '备用手机');
    const thirdKey = await insertKey(pool, 2, '唯一设备');
    const firstPage = await request(router, db, token, 'GET', '/?page=1&limit=1');
    const secondPage = await request(router, db, token, 'GET', '/?page=2&limit=1');
    assert.equal(firstPage.body.code, 0);
    assert.deepEqual([firstPage.body.data.total, firstPage.body.data.page, firstPage.body.data.limit], [2, 1, 1]);
    assert.equal(firstPage.body.data.list[0].user_id, 2);
    assert.equal(secondPage.body.data.list[0].user_id, 1);
    assert.equal(secondPage.body.data.list[0].passkey_count, 2);
    assert.equal(secondPage.body.data.list[0].passkey_limit, 2);
    assert.deepEqual(secondPage.body.data.list[0].passkeys.map(key => key.id), [secondKey, firstKey]);
    assert.deepEqual(Object.keys(secondPage.body.data.list[0].passkeys[0]).sort(), ['created_at', 'id', 'last_used_at', 'name']);
    assertSafe(firstPage.body);
    assertSafe(secondPage.body);
    console.log('PASS 用户分组分页：总数按用户计算，用户全部密钥保留在同一页，响应只含安全元数据');

    for (const keyword of ['first@example', '家用电脑', '1']) {
      const response = await request(router, db, token, 'GET', `/?keyword=${encodeURIComponent(keyword)}&limit=1`);
      assert.equal(response.body.data.total, 1);
      assert.equal(response.body.data.list[0].user_id, 1);
      assert.equal(response.body.data.list[0].passkeys.length, 2);
      assertSafe(response.body);
    }
    const empty = await request(router, db, token, 'GET', '/?keyword=missing');
    assert.deepEqual(empty.body.data, { list: [], total: 0, page: 1, limit: 20 });
    const beyond = await request(router, db, token, 'GET', '/?page=3&limit=1');
    assert.deepEqual(beyond.body.data, { list: [], total: 2, page: 3, limit: 1 });
    console.log('PASS 搜索：邮箱、用户 ID 和密钥名称匹配返回该用户所有密钥，空结果与越界页正常');

    const revoked = await captureLogs(() => request(router, db, token, 'DELETE', `/${firstKey}`));
    assert.equal(revoked.result.status, 200);
    assertSafe(revoked.result.body);
    assert.equal((await pool.query('SELECT id FROM user_passkeys ORDER BY id')).rows.length, 2);
    assert.deepEqual((await pool.query('SELECT id FROM user_passkeys ORDER BY id')).rows.map(row => row.id), [secondKey, thirdKey]);
    assert.match(revoked.logs, /"admin_id":45/);
    assert.match(revoked.logs, /"admin_username":"passkey-test-admin"/);
    assert.match(revoked.logs, /"user_id":1/);
    assert.match(revoked.logs, /"passkey_name":"家用电脑"/);
    assert.match(revoked.logs, /"result":"success"/);
    const missing = await captureLogs(() => request(router, db, token, 'DELETE', `/${firstKey}`));
    assert.equal(missing.result.status, 404);
    assert.match(missing.logs, /"result":"not_found"/);
    console.log('PASS 单密钥撤销：仅删除目标密钥，重复撤销返回 404，审计日志含可信管理员和目标元数据');

    // 仓储返回结构将来扩展时，服务白名单仍必须阻止额外认证材料泄露。
    const internal = { id: 99, user_id: 1, name: '测试设备', created_at: 1, last_used_at: null,
      credential_id: 'test-only-material', public_key: Buffer.from([9]), counter: 7,
      transports: ['internal'], webauthn_user_id: 'test-only-handle' };
    const service = new AdminPasskeyService({ pool: { async query(sql) {
      if (sql.includes('COUNT(*)')) return { rows: [{ total: '1' }] };
      if (sql.includes('SELECT u.id AS user_id')) return { rows: [{ user_id: 1, email: 'first@example.test' }] };
      return { rows: [internal] };
    } } });
    assertSafe(await service.list({ page: 1, limit: 20 }));
    assert.deepEqual(await service.revoke(99), { id: 99, user_id: 1, name: '测试设备', created_at: 1, last_used_at: null });
    const failed = await captureLogs(() => request(router, { pool: { async query() {
      throw new Error('test-only-material');
    } } }, token, 'DELETE', '/99'));
    assert.equal(failed.result.status, 500);
    assert.ok(!JSON.stringify(failed).includes('test-only-material'));
    assert.match(failed.logs, /"result":"error"/);
    const failedList = await captureLogs(() => request(router, { pool: { async query() {
      throw new Error('test-only-material');
    } } }, token));
    assert.equal(failedList.result.status, 500);
    assert.ok(!JSON.stringify(failedList).includes('test-only-material'));
    console.log('PASS 防泄露：仓储扩展字段由服务剔除，数据库异常内容不进入响应或日志');
  } finally {
    if (pool) await pool.end();
    assert.match(schema, /^admin_passkey_test_[a-f0-9]{16}$/);
    await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await control.end();
  }
  console.log('PASS 管理端 Passkey 测试全部通过');
}

run().catch(error => {
  console.error('FAIL 管理端 Passkey:', error.message);
  process.exitCode = 1;
});
