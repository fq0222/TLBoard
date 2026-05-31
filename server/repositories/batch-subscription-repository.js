/**
 * 批量订阅生成仓储。
 * 负责批量任务、任务明细和候选用户的 SQL 访问，保持 service 不直接拼 SQL。
 */

const ACTIVE_TASK_STATUSES = ['pending', 'running', 'paused'];

/**
 * 获取当前秒级时间戳。
 *
 * @returns {number} 秒级 Unix 时间戳
 */
function nowTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * 查询可执行批量订阅生成的用户列表。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} options - 查询选项
 * @param {boolean} options.cfOptimizedOnly - 是否仅筛选已配置启用 CF IP 的用户
 * @returns {Promise<Array>} 用户列表
 */
async function listBatchUsers(db, options = {}) {
  const cfOptimizedOnly = options.cfOptimizedOnly !== false;
  const cfClause = cfOptimizedOnly
    ? `AND EXISTS (
        SELECT 1
        FROM user_cf_ips uci
        JOIN cf_ip_pool cp ON uci.ip_pool_id = cp.id
        WHERE uci.user_id = u.id AND cp.enabled = 1
      )`
    : '';

  return db.prepare(`
    SELECT u.id, u.email
    FROM users u
    WHERE u.enabled = 1
      ${cfClause}
    ORDER BY u.id ASC
  `).all();
}

/**
 * 查询当前未结束的批量任务。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Promise<Object|undefined>} 活跃任务
 */
async function findActiveTask(db) {
  return db.prepare(`
    SELECT *
    FROM batch_subscription_tasks
    WHERE status IN (?, ?, ?)
    ORDER BY id DESC
    LIMIT 1
  `).get(...ACTIVE_TASK_STATUSES);
}

/**
 * 查询最近一条批量任务。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Promise<Object|undefined>} 最近任务
 */
async function findLatestTask(db) {
  return db.prepare(`
    SELECT *
    FROM batch_subscription_tasks
    ORDER BY id DESC
    LIMIT 1
  `).get();
}

/**
 * 持久化创建批量任务和用户明细。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - 创建参数
 * @param {boolean} payload.cfOptimizedOnly - 是否仅处理已优选用户
 * @param {Array} payload.users - 任务用户列表
 * @returns {Promise<Object>} 新建任务记录
 */
async function createTaskWithItems(db, payload) {
  const client = await db.pool.connect();
  const now = nowTimestamp();

  try {
    await client.query('BEGIN');
    const taskResult = await client.query(`
      INSERT INTO batch_subscription_tasks (
        status, filter_cf_optimized, total_count, completed_count,
        failed_count, current_email, created_at, updated_at
      )
      VALUES ($1, $2, $3, 0, 0, '', $4, $4)
      RETURNING *
    `, [
      'pending',
      payload.cfOptimizedOnly ? 1 : 0,
      payload.users.length,
      now
    ]);
    const task = taskResult.rows[0];

    for (const user of payload.users) {
      await client.query(`
        INSERT INTO batch_subscription_task_items (
          task_id, user_id, email, status, created_at, updated_at
        )
        VALUES ($1, $2, $3, 'pending', $4, $4)
        ON CONFLICT (user_id) DO UPDATE SET
          task_id = EXCLUDED.task_id,
          email = EXCLUDED.email,
          status = 'pending',
          error_message = NULL,
          started_at = NULL,
          finished_at = NULL,
          updated_at = EXCLUDED.updated_at
      `, [task.id, user.id, user.email, now]);
    }

    await client.query('COMMIT');
    return task;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 查询任务下一条待处理明细。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} taskId - 任务 ID
 * @returns {Promise<Object|undefined>} 待处理明细
 */
async function findNextPendingItem(db, taskId) {
  return db.prepare(`
    SELECT *
    FROM batch_subscription_task_items
    WHERE task_id = ? AND status = 'pending'
    ORDER BY id ASC
    LIMIT 1
  `).get(taskId);
}

/**
 * 将重启前未完成的运行中明细恢复为待处理。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} taskId - 任务 ID
 * @returns {Promise<void>}
 */
async function resetRunningItems(db, taskId) {
  await db.prepare(`
    UPDATE batch_subscription_task_items
    SET status = 'pending', updated_at = ?
    WHERE task_id = ? AND status = 'running'
  `).run(nowTimestamp(), taskId);
}

/**
 * 更新任务主状态。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} taskId - 任务 ID
 * @param {Object} fields - 更新字段
 * @returns {Promise<void>}
 */
async function updateTask(db, taskId, fields) {
  const updates = [];
  const values = [];
  Object.entries(fields).forEach(([key, value]) => {
    updates.push(`${key} = ?`);
    values.push(value);
  });
  updates.push('updated_at = ?');
  values.push(nowTimestamp());

  await db.prepare(`UPDATE batch_subscription_tasks SET ${updates.join(', ')} WHERE id = ?`)
    .run(...values, taskId);
}

/**
 * 标记任务明细开始执行。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} itemId - 明细 ID
 * @returns {Promise<void>}
 */
async function markItemRunning(db, itemId) {
  const now = nowTimestamp();
  await db.prepare(`
    UPDATE batch_subscription_task_items
    SET status = 'running', started_at = ?, updated_at = ?
    WHERE id = ?
  `).run(now, now, itemId);
}

/**
 * 标记任务明细执行完成。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} itemId - 明细 ID
 * @returns {Promise<void>}
 */
async function markItemSuccess(db, itemId) {
  const now = nowTimestamp();
  await db.prepare(`
    UPDATE batch_subscription_task_items
    SET status = 'success', finished_at = ?, updated_at = ?
    WHERE id = ?
  `).run(now, now, itemId);
}

/**
 * 标记任务明细执行失败。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} itemId - 明细 ID
 * @param {string} message - 失败信息
 * @returns {Promise<void>}
 */
async function markItemFailed(db, itemId, message) {
  const now = nowTimestamp();
  await db.prepare(`
    UPDATE batch_subscription_task_items
    SET status = 'failed', error_message = ?, finished_at = ?, updated_at = ?
    WHERE id = ?
  `).run(String(message || '').slice(0, 2000), now, now, itemId);
}

/**
 * 汇总任务明细进度并写回任务主表。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} taskId - 任务 ID
 * @returns {Promise<Object>} 最新任务记录
 */
async function refreshTaskCounters(db, taskId) {
  const row = await db.prepare(`
    SELECT
      COUNT(*) AS total_count,
      SUM(CASE WHEN status IN ('success', 'failed') THEN 1 ELSE 0 END) AS completed_count,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count
    FROM batch_subscription_task_items
    WHERE task_id = ?
  `).get(taskId);

  await updateTask(db, taskId, {
    total_count: Number(row.total_count) || 0,
    completed_count: Number(row.completed_count) || 0,
    failed_count: Number(row.failed_count) || 0
  });

  return getTaskById(db, taskId);
}

/**
 * 按 ID 查询任务。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} taskId - 任务 ID
 * @returns {Promise<Object|undefined>} 任务记录
 */
async function getTaskById(db, taskId) {
  return db.prepare('SELECT * FROM batch_subscription_tasks WHERE id = ?').get(taskId);
}

module.exports = {
  listBatchUsers,
  findActiveTask,
  findLatestTask,
  createTaskWithItems,
  findNextPendingItem,
  resetRunningItems,
  updateTask,
  markItemRunning,
  markItemSuccess,
  markItemFailed,
  refreshTaskCounters,
  getTaskById,
  nowTimestamp
};
