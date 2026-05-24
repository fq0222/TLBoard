/**
 * 数据库迁移脚本：007-user-subscription-sources
 *
 * 变更内容：
 * 1. 新增 user_subscription_sources 表，用于缓存用户维度的原始订阅模板
 * 2. 新增 user_id、server_id 查询索引
 *
 * 使用方式：
 * node server/db/migrations/007-user-subscription-sources.js
 */

const databaseManager = require('../init');

/**
 * 执行迁移。
 * @param {import('pg').Pool} pool PostgreSQL 连接池
 */
async function up(pool) {
  const client = await pool.connect();

  try {
    console.log('开始执行迁移：007-user-subscription-sources');
    await client.query('BEGIN');

    // 为每个 user_id + server_id + inbound_id 持久化一份原始订阅模板缓存。
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_subscription_sources (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        server_id INTEGER NOT NULL,
        inbound_id INTEGER NOT NULL,
        sub_id VARCHAR(50) NOT NULL DEFAULT '',
        remark VARCHAR(255) NOT NULL DEFAULT '',
        protocol VARCHAR(50) NOT NULL DEFAULT '',
        original_link TEXT NOT NULL DEFAULT '',
        node_fingerprint VARCHAR(255) NOT NULL DEFAULT '',
        server_fingerprint VARCHAR(255) NOT NULL DEFAULT '',
        fetched_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        UNIQUE(user_id, server_id, inbound_id)
      )
    `);
    console.log('已确认 user_subscription_sources 表存在');

    // 按用户和服务器查询是最常见的两个场景，单列索引足够支撑。
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_subscription_sources_user_id
      ON user_subscription_sources(user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_subscription_sources_server_id
      ON user_subscription_sources(server_id)
    `);
    console.log('已确认 user_subscription_sources 索引存在');

    await client.query('COMMIT');
    console.log('迁移完成：007-user-subscription-sources');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('迁移失败：007-user-subscription-sources', error.message);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  databaseManager.init()
    .then(db => up(db.pool))
    .finally(() => databaseManager.close());
}

module.exports = { up };
