/**
 * 家宽 IP 出站仓储。
 * 负责 home_proxies 表和同步目标 3X-UI 服务器的数据访问，业务状态聚合由 service 完成。
 */

function getUnixTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * 查询全部家宽 IP 配置。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Array>} 家宽 IP 配置列表
 */
async function listHomeProxies(db) {
  return db.prepare('SELECT * FROM home_proxies ORDER BY created_at DESC').all();
}

/**
 * 根据 ID 查询家宽 IP 配置。
 *
 * @param {Object} db - 数据库实例
 * @param {number} id - 家宽 IP 配置 ID
 * @returns {Promise<Object|undefined>} 家宽 IP 配置
 */
async function findHomeProxyById(db, id) {
  return db.prepare('SELECT * FROM home_proxies WHERE id = ?').get(id);
}

/**
 * 根据 tag 查询家宽 IP 配置，用于唯一性校验。
 *
 * @param {Object} db - 数据库实例
 * @param {string} tag - outbound tag
 * @returns {Promise<Object|undefined>} 家宽 IP 配置
 */
async function findHomeProxyByTag(db, tag) {
  return db.prepare('SELECT * FROM home_proxies WHERE tag = ?').get(tag);
}

/**
 * 创建家宽 IP 配置，初始状态固定为 pending。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 写入参数
 * @returns {Promise<Object>} 插入结果
 */
async function createHomeProxy(db, payload) {
  return db.prepare(`
    INSERT INTO home_proxies (tag, address, port, username, password, sync_status, failed_server_ids)
    VALUES (?, ?, ?, ?, ?, 'pending', '[]')
  `).run(payload.tag, payload.address, payload.port, payload.username, payload.password);
}

/**
 * 更新家宽 IP 配置，并重置同步状态等待管理员重新同步。
 *
 * @param {Object} db - 数据库实例
 * @param {number} id - 家宽 IP 配置 ID
 * @param {Object} payload - 更新参数
 * @returns {Promise<void>}
 */
async function updateHomeProxy(db, id, payload) {
  const now = getUnixTimestamp();
  await db.prepare(`
    UPDATE home_proxies
    SET tag = ?,
        address = ?,
        port = ?,
        username = ?,
        password = ?,
        sync_status = 'pending',
        failed_server_ids = '[]',
        last_sync_success_count = 0,
        last_sync_failed_count = 0,
        last_sync_message = '配置已更新，等待重新同步',
        updated_at = ?
    WHERE id = ?
  `).run(payload.tag, payload.address, payload.port, payload.username, payload.password, now, id);
}

/**
 * 更新家宽 IP 同步状态与失败服务器记录。
 *
 * @param {Object} db - 数据库实例
 * @param {number} id - 家宽 IP 配置 ID
 * @param {Object} payload - 同步状态
 * @returns {Promise<void>}
 */
async function updateSyncState(db, id, payload) {
  const now = getUnixTimestamp();
  await db.prepare(`
    UPDATE home_proxies
    SET sync_status = ?,
        failed_server_ids = ?,
        last_sync_at = ?,
        last_sync_success_count = ?,
        last_sync_failed_count = ?,
        last_sync_message = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    payload.syncStatus,
    JSON.stringify(payload.failedServerIds || []),
    payload.lastSyncAt || now,
    payload.successCount || 0,
    payload.failedCount || 0,
    payload.message || '',
    now,
    id
  );
}

/**
 * 删除本地家宽 IP 配置。
 *
 * @param {Object} db - 数据库实例
 * @param {number} id - 家宽 IP 配置 ID
 * @returns {Promise<void>}
 */
async function deleteHomeProxy(db, id) {
  await db.prepare('DELETE FROM home_proxies WHERE id = ?').run(id);
}

/**
 * 查询当前在线的 3X-UI 服务器。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Array>} 在线服务器列表
 */
async function listOnlineServers(db) {
  return db.prepare(`
    SELECT id, name, api_url, api_token, panel_version, status
    FROM xui_servers
    WHERE status = 1
    ORDER BY created_at DESC
  `).all();
}

/**
 * 按 ID 查询服务器，用于把失败服务器 ID 转换为管理员可读名称。
 *
 * @param {Object} db - 数据库实例
 * @param {number[]} ids - 服务器 ID 列表
 * @returns {Promise<Array>} 服务器列表
 */
async function listServersByIds(db, ids) {
  const normalizedIds = Array.from(new Set((ids || [])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0)));

  if (normalizedIds.length === 0) {
    return [];
  }

  const placeholders = normalizedIds.map(() => '?').join(', ');
  return db.prepare(`
    SELECT id, name, api_url, api_token, panel_version, status
    FROM xui_servers
    WHERE id IN (${placeholders})
    ORDER BY created_at DESC
  `).all(...normalizedIds);
}

module.exports = {
  listHomeProxies,
  findHomeProxyById,
  findHomeProxyByTag,
  createHomeProxy,
  updateHomeProxy,
  updateSyncState,
  deleteHomeProxy,
  listOnlineServers,
  listServersByIds
};
