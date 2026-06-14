/**
 * 推广余额奖励迁移脚本。
 * 职责：把历史推广流量并入用户套餐流量，新增余额与奖励金额字段，移除旧奖励流量字段。
 *
 * 使用方式：
 * node server/db/migrations/016-referral-balance-rewards.js
 */

const { Pool } = require('pg');
const config = require('../../config');

/**
 * 执行推广余额奖励迁移。
 * 核心分支：历史 referral_traffic_limit 只在大于 0 时并入 traffic_limit，重复执行不会重复增加。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @returns {Promise<void>}
 */
async function up(pool) {
  const client = await pool.connect();

  try {
    console.log('开始执行迁移：016-referral-balance-rewards');
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS balance INTEGER DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE referral_rewards
      ADD COLUMN IF NOT EXISTS reward_amount INTEGER NOT NULL DEFAULT 0
    `);

    await client.query(`
      UPDATE users
      SET traffic_limit = COALESCE(traffic_limit, 0) + COALESCE(referral_traffic_limit, 0),
          referral_traffic_limit = 0
      WHERE COALESCE(referral_traffic_limit, 0) > 0
    `);

    await client.query(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES ('referral_reward_coefficient', '0.1', EXTRACT(EPOCH FROM NOW()))
      ON CONFLICT (key) DO NOTHING
    `);

    await client.query(`
      DELETE FROM system_settings
      WHERE key = 'referral_reward_traffic'
    `);

    await client.query(`
      ALTER TABLE referral_rewards
      DROP COLUMN IF EXISTS reward_traffic
    `);

    await client.query('COMMIT');
    console.log('迁移执行完成：016-referral-balance-rewards');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('迁移执行失败：016-referral-balance-rewards', error.message);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 创建迁移专用连接池。
 * 职责：允许脚本独立运行，不依赖应用启动流程。
 *
 * @returns {import('pg').Pool} PostgreSQL 连接池
 */
function createMigrationPool() {
  return new Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
    max: config.database.max,
    idleTimeoutMillis: config.database.idleTimeoutMillis,
    connectionTimeoutMillis: config.database.connectionTimeoutMillis,
    allowExitOnIdle: false,
    application_name: 'subscription_manager_migration_016'
  });
}

async function migrate() {
  const pool = createMigrationPool();
  try {
    await up(pool);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  migrate().catch((error) => {
    console.error('迁移执行失败:', error);
    process.exit(1);
  });
}

module.exports = { up, migrate, createMigrationPool };
