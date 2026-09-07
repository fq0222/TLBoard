/**
 * 数据库迁移脚本 028-home-ip-plan
 * 职责：为家宽 IP 套餐补充套餐 tag 字段和用户家宽套餐权益字段。
 * 关键参数：无，直接使用本地数据库配置。
 * 核心分支：所有 ALTER TABLE 使用 IF NOT EXISTS，重复执行不会破坏已有数据。
 */

const db = require('../init');

async function migrate() {
  try {
    console.log('=== 迁移 028: home-ip-plan ===\n');

    console.log('[1/3] 检查 plans.home_proxy_tag 字段...');
    await db.exec(`
      ALTER TABLE plans
      ADD COLUMN IF NOT EXISTS home_proxy_tag VARCHAR(255)
    `);
    console.log('  plans.home_proxy_tag 已就绪');

    console.log('\n[2/3] 检查 users.home_plan_id 字段...');
    await db.exec(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS home_plan_id INTEGER
    `);
    console.log('  users.home_plan_id 已就绪');

    console.log('\n[3/3] 检查 users.home_expire_at 字段...');
    await db.exec(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS home_expire_at BIGINT
    `);
    console.log('  users.home_expire_at 已就绪');

    console.log('\n迁移完成');
  } catch (error) {
    console.error('迁移失败:', error);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

migrate();
