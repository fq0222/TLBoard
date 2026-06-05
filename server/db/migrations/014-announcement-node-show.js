/**
 * 公告虚拟节点展示字段迁移脚本。
 * 职责：为 announcements 表补充 node_show 字段，用于区分只在订阅节点中展示的公告。
 *
 * 使用方式：
 * node server/db/migrations/014-announcement-node-show.js
 */

const { Pool } = require('pg');
const config = require('../../config');

/**
 * 执行公告虚拟节点字段迁移。
 * 核心分支：字段已存在时跳过；字段为空时回填 0；最后设置默认值和非空约束。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @returns {Promise<void>}
 */
async function up(pool) {
  const client = await pool.connect();

  try {
    console.log('开始执行迁移：014-announcement-node-show');
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE announcements
      ADD COLUMN IF NOT EXISTS node_show INTEGER DEFAULT 0
    `);

    await client.query(`
      UPDATE announcements
      SET node_show = 0
      WHERE node_show IS NULL
    `);

    await client.query(`
      ALTER TABLE announcements
      ALTER COLUMN node_show SET DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE announcements
      ALTER COLUMN node_show SET NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_announcements_node_show_created_at
      ON announcements(node_show, enabled, created_at DESC)
    `);

    await client.query('COMMIT');
    console.log('迁移执行完成：014-announcement-node-show');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('迁移执行失败：014-announcement-node-show', error.message);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 创建迁移专用连接池。
 * 核心分支：迁移脚本不能调用 databaseManager.init()，否则会在补字段前触发全量索引初始化。
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
    application_name: 'subscription_manager_migration_014'
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
