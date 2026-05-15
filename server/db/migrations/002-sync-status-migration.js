/**
 * 数据库迁移脚本: 002-sync-status-migration
 * 
 * 变更内容：
 * 1. users 表添加 sync_status 字段（0=未同步，1=同步中，2=已完成）
 * 2. 将现有用户的 sync_status 设置为 2（已完成）
 * 
 * 使用方法：node server/db/migrations/002-sync-status-migration.js
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
    console.log('=== 迁移 002: sync-status ===\n');

    // ========================================
    // 1. users 表添加 sync_status 字段
    // ========================================
    console.log('[1/2] 检查 users.sync_status 字段...');
    const hasSyncStatus = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'sync_status'
      )
    `);

    if (!hasSyncStatus.rows[0].exists) {
      await client.query(`ALTER TABLE users ADD COLUMN sync_status INTEGER DEFAULT 0`);
      console.log('  已添加 sync_status 字段');
    } else {
      console.log('  sync_status 字段已存在，跳过');
    }

    // ========================================
    // 2. 将现有用户的 sync_status 设置为 2（已完成）
    // ========================================
    console.log('\n[2/2] 更新现有用户的 sync_status...');
    const updateResult = await client.query(`
      UPDATE users SET sync_status = 2 WHERE sync_status != 2
    `);
    console.log(`  已更新 ${updateResult.rowCount} 个用户的 sync_status 为 2`);

    console.log('\n=== 迁移完成 ===');

  } catch (error) {
    console.error('\n迁移失败:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().then(() => {
  console.log('\n脚本执行成功');
  process.exit(0);
}).catch(error => {
  console.error('\n脚本执行失败:', error);
  process.exit(1);
});
