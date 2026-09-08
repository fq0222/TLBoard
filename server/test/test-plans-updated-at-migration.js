const assert = require('assert');
const migration = require('../db/migrations/031-plans-updated-at');

/**
 * 构造迁移脚本测试用的 PostgreSQL 连接池替身。
 * 职责：记录 SQL 与参数，不连接真实数据库，便于验证幂等迁移行为。
 * 核心分支：throwOnQuery 命中时模拟数据库失败，校验回滚与释放连接。
 *
 * @param {Object} options - 测试配置
 * @param {RegExp} [options.throwOnQuery] - 命中时抛出错误的 SQL 正则
 * @returns {{pool:Object, queries:Array<Object>, client:Object}}
 */
function createFakePool(options = {}) {
  const queries = [];
  const client = {
    released: false,
    async query(sql, params = []) {
      queries.push({ sql: String(sql).trim(), params });
      if (options.throwOnQuery && options.throwOnQuery.test(sql)) {
        throw new Error('simulated failure');
      }
      return { rows: [], rowCount: 0 };
    },
    release() {
      this.released = true;
    }
  };

  return {
    queries,
    client,
    pool: {
      async connect() {
        return client;
      }
    }
  };
}

async function testAddsUpdatedAtAndBackfillsWithExecutionTimestamp() {
  const { pool, queries, client } = createFakePool();

  const result = await migration.up(pool, 1999999999);

  assert.equal(result.backfillTimestamp, 1999999999);
  assert.equal(queries[0].sql, 'BEGIN');
  assert.match(queries[1].sql, /ALTER TABLE plans\s+ADD COLUMN IF NOT EXISTS updated_at BIGINT/i);
  assert.match(queries[2].sql, /ALTER TABLE plans\s+ALTER COLUMN updated_at SET DEFAULT EXTRACT\(EPOCH FROM NOW\(\)\)/i);
  assert.match(queries[3].sql, /UPDATE plans\s+SET updated_at = \$1\s+WHERE updated_at IS NULL/i);
  assert.deepEqual(queries[3].params, [1999999999]);
  assert.equal(queries[4].sql, 'COMMIT');
  assert.equal(client.released, true);
}

async function testRollsBackOnFailure() {
  const { pool, queries, client } = createFakePool({
    throwOnQuery: /UPDATE plans/i
  });

  await assert.rejects(() => migration.up(pool, 1999999999), /simulated failure/);

  assert.equal(queries.at(-1).sql, 'ROLLBACK');
  assert.equal(client.released, true);
}

async function run() {
  await testAddsUpdatedAtAndBackfillsWithExecutionTimestamp();
  await testRollsBackOnFailure();
  console.log('plans updated_at migration tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
