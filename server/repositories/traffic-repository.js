/**
 * 流量管理仓储。
 * 负责 traffic-manager 相关的服务器、用户、同步日志与禁用状态 SQL 访问，
 * 供流量同步、超量禁用和状态补偿逻辑复用。
 */

/**
 * 查询流量统计倍率配置。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Promise<Object|undefined>} 倍率配置记录
 */
async function findTrafficUsageMultiplierSetting(db) {
  return db.prepare(
    "SELECT value FROM system_settings WHERE key = 'traffic_usage_multiplier'"
  ).get();
}

/**
 * 查询所有在线 3X-UI 服务器。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Promise<Array>} 在线服务器列表
 */
async function listOnlineServers(db) {
  return db.prepare(`
    SELECT id, name, api_url, api_token, panel_version
    FROM xui_servers
    WHERE status = 1
  `).all();
}

/**
 * 查询 Telegram 健康巡检需要覆盖的全部 3X-UI 服务器。
 * status=0 通常表示上次探测离线，健康巡检必须继续探测这些服务器才能触发告警和恢复判断。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Promise<Array>} 全量服务器列表
 */
async function listAllServersForHealthCheck(db) {
  return db.prepare(`
    SELECT id, name, api_url, api_token, panel_version, status
    FROM xui_servers
    ORDER BY id ASC
  `).all();
}

/**
 * 查询所有启用用户的流量统计基础信息。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Promise<Array>} 用户列表
 */
async function listEnabledUsersForTrafficSync(db) {
  return db.prepare(`
    SELECT id, email, enabled, traffic_used, traffic_limit, referral_traffic_limit
    FROM users
  `).all();
}

/**
 * 在 PostgreSQL 事务中执行流量同步日志读写。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Function} handler - 事务处理函数
 * @returns {Promise<*>} 事务处理结果
 */
async function withTrafficSyncTransaction(db, handler) {
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');
    const result = await handler(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 查询所有用户的流量同步日志。
 *
 * @param {Object} client - PostgreSQL 事务连接
 * @returns {Promise<Array>} 同步日志列表
 */
async function listTrafficSyncLogs(client) {
  const result = await client.query(
    'SELECT user_id, server_id, last_sync_traffic FROM traffic_sync_log'
  );
  return result.rows;
}

/**
 * 批量写入或更新流量同步日志。
 *
 * @param {Object} client - PostgreSQL 事务连接
 * @param {Array} updates - 更新记录列表
 * @returns {Promise<void>}
 */
async function upsertTrafficSyncLogs(client, updates) {
  if (!Array.isArray(updates) || updates.length === 0) {
    return;
  }

  const values = [];
  const params = [];
  let paramIndex = 1;

  for (const update of updates) {
    values.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3})`);
    params.push(update.userId, update.serverId, update.currentTraffic, update.now);
    paramIndex += 4;
  }

  await client.query(
    `INSERT INTO traffic_sync_log (user_id, server_id, last_sync_traffic, last_sync_at)
     VALUES ${values.join(', ')}
     ON CONFLICT (user_id, server_id)
     DO UPDATE SET last_sync_traffic = EXCLUDED.last_sync_traffic, last_sync_at = EXCLUDED.last_sync_at`,
    params
  );
}

/**
 * 更新单个用户的已用流量。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number|string} userId - 用户 ID
 * @param {number} trafficUsed - 最新已用流量
 * @param {number} updatedAt - 更新时间戳
 * @returns {Promise<void>}
 */
async function updateUserTrafficUsed(db, userId, trafficUsed, updatedAt) {
  await db.prepare(`
    UPDATE users SET traffic_used = ?, updated_at = ? WHERE id = ?
  `).run(trafficUsed, updatedAt, userId);
}

/**
 * 查询禁用前的用户最新状态。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number|string} userId - 用户 ID
 * @returns {Promise<Object|undefined>} 用户状态快照
 */
async function findLatestUserDisableState(db, userId) {
  return db.prepare(`
    SELECT id, email, enabled, traffic_used, traffic_limit, referral_traffic_limit, traffic_used_at, disable_reason
    FROM users
    WHERE id = ?
  `).get(userId);
}

/**
 * 将用户标记为流量超限禁用。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number|string} userId - 用户 ID
 * @param {number} trafficUsedAt - 流量用尽时间戳
 * @param {string} disableReason - 禁用原因
 * @returns {Promise<void>}
 */
async function disableUserByTrafficLimit(db, userId, trafficUsedAt, disableReason) {
  await db.prepare(`
    UPDATE users SET enabled = 0, traffic_used_at = ?, disable_reason = ? WHERE id = ?
  `).run(trafficUsedAt, disableReason, userId);
}

/**
 * 恢复因流量超限禁用、但当前流量已低于上限的用户。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number|string} userId - 用户 ID
 * @returns {Promise<void>}
 */
async function enableUserAfterTrafficLimitRecovery(db, userId) {
  await db.prepare(`
    UPDATE users SET enabled = 1, traffic_used_at = NULL, disable_reason = NULL WHERE id = ?
  `).run(userId);
}

/**
 * 查询状态同步所需的用户邮箱。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number|string} userId - 用户 ID
 * @returns {Promise<Object|undefined>} 用户记录
 */
async function findUserEmailById(db, userId) {
  return db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
}

module.exports = {
  findTrafficUsageMultiplierSetting,
  listAllServersForHealthCheck,
  listOnlineServers,
  listEnabledUsersForTrafficSync,
  withTrafficSyncTransaction,
  listTrafficSyncLogs,
  upsertTrafficSyncLogs,
  updateUserTrafficUsed,
  findLatestUserDisableState,
  disableUserByTrafficLimit,
  enableUserAfterTrafficLimitRecovery,
  findUserEmailById
};
