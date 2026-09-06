/**
 * 数据库迁移脚本: 026-ticket-admin-read-state
 *
 * 变更内容：
 * 1. tickets 表添加 admin_last_read_at 字段，用于记录管理员已看到的最新用户消息时间。
 *
 * 使用方法：node server/db/migrations/026-ticket-admin-read-state.js
 */

const { Pool } = require('pg');
const config = require('../../config');

async function migrate() {
  const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database
  });

  const client = await pool.connect();

  try {
    console.log('=== 迁移 026: ticket-admin-read-state ===\n');
    console.log('[1/1] 检查 tickets.admin_last_read_at 字段...');

    const hasColumn = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_name = 'tickets' AND column_name = 'admin_last_read_at'
      )
    `);

    if (!hasColumn.rows[0].exists) {
      await client.query('ALTER TABLE tickets ADD COLUMN admin_last_read_at BIGINT');
      console.log('  已添加 admin_last_read_at 字段');
    } else {
      console.log('  admin_last_read_at 字段已存在，跳过');
    }

    console.log('\n=== 迁移完成 ===');
  } catch (error) {
    console.error('\n迁移失败:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  migrate().then(() => {
    console.log('\n脚本执行成功');
    process.exit(0);
  }).catch(error => {
    console.error('\n脚本执行失败:', error);
    process.exit(1);
  });
}

module.exports = { migrate };
