/**
 * 数据库迁移脚本：009-batch-subscription-tasks
 *
 * 变更内容：
 * 1. 新增 batch_subscription_tasks 表，持久化批量生成订阅链接任务进度
 * 2. 新增 batch_subscription_task_items 表，记录每个用户的执行状态
 * 3. 新增任务状态与明细查询索引
 *
 * 使用方式：
 * node server/db/migrations/009-batch-subscription-tasks.js
 */

const databaseManager = require('../init');

/**
 * 执行迁移。
 *
 * @param {import('pg').Pool} pool PostgreSQL 连接池
 * @returns {Promise<void>}
 */
async function up(pool) {
  const client = await pool.connect();

  try {
    console.log('开始执行迁移：009-batch-subscription-tasks');
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS batch_subscription_tasks (
        id SERIAL PRIMARY KEY,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        filter_cf_optimized INTEGER DEFAULT 1,
        total_count INTEGER DEFAULT 0,
        completed_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        current_email VARCHAR(255) DEFAULT '',
        last_error TEXT,
        started_at BIGINT,
        finished_at BIGINT,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS batch_subscription_task_items (
        id SERIAL PRIMARY KEY,
        task_id INTEGER NOT NULL REFERENCES batch_subscription_tasks(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        error_message TEXT,
        started_at BIGINT,
        finished_at BIGINT,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        UNIQUE(user_id)
      )
    `);

    // 旧版本按 task_id + user_id 唯一，升级时保留每个用户最新一条明细。
    await client.query(`
      DELETE FROM batch_subscription_task_items old_item
      USING batch_subscription_task_items latest_item
      WHERE old_item.user_id = latest_item.user_id
        AND old_item.id < latest_item.id
    `);

    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'batch_subscription_task_items_task_id_user_id_key'
        ) THEN
          ALTER TABLE batch_subscription_task_items
          DROP CONSTRAINT batch_subscription_task_items_task_id_user_id_key;
        END IF;
      END $$;
    `);

    await client.query('CREATE INDEX IF NOT EXISTS idx_batch_subscription_tasks_status ON batch_subscription_tasks(status)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_batch_subscription_task_items_task_status ON batch_subscription_task_items(task_id, status)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_batch_subscription_task_items_user_id ON batch_subscription_task_items(user_id)');
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_batch_subscription_task_items_user_unique ON batch_subscription_task_items(user_id)');

    await client.query('COMMIT');
    console.log('迁移完成：009-batch-subscription-tasks');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('迁移失败：009-batch-subscription-tasks', error.message);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  databaseManager.init()
    .then(db => up(db.pool))
    .finally(() => databaseManager.close());
}

module.exports = { up };
