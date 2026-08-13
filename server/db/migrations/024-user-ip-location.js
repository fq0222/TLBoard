/**
 * 数据库迁移脚本：024-user-ip-location
 *
 * 变更内容：
 * 1. users 表新增 ip_location 字段，用 JSON 字符串保存登录和订阅 IP 归属地。
 *
 * 使用方式：
 * node server/db/migrations/024-user-ip-location.js
 */

const databaseManager = require('../init');

/**
 * 检查 users 表中的指定字段是否存在。
 *
 * @param {import('pg').PoolClient} client - PostgreSQL 事务连接
 * @param {string} columnName - 需要检查的 users 字段名
 * @returns {Promise<boolean>} true 表示字段已存在
 */
async function columnExists(client, columnName) {
  const result = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = $1
  `, [columnName]);

  return result.rows.length > 0;
}

/**
 * 执行用户 IP 归属地字段迁移。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @returns {Promise<{addedColumns:string[],skippedColumns:string[]}>} 字段处理结果
 */
async function up(pool) {
  const client = await pool.connect();
  const addedColumns = [];
  const skippedColumns = [];

  try {
    console.log('开始执行迁移：024-user-ip-location');
    await client.query('BEGIN');

    if (await columnExists(client, 'ip_location')) {
      skippedColumns.push('ip_location');
    } else {
      await client.query(`
        ALTER TABLE users
        ADD COLUMN ip_location TEXT DEFAULT '{}'
      `);
      addedColumns.push('ip_location');
    }

    await client.query('COMMIT');
    console.log('迁移完成：024-user-ip-location');

    return { addedColumns, skippedColumns };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('迁移失败：024-user-ip-location', error.message);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  databaseManager.init()
    .then((db) => up(db.pool))
    .finally(() => databaseManager.close());
}

module.exports = {
  up,
  columnExists
};
