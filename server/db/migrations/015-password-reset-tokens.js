/**
 * 密码重置 Token 表迁移脚本。
 * 职责：为忘记密码流程创建一次性 Token 存储表和查询索引。
 *
 * 使用方式：
 * node server/db/migrations/015-password-reset-tokens.js
 */

const { Pool } = require('pg');
const config = require('../../config');

/**
 * 执行密码重置 Token 表迁移。
 * 核心分支：表和索引均使用 IF NOT EXISTS，可在生产环境重复执行。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @returns {Promise<void>}
 */
async function up(pool) {
  const client = await pool.connect();

  try {
    console.log('开始执行迁移：015-password-reset-tokens');
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(64) UNIQUE NOT NULL,
        expires_at BIGINT NOT NULL,
        used_at BIGINT,
        request_ip VARCHAR(64) DEFAULT '',
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_created
      ON password_reset_tokens(user_id, created_at)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token
      ON password_reset_tokens(token)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at
      ON password_reset_tokens(expires_at)
    `);

    await client.query('COMMIT');
    console.log('迁移执行完成：015-password-reset-tokens');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('迁移执行失败：015-password-reset-tokens', error.message);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 创建迁移专用连接池。
 * 职责：避免迁移脚本依赖应用完整启动流程，便于独立部署执行。
 *
 * @returns {import('pg').Pool} PostgreSQL 连接池
 */
function createMigrationPool() {
  return new Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
    max: config.database.max,
    idleTimeoutMillis: config.database.idleTimeoutMillis,
    connectionTimeoutMillis: config.database.connectionTimeoutMillis,
    allowExitOnIdle: false,
    application_name: 'subscription_manager_migration_015'
  });
}

async function migrate() {
  const pool = createMigrationPool();
  try {
    await up(pool);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  migrate().catch((error) => {
    console.error('迁移执行失败:', error);
    process.exit(1);
  });
}

module.exports = { up, migrate, createMigrationPool };
