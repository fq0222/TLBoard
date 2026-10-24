/**
 * 订阅凭证轮换的数据基础测试。
 * 使用专用连接替身验证 SQL 边界，不连接实际数据库或远端面板。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

/** 验证迁移可重复执行且初始化建表包含同一可空时间字段。 */
async function testMigration() {
  const migrationPath = path.join(__dirname, '../db/migrations/035-subscription-credential-rotation.js');
  assert.ok(fs.existsSync(migrationPath), '凭证轮换迁移文件不存在');
  const migration = require(migrationPath);
  const calls = [];
  const client = {
    async query(sql) { calls.push(sql.replace(/\s+/g, ' ').trim()); return { rows: [] }; },
    release() { calls.push('release'); }
  };
  const pool = { async connect() { return client; } };
  await migration.up(pool);
  await migration.up({ pool, exec() { throw new Error('不允许绕过专用连接'); } });
  const expected = ['BEGIN', 'ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_credentials_rotated_at BIGINT', 'COMMIT', 'release'];
  assert.deepStrictEqual(calls, [...expected, ...expected]);
  assert.strictEqual(typeof migration.upWithDbProxy, 'function');
  assert.strictEqual(typeof migration.upWithPool, 'function');
  const source = fs.readFileSync(path.join(__dirname, '../db/schema/tables.js'), 'utf8');
  assert.match(source, /CREATE TABLE IF NOT EXISTS users \([\s\S]*?subscription_credentials_rotated_at BIGINT\s*,/);
  const failureCalls = [];
  await assert.rejects(() => migration.up({ async connect() { return {
    async query(sql) { failureCalls.push(sql.trim()); if (sql.includes('ALTER TABLE')) throw new Error('模拟 DDL 失败'); },
    release() { failureCalls.push('release'); }
  }; } }), /模拟 DDL 失败/);
  assert.deepStrictEqual(failureCalls.slice(-2), ['ROLLBACK', 'release']);
  console.log('PASS 迁移：幂等 SQL、初始化字段、失败回滚和连接释放');
}

/**
 * 记录专用连接发出的 SQL；仅替代外部 PostgreSQL，保留真实仓储全部执行路径。
 * respond 接收 SQL/参数并提供测试数据，failOn 用于注入明确的数据库失败。
 */
class RecordingClient {
  constructor(respond = () => ({ rows: [] }), failOn = () => false) {
    this.calls = [];
    this.respond = respond;
    this.failOn = failOn;
  }

  /** 规范化 SQL 以检查语义边界，命中失败分支则模拟数据库拒绝查询。 */
  async query(sql, params = []) {
    const text = sql.replace(/\s+/g, ' ').trim();
    this.calls.push({ sql: text, params });
    if (this.failOn(text)) throw new Error('模拟数据库失败');
    return this.respond(text, params);
  }

  /** 记录释放时机，以检测异常时专用连接泄漏。 */
  release() { this.calls.push({ sql: 'release', params: [] }); }
}

/** 验证事务读写共享用户锁定连接、任务先于提交、节点凭证更新保留 sub_id。 */
async function testRepositoryTransaction() {
  const repositoryPath = path.join(__dirname, '../repositories/subscription-credential-rotation-repository.js');
  assert.ok(fs.existsSync(repositoryPath), '凭证轮换仓储文件不存在');
  const repository = require(repositoryPath);
  const user = { id: 7, sub_id: 'old-token', subscription_credentials_rotated_at: 100 };
  const servers = [
    { id: 9, status: 1, panel_version: '3.6.0' },
    { id: 2, status: 1, panel_version: '3.4.2' },
    { id: 4, status: 1, panel_version: '3.4.1' },
    { id: 5, status: 1, panel_version: 'invalid' }
  ];
  const configs = [{ user_id: 7, server_id: 2, inbound_id: 10, sub_id: 'original-internal-id' }];
  const nodes = [{ server_id: 2, inbound_id: 10 }, { server_id: 2, inbound_id: 11 }];
  const client = new RecordingClient((sql) => {
    if (/FROM users/.test(sql)) return { rows: [user] };
    if (/FROM xui_servers/.test(sql)) return { rows: servers };
    if (/FROM xui_nodes/.test(sql)) return { rows: nodes };
    if (/FROM user_node_configs/.test(sql) && !/LIMIT 1/.test(sql)) return { rows: configs };
    if (/INSERT INTO xui_sync_tasks/.test(sql)) return { rows: [{ id: 44 }] };
    return { rows: [] };
  });
  const db = {
    pool: { async connect() { return client; } },
    prepare() { throw new Error('禁止使用连接池默认连接'); }
  };
  const baseline = '[{"server_id":2,"name":"旧节点"}]';
  const result = await repository.withRotationTransaction(db, 7, async (transactionClient, lockedUser) => {
    assert.strictEqual(transactionClient, client);
    assert.strictEqual(lockedUser, user);
    // 冷却判断必须读取 FOR UPDATE 返回值，不能在连接池外提前读取。
    assert.strictEqual(lockedUser.subscription_credentials_rotated_at, 100);
    const targets = await repository.listRotationTargets(transactionClient, 7);
    assert.deepStrictEqual(targets.servers.map(server => server.id), [2, 9]);
    assert.deepStrictEqual(targets.unsupportedServers.map(server => server.id), [4, 5]);
    assert.deepStrictEqual(targets.configs, configs);
    assert.deepStrictEqual(targets.nodes, nodes);
    assert.strictEqual(await repository.findCredentialCollision(transactionClient, 2, 7,
      { uuid: 'new-uuid', password: 'new-password', auth: 'new-auth' }), undefined);
    await repository.upsertServerConfigs(transactionClient, {
      userId: 7, serverId: 2, inboundIds: [10, 11], subId: 'original-internal-id',
      credentials: { uuid: 'new-uuid', password: 'new-password', auth: 'new-auth' }
    });
    await repository.replacePublicTokenAndBaseline(transactionClient,
      { userId: 7, subId: 'new-token', rotatedAt: 4000, nodesData: baseline });
    return repository.insertRotationTask(transactionClient,
      { userId: 7, serverIds: [9, 2, 9], now: 4000, credentials: { uuid: 'must-not-leak' } });
  });
  assert.deepStrictEqual(result, { id: 44 });
  assert.deepStrictEqual(client.calls.slice(0, 2).map(call => call.sql), ['BEGIN', 'SELECT * FROM users WHERE id = $1 FOR UPDATE']);
  assert.deepStrictEqual(client.calls[1].params, [7]);
  assert.deepStrictEqual(client.calls.slice(-2).map(call => call.sql), ['COMMIT', 'release']);
  const serverQuery = client.calls.find(call => /FROM xui_servers/.test(call.sql));
  assert.match(serverQuery.sql, /WHERE status = 1/);
  const locks = client.calls.filter(call => /pg_advisory_xact_lock/.test(call.sql));
  assert.deepStrictEqual(locks.map(call => call.params), [[31002, 2], [31002, 9]]);
  for (const table of ['xui_nodes', 'user_node_configs']) {
    const read = client.calls.find(call => call.sql.includes(`FROM ${table}`));
    assert.ok(client.calls.indexOf(read) > client.calls.indexOf(locks[1]));
    assert.deepStrictEqual(read.params.includes(7) ? read.params : [7, ...read.params], [7, [2, 9]]);
  }
  const collision = client.calls.find(call => /LIMIT 1/.test(call.sql));
  assert.match(collision.sql, /server_id = \$1 AND user_id <> \$2/);
  for (const [field, parameter] of [['uuid', 3], ['password', 4], ['auth', 5]]) {
    assert.ok(collision.sql.includes(`NULLIF($${parameter}, '') IS NOT NULL AND ${field} = $${parameter}`));
  }
  assert.deepStrictEqual(collision.params, [2, 7, 'new-uuid', 'new-password', 'new-auth']);
  const updates = client.calls.filter(call => /UPDATE user_node_configs|INSERT INTO user_node_configs/.test(call.sql));
  assert.strictEqual(updates.length, 3);
  assert.match(updates[0].sql, /WHERE user_id = \$1 AND server_id = \$2$/);
  assert.ok(!updates[0].sql.includes('sub_id'));
  assert.deepStrictEqual(updates[0].params, [7, 2, 'new-uuid', 'new-password', 'new-auth']);
  for (const call of updates.slice(1)) {
    assert.deepStrictEqual(call.params.slice(0, 2), [7, 2]);
    assert.deepStrictEqual(call.params.slice(3), ['new-uuid', 'new-password', 'new-auth', 'original-internal-id']);
    assert.ok(!/sub_id\s*=/.test(call.sql.split('DO UPDATE SET')[1]));
  }
  assert.deepStrictEqual(updates.slice(1).map(call => call.params[2]), [10, 11]);
  const userUpdate = client.calls.find(call => /UPDATE users/.test(call.sql));
  assert.match(userUpdate.sql, /sub_id = \$2, subscription_credentials_rotated_at = \$3/);
  assert.deepStrictEqual(userUpdate.params, [7, 'new-token', 4000]);
  const cacheDelete = client.calls.find(call => /DELETE FROM user_subscriptions/.test(call.sql));
  assert.deepStrictEqual(cacheDelete.params, [7]);
  const cacheInsert = client.calls.find(call => /INSERT INTO user_subscriptions/.test(call.sql));
  assert.deepStrictEqual(cacheInsert.params, [7, 'new-token', baseline, 4000]);
  const task = client.calls.find(call => /INSERT INTO xui_sync_tasks/.test(call.sql));
  assert.match(task.sql, /'credential_rotation_sync', 'pending'/);
  assert.deepStrictEqual(task.params, [7, '{"user_id":7,"serverIds":[2,9]}', 4000]);
  assert.ok(client.calls.indexOf(cacheDelete) < client.calls.indexOf(cacheInsert));
  assert.ok(client.calls.indexOf(cacheInsert) < client.calls.indexOf(task));
  assert.ok(client.calls.indexOf(task) < client.calls.length - 2);
  console.log('PASS 仓储：用户行锁、冷却读取、服务器锁顺序、碰撞 SQL、保留 sub_id、原子基线与任务');
}

/** 验证任务写入异常、用户不存在和冷却拒绝都回滚释放；不掩盖原始异常。 */
async function testRepositoryFailureAndCollision() {
  const repository = require('../repositories/subscription-credential-rotation-repository');
  for (const scenario of ['task-failure', 'missing-user', 'cooldown']) {
    const client = new RecordingClient(sql => ({ rows: /FROM users/.test(sql) && scenario !== 'missing-user' ? [{ id: 7 }] : [] }),
      sql => scenario === 'task-failure' && sql.includes('INSERT INTO xui_sync_tasks'));
    const db = { pool: { async connect() { return client; } } };
    let handlerCalled = false;
    await assert.rejects(() => repository.withRotationTransaction(db, 7, async transactionClient => {
      handlerCalled = true;
      if (scenario === 'cooldown') throw new Error('冷却期拒绝');
      await repository.insertRotationTask(transactionClient, { userId: 7, serverIds: [2], now: 4000 });
    }));
    assert.strictEqual(handlerCalled, scenario !== 'missing-user');
    assert.deepStrictEqual(client.calls.slice(-2).map(call => call.sql), ['ROLLBACK', 'release']);
    assert.ok(!client.calls.some(call => call.sql === 'COMMIT'));
  }
  const collision = { user_id: 8, server_id: 2 };
  const client = new RecordingClient(() => ({ rows: [collision] }));
  assert.strictEqual(await repository.findCredentialCollision(client, 2, 7, { uuid: '', auth: null }), collision);
  assert.deepStrictEqual(client.calls[0].params, [2, 7, '', '', '']);
  console.log('PASS 仓储：任务失败、用户缺失、冷却拒绝均回滚释放；非空凭证碰撞返回');
}

/** 依次运行迁移与仓储契约，错误时保留明确失败日志和非零退出码。 */
async function main() {
  await testMigration();
  await testRepositoryTransaction();
  await testRepositoryFailureAndCollision();
}

main().catch(error => {
  console.error('FAIL', error);
  process.exitCode = 1;
});
