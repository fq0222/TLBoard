/**
 * 数据库迁移脚本：011-referral-system
 *
 * 变更内容：
 * 1. users 表新增 referral_traffic_limit 字段，兼容历史推广流量额度。
 * 2. orders 表新增 referrer_user_id 字段，记录订单归属的推荐人。
 * 3. 新增推广码、推广点击、推广奖励三张表及查询索引。
 *
 * 使用方式：
 * node server/db/migrations/011-referral-system.js
 */

const { Pool } = require('pg');
const config = require('../../config');

/**
 * 创建本迁移使用的 PostgreSQL 连接池。
 *
 * 职责：从 server/config.js 读取数据库连接参数，构造独立迁移连接池。
 * 关键参数：无外部入参，全部配置来自项目本地配置文件。
 * 核心分支：本函数不包含条件分支，连接异常交由调用方处理。
 *
 * @returns {Pool} 使用 server/config.js 数据库配置创建的连接池
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
    application_name: 'subscription_manager_migration_011'
  });
}

/**
 * 执行推广系统结构迁移。
 *
 * 职责：在单个事务内补齐推广系统字段、表和索引。
 * 关键参数：pool 为 PostgreSQL 连接池，可由脚本入口创建，也可由迁移调度器传入。
 * 核心分支：DDL 使用 IF NOT EXISTS，已存在结构自动跳过；异常时回滚事务并继续抛出错误。
 *
 * @param {Pool} pool PostgreSQL 连接池；调用方可传入现有连接池复用事务环境
 * @returns {Promise<void>}
 */
async function up(pool) {
  const client = await pool.connect();

  try {
    console.log('开始执行迁移：011-referral-system');
    await client.query('BEGIN');

    // 字段创建使用 IF NOT EXISTS，已有字段会跳过，保证重复执行不破坏现有数据。
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS referral_traffic_limit BIGINT DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS referrer_user_id INTEGER
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS referral_codes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        code VARCHAR(64) NOT NULL UNIQUE,
        enabled INTEGER DEFAULT 1,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS referral_clicks (
        id SERIAL PRIMARY KEY,
        referrer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code VARCHAR(64) NOT NULL,
        ip VARCHAR(64),
        user_agent TEXT,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS referral_rewards (
        id SERIAL PRIMARY KEY,
        referrer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        referred_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        reward_amount INTEGER NOT NULL DEFAULT 0,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        UNIQUE(referred_user_id),
        UNIQUE(order_id)
      )
    `);

    // 索引按查询入口拆分，重复执行时由 IF NOT EXISTS 直接跳过。
    await client.query('CREATE INDEX IF NOT EXISTS idx_referral_clicks_referrer_user_id ON referral_clicks(referrer_user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_referral_clicks_code ON referral_clicks(code)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer_user_id ON referral_rewards(referrer_user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_referral_rewards_referred_user_id ON referral_rewards(referred_user_id)');

    await client.query('COMMIT');
    console.log('迁移完成：011-referral-system');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('迁移失败：011-referral-system', error.message);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  const pool = createMigrationPool();
  up(pool)
    .finally(() => pool.end());
}

module.exports = {
  createMigrationPool,
  up
};
