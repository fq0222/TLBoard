/**
 * 数据库迁移脚本 029-user-home-proxy-routes
 * 职责：新增用户家宽 IP routing 绑定表，保存用户已成功同步到 3X-UI 的服务器选择。
 * 关键参数：无，直接使用本地数据库配置。
 * 核心分支：CREATE TABLE/INDEX 使用 IF NOT EXISTS，重复执行保持幂等。
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
    console.log('=== 迁移 029: user-home-proxy-routes ===\n');
    await client.query('BEGIN');

    console.log('[1/3] 创建 user_home_proxy_routes 表...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_home_proxy_routes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        home_proxy_tag VARCHAR(255) NOT NULL,
        server_ids TEXT NOT NULL DEFAULT '[]',
        last_synced_at BIGINT,
        last_sync_status VARCHAR(30) NOT NULL DEFAULT 'success',
        last_sync_message TEXT NOT NULL DEFAULT '',
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        UNIQUE(user_id)
      )
    `);

    console.log('\n[2/3] 创建用户索引...');
    await client.query('CREATE INDEX IF NOT EXISTS idx_user_home_proxy_routes_user_id ON user_home_proxy_routes(user_id)');

    console.log('\n[3/3] 创建家宽 tag 索引...');
    await client.query('CREATE INDEX IF NOT EXISTS idx_user_home_proxy_routes_home_proxy_tag ON user_home_proxy_routes(home_proxy_tag)');

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

if (require.main === module) {
  migrate().then(() => {
    console.log('\n脚本执行成功');
    process.exit(0);
  }).catch((error) => {
    console.error('\n脚本执行失败:', error);
    process.exit(1);
  });
}

module.exports = { migrate };
