/**
 * 迁移 035：增加订阅凭证最近轮换时间（Unix 秒）；可重复执行且不回填历史时间。
 * 命令行执行时使用本地数据库配置，失败回滚并关闭连接池。
 */

/**
 * 在连接池的专用事务中添加字段；pool 必须提供 connect()。
 * DDL 失败时回滚，任何分支都释放连接。
 */
async function upWithPool(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_credentials_rotated_at BIGINT');
    await client.query('COMMIT');
    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** 数据库代理适配入口；db.pool 必须暴露连接池，禁止通过 exec 绕过事务。 */
async function upWithDbProxy(db) {
  return upWithPool(db.pool);
}

/** 幂等迁移入口；dbOrPool 接受项目数据库代理或原生 PostgreSQL 连接池。 */
async function up(dbOrPool) {
  return dbOrPool.pool ? upWithDbProxy(dbOrPool) : upWithPool(dbOrPool);
}

if (require.main === module) {
  const { Pool } = require('pg');
  const config = require('../../config');
  const pool = new Pool(config.database);
  up(pool)
    .then(() => console.log('迁移 035：订阅凭证轮换时间字段初始化完成'))
    .catch(error => {
      console.error('迁移 035 失败:', error.code || error.name);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { up, upWithDbProxy, upWithPool };
