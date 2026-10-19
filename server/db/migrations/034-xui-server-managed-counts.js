/**
 * 为 xui_servers 添加服务器级系统用户统计缓存。
 * 两个字段只保存与 users 表匹配并按邮箱去重后的用户数和在线人数。
 */

const databaseManager = require('../init');

async function migrate() {
  const db = await databaseManager.init();

  try {
    await db.exec(`
      ALTER TABLE xui_servers
      ADD COLUMN IF NOT EXISTS managed_user_count INTEGER NOT NULL DEFAULT 0
    `);
    await db.exec(`
      ALTER TABLE xui_servers
      ADD COLUMN IF NOT EXISTS managed_online_count INTEGER NOT NULL DEFAULT 0
    `);
    console.log('迁移完成: xui_servers 系统用户统计缓存字段');
  } finally {
    await databaseManager.close();
  }
}

if (require.main === module) {
  migrate().catch((error) => {
    console.error('迁移失败:', error);
    process.exit(1);
  });
}

module.exports = migrate;
