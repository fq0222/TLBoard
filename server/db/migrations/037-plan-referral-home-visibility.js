/**
 * 数据库迁移脚本 037-plan-referral-home-visibility。
 * 职责：为 plans 增加邀请首页展示开关，历史套餐默认不展示。
 * 参数：up 接收 PostgreSQL 连接池，migrate 使用本地数据库配置。
 * 核心分支：字段已存在时重复执行仍安全；失败时回滚并释放专用连接。
 * 使用方法：node server/db/migrations/037-plan-referral-home-visibility.js
 */
const { Pool } = require('pg');
const config = require('../../config');

/**
 * 补齐展示字段、默认值和非空约束，并将历史空值回填为 0。
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @returns {Promise<void>}
 * 任一语句失败时回滚整个事务；成功或失败均释放专用连接。
 */
async function up(pool) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(`
      ALTER TABLE plans
      ADD COLUMN IF NOT EXISTS show_on_referral_home INTEGER NOT NULL DEFAULT 0
    `);
    await client.query(`
      ALTER TABLE plans
      ALTER COLUMN show_on_referral_home SET DEFAULT 0
    `);
    await client.query(`
      UPDATE plans
      SET show_on_referral_home = 0
      WHERE show_on_referral_home IS NULL
    `);
    await client.query(`
      ALTER TABLE plans
      ALTER COLUMN show_on_referral_home SET NOT NULL
    `);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 使用本地配置创建连接池并执行迁移，无外部参数。
 * @returns {Promise<void>}
 * 迁移失败由 up 回滚并继续抛出；无论结果如何均关闭连接池。
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
    console.log('=== 迁移 037: plan-referral-home-visibility ===\n');
    await up(pool);
    console.log('plans.show_on_referral_home 已就绪，默认值为 0');
    console.log('\n=== 迁移完成 ===');
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
