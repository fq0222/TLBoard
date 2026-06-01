const { Pool } = require('pg');
const config = require('../../config');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('MIGRATION-006');

/**
 * 为 resources 表补充用户端下载栏所需的显式配置字段。
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @returns {Promise<void>}
 */
async function up(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query("ALTER TABLE resources ADD COLUMN IF NOT EXISTS is_download_resource INTEGER DEFAULT 0");
    await client.query("ALTER TABLE resources ADD COLUMN IF NOT EXISTS download_category VARCHAR(100) DEFAULT '其他'");
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_resources_download_category ON resources(is_download_resource, download_category)'
    );

    await client.query('COMMIT');
    logger.info('resources 下载资源分类字段迁移完成');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error(`resources 下载资源分类字段迁移失败: ${error.message}`);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 回滚用户端下载栏显式配置字段。
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @returns {Promise<void>}
 */
async function down(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('DROP INDEX IF EXISTS idx_resources_download_category');
    await client.query('ALTER TABLE resources DROP COLUMN IF EXISTS download_category');
    await client.query('ALTER TABLE resources DROP COLUMN IF EXISTS is_download_resource');

    await client.query('COMMIT');
    logger.info('resources 下载资源分类字段回滚完成');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { up, down };

if (require.main === module) {
  const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database
  });

  up(pool)
    .then(() => {
      logger.info('迁移执行成功');
      process.exit(0);
    })
    .catch((error) => {
      logger.error(`迁移执行失败: ${error.message}`);
      process.exit(1);
    })
    .finally(() => pool.end());
}
