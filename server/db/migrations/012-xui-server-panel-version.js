/**
 * 为 xui_servers 添加 panel_version 字段
 */

const databaseManager = require('../init');

async function migrate() {
  const db = await databaseManager.init();

  try {
    await db.exec("ALTER TABLE xui_servers ADD COLUMN IF NOT EXISTS panel_version VARCHAR(20) DEFAULT '3.0.2'");
    console.log('迁移完成: xui_servers.panel_version');
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
