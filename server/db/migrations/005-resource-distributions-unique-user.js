const { Pool } = require('pg');
const config = require('../../config');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('MIGRATION-005');

async function up(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 保留每个用户最新的一条分发记录，删除历史重复记录
    const cleanupResult = await client.query(`
      DELETE FROM resource_distributions rd
      USING (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY user_id
                 ORDER BY created_at DESC, id DESC
               ) AS row_num
        FROM resource_distributions
      ) ranked
      WHERE rd.id = ranked.id
        AND ranked.row_num > 1
    `);
    logger.info(`清理重复分发记录完成，共删除 ${cleanupResult.rowCount} 条`);

    // 数据库层保证同一用户只保留一条分发记录
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_resource_distributions_user_id_unique
      ON resource_distributions(user_id)
    `);
    logger.info('resource_distributions.user_id 唯一索引创建成功');

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
    await client.query('DROP INDEX IF EXISTS idx_resource_distributions_user_id_unique');
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
