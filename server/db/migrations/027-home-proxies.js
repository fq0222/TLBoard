/**
 * 数据库迁移脚本: 027-home-proxies
 *
 * 变更内容：
 * 1. 新增 home_proxies 表，用于保存家宽 SOCKS outbound 本地配置与同步状态。
 * 2. 新增 tag 唯一索引和同步状态索引。
 *
 * 使用方法：node server/db/migrations/027-home-proxies.js
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
    console.log('=== 迁移 027: home-proxies ===\n');
    console.log('[1/3] 创建 home_proxies 表...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS home_proxies (
        id SERIAL PRIMARY KEY,
        tag VARCHAR(255) NOT NULL,
        address VARCHAR(255) NOT NULL,
        port INTEGER NOT NULL,
        username VARCHAR(255) NOT NULL,
        password TEXT NOT NULL,
        sync_status VARCHAR(30) NOT NULL DEFAULT 'pending',
        failed_server_ids TEXT NOT NULL DEFAULT '[]',
        last_sync_at BIGINT,
        last_sync_success_count INTEGER NOT NULL DEFAULT 0,
        last_sync_failed_count INTEGER NOT NULL DEFAULT 0,
        last_sync_message TEXT NOT NULL DEFAULT '',
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `);
    console.log('  home_proxies 表已就绪');

    console.log('[2/3] 创建 tag 唯一索引...');
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_home_proxies_tag ON home_proxies(tag)');
    console.log('  idx_home_proxies_tag 已就绪');

    console.log('[3/3] 创建同步状态索引...');
    await client.query('CREATE INDEX IF NOT EXISTS idx_home_proxies_sync_status ON home_proxies(sync_status)');
    console.log('  idx_home_proxies_sync_status 已就绪');

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
