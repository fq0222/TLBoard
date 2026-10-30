/** 家宽 routing 待清理字段、迁移事务和仓储持久化契约测试；不访问真实数据库。 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const repository = require('../repositories/user-home-routing-repository');
const { initTables } = require('../db/schema/tables');
const { createDbProxy } = require('../db/proxy');

/** 记录 SQL 边界；failDdl 为 true 时模拟 DDL 失败以覆盖回滚分支。 */
class MigrationPool {
  constructor(failDdl = false) {
    this.failDdl = failDdl;
    this.queries = [];
    this.released = false;
  }

  /** 提供专用连接，保持迁移使用注入连接池的公共契约。 */
  async connect() {
    return this;
  }

  /** 记录 SQL；只在 DDL 阶段模拟错误，不吞掉事务语句。 */
  async query(sql) {
    this.queries.push(sql.trim());
    if (this.failDdl && /ALTER TABLE/i.test(sql)) throw new Error('simulated ddl failure');
    return { rows: [] };
  }

  /** 记录专用连接的释放。 */
  release() {
    this.released = true;
  }
}

/** 捕获仓储发往数据库代理的 SQL 与参数；rows 为查询返回的完整绑定记录。 */
class RepositoryDb {
  constructor(rows = []) {
    this.rows = rows;
    this.writes = [];
  }

  /** 查询返回预设绑定；写入记录 SQL 与参数供持久化契约断言。 */
  prepare(sql) {
    return {
      all: async () => this.rows,
      run: async (...params) => { this.writes.push({ sql, params }); }
    };
  }
}

/** 缺失字段、错误默认值、丢失事务或异常后不释放连接均应失败。 */
async function testMigrationAndFreshSchema() {
  const migrationPath = path.join(__dirname, '../db/migrations/036-home-routing-pending-cleanup.js');
  assert.ok(fs.existsSync(migrationPath), '待清理字段迁移文件应存在');
  const { up } = require(migrationPath);
  const pool = new MigrationPool();
  await up(pool);
  await up(pool);
  assert.deepStrictEqual(pool.queries.filter(sql => sql === 'BEGIN'), ['BEGIN', 'BEGIN']);
  assert.deepStrictEqual(pool.queries.filter(sql => sql === 'COMMIT'), ['COMMIT', 'COMMIT']);
  assert.match(pool.queries[1], /ALTER TABLE user_home_proxy_routes\s+ADD COLUMN IF NOT EXISTS pending_cleanup_server_ids TEXT NOT NULL DEFAULT '\[\]'/i);
  assert.strictEqual(pool.released, true);
  const failedPool = new MigrationPool(true);
  await assert.rejects(() => up(failedPool), /simulated ddl failure/);
  assert.deepStrictEqual(failedPool.queries.filter(sql => /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)), ['BEGIN', 'ROLLBACK']);
  assert.strictEqual(failedPool.released, true);
  const schemaQueries = [];
  await initTables({ query: async sql => schemaQueries.push(sql) }, { info() {} });
  const routeSchema = schemaQueries.find(sql => /CREATE TABLE IF NOT EXISTS user_home_proxy_routes/.test(sql));
  assert.match(routeSchema, /pending_cleanup_server_ids TEXT NOT NULL DEFAULT '\[\]'/i);
}

/** 保存时必须同时插入和覆盖两个数组，未传待清理列表时存空数组。 */
async function testUpsertPersistsBothArrays() {
  const db = new RepositoryDb();
  const payload = { userId: 7, homeProxyTag: 'home', serverIds: [1], pendingCleanupServerIds: [2], syncedAt: 123 };
  await repository.upsertUserHomeRoute(db, payload);
  await repository.upsertUserHomeRoute(db, { ...payload, pendingCleanupServerIds: undefined });
  assert.match(db.writes[0].sql, /pending_cleanup_server_ids\s*=\s*EXCLUDED.pending_cleanup_server_ids/);
  assert.match(db.writes[0].sql, /INSERT INTO user_home_proxy_routes\s*\([^)]*pending_cleanup_server_ids\s*\)/);
  assert.deepStrictEqual(db.writes[0].params, [7, 'home', '[1]', 0, 123, '', 123, 123, '[2]']);
  assert.deepStrictEqual(db.writes[1].params, [7, 'home', '[1]', 0, 123, '', 123, 123, '[]']);
}

