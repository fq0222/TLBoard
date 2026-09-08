/**
 * 数据库迁移脚本 031-plans-updated-at
 * 职责：为历史生产库的 plans 表补齐 updated_at 字段，并回填脚本执行时的时间戳。
 * 关键参数：pool 为 PostgreSQL 连接池，backfillTimestamp 为本次执行统一使用的秒级时间戳。
 * 核心分支：字段已存在时保持幂等；只有 updated_at 为空的记录会被回填。
 *
 * 使用方法：node server/db/migrations/031-plans-updated-at.js
 */

const { Pool } = require('pg');
const config = require('../../config');

/**
 * 执行 plans.updated_at 字段迁移。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @param {number} [backfillTimestamp] - 可选回填时间戳，默认取脚本执行时的当前秒
 * @returns {Promise<{backfillTimestamp:number}>} 本次用于回填的时间戳
 */
async function up(pool, backfillTimestamp = Math.floor(Date.now() / 1000)) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE plans
      ADD COLUMN IF NOT EXISTS updated_at BIGINT
    `);

    await client.query(`
      ALTER TABLE plans
      ALTER COLUMN updated_at SET DEFAULT EXTRACT(EPOCH FROM NOW())
    `);

    await client.query(`
      UPDATE plans
      SET updated_at = $1
      WHERE updated_at IS NULL
    `, [backfillTimestamp]);

    await client.query('COMMIT');
    return { backfillTimestamp };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 使用本地配置创建连接池并执行迁移。
 *
 * @returns {Promise<{backfillTimestamp:number}>} 本次迁移结果
 */
async function migrate() {
  const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database
  });

  try {
    console.log('=== 迁移 031: plans-updated-at ===\n');
    const result = await up(pool);
    console.log(`plans.updated_at 已就绪，空值已回填为: ${result.backfillTimestamp}`);
    console.log('\n=== 迁移完成 ===');
    return result;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  migrate().then(() => {
    console.log('\n脚本执行成功');
    process.exit(0);
  }).catch((error) => {
    console.error('\n脚本执行失败:', error);
    process.exit(1);
  });
}

module.exports = {
  up,
  migrate
};
