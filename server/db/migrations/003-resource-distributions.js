const { Pool } = require('pg');
const config = require('../../config');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('MIGRATION-003');

async function up(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 创建 resource_distributions 表
    await client.query(`
      CREATE TABLE IF NOT EXISTS resource_distributions (
        id SERIAL PRIMARY KEY,
        resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        download_token VARCHAR(32) UNIQUE NOT NULL,
        expire_at BIGINT,
        download_count INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 1,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `);
    logger.info('resource_distributions 表创建成功');

    // 创建索引
    await client.query('CREATE INDEX IF NOT EXISTS idx_resource_distributions_user_id ON resource_distributions(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_resource_distributions_resource_id ON resource_distributions(resource_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_resource_distributions_download_token ON resource_distributions(download_token)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_resource_distributions_expire_at ON resource_distributions(expire_at)');
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
    await client.query('DROP TABLE IF EXISTS resource_distributions CASCADE');
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
