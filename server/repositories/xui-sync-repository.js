/**
 * 3X-UI 同步仓储。
 * 负责 xui_sync_tasks、user_node_configs 以及 3X-UI 同步巡检所需的用户/服务器 SQL 访问，
 * 供 xui-service、xui-sync-task-service 与相关 job handler 复用。
 */

const USER_SYNC_TASK_TYPES = [
  'initial_user_sync',
  'renew_sync',
  'user_sync'
];

/**
 * 查询单个用户节点配置。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @param {number} serverId - 服务器 ID
 * @param {number} inboundId - inbound ID
 * @returns {Promise<Object|undefined>} 节点配置
 */
async function findUserNodeConfig(db, userId, serverId, inboundId) {
  return db.prepare(
    'SELECT uuid, auth, sub_id FROM user_node_configs WHERE user_id = ? AND server_id = ? AND inbound_id = ?'
  ).get(userId, serverId, inboundId);
}

/**
 * 保存用户节点配置，存在则更新，不存在则插入。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - 节点配置数据
 * @returns {Promise<void>}
 */
async function saveUserNodeConfig(db, payload) {
  const {
    userId,
    serverId,
    inboundId,
    uuid,
    auth,
    subId
  } = payload;

  const existing = await findUserNodeConfig(db, userId, serverId, inboundId);
  if (existing) {
    await db.prepare(
      'UPDATE user_node_configs SET uuid = ?, auth = ?, sub_id = ? WHERE user_id = ? AND server_id = ? AND inbound_id = ?'
    ).run(uuid, auth, subId, userId, serverId, inboundId);
    return;
  }

  await db.prepare(
    'INSERT INTO user_node_configs (user_id, server_id, inbound_id, uuid, auth, sub_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId, serverId, inboundId, uuid, auth, subId);
}

/**
 * 尝试获取用户唯一客户端 advisory lock。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} lockKey - advisory lock 键
 * @returns {Promise<boolean>} 是否获取成功
 */
async function tryAcquireUniqueClientLock(db, lockKey) {
  const result = await db.prepare('SELECT pg_try_advisory_lock($1) AS locked').get(lockKey);
  return !!result?.locked;
}

/**
 * 释放用户唯一客户端 advisory lock。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} lockKey - advisory lock 键
 * @returns {Promise<boolean>} 是否释放成功
 */
async function releaseUniqueClientLock(db, lockKey) {
  const result = await db.prepare('SELECT pg_advisory_unlock($1) AS unlocked').get(lockKey);
  return !!result?.unlocked;
}

/**
 * 将同一用户旧的 pending 用户同步任务标记为已取代。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @param {string} reason - 取代原因
 * @param {number} updatedAt - 更新时间戳
 * @returns {Promise<Object>} 更新结果
 */
async function supersedePendingUserSyncTasks(db, userId, reason, updatedAt) {
  return db.prepare(`
    UPDATE xui_sync_tasks
    SET status = 'success',
        last_error = ?,
        updated_at = ?
    WHERE user_id = ?
      AND status = 'pending'
      AND task_type IN (?, ?, ?)
  `).run(reason, updatedAt, userId, ...USER_SYNC_TASK_TYPES);
}

/**
 * 创建 3X-UI 同步任务。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - 任务数据
 * @returns {Promise<Object>} 插入结果
 */
async function insertXuiSyncTask(db, payload) {
  const {
    userId,
    taskType,
    payloadText,
    nextRetryAt,
    createdAt,
    updatedAt
  } = payload;

  return db.prepare(`
    INSERT INTO xui_sync_tasks (
      user_id, task_type, status, payload, attempts, next_retry_at, created_at, updated_at
    )
    VALUES (?, ?, 'pending', ?, 0, ?, ?, ?)
  `).run(userId, taskType, payloadText, nextRetryAt, createdAt, updatedAt);
}

/**
 * 查询到期可执行的同步任务。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} now - 当前时间戳
 * @param {number} limit - 查询上限
 * @returns {Promise<Array>} 任务列表
 */
async function listDueXuiSyncTasks(db, now, limit) {
  return db.prepare(`
    SELECT *
    FROM xui_sync_tasks
    WHERE status = 'pending' AND next_retry_at <= ?
    ORDER BY next_retry_at ASC, id ASC
    LIMIT ?
  `).all(now, limit);
}

/**
 * 标记同步任务处理中。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} taskId - 任务 ID
 * @param {number} updatedAt - 更新时间戳
 * @returns {Promise<void>}
 */
async function markXuiSyncTaskProcessing(db, taskId, updatedAt) {
  await db.prepare(`
    UPDATE xui_sync_tasks
    SET status = 'processing', updated_at = ?
    WHERE id = ?
  `).run(updatedAt, taskId);
}

/**
 * 标记同步任务成功。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} taskId - 任务 ID
 * @param {number} updatedAt - 更新时间戳
 * @returns {Promise<void>}
 */
async function markXuiSyncTaskSuccess(db, taskId, updatedAt) {
  await db.prepare(`
    UPDATE xui_sync_tasks
    SET status = 'success', updated_at = ?
    WHERE id = ?
  `).run(updatedAt, taskId);
}

/**
 * 标记同步任务等待重试。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - 重试数据
 * @returns {Promise<void>}
 */
async function markXuiSyncTaskRetry(db, payload) {
  const {
    taskId,
    attempts,
    nextRetryAt,
    errorMessage,
    updatedAt
  } = payload;

  await db.prepare(`
    UPDATE xui_sync_tasks
    SET status = 'pending',
        attempts = ?,
        next_retry_at = ?,
        last_error = ?,
        updated_at = ?
    WHERE id = ?
  `).run(attempts, nextRetryAt, String(errorMessage || '').slice(0, 2000), updatedAt, taskId);
}

/**
 * 标记同步任务最终失败。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - 失败数据
 * @returns {Promise<void>}
 */
async function markXuiSyncTaskFailed(db, payload) {
  const {
    taskId,
    attempts,
    errorMessage,
    updatedAt
  } = payload;

  await db.prepare(`
    UPDATE xui_sync_tasks
    SET status = 'failed',
        attempts = ?,
        last_error = ?,
        updated_at = ?
    WHERE id = ?
  `).run(attempts, String(errorMessage || '').slice(0, 2000), updatedAt, taskId);
}

/**
 * 查询队列任务执行时使用的最新用户快照。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<Object|undefined>} 用户快照
 */
async function findUserForSyncTask(db, userId) {
  return db.prepare(`
    SELECT id, email, subscription_token, enabled, traffic_limit, expire_at
    FROM users
    WHERE id = ?
  `).get(userId);
}

/**
 * 查询需要参与 3X-UI 巡检的启用用户。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} now - 当前时间戳
 * @returns {Promise<Array>} 用户列表
 */
async function listUsersForXuiSync(db, now) {
  return db.prepare(`
    SELECT id, email, subscription_token, enabled, traffic_limit, expire_at
    FROM users
    WHERE enabled = 1 AND (expire_at = 0 OR expire_at = '0' OR expire_at IS NULL OR expire_at > ?)
  `).all(now);
}

/**
 * 查询在线 3X-UI 服务器。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Promise<Array>} 服务器列表
 */
async function listOnlineXuiServers(db) {
  return db.prepare(`
    SELECT id, name, api_url, api_token
    FROM xui_servers
    WHERE status = 1
  `).all();
}

/**
 * 删除某台服务器现有的节点快照。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} serverId - 服务器 ID
 * @returns {Promise<void>}
 */
async function deleteServerNodes(db, serverId) {
  await db.prepare('DELETE FROM xui_nodes WHERE server_id = ?').run(serverId);
}

/**
 * 写入单个 inbound 的节点快照。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - 节点快照
 * @returns {Promise<void>}
 */
async function insertServerNodeSnapshot(db, payload) {
  const {
    serverId,
    inboundId,
    remark,
    port,
    protocol,
    settings,
    streamSettings,
    userCount,
    onlineCount
  } = payload;

  await db.prepare(`
    INSERT INTO xui_nodes (server_id, inbound_id, remark, port, protocol, settings, stream_settings, user_count, online_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(serverId, inboundId, remark, port, protocol, settings, streamSettings, userCount, onlineCount);
}

module.exports = {
  findUserNodeConfig,
  saveUserNodeConfig,
  tryAcquireUniqueClientLock,
  releaseUniqueClientLock,
  supersedePendingUserSyncTasks,
  insertXuiSyncTask,
  listDueXuiSyncTasks,
  markXuiSyncTaskProcessing,
  markXuiSyncTaskSuccess,
  markXuiSyncTaskRetry,
  markXuiSyncTaskFailed,
  findUserForSyncTask,
  listUsersForXuiSync,
  listOnlineXuiServers
};
