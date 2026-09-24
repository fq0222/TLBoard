/**
 * 钱包与提现数据库迁移测试。
 * 职责：通过可记录 SQL 的假连接池验证迁移事务、幂等 DDL、默认配置、期初流水与失败回滚。
 */

const assert = require('assert');
const { up } = require('../db/migrations/019-wallet-withdrawals');
const { initTables } = require('../db/schema/tables');
const { createIndexes } = require('../db/schema/indexes');

/**
 * 创建会记录查询事件的连接池替身。
 * @param {object} [options] - 可选故障注入配置
 * @param {string} [options.failOn] - SQL 包含该文本时抛出模拟错误
 * @returns {{pool: object, events: string[], queries: string[]}} 连接池、事务事件和 SQL 记录
 */
function createRecordingPool({ failOn } = {}) {
  const events = [];
  const queries = [];
  const client = {
    async query(statement) {
      const sql = String(statement).trim();
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        events.push(sql);
      } else {
        queries.push(sql);
      }

      if (failOn && sql.includes(failOn)) {
        throw new Error('模拟迁移失败');
      }

      return { rows: [], rowCount: 0 };
    },
    release() {
      events.push('RELEASE');
    }
  };

  return {
    events,
    queries,
    pool: {
      async connect() {
        return client;
      }
    }
  };
}

/**
 * 合并 SQL 并验证三张表的字段、约束和业务索引。
 * @param {string[]} queries - 待验证的 SQL 语句列表
 */
function assertWalletSql(queries) {
  const sql = queries.join('\n');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS balance_transactions/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS user_payment_qr_codes/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS withdrawal_requests/);
  assert.match(sql, /CHECK \(amount <> 0\)/);
  assert.match(sql, /CHECK \(balance_after >= 0\)/);
  assert.match(sql, /CHECK \(amount > 0\)/);
  assert.match(sql, /type IN \('opening_balance', 'referral_reward', 'plan_payment', 'withdrawal', 'withdrawal_refund'\)/);
  assert.match(sql, /status IN \('pending', 'completed', 'rejected'\)/);
  assert.match(sql, /payment_type IN \('wechat', 'alipay'\)/);
  assert.match(sql, /status <> 'rejected' OR NULLIF\(BTRIM\(reject_reason\), ''\) IS NOT NULL/);
  assert.match(sql, /UNIQUE \(reference_type, reference_id, type\)/);
  assert.doesNotMatch(sql, /CREATE INDEX IF NOT EXISTS idx_balance_transactions_user_created_at\b/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_balance_transactions_user_created_id[\s\S]*ON balance_transactions\(user_id, created_at DESC, id DESC\)/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status_created_at[\s\S]*ON withdrawal_requests\(status, created_at DESC\)/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_withdrawal_requests_one_pending_per_user[\s\S]*WHERE status = 'pending'/);
}

/**
 * 验证正常迁移会在单个事务内完成全部结构及数据初始化。
 */
async function testSuccessfulMigration() {
  const { pool, events, queries } = createRecordingPool();

  await up(pool);

  assert.deepStrictEqual(events.slice(0, 1), ['BEGIN']);
  assert.equal(events.at(-2), 'COMMIT');
  assert.equal(events.at(-1), 'RELEASE');
  assertWalletSql(queries);

  const sql = queries.join('\n');
  assert.match(sql, /minimum_withdrawal_amount/);
  assert.match(sql, /VALUES \('minimum_withdrawal_amount', '2000'/);
  assert.match(sql, /'opening_balance', id, '期初余额'/);
  assert.match(sql, /WHERE COALESCE\(balance, 0\) > 0/);
  assert.match(sql, /ON CONFLICT \(reference_type, reference_id, type\) DO NOTHING/);
}

/**
 * 验证重复执行仍使用幂等语句完成提交。
 */
async function testIdempotentMigration() {
  const { pool, events, queries } = createRecordingPool();

  await up(pool);
  await up(pool);

  assert.equal(events.filter((event) => event === 'COMMIT').length, 2);
  assert.equal(queries.filter((sql) => sql.includes('CREATE TABLE IF NOT EXISTS')).length, 6);
  assert.equal(queries.filter((sql) => sql.includes('ON CONFLICT (key) DO NOTHING')).length, 2);
  assert.equal(queries.filter((sql) => sql.includes('ON CONFLICT (reference_type, reference_id, type) DO NOTHING')).length, 2);
}

/**
 * 验证任一中途 SQL 失败时回滚且始终释放连接。
 */
async function testRollbackOnFailure() {
  const { pool, events } = createRecordingPool({ failOn: 'withdrawal_requests' });

  await assert.rejects(() => up(pool), /模拟迁移失败/);

  assert.deepStrictEqual(events, ['BEGIN', 'ROLLBACK', 'RELEASE']);
}

/**
 * 验证全新数据库初始化定义包含同样的表、约束和部分唯一索引。
 */
async function testFreshDatabaseSchema() {
  const tableQueries = [];
  const indexQueries = [];
  const logger = { info() {}, error() {} };

  await initTables({ query: async (sql) => tableQueries.push(String(sql).trim()) }, logger);
  await createIndexes({ query: async (sql) => indexQueries.push(String(sql).trim()) }, logger);

  assertWalletSql([...tableQueries, ...indexQueries]);
}

async function run() {
  await testSuccessfulMigration();
  console.log('✓ 迁移成功测试通过');
  await testIdempotentMigration();
  console.log('✓ 迁移幂等测试通过');
  await testRollbackOnFailure();
  console.log('✓ 迁移回滚测试通过');
  await testFreshDatabaseSchema();
  console.log('✓ 全新数据库表结构测试通过');
}

run().catch((error) => {
  console.error('钱包与提现迁移测试失败:', error);
  process.exit(1);
});
