/**
 * 迁移 036：为家宽 routing 增加离线服务器待清理列表，默认空数组。
 * 命令行执行时使用本地配置；DDL 可重复执行，不改动现有绑定。
 */

/**
 * 使用注入的 PostgreSQL pool 在专用事务中添加字段。
 * @param {Object} pool - 提供 connect() 的连接池
 * 核心分支：任何查询失败均回滚并抛出，最终始终释放连接。
 */
async function up(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("ALTER TABLE user_home_proxy_routes ADD COLUMN IF NOT EXISTS pending_cleanup_server_ids TEXT NOT NULL DEFAULT '[]'");
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  const { Pool } = require('pg');
  const config = require('../../config');
  const pool = new Pool(config.database);
  up(pool)
    .then(() => console.log('迁移 036：家宽 routing 待清理字段初始化完成'))
    .catch(error => {
      console.error('迁移 036 失败:', error.code || error.name);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { up };
