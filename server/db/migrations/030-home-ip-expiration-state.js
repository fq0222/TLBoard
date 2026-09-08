/**
 * 数据库迁移脚本：030-home-ip-expiration-state
 *
 * 变更内容：
 * 1. users 表新增 home_status 字段，记录家宽权益状态
 * 2. users 表新增 home_expired_notice_sent_at 字段，记录家宽过期提醒尝试时间
 *
 * 使用方式：
 * node server/db/migrations/030-home-ip-expiration-state.js
 */

const databaseManager = require('../init');

/**
 * 检查 users 表中的指定字段是否存在。
 *
 * @param {import('pg').PoolClient} client - PostgreSQL 事务连接
 * @param {string} columnName - 需要检查的 users 字段名
 * @returns {Promise<boolean>} true 表示字段已存在，迁移应跳过添加
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
 * 执行家宽 IP 到期状态字段迁移。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @returns {Promise<{addedColumns:string[],skippedColumns:string[]}>} 字段处理结果
 */
async function up(pool) {
  const client = await pool.connect();
  const addedColumns = [];
  const skippedColumns = [];

  try {
    console.log('开始执行迁移：030-home-ip-expiration-state');
    await client.query('BEGIN');

    if (await columnExists(client, 'home_status')) {
      skippedColumns.push('home_status');
    } else {
      await client.query(`
        ALTER TABLE users
        ADD COLUMN home_status VARCHAR(20) DEFAULT 'normal'
      `);
      addedColumns.push('home_status');
    }

    if (await columnExists(client, 'home_expired_notice_sent_at')) {
      skippedColumns.push('home_expired_notice_sent_at');
    } else {
      await client.query(`
        ALTER TABLE users
        ADD COLUMN home_expired_notice_sent_at BIGINT
      `);
      addedColumns.push('home_expired_notice_sent_at');
    }

    await client.query('COMMIT');
    console.log('迁移完成：030-home-ip-expiration-state');

    return { addedColumns, skippedColumns };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('迁移失败：030-home-ip-expiration-state', error.message);
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
