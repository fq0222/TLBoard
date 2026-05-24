/**
 * 数据库迁移脚本: 006-xui-sync-tasks
 *
 * 变更内容：
 * 1. users 表补齐 sync_status 字段
 * 2. 新增 xui_sync_tasks 表，持久化 3X-UI 同步重试任务
 *
 * 使用方法：node server/db/migrations/006-xui-sync-tasks.js
 */

const databaseManager = require('../init');

/**
 * 执行迁移
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 */
async function up(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS sync_status INTEGER DEFAULT 0
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS xui_sync_tasks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        task_type VARCHAR(50) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        payload TEXT DEFAULT '{}',
        attempts INTEGER DEFAULT 0,
        next_retry_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        last_error TEXT,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_xui_sync_tasks_status_retry
      ON xui_sync_tasks(status, next_retry_at)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_xui_sync_tasks_user_id
      ON xui_sync_tasks(user_id)
    `);

    await client.query('COMMIT');
    console.log('迁移完成: xui_sync_tasks');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('迁移失败:', error.message);
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
