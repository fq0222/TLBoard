/**
 * 钱包流水与个人提现迁移脚本。
 * 职责：创建余额流水、用户收款码和提现申请表，并初始化最低提现金额与历史期初流水。
 * 金额字段统一使用分；所有结构和初始化数据在同一事务中提交。
 *
 * 使用方式：node server/db/migrations/019-wallet-withdrawals.js
 */

const { Pool } = require('pg');
const config = require('../../config');

/**
 * 执行钱包与提现迁移。
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @returns {Promise<void>}
 * 核心分支：任一 SQL 失败时整体回滚；重复执行时依靠 IF NOT EXISTS 与 ON CONFLICT 保持幂等。
 */
async function up(pool) {
  const client = await pool.connect();

  try {
    console.log('开始执行迁移：019-wallet-withdrawals');
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS balance_transactions (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        type VARCHAR(30) NOT NULL,
        amount INTEGER NOT NULL CHECK (amount <> 0),
        balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
        reference_type VARCHAR(50) NOT NULL,
        reference_id INTEGER NOT NULL,
        description VARCHAR(255) NOT NULL DEFAULT '',
        created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
        CONSTRAINT balance_transactions_type_check CHECK (
          type IN ('opening_balance', 'referral_reward', 'plan_payment', 'withdrawal', 'withdrawal_refund')
        ),
        UNIQUE (reference_type, reference_id, type)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_payment_qr_codes (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        payment_type VARCHAR(20) NOT NULL,
        qr_payload_encrypted TEXT NOT NULL,
        qr_payload_digest VARCHAR(128) NOT NULL,
        created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
        CONSTRAINT user_payment_qr_codes_payment_type_check CHECK (
          payment_type IN ('wechat', 'alipay')
        )
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS withdrawal_requests (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        amount INTEGER NOT NULL CHECK (amount > 0),
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        payment_type VARCHAR(20) NOT NULL,
        qr_payload_encrypted TEXT NOT NULL,
        qr_payload_digest VARCHAR(128) NOT NULL,
        reject_reason TEXT,
        processed_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,
        processed_at BIGINT,
        created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
        CONSTRAINT withdrawal_requests_status_check CHECK (
          status IN ('pending', 'completed', 'rejected')
        ),
        CONSTRAINT withdrawal_requests_payment_type_check CHECK (
          payment_type IN ('wechat', 'alipay')
        ),
        CONSTRAINT withdrawal_requests_reject_reason_check CHECK (
          status <> 'rejected' OR NULLIF(BTRIM(reject_reason), '') IS NOT NULL
        )
      )
    `);

    // 已部署旧版 019 的库也必须升级外键；事务内重建默认具名约束，不留下级联删除窗口。
    for (const table of ['balance_transactions', 'withdrawal_requests']) {
      await client.query(`
        ALTER TABLE ${table}
        DROP CONSTRAINT IF EXISTS ${table}_user_id_fkey,
        ADD CONSTRAINT ${table}_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
      `);
    }

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_balance_transactions_user_created_id
      ON balance_transactions(user_id, created_at DESC, id DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user_created_at
      ON withdrawal_requests(user_id, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status_created_at
      ON withdrawal_requests(status, created_at DESC)
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_withdrawal_requests_one_pending_per_user
      ON withdrawal_requests(user_id)
      WHERE status = 'pending'
    `);

    await client.query(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES ('minimum_withdrawal_amount', '2000', EXTRACT(EPOCH FROM NOW()))
      ON CONFLICT (key) DO NOTHING
    `);

    await client.query(`
      INSERT INTO balance_transactions
        (user_id, type, amount, balance_after, reference_type, reference_id, description)
      SELECT id, 'opening_balance', balance, balance, 'opening_balance', id, '期初余额'
      FROM users
      WHERE COALESCE(balance, 0) > 0
        AND NOT EXISTS (
          SELECT 1 FROM balance_transactions existing WHERE existing.user_id = users.id
        )
      ON CONFLICT (reference_type, reference_id, type) DO NOTHING
    `);

    await client.query('COMMIT');
    console.log('迁移执行完成：019-wallet-withdrawals');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('迁移执行失败：019-wallet-withdrawals', error.message);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 使用本地数据库配置创建迁移专用连接池。
 * @returns {import('pg').Pool} PostgreSQL 连接池
 */
function createMigrationPool() {
  return new Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
    max: config.database.max,
    idleTimeoutMillis: config.database.idleTimeoutMillis,
    connectionTimeoutMillis: config.database.connectionTimeoutMillis,
    allowExitOnIdle: false,
    application_name: 'subscription_manager_migration_019_wallet_withdrawals'
  });
}

/**
 * 独立运行迁移并确保连接池关闭。
 * @returns {Promise<void>}
 */
async function migrate() {
  const pool = createMigrationPool();
  try {
    await up(pool);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  migrate().catch((error) => {
    console.error('迁移执行失败:', error);
    process.exit(1);
  });
}

module.exports = { up, migrate, createMigrationPool };
