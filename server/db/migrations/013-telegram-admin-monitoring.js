/**
 * 创建 Telegram 一期管理员绑定、监控与告警所需表结构。
 */

const databaseManager = require('../init');

const migrationStatements = [
  `
    CREATE TABLE IF NOT EXISTS telegram_admin_bindings (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER NOT NULL UNIQUE REFERENCES admins(id) ON DELETE CASCADE,
      chat_id VARCHAR(64) NOT NULL UNIQUE,
      telegram_user_id VARCHAR(64) DEFAULT '',
      telegram_username VARCHAR(255) DEFAULT '',
      telegram_first_name VARCHAR(255) DEFAULT '',
      telegram_last_name VARCHAR(255) DEFAULT '',
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
      updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS telegram_bind_codes (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      bind_code VARCHAR(64) NOT NULL UNIQUE,
      expires_at BIGINT NOT NULL,
      used_at BIGINT,
      created_by_admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
      updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS telegram_server_health_checks (
      server_id INTEGER PRIMARY KEY REFERENCES xui_servers(id) ON DELETE CASCADE,
      panel_api_status VARCHAR(20) NOT NULL DEFAULT 'unknown',
      panel_auth_status VARCHAR(20) NOT NULL DEFAULT 'unknown',
      xray_runtime_status VARCHAR(20) NOT NULL DEFAULT 'unknown',
      last_success_at BIGINT,
      last_failure_at BIGINT,
      last_checked_at BIGINT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      failure_reason VARCHAR(255) DEFAULT '',
      failure_detail TEXT DEFAULT '',
      updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS telegram_alert_records (
      id SERIAL PRIMARY KEY,
      server_id INTEGER NOT NULL REFERENCES xui_servers(id) ON DELETE CASCADE,
      alert_type VARCHAR(100) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      first_triggered_at BIGINT NOT NULL,
      last_triggered_at BIGINT NOT NULL,
      resolved_at BIGINT,
      last_sent_at BIGINT,
      send_count INTEGER NOT NULL DEFAULT 0,
      last_send_status VARCHAR(20) DEFAULT '',
      last_send_message_id VARCHAR(64) DEFAULT '',
      last_send_error TEXT DEFAULT '',
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
      updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS telegram_command_logs (
      id SERIAL PRIMARY KEY,
      binding_id INTEGER REFERENCES telegram_admin_bindings(id) ON DELETE SET NULL,
      admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
      chat_id VARCHAR(64) DEFAULT '',
      command VARCHAR(100) NOT NULL,
      command_args TEXT DEFAULT '',
      result_status VARCHAR(20) NOT NULL DEFAULT 'success',
      result_message TEXT DEFAULT '',
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
    )
  `
];

async function migrate() {
  const db = await databaseManager.init();

  try {
    for (const statement of migrationStatements) {
      await db.exec(statement);
    }
    console.log('迁移完成: Telegram 一期表结构');
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

