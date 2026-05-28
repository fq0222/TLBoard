/**
 * 数据库迁移脚本 008-user-node-config-password
 *
 * 职责：
 * 1. 为 user_node_configs 表补充 auth 字段
 * 2. 兼容旧版本已创建的 password 字段，并将已有值同步到 auth
 * 3. 保持迁移幂等，避免重复执行失败
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
    console.log('=== 迁移 008: user-node-config-auth ===\n');
    console.log('[1/4] 检查 user_node_configs.auth 字段...');

    const hasAuth = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_name = 'user_node_configs' AND column_name = 'auth'
      )
    `);

    if (!hasAuth.rows[0].exists) {
      await client.query(`ALTER TABLE user_node_configs ADD COLUMN auth VARCHAR(100) DEFAULT ''`);
      console.log('  已添加 auth 字段');
    } else {
      console.log('  auth 字段已存在，跳过');
    }

    console.log('\n[2/4] 检查旧 password 字段是否存在...');
    const hasPassword = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_name = 'user_node_configs' AND column_name = 'password'
      )
    `);

    if (hasPassword.rows[0].exists) {
      console.log('  检测到旧 password 字段，开始同步到 auth');
      const syncResult = await client.query(`
        UPDATE user_node_configs
        SET auth = password
        WHERE COALESCE(auth, '') = '' AND COALESCE(password, '') <> ''
      `);
      console.log(`  已同步 ${syncResult.rowCount} 条记录`);
    } else {
      console.log('  未检测到旧 password 字段，跳过');
    }

    console.log('\n[3/4] 规范化空值...');
    const normalizeResult = await client.query(`
      UPDATE user_node_configs
      SET auth = ''
      WHERE auth IS NULL
    `);
    console.log(`  已规范 ${normalizeResult.rowCount} 条记录`);

    console.log('\n[4/4] 验证迁移结果...');
    const verifyResult = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'user_node_configs' AND column_name = 'auth'
    `);

    if (verifyResult.rows.length !== 1) {
      throw new Error('auth 字段验证失败');
    }

    console.log(`  字段验证通过: ${verifyResult.rows[0].column_name} (${verifyResult.rows[0].data_type})`);
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
