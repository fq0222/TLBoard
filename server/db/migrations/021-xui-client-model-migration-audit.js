/**
 * 数据库迁移脚本：021-xui-client-model-migration-audit
 *
 * 变更内容：
 * 1. 为 user_node_configs 增加 password 字段，保存 3X-UI 全量 client 的密码凭证。
 * 2. 新增 xui_client_model_migrations 审计表，记录每个用户在每台服务器的迁移结果。
 *
 * 使用方式：
 * node server/db/migrations/021-xui-client-model-migration-audit.js
 */

const databaseManager = require('../init');

const PASSWORD_COLUMN_SQL = `
  ALTER TABLE user_node_configs
  ADD COLUMN IF NOT EXISTS password VARCHAR(100) NOT NULL DEFAULT ''
`;

const AUDIT_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS xui_client_model_migrations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    server_id INTEGER NOT NULL REFERENCES xui_servers(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL,
    old_emails TEXT NOT NULL DEFAULT '[]',
    new_email VARCHAR(255) NOT NULL DEFAULT '',
    inbound_ids TEXT NOT NULL DEFAULT '[]',
    credential_source VARCHAR(50) NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    migrated_at BIGINT,
    updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
    UNIQUE(user_id, server_id)
  )
`;

const AUDIT_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_xui_client_model_migrations_status
  ON xui_client_model_migrations(status);

  CREATE INDEX IF NOT EXISTS idx_xui_client_model_migrations_server_id
  ON xui_client_model_migrations(server_id)
`;

/**
 * 在 db 代理上执行迁移 SQL。
 * @param {Object} db - 项目数据库代理，需支持 exec。
 * @returns {Promise<Object>} 执行结果。
 */
async function upWithDbProxy(db) {
  await db.exec(PASSWORD_COLUMN_SQL);
  await db.exec(AUDIT_TABLE_SQL);
  await db.exec(AUDIT_INDEX_SQL);
  return { success: true };
}

/**
 * 在 PostgreSQL 连接池上执行迁移 SQL。
 * @param {import('pg').Pool} pool - PostgreSQL 连接池。
 * @returns {Promise<Object>} 执行结果。
 */
async function upWithPool(pool) {
  const client = await pool.connect();
  try {
    console.log('开始执行迁移：021-xui-client-model-migration-audit');
    await client.query('BEGIN');
    await client.query(PASSWORD_COLUMN_SQL);
    await client.query(AUDIT_TABLE_SQL);
    await client.query(AUDIT_INDEX_SQL);
    await client.query('COMMIT');
    console.log('迁移完成：021-xui-client-model-migration-audit');
    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('迁移失败：021-xui-client-model-migration-audit', error.message);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 执行迁移。
 * @param {Object} dbOrPool - 数据库代理或 PostgreSQL 连接池。
 * @returns {Promise<Object>} 执行结果。
 */
async function up(dbOrPool) {
  if (dbOrPool && typeof dbOrPool.exec === 'function') {
    return upWithDbProxy(dbOrPool);
  }
  return upWithPool(dbOrPool);
}

if (require.main === module) {
  databaseManager.init()
    .then((db) => up(db.pool))
    .finally(() => databaseManager.close());
}

module.exports = {
  up,
  upWithDbProxy,
  upWithPool
};
