const { Pool } = require('pg');
const config = require('../../config');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('MIGRATION-002');

async function up(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 创建 resources 表
    await client.query(`
      CREATE TABLE IF NOT EXISTS resources (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        filename VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        size BIGINT NOT NULL,
        mimetype VARCHAR(100),
        path VARCHAR(500) NOT NULL,
        download_token VARCHAR(32) UNIQUE NOT NULL,
        expire_at BIGINT,
        download_count INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 1,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `);
    logger.info('resources 表创建成功');

    // 创建索引
    await client.query('CREATE INDEX IF NOT EXISTS idx_resources_download_token ON resources(download_token)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_resources_enabled ON resources(enabled)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_resources_expire_at ON resources(expire_at)');
    logger.info('索引创建成功');

    await client.query('COMMIT');
    logger.info('迁移完成');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error(`迁移失败: ${error.message}`);
    throw error;
  } finally {
    client.release();
  }
}

async function down(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DROP TABLE IF EXISTS resources CASCADE');
    await client.query('COMMIT');
    logger.info('回滚完成');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { up, down };

// 直接运行迁移
if (require.main === module) {
  const { Pool } = require('pg');
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
