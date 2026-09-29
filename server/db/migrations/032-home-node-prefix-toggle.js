/**
 * 数据库迁移脚本 032-home-node-prefix-toggle。
 * 职责：为用户家宽绑定补充订阅节点前缀开关，历史绑定默认开启。
 * 核心分支：字段已存在时跳过添加，重复执行保持幂等。
 * 使用方法：node server/db/migrations/032-home-node-prefix-toggle.js
 */

const { Pool } = require('pg');
const config = require('../../config');

/**
 * 执行家宽节点前缀开关字段迁移。
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @returns {Promise<void>} 迁移成功后提交事务
 */
async function up(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      ALTER TABLE user_home_proxy_routes
      ADD COLUMN IF NOT EXISTS show_home_node_prefix INTEGER NOT NULL DEFAULT 1
    `);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 使用本地配置创建连接池并执行迁移。
 * @returns {Promise<void>} 迁移完成后关闭连接池
 */
async function migrate() {
  const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database
  });
  try {
    console.log('=== 迁移 032: home-node-prefix-toggle ===');
    await up(pool);
    console.log('=== 迁移完成 ===');
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  migrate().then(() => {
    console.log('脚本执行成功');
    process.exit(0);
  }).catch((error) => {
    console.error('脚本执行失败:', error);
    process.exit(1);
  });
}

module.exports = { up, migrate };
