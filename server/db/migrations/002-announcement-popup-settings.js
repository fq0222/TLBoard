/**
 * 公告弹窗配置迁移脚本。
 * 职责：补充公告弹窗次数字段，并创建按“用户 + 公告”统计关闭次数的表和索引。
 *
 * 使用方式：
 * node server/db/migrations/002-announcement-popup-settings.js
 */

const databaseManager = require('../init');

/**
 * 执行公告弹窗配置迁移。
 * 核心分支：所有结构变更放在同一个事务中，任一步失败都会回滚。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @returns {Promise<void>}
 */
async function up(pool) {
  const client = await pool.connect();

  try {
    console.log('开始执行迁移：002-announcement-popup-settings');
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE announcements
      ADD COLUMN IF NOT EXISTS popup_show_limit INTEGER DEFAULT 0
    `);

    await client.query(`
      UPDATE announcements
      SET popup_show_limit = 0
      WHERE popup_show_limit IS NULL
    `);

    await client.query(`
      ALTER TABLE announcements
      ALTER COLUMN popup_show_limit SET DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE announcements
      ALTER COLUMN popup_show_limit SET NOT NULL
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_announcement_popup_stats (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
        shown_count INTEGER NOT NULL DEFAULT 0,
        last_shown_at BIGINT,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        UNIQUE(user_id, announcement_id)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_announcements_enabled_created_at
      ON announcements(enabled, created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_announcement_popup_stats_user_id
      ON user_announcement_popup_stats(user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_announcement_popup_stats_announcement_id
      ON user_announcement_popup_stats(announcement_id)
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_announcement_popup_stats_user_announcement_unique
      ON user_announcement_popup_stats(user_id, announcement_id)
    `);

    await client.query('COMMIT');
    console.log('迁移执行完成：002-announcement-popup-settings');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('迁移执行失败：002-announcement-popup-settings', error.message);
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

module.exports = { up };
