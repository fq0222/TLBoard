/**
 * 数据库迁移脚本：023-traffic-usage-current
 *
 * 变更内容：
 * 1. 新增 traffic_usage_current 表，只保存最近一轮服务器流量统计快照。
 * 2. 新增 server_id 和 sync_at 索引，支撑管理端统计页读取。
 *
 * 使用方法：node server/db/migrations/023-traffic-usage-current.js
 */

const databaseManager = require('../init');

const statements = [
  `
    CREATE TABLE IF NOT EXISTS traffic_usage_current (
      id SERIAL PRIMARY KEY,
      sync_at BIGINT NOT NULL,
      server_id INTEGER NOT NULL REFERENCES xui_servers(id) ON DELETE CASCADE,
      server_name VARCHAR(255) NOT NULL,
      total_traffic BIGINT DEFAULT 0,
      user_count INTEGER DEFAULT 0,
      users_data TEXT NOT NULL DEFAULT '[]',
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
    )
  `,
  'CREATE INDEX IF NOT EXISTS idx_traffic_usage_current_server_id ON traffic_usage_current(server_id)',
  'CREATE INDEX IF NOT EXISTS idx_traffic_usage_current_sync_at ON traffic_usage_current(sync_at)'
];

/**
 * 执行最近一轮服务器流量统计表迁移。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @returns {Promise<{executed:number}>} 已执行语句数量
 */
async function up(pool) {
  const client = await pool.connect();

  try {
    console.log('开始执行迁移：023-traffic-usage-current');
    await client.query('BEGIN');
    for (const statement of statements) {
      await client.query(statement);
    }
    await client.query('COMMIT');
    console.log('迁移完成：023-traffic-usage-current');
    return { executed: statements.length };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('迁移失败：023-traffic-usage-current', error.message);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  databaseManager.init()
    .then((db) => up(db.pool))
    .finally(() => databaseManager.close());
}

module.exports = {
  up
};
