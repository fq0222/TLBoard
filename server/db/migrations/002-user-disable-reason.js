/**
 * 数据库迁移脚本 002-user-disable-reason
 *
 * 变更内容：
 * 1. users 表新增 disable_reason 字段
 * 2. 为历史禁用用户回填禁用原因
 *
 * 使用方法：node server/db/migrations/002-user-disable-reason.js
 */

const { Pool } = require('pg');
const config = require('../../config');

const DISABLE_REASONS = {
  ADMIN: 'admin',
  TRAFFIC_LIMIT: 'traffic_limit'
};

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
    console.log('=== 迁移 002: user-disable-reason ===\n');

    console.log('[1/3] 检查 users.disable_reason 字段...');
    const hasDisableReason = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'disable_reason'
      )
    `);

    if (!hasDisableReason.rows[0].exists) {
      await client.query(`ALTER TABLE users ADD COLUMN disable_reason VARCHAR(50)`);
      console.log('  已添加 disable_reason 字段');
    } else {
      console.log('  disable_reason 字段已存在，跳过');
    }

    console.log('\n[2/3] 回填历史禁用原因...');
    const trafficLimitResult = await client.query(`
      UPDATE users
      SET disable_reason = $1
      WHERE enabled = 0
        AND traffic_used_at IS NOT NULL
        AND (disable_reason IS NULL OR disable_reason = '')
    `, [DISABLE_REASONS.TRAFFIC_LIMIT]);
    console.log(`  已回填流量超限禁用用户: ${trafficLimitResult.rowCount} 个`);

    const adminResult = await client.query(`
      UPDATE users
      SET disable_reason = $1
      WHERE enabled = 0
        AND traffic_used_at IS NULL
        AND (disable_reason IS NULL OR disable_reason = '')
    `, [DISABLE_REASONS.ADMIN]);
    console.log(`  已回填管理员禁用用户: ${adminResult.rowCount} 个`);

    console.log('\n[3/3] 验证迁移结果...');
    const summary = await client.query(`
      SELECT COALESCE(disable_reason, 'null') AS disable_reason, COUNT(*) AS count
      FROM users
      GROUP BY COALESCE(disable_reason, 'null')
      ORDER BY disable_reason
    `);

    for (const row of summary.rows) {
      console.log(`  ${row.disable_reason}: ${row.count}`);
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

migrate().then(() => {
  console.log('\n脚本执行成功');
  process.exit(0);
}).catch(error => {
  console.error('\n脚本执行失败:', error);
  process.exit(1);
});
