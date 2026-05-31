/**
 * 数据库迁移脚本：010-user-onboarding-completed
 *
 * 变更内容：
 * 1. users 表新增 onboarding_completed 字段，记录账号是否已完成新手引导
 *
 * 使用方式：
 * node server/db/migrations/010-user-onboarding-completed.js
 */

const databaseManager = require('../init');

/**
 * 执行迁移。
 *
 * @param {import('pg').Pool} pool PostgreSQL 连接池
 * @returns {Promise<void>}
 */
async function up(pool) {
  const client = await pool.connect();

  try {
    console.log('开始执行迁移：010-user-onboarding-completed');
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS onboarding_completed INTEGER DEFAULT 0
    `);

    await client.query(`
      UPDATE users
      SET onboarding_completed = 0
      WHERE onboarding_completed IS NULL
    `);

    await client.query('COMMIT');
    console.log('迁移完成：010-user-onboarding-completed');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('迁移失败：010-user-onboarding-completed', error.message);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  databaseManager.init()
    .then(db => up(db.pool))
    .finally(() => databaseManager.close());
}

module.exports = { up };
