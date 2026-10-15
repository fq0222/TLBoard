/**
 * 数据库迁移 033：用户 Passkey 和一次性 WebAuthn 挑战。
 * 职责：在专用事务连接上补充稳定 user handle、表及索引，重复运行保持幂等。
 * 用法：node server/db/migrations/033-passkeys.js；失败时回滚全部 DDL。
 */
const { Pool } = require('pg');
const config = require('../../config');
const { passkeyTableDefinitions } = require('../schema/tables');
const { passkeyIndexStatements } = require('../schema/indexes');

/**
 * 执行 Passkey 迁移；pool 为调用方提供的数据库连接池。
 * 核心分支：所有 DDL 在同一事务内执行，失败回滚，始终释放专用连接。
 */
async function up(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS webauthn_user_id VARCHAR(64)');
    for (const definition of passkeyTableDefinitions) {
      await client.query(definition.sql);
    }
    for (const statement of passkeyIndexStatements) {
      await client.query(statement);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** 使用本地配置执行迁移；无参数，执行后关闭连接池且仅输出非敏感状态。 */
async function migrate() {
  const pool = new Pool(config.database);
  try {
    await up(pool);
    console.log('迁移 033：Passkey 数据结构初始化完成');
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  migrate().catch(error => {
    console.error('迁移 033 失败:', error.code || error.name);
    process.exitCode = 1;
  });
}

module.exports = { up, migrate };
