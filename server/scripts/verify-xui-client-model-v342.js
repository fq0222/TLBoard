/**
 * 3X-UI 3.4.2+ 客户端模型迁移验证脚本。
 * 职责：通过数据库审计表检查迁移是否存在失败记录。
 *
 * 使用：
 * node server/scripts/verify-xui-client-model-v342.js
 */

const databaseManager = require('../db/init');

async function queryAll(db, sql, ...params) {
  return db.prepare(sql).all(...params);
}

async function run() {
  const db = await databaseManager.init();
  try {
    const failures = await queryAll(db, `
      SELECT *
      FROM xui_client_model_migrations
      WHERE status <> 'success'
      ORDER BY updated_at DESC
    `);

    if (failures.length > 0) {
      console.error(`[FAIL] 迁移审计存在失败记录: ${failures.length}`);
      for (const row of failures.slice(0, 20)) {
        console.error(`  user_id=${row.user_id}, server_id=${row.server_id}, status=${row.status}, message=${row.message}`);
      }
      process.exit(1);
    }

    const successRows = await queryAll(db, `
      SELECT COUNT(*) AS count
      FROM xui_client_model_migrations
      WHERE status = 'success'
    `);
    console.log(`[OK] 迁移审计验证通过，成功记录数: ${successRows[0]?.count || 0}`);
  } finally {
    await databaseManager.close();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  run
};