/** 目标 ID 在任一数组出现时清除；只有两列同时为空才删除整条记录。 */
async function testRemoveServerFromBothArrays() {
  assert.strictEqual(typeof repository.removeServerIdFromAllHomeRoutes, 'function', '仓储应导出服务器清理方法');
  const db = new RepositoryDb([
    { user_id: 1, server_ids: '[2,3]', pending_cleanup_server_ids: '[2,4]' },
    { user_id: 2, server_ids: '[]', pending_cleanup_server_ids: '[2]' },
    { user_id: 3, server_ids: '[2]', pending_cleanup_server_ids: '[]' },
    { user_id: 4, server_ids: '[5]', pending_cleanup_server_ids: '[]' },
    { user_id: 5, server_ids: '[2]', pending_cleanup_server_ids: '[4]' }
  ]);
  await repository.removeServerIdFromAllHomeRoutes(db, 2);
  assert.strictEqual(db.writes.length, 4);
  const updates = db.writes.filter(write => /UPDATE/.test(write.sql));
  assert.deepStrictEqual(updates.map(write => write.params), [['[3]', '[4]', 1], ['[]', '[4]', 5]]);
  updates.forEach(write => assert.match(write.sql, /server_ids = \?,\s*pending_cleanup_server_ids = \?/));
  assert.deepStrictEqual(db.writes.filter(write => /DELETE/.test(write.sql)).map(write => write.params), [[2], [3]]);
  for (const invalidId of [0, -1, 1.5, '2 OR 1=1', null]) {
    const invalidDb = new RepositoryDb(db.rows);
    await repository.removeServerIdFromAllHomeRoutes(invalidDb, invalidId);
    assert.deepStrictEqual(invalidDb.writes, []);
  }
}

/**
 * 给定异常字段值，分别覆盖两列损坏时的跳过策略。
 * 异常绑定前后均包含正常记录，确保不会提前中断或误删异常绑定。
 */
async function assertInvalidRouteIsSkipped(invalidValue) {
  for (const field of ['server_ids', 'pending_cleanup_server_ids']) {
    const db = new RepositoryDb([
      { user_id: 1, server_ids: '[2,3]', pending_cleanup_server_ids: '[]' },
      { user_id: 2, server_ids: '[2]', pending_cleanup_server_ids: '[2]', [field]: invalidValue },
      { user_id: 4, server_ids: '[5]', pending_cleanup_server_ids: '[5]', [field]: invalidValue },
      { user_id: 3, server_ids: '[]', pending_cleanup_server_ids: '[2]' }
    ]);
    await repository.removeServerIdFromAllHomeRoutes(db, 2);
    assert.deepStrictEqual(db.writes.map(write => write.params), [['[3]', '[]', 1], [3]], `${field}=${invalidValue} 应跳过异常绑定并继续处理`);
  }
}

/** 损坏 JSON 不得阻断其他绑定的清理，也不得将异常字段视为空数组。 */
async function testMalformedJsonDoesNotInterruptCleanup() {
  await assertInvalidRouteIsSkipped('bad');
}

/** 合法非数组 JSON、空值及缺失字段均保留原记录，后续正常记录仍应清理。 */
async function testNonArrayJsonDoesNotInterruptCleanup() {
  for (const value of ['null', '{}', '2', '""', null, '', undefined]) {
    await assertInvalidRouteIsSkipped(value);
  }
}

/** 清理必须在外层事务连接上请求行锁，防止并发管理员读到旧数组后覆盖彼此的删除。 */
async function testRemoveServerLocksRoutesInTransaction() {
  const pool = new MigrationPool();
  const db = createDbProxy({
    pool,
    queryWithRetry: async () => assert.fail('清理 SQL 必须使用外层事务连接'),
    convertPlaceholders: sql => sql,
    logger: { error() {}, info() {} }
  });

  await db.transaction(transactionDb => repository.removeServerIdFromAllHomeRoutes(transactionDb, 2))();

  assert.strictEqual(pool.queries.length, 3, '应复用外层事务，不增加独立事务或额外查询');
  assert.strictEqual(pool.queries[0], 'BEGIN');
  assert.match(pool.queries[1], /^SELECT user_id, server_ids, pending_cleanup_server_ids\s+FROM user_home_proxy_routes\s+FOR UPDATE$/i, '读取 route 必须请求行锁，串行化并发删除');
  assert.strictEqual(pool.queries[2], 'COMMIT');
  assert.strictEqual(pool.released, true);
}

/** 顺序执行契约测试并输出可定位的验证日志。 */
async function run() {
  let failures = 0;
  for (const test of [testMigrationAndFreshSchema, testUpsertPersistsBothArrays, testRemoveServerFromBothArrays, testMalformedJsonDoesNotInterruptCleanup, testNonArrayJsonDoesNotInterruptCleanup, testRemoveServerLocksRoutesInTransaction]) {
    try {
      await test();
      console.log(`PASS ${test.name}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${test.name}: ${error.message}`);
    }
  }
  assert.strictEqual(failures, 0, `${failures} test(s) failed`);
  console.log('home routing pending cleanup migration tests passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
