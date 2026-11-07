/**
 * 验证邀请首页展示字段的迁移顺序、幂等 SQL 和失败回滚。
 * 使用专用连接替身记录 SQL；不连接真实数据库或修改生产数据。
 */
const assert = require('assert');
const migration = require('../db/migrations/037-plan-referral-home-visibility');

/** PostgreSQL 连接池替身，记录调用并可在指定 SQL 序号模拟失败。 */
class FakePool {
  /** @param {number} [failureIndex] - 从 0 开始的失败 SQL 序号；默认不失败。 */
  constructor(failureIndex = -1) {
    this.queries = [];
    this.released = false;
    this.failureIndex = failureIndex;
  }

  /** 返回专用连接替身，供迁移控制同一事务。 */
  async connect() {
    return this;
  }

  /** @param {string} sql - 待执行 SQL；命中失败序号时模拟 DDL 错误。 */
  async query(sql) {
    this.queries.push(String(sql).trim().replace(/\s+/g, ' '));
    if (this.queries.length - 1 === this.failureIndex) {
      throw new Error('simulated failure');
    }
    return { rows: [], rowCount: 0 };
  }

  /** 记录连接已释放，验证成功和回滚路径均无连接泄漏。 */
  release() {
    this.released = true;
  }
}

/** 验证新字段、默认值、空值回填和非空约束按事务顺序执行。 */
async function testAddsColumnAndNormalizesExistingValues() {
  const pool = new FakePool();

  await migration.up(pool);

  assert.deepStrictEqual(pool.queries, [
    'BEGIN',
    'ALTER TABLE plans ADD COLUMN IF NOT EXISTS show_on_referral_home INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE plans ALTER COLUMN show_on_referral_home SET DEFAULT 0',
    'UPDATE plans SET show_on_referral_home = 0 WHERE show_on_referral_home IS NULL',
    'ALTER TABLE plans ALTER COLUMN show_on_referral_home SET NOT NULL',
    'COMMIT'
  ]);
  assert.strictEqual(pool.released, true);
  assert.strictEqual(typeof migration.migrate, 'function');
}

/** 验证任一字段变更或回填失败都会回滚，且始终释放专用连接。 */
async function testRollsBackOnEachStatementFailure() {
  for (const failureIndex of [1, 2, 3, 4]) {
    const pool = new FakePool(failureIndex);

    await assert.rejects(() => migration.up(pool), /simulated failure/);

    assert.strictEqual(pool.queries.at(-1), 'ROLLBACK');
    assert.strictEqual(pool.queries.includes('COMMIT'), false);
    assert.strictEqual(pool.released, true);
  }
}

/** 执行全部迁移契约测试；任一断言失败由入口报告并返回非零退出码。 */
async function run() {
  await testAddsColumnAndNormalizesExistingValues();
  await testRollsBackOnEachStatementFailure();
  console.log('plan referral home visibility migration tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
