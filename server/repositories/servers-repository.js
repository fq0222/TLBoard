/**
 * 3X-UI 服务器仓储。
 * 负责 xui_servers / xui_nodes 的数据访问，供管理端服务器模块复用。
 */

async function listServers(db) {
  return db.prepare(`
    SELECT id, name, api_url, api_token, panel_version, host, client_port, hy2_ports, sub_url,
           status, managed_user_count, managed_online_count, last_check_at, created_at
    FROM xui_servers
    ORDER BY created_at DESC
  `).all();
}

/**
 * 汇总每台服务器的节点、用户和在线数统计。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Array>} 聚合统计结果
 */
async function listServerNodeStats(db) {
  return db.prepare(`
    SELECT
      server_id,
      COUNT(*) as node_count
    FROM xui_nodes
    GROUP BY server_id
  `).all();
}

/**
 * 筛选 users 表中真实存在的邮箱。
 * 空集合直接返回，避免生成无意义的数据库查询。
 *
 * @param {Object} db - 数据库实例
 * @param {Array<string>} emails - 已去重的远端客户端邮箱
 * @returns {Promise<Array<string>>} 本地存在的邮箱
 */
async function listExistingUserEmails(db, emails) {
  const uniqueEmails = [...new Set((emails || []).filter(Boolean))];
  if (uniqueEmails.length === 0) {
    return [];
  }

  const rows = await db.prepare('SELECT email FROM users WHERE email = ANY(?)').all(uniqueEmails);
  return rows.map((row) => row.email);
}

/**
 * 更新服务器级受管用户与在线用户缓存。
 *
 * @param {Object} db - 数据库实例
 * @param {number} serverId - 服务器 ID
 * @param {{userCount:number, onlineCount:number}} counts - 去重后的统计值
 * @returns {Promise<void>}
 */
async function updateServerManagedCounts(db, serverId, counts) {
  await db.prepare(`
    UPDATE xui_servers
    SET managed_user_count = ?, managed_online_count = ?
    WHERE id = ?
  `).run(counts.userCount, counts.onlineCount, serverId);
}

/**
 * 只更新服务器级在线用户缓存，查询失败时由调用方跳过本方法以保留旧值。
 *
 * @param {Object} db - 数据库实例
 * @param {number} serverId - 服务器 ID
 * @param {number} onlineCount - 去重后的在线用户数
 * @returns {Promise<void>}
 */
async function updateServerManagedOnlineCount(db, serverId, onlineCount) {
  await db.prepare('UPDATE xui_servers SET managed_online_count = ? WHERE id = ?')
    .run(onlineCount, serverId);
}

/**
 * 根据服务器 ID 查询服务器详情。
 *
 * @param {Object} db - 数据库实例
 * @param {number} serverId - 服务器 ID
 * @returns {Promise<Object|undefined>} 服务器记录
 */
async function findServerById(db, serverId) {
  return db.prepare('SELECT * FROM xui_servers WHERE id = ?').get(serverId);
}

/**
 * 创建服务器记录。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 服务器写入参数
 * @returns {Promise<Object>} 插入结果
 */
async function createServer(db, payload) {
  const {
    name,
    apiUrl,
    apiToken,
    panelVersion,
    host,
    clientPort,
    hy2Ports,
    subUrl,
    lastCheckAt
  } = payload;

  return db.prepare(`
    INSERT INTO xui_servers (name, api_url, api_username, api_password, api_token, panel_version, host, client_port, hy2_ports, sub_url, status, last_check_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(name, apiUrl, '', '', apiToken, panelVersion || '3.0.2', host, clientPort, hy2Ports, subUrl, lastCheckAt);
}

/**
 * 按动态字段更新服务器记录。
 *
 * @param {Object} db - 数据库实例
 * @param {number} serverId - 服务器 ID
 * @param {Array<string>} updates - 更新语句片段
 * @param {Array<*>} values - 绑定参数
 * @returns {Promise<void>}
 */
async function updateServerFields(db, serverId, updates, values) {
  await db.prepare(`UPDATE xui_servers SET ${updates.join(', ')} WHERE id = ?`).run(...values, serverId);
}

/**
 * 更新服务器状态与最近检查时间。
 *
 * @param {Object} db - 数据库实例
 * @param {number} serverId - 服务器 ID
 * @param {number} status - 状态值
 * @param {number} lastCheckAt - 检查时间戳
 * @returns {Promise<void>}
 */
async function updateServerStatus(db, serverId, status, lastCheckAt) {
  await db.prepare('UPDATE xui_servers SET status = ?, last_check_at = ? WHERE id = ?')
    .run(status, lastCheckAt, serverId);
}

/**
 * 更新服务器最近检查时间，不修改在线状态。
 *
 * @param {Object} db - 数据库实例
 * @param {number} serverId - 服务器 ID
 * @param {number} lastCheckAt - 最近检查时间戳
 * @returns {Promise<void>}
 */
async function updateServerLastCheckAt(db, serverId, lastCheckAt) {
  await db.prepare('UPDATE xui_servers SET last_check_at = ? WHERE id = ?')
    .run(lastCheckAt, serverId);
}

/**
 * 删除服务器记录。
 *
 * @param {Object} db - 数据库实例
 * @param {number} serverId - 服务器 ID
 * @returns {Promise<void>}
 */
async function deleteServer(db, serverId) {
  await db.prepare('DELETE FROM xui_servers WHERE id = ?').run(serverId);
}

/**
 * 查询服务器当前缓存的节点列表。
 *
 * @param {Object} db - 数据库实例
 * @param {number} serverId - 服务器 ID
 * @returns {Promise<Array>} 节点缓存列表
 */
async function listCachedServerNodes(db, serverId) {
  return db.prepare(`
    SELECT inbound_id, remark, port, protocol, settings, stream_settings, user_count, online_count
    FROM xui_nodes
    WHERE server_id = ?
    ORDER BY port ASC
  `).all(serverId);
}

module.exports = {
  listServers,
  listServerNodeStats,
  listExistingUserEmails,
  updateServerManagedCounts,
  updateServerManagedOnlineCount,
  findServerById,
  createServer,
  updateServerFields,
  updateServerStatus,
  updateServerLastCheckAt,
  deleteServer,
  listCachedServerNodes
};
