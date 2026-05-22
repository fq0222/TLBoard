/**
 * 为 xui_servers 添加 API Token 字段
 */

const databaseManager = require('../init');

async function migrate() {
  const db = await databaseManager.init();

  try {
    await db.exec("ALTER TABLE xui_servers ADD COLUMN IF NOT EXISTS api_token TEXT DEFAULT ''");
    console.log('迁移完成: xui_servers.api_token');
  } finally {
    await databaseManager.close();
  }
}

if (require.main === module) {
  migrate().catch(error => {
    console.error('迁移失败:', error);
    process.exit(1);
  });
}

module.exports = migrate;
