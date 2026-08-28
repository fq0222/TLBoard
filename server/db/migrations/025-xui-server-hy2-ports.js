/**
 * 为 xui_servers 添加 hy2_ports 字段。
 * 职责：保存每台服务器生成 Clash hysteria2 节点时使用的 UDP 端口范围。
 */

const databaseManager = require('../init');

async function migrate() {
  const db = await databaseManager.init();

  try {
    await db.exec("ALTER TABLE xui_servers ADD COLUMN IF NOT EXISTS hy2_ports VARCHAR(20) DEFAULT '40000-50000'");
    console.log('迁移完成: xui_servers.hy2_ports');
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
