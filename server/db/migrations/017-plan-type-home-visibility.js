/**
 * 数据库迁移脚本 017-plan-type-home-visibility
 *
 * 变更内容：
 * 1. plans 表新增 plan_type 字段，默认 lifetime。
 * 2. plans 表新增 show_on_home 字段，默认 1。
 * 3. 历史套餐统一回填为 lifetime，避免改变现有不限时套餐逻辑。
 *
 * 使用方法：node server/db/migrations/017-plan-type-home-visibility.js
 */

const { Pool } = require('pg');
const config = require('../../config');

/**
 * 执行 plans 表字段迁移。
 * @returns {Promise<void>} 事务成功提交，失败时回滚并抛出错误
 */
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
    console.log('=== 迁移 017: plan-type-home-visibility ===\n');

    await client.query('BEGIN');

    console.log('[1/3] 检查 plans.plan_type 字段...');
    await client.query(`
      ALTER TABLE plans
      ADD COLUMN IF NOT EXISTS plan_type VARCHAR(20) DEFAULT 'lifetime'
    `);
    await client.query(`
      UPDATE plans
      SET plan_type = 'lifetime'
      WHERE plan_type IS NULL OR plan_type = ''
    `);
    console.log('  plan_type 字段已就绪');

    console.log('\n[2/3] 检查 plans.show_on_home 字段...');
    await client.query(`
      ALTER TABLE plans
      ADD COLUMN IF NOT EXISTS show_on_home INTEGER DEFAULT 1
    `);
    await client.query(`
      UPDATE plans
      SET show_on_home = 1
      WHERE show_on_home IS NULL
    `);
    console.log('  show_on_home 字段已就绪');

    console.log('\n[3/3] 验证套餐类型统计...');
    const summary = await client.query(`
      SELECT plan_type, show_on_home, COUNT(*) AS count
      FROM plans
      GROUP BY plan_type, show_on_home
      ORDER BY plan_type, show_on_home
    `);

    for (const row of summary.rows) {
      console.log(`  plan_type=${row.plan_type}, show_on_home=${row.show_on_home}: ${row.count}`);
    }

    await client.query('COMMIT');
    console.log('\n=== 迁移完成 ===');
  } catch (error) {
    await client.query('ROLLBACK');
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
