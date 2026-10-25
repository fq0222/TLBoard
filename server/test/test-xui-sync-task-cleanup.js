const test = require('node:test');
const assert = require('node:assert/strict');

const { deleteExpiredTerminalTasks } = require('../repositories/xui-sync-repository');
const { createIndexes } = require('../db/schema/indexes');
const { createDbProxy } = require('../db/proxy');
const { createQueryWithRetry } = require('../db/query-runner');
const { convertPlaceholders } = require('../db/sql-utils');

/** 模拟 DELETE 已提交但首次响应丢失的连接池，观察仓储是否重放第二批删除。 */
class ConnectionLossPool {
  /** 初始化 100 条过期终态任务和可被真实代理识别的连接错误。 */
  constructor() {
    this.rows = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      status: 'success',
      created_at: 1
    }));
    this.calls = [];
    this.error = Object.assign(new Error('connection reset after committed delete'), { code: 'ECONNRESET' });
  }

  /**
   * 按 params[1] 删除一批；首次在删除生效后抛错，后续请求会再次删除。
   * @param {string} sql - 真实仓储/代理发出的 SQL。
   * @param {Array<number>} params - 截止时间和批量上限。
   * @returns {Promise<Object>} PostgreSQL 查询结果。
   */
  async query(sql, params) {
    this.calls.push({ sql, params });
    const deleted = this.rows.splice(0, params[1]);
    if (this.calls.length === 1) throw this.error;
    return { rowCount: deleted.length, rows: deleted };
  }
}

test('删除已生效但响应连接中断时只尝试一次并向上抛错', async () => {
  const pool = new ConnectionLossPool();
  const logger = { warn() {}, error() {} };
  const db = createDbProxy({
    pool,
    queryWithRetry: createQueryWithRetry(pool, logger),
    convertPlaceholders,
    logger
  });

  const outcome = await deleteExpiredTerminalTasks(db, 1000, 50).then(
    (value) => ({ value }),
    (error) => ({ error })
  );

  assert.equal(pool.calls.length, 1, '响应丢失后不得重放 DELETE');
  assert.equal(outcome.error, pool.error);
  assert.equal(pool.rows.length, 50, '单次调用最多删除 50 条');
  assert.deepEqual(pool.rows.map((row) => row.id), Array.from({ length: 50 }, (_, index) => index + 51));
});

/**
 * 清理仓储数据库替身：记录 SQL/参数并按收到的筛选、排序和上限模拟删除。
 * rows 为任务快照；SQL 缺少条件时不应用该条件，确保错误查询不能静默通过。
 */
class CleanupDb {
  /** @param {Array<Object>} rows - 用于观察保留/删除结果的内存任务集。 */
  constructor(rows = []) {
    this.rows = rows.map((row) => ({ ...row }));
    this.calls = [];
    this.pool = { query: this.query.bind(this) };
  }

  /**
   * @param {string} sql - 仓储提交的 SQL。
   * @param {Array<number>} params - 截止时间和批量上限。
   * @returns {Promise<Object>} 根据 SQL 条件删除候选，返回 PostgreSQL rowCount。
   */
  async query(sql, params) {
    this.calls.push({ sql, params });
    const normalized = sql.replace(/\s+/g, ' ').trim();
    assert.match(normalized, /^WITH \w+ AS \( SELECT id FROM xui_sync_tasks /i);
    assert.match(normalized, /DELETE FROM xui_sync_tasks WHERE id IN \(SELECT id FROM \w+\)/i);
    const [cutoff, limit] = params;
    let candidates = this.rows.filter((row) => {
      const terminal = !/status IN \('success', 'failed'\)/i.test(normalized)
        || ['success', 'failed'].includes(row.status);
      const expired = /created_at <= \$1/i.test(normalized)
        ? row.created_at <= cutoff
        : !/created_at < \$1/i.test(normalized) || row.created_at < cutoff;
      return terminal && expired;
    });
    if (/ORDER BY created_at ASC/i.test(normalized)) {
      candidates.sort((a, b) => a.created_at - b.created_at
        || (/created_at ASC, id ASC/i.test(normalized) ? a.id - b.id : 0));
    }
    if (/LIMIT \$2/i.test(normalized)) candidates = candidates.slice(0, limit);
    const deletedIds = new Set(candidates.map((row) => row.id));
    this.rows = this.rows.filter((row) => !deletedIds.has(row.id));
    return { rowCount: String(deletedIds.size), rows: [] };
  }
}

test('只删除严格超过保留期的 success 和 failed 任务', async () => {
  const db = new CleanupDb([
    { id: 1, status: 'success', created_at: 999 },
    { id: 2, status: 'failed', created_at: 999 },
    { id: 3, status: 'success', created_at: 1000 },
    { id: 4, status: 'failed', created_at: 1000 },
    { id: 5, status: 'success', created_at: 1001 },
    { id: 6, status: 'failed', created_at: 1001 },
    { id: 7, status: 'pending', created_at: 1 },
    { id: 8, status: 'processing', created_at: 1 }
  ]);

  assert.equal(await deleteExpiredTerminalTasks(db, 1000, 50), 2);
  assert.deepEqual(db.rows.map((row) => row.id), [3, 4, 5, 6, 7, 8]);
});

test('单批最多删除最旧 50 条并用 id 稳定排序', async () => {
  const rows = Array.from({ length: 55 }, (_, index) => ({
    id: 55 - index,
    status: index % 2 ? 'success' : 'failed',
    created_at: 100
  }));
  // ID 1000 创建时间更早，应优先于同时间的 ID 1..55 删除。
  const db = new CleanupDb([...rows, { id: 1000, status: 'success', created_at: 1 }]);

  assert.equal(await deleteExpiredTerminalTasks(db, 1000, 50), 50);
  assert.deepEqual(db.rows.map((row) => row.id), [55, 54, 53, 52, 51, 50]);
});

test('清理仓储使用终态、创建时间、稳定排序和 limit 参数', async () => {
  const db = new CleanupDb();

  assert.equal(await deleteExpiredTerminalTasks(db, 1234, 7), 0);
  assert.equal(db.calls.length, 1);
  const { sql, params } = db.calls[0];
  const normalized = sql.replace(/\s+/g, ' ');
  assert.match(normalized, /status IN \('success', 'failed'\)/);
  assert.match(normalized, /created_at < \$1/);
  assert.match(normalized, /ORDER BY created_at ASC, id ASC/);
  assert.match(normalized, /LIMIT \$2/);
  assert.doesNotMatch(normalized, /\?/);
  assert.deepEqual(params, [1234, 7]);
});

test('未提供 rowCount 时返回数字零', async () => {
  const db = { pool: { query: async () => ({ rows: [] }) } };
  assert.equal(await deleteExpiredTerminalTasks(db, 1000, 50), 0);
});

test('createIndexes 向数据库提交清理索引并保持字段顺序', async () => {
  const statements = [];
  const errors = [];
  await createIndexes(
    { query: async (sql) => statements.push(sql) },
    { info() {}, error: (message) => errors.push(message) }
  );

  assert.deepEqual(errors, []);
  assert.ok(statements.some((sql) => /^CREATE INDEX IF NOT EXISTS idx_xui_sync_tasks_status_created_at_id\s+ON xui_sync_tasks\(status, created_at, id\)$/i.test(sql.trim())));
});
