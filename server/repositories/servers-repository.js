/**
 * 3X-UI 服务器仓储。
 * 负责 xui_servers / xui_nodes 的数据访问，供管理端服务器模块复用。
 */

async function listServers(db) {
  return db.prepare(`
    SELECT id, name, api_url, api_token, panel_version, host, client_port, hy2_ports, sub_url, status, last_check_at, created_at
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
      COUNT(*) as node_count,
      COALESCE(SUM(user_count), 0) as user_count,
      COALESCE(SUM(online_count), 0) as online_count
    FROM xui_nodes
    GROUP BY server_id
  `).all();
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
  findServerById,
  createServer,
  updateServerFields,
  updateServerStatus,
  updateServerLastCheckAt,
  deleteServer,
  listCachedServerNodes
};
