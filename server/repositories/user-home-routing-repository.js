/**
 * 用户家宽 IP routing 仓储。
 * 职责：封装用户家宽权益、可选服务器、当前绑定和绑定持久化 SQL。
 */

/**
 * 查询用户当前家宽 IP 权益及对应 outbound tag。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 当前用户 ID
 * @returns {Promise<Object|undefined>} 家宽权益记录
 */
async function findHomeRoutingEntitlement(db, userId) {
  return db.prepare(`
    SELECT
      u.id AS user_id,
      u.email,
      u.home_plan_id,
      u.home_expire_at,
      u.home_status,
      u.home_expired_notice_sent_at,
      p.name AS home_plan_name,
      p.plan_type,
      p.home_proxy_tag,
      hp.id AS home_proxy_id,
      hp.tag AS proxy_tag
    FROM users u
    LEFT JOIN plans p ON p.id = u.home_plan_id
    LEFT JOIN home_proxies hp ON hp.tag = p.home_proxy_tag
    WHERE u.id = ?
  `).get(userId);
}

/**
 * 查询用户当前成功保存的家宽 routing 绑定。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 当前用户 ID
 * @returns {Promise<Object|undefined>} 当前绑定记录
 */
async function findUserHomeRoute(db, userId) {
  return db.prepare('SELECT * FROM user_home_proxy_routes WHERE user_id = ?').get(userId);
}

/**
 * 查询家宽 routing 删除所需的用户上下文。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 当前用户 ID
 * @returns {Promise<Object|undefined>} 用户邮箱上下文
 */
async function findUserHomeRoutingContext(db, userId) {
  return db.prepare('SELECT id AS user_id, email FROM users WHERE id = ?').get(userId);
}

/**
 * 查询用户可选择的在线 3X-UI 服务器。
 *
 * @param {Object} db - 数据库代理对象
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
 * 根据 ID 查询服务器记录，包含离线服务器，便于展示旧绑定名称。
 *
 * @param {Object} db - 数据库代理对象
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

/**
 * 保存用户家宽 routing 绑定，按 user_id 幂等覆盖。
 * 核心分支：只有远端全部成功后才调用本方法，因此这里固定写入 success 状态。
 *
 * @param {Object} db - 数据库代理对象，成功同步后传入普通 db 或事务态 db
 * @param {Object} payload - 绑定数据
 * @param {number} payload.userId - 用户 ID
 * @param {string} payload.homeProxyTag - 家宽 outbound tag
 * @param {number[]} payload.serverIds - 已成功同步服务器 ID
 * @param {number} payload.syncedAt - 成功同步时间
 * @param {string} payload.message - 成功摘要
 * @returns {Promise<void>}
 */
async function upsertUserHomeRoute(db, payload) {
  await db.prepare(`
    INSERT INTO user_home_proxy_routes (
      user_id, home_proxy_tag, server_ids, last_synced_at, last_sync_status, last_sync_message, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, 'success', ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET
      home_proxy_tag = EXCLUDED.home_proxy_tag,
      server_ids = EXCLUDED.server_ids,
      last_synced_at = EXCLUDED.last_synced_at,
      last_sync_status = EXCLUDED.last_sync_status,
      last_sync_message = EXCLUDED.last_sync_message,
      updated_at = EXCLUDED.updated_at
  `).run(
    payload.userId,
    payload.homeProxyTag,
    JSON.stringify(payload.serverIds || []),
    payload.syncedAt,
    payload.message || '',
    payload.syncedAt,
    payload.syncedAt
  );
}

/**
 * 删除用户本地家宽 routing 绑定记录。
 * 核心分支：调用方已确认远端清理成功，这里只删除当前用户自己的记录。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<void>}
 */
async function deleteUserHomeRoute(db, userId) {
  await db.prepare('DELETE FROM user_home_proxy_routes WHERE user_id = ?').run(userId);
}

module.exports = {
  findHomeRoutingEntitlement,
  findUserHomeRoute,
  findUserHomeRoutingContext,
  listOnlineServers,
  listServersByIds,
  upsertUserHomeRoute,
  deleteUserHomeRoute
};
