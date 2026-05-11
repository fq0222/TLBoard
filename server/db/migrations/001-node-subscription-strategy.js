/**
 * 数据库迁移脚本: 001-node-subscription-strategy
 * 
 * 变更内容：
 * 1. xui_servers 表添加 sub_url 字段
 * 2. user_node_configs 表从 node_id 改为 server_id + inbound_id
 * 3. users 表 sub_id 从 32 位更新为 16 位
 * 4. user_node_configs 表 sub_id 从 32 位更新为 16 位
 * 
 * 使用方法：node server/db/migrations/001-node-subscription-strategy.js
 */

const { Pool } = require('pg');
const crypto = require('crypto');
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
    console.log('=== 迁移 001: node-subscription-strategy ===\n');

    // ========================================
    // 1. xui_servers 表添加 sub_url 字段
    // ========================================
    console.log('[1/5] 检查 xui_servers.sub_url 字段...');
    const hasSubUrl = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_name = 'xui_servers' AND column_name = 'sub_url'
      )
    `);

    if (!hasSubUrl.rows[0].exists) {
      await client.query(`ALTER TABLE xui_servers ADD COLUMN sub_url VARCHAR(500) DEFAULT ''`);
      console.log('  已添加 sub_url 字段');
    } else {
      console.log('  sub_url 字段已存在，跳过');
    }

    // ========================================
    // 2. user_node_configs 表结构迁移
    // ========================================
    console.log('\n[2/5] 迁移 user_node_configs 表结构...');

    // 检查表是否存在
    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'user_node_configs'
      )
    `);

    if (!tableExists.rows[0].exists) {
      console.log('  user_node_configs 表不存在，创建新表...');
      await client.query(`
        CREATE TABLE user_node_configs (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          server_id INTEGER NOT NULL,
          inbound_id INTEGER NOT NULL,
          uuid VARCHAR(100) NOT NULL,
          sub_id VARCHAR(50) NOT NULL,
          created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
          UNIQUE(user_id, server_id, inbound_id)
        )
      `);
      console.log('  已创建 user_node_configs 表');
    } else {
      // 检查是否已有 server_id 字段
      const hasServerId = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.columns
          WHERE table_name = 'user_node_configs' AND column_name = 'server_id'
        )
      `);

      if (!hasServerId.rows[0].exists) {
        console.log('  添加 server_id 和 inbound_id 字段...');
        await client.query(`ALTER TABLE user_node_configs ADD COLUMN server_id INTEGER`);
        await client.query(`ALTER TABLE user_node_configs ADD COLUMN inbound_id INTEGER`);

        // 从 xui_nodes 填充数据
        console.log('  从 xui_nodes 填充 server_id 和 inbound_id...');

        // 先删除无法关联的记录
        const deleteResult = await client.query(`
          DELETE FROM user_node_configs
          WHERE node_id NOT IN (SELECT id FROM xui_nodes)
        `);
        console.log(`  删除无效记录: ${deleteResult.rowCount} 条`);

        // 关联填充
        await client.query(`
          UPDATE user_node_configs
          SET server_id = xn.server_id, inbound_id = xn.inbound_id
          FROM xui_nodes xn
          WHERE user_node_configs.node_id = xn.id
        `);

        // 设置 NOT NULL
        await client.query(`ALTER TABLE user_node_configs ALTER COLUMN server_id SET NOT NULL`);
        await client.query(`ALTER TABLE user_node_configs ALTER COLUMN inbound_id SET NOT NULL`);
        console.log('  已填充 server_id 和 inbound_id');

        // 删除旧的唯一约束
        const constraints = await client.query(`
          SELECT constraint_name
          FROM information_schema.table_constraints
          WHERE table_name = 'user_node_configs' AND constraint_type = 'UNIQUE'
        `);
        for (const row of constraints.rows) {
          await client.query(`ALTER TABLE user_node_configs DROP CONSTRAINT ${row.constraint_name}`);
          console.log(`  删除约束: ${row.constraint_name}`);
        }

        // 添加新的唯一约束
        await client.query(`
          ALTER TABLE user_node_configs
          ADD CONSTRAINT user_node_configs_user_server_inbound UNIQUE (user_id, server_id, inbound_id)
        `);
        console.log('  已添加新唯一约束 (user_id, server_id, inbound_id)');

        // 检查并删除 node_id 字段
        const hasNodeId = await client.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.columns
            WHERE table_name = 'user_node_configs' AND column_name = 'node_id'
          )
        `);
        if (hasNodeId.rows[0].exists) {
          await client.query(`ALTER TABLE user_node_configs DROP COLUMN node_id`);
          console.log('  已删除 node_id 字段');
        }

        // 创建索引
        await client.query(`CREATE INDEX IF NOT EXISTS idx_user_node_configs_server_id ON user_node_configs(server_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_user_node_configs_inbound_id ON user_node_configs(inbound_id)`);
        console.log('  已创建索引');
      } else {
        console.log('  server_id 字段已存在，跳过表结构迁移');
      }
    }

    // ========================================
    // 3. users 表 sub_id 更新为 16 位
    // ========================================
    console.log('\n[3/5] 检查 users 表 sub_id 长度...');
    const users = await client.query(`SELECT id, email, sub_id, LENGTH(sub_id) as len FROM users`);
    let usersUpdated = 0;
    for (const user of users.rows) {
      if (user.len && user.len > 16) {
        const newSubId = crypto.randomBytes(8).toString('hex');
        await client.query(`UPDATE users SET sub_id = $1 WHERE id = $2`, [newSubId, user.id]);
        console.log(`  更新 ${user.email}: ${user.sub_id} -> ${newSubId}`);
        usersUpdated++;
      }
    }
    console.log(`  共更新 ${usersUpdated} 个用户 sub_id`);

    // ========================================
    // 4. user_node_configs 表 sub_id 更新为 16 位
    // ========================================
    console.log('\n[4/5] 检查 user_node_configs 表 sub_id 长度...');
    const configs = await client.query(`SELECT id, sub_id, LENGTH(sub_id) as len FROM user_node_configs`);
    let configsUpdated = 0;
    for (const config of configs.rows) {
      if (config.len && config.len > 16) {
        const newSubId = crypto.randomBytes(8).toString('hex');
        await client.query(`UPDATE user_node_configs SET sub_id = $1 WHERE id = $2`, [newSubId, config.id]);
        console.log(`  id=${config.id}: ${config.sub_id} -> ${newSubId}`);
        configsUpdated++;
      }
    }
    console.log(`  共更新 ${configsUpdated} 条配置`);

    // ========================================
    // 5. 验证
    // ========================================
    console.log('\n[5/5] 验证迁移结果...');

    const finalConfigs = await client.query(`
      SELECT unc.user_id, unc.server_id, unc.inbound_id, unc.uuid, unc.sub_id, u.email
      FROM user_node_configs unc
      JOIN users u ON unc.user_id = u.id
    `);
    console.log(`  user_node_configs 记录数: ${finalConfigs.rows.length}`);
    for (const c of finalConfigs.rows) {
      console.log(`    ${c.email}: server=${c.server_id}, inbound=${c.inbound_id}, sub_id=${c.sub_id} (${c.sub_id.length}位)`);
    }

    const finalUsers = await client.query(`SELECT email, sub_id, LENGTH(sub_id) as len FROM users`);
    console.log(`  users 记录数: ${finalUsers.rows.length}`);
    for (const u of finalUsers.rows) {
      console.log(`    ${u.email}: sub_id=${u.sub_id} (${u.len}位)`);
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
