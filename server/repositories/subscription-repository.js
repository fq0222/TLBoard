/**
 * 订阅仓储。
 * 负责 user subscriptions / xui servers / xui nodes 相关 SQL 访问，
 * 供用户端订阅生成、订阅详情与订阅内容接口复用。
 */

/**
 * 查询订阅模块所需的用户基础信息。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<Object|undefined>} 用户与套餐信息
 */
async function findSubscriptionUserById(db, userId) {
  return db.prepare(`
    SELECT
      u.id, u.email, u.subscription_token, u.sub_id,
      u.traffic_used, u.traffic_limit, u.referral_traffic_limit, u.expire_at, u.enabled, u.disable_reason,
      p.name as plan_name, p.plan_type
    FROM users u
    LEFT JOIN plans p ON u.plan_id = p.id
    WHERE u.id = ?
  `).get(userId);
}

/**
 * 查询用户最后一次生成的订阅缓存。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<Object|undefined>} 订阅缓存
 */
async function findLatestUserSubscription(db, userId) {
  return db.prepare(`
    SELECT *
    FROM user_subscriptions
    WHERE user_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(userId);
}

/**
 * 查询用户已启用的 CF 优选 IP 列表。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<Array>} CF IP 列表
 */
async function listEnabledUserCfIps(db, userId) {
  return db.prepare(`
    SELECT COALESCE(cp.ip, uci.custom_ip) AS ip
    FROM user_cf_ips uci
    LEFT JOIN cf_ip_pool cp ON uci.ip_pool_id = cp.id
    WHERE uci.user_id = ?
      AND (COALESCE(uci.source, 'pool') = 'custom' OR cp.enabled = 1)
    ORDER BY COALESCE(uci.slot_index, uci.id) ASC, uci.id ASC
  `).all(userId);
}

/**
 * 查询当前所有在线服务器。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Promise<Array>} 在线服务器列表
 */
async function listOnlineServers(db) {
  return db.prepare(`
    SELECT id, name, api_url, api_token, host, client_port, sub_url, panel_version
    FROM xui_servers
    WHERE status = 1
  `).all();
}

/**
 * 查询用于订阅详情展示的在线服务器列表。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Promise<Array>} 在线服务器列表
 */
async function listOnlineServersForDisplay(db) {
  return db.prepare(`
    SELECT id, name, api_url, host, client_port, status
    FROM xui_servers
    WHERE status = 1
  `).all();
}

/**
 * 查询在线服务器已有的 inbound 快照。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Promise<Array>} 快照列表
 */
async function listNodeSnapshots(db) {
  return db.prepare(`
    SELECT server_id, inbound_id
    FROM xui_nodes
  `).all();
}

/**
 * 查询用户在在线服务器上的节点配置。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<Array>} 节点配置列表
 */
async function listUserNodeConfigs(db, userId) {
  return db.prepare(`
    SELECT
      unc.user_id, unc.server_id, unc.inbound_id, unc.uuid, unc.password, unc.auth, unc.sub_id,
      xn.remark, xn.protocol, xn.port, xn.settings, xn.stream_settings
    FROM user_node_configs unc
    JOIN xui_nodes xn ON unc.server_id = xn.server_id AND unc.inbound_id = xn.inbound_id
    WHERE unc.user_id = ?
  `).all(userId);
}

/**
 * 查询用户的原始订阅来源缓存。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<Array>} 缓存记录
 */
async function listUserSubscriptionSources(db, userId) {
  return db.prepare(`
    SELECT *
    FROM user_subscription_sources
    WHERE user_id = ?
  `).all(userId);
}

/**
 * 写入或更新单条原始订阅来源缓存。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - 缓存记录
 * @returns {Promise<void>}
 */
async function upsertSubscriptionSource(db, payload) {
  await db.prepare(`
    INSERT INTO user_subscription_sources (
      user_id, server_id, inbound_id, sub_id, remark, protocol,
      original_link, node_fingerprint, server_fingerprint, fetched_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, server_id, inbound_id) DO UPDATE SET
      sub_id = EXCLUDED.sub_id,
      remark = EXCLUDED.remark,
      protocol = EXCLUDED.protocol,
      original_link = EXCLUDED.original_link,
      node_fingerprint = EXCLUDED.node_fingerprint,
      server_fingerprint = EXCLUDED.server_fingerprint,
      fetched_at = EXCLUDED.fetched_at,
      updated_at = EXCLUDED.updated_at
  `).run(
    payload.user_id,
    payload.server_id,
    payload.inbound_id,
    payload.sub_id,
    payload.remark,
    payload.protocol,
    payload.original_link,
    payload.node_fingerprint,
    payload.server_fingerprint,
    payload.fetched_at,
    payload.updated_at
  );
}

/**
 * 写回用户最终订阅缓存。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @param {string} subId - 订阅 token
 * @param {Array} nodes - 最终节点列表
 * @returns {Promise<void>}
 */
async function saveUserSubscriptionCache(db, userId, subId, nodes) {
  const now = Math.floor(Date.now() / 1000);

  await db.prepare(`
    INSERT INTO user_subscriptions (user_id, sub_id, nodes_data, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (sub_id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      nodes_data = EXCLUDED.nodes_data,
      updated_at = EXCLUDED.updated_at
  `).run(userId, subId, JSON.stringify(nodes), now);
}

/**
 * 替换用户公开订阅链接 ID。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @param {string} subId - 新的 32 位公开订阅 ID
 * @returns {Promise<void>}
 */
async function replaceUserSubscriptionId(db, userId, subId) {
  await db.prepare('UPDATE users SET sub_id = ? WHERE id = ?').run(subId, userId);
}

/**
 * 清理用户已有订阅缓存，使旧公开订阅链接立即失效。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<void>}
 */
async function deleteUserSubscriptionCaches(db, userId) {
  await db.prepare('DELETE FROM user_subscriptions WHERE user_id = ?').run(userId);
}

/**
 * 查询订阅内容输出所需缓存与用户信息。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} token - 订阅 token
 * @returns {Promise<Object|undefined>} 订阅缓存记录
 */
async function findSubscriptionContentByToken(db, token) {
  return db.prepare(`
    SELECT us.*, u.email, u.traffic_used, u.traffic_limit, u.referral_traffic_limit, u.expire_at, u.enabled, u.disable_reason, p.plan_type
    FROM user_subscriptions us
    JOIN users u ON us.user_id = u.id
    LEFT JOIN plans p ON u.plan_id = p.id
    WHERE us.sub_id = ?
  `).get(token);
}

/**
 * 按公开订阅 ID 查询用户状态。
 * 职责：订阅缓存缺失时仍能判断该链接是否属于已存在用户，从而返回续费或禁用提示。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} subId - users.sub_id 公开订阅 ID
 * @returns {Promise<Object|undefined>} 用户订阅状态
 */
async function findSubscriptionUserBySubId(db, subId) {
  return db.prepare(`
    SELECT
      u.id, u.email, u.sub_id,
      u.traffic_used, u.traffic_limit, u.referral_traffic_limit, u.expire_at, u.enabled, u.disable_reason,
      p.plan_type
    FROM users u
    LEFT JOIN plans p ON u.plan_id = p.id
    WHERE u.sub_id = ?
  `).get(subId);
}

/**
 * 查询单个系统设置值。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} key - 系统设置键名
 * @returns {Promise<Object|undefined>} 设置记录
 */
async function findSystemSettingByKey(db, key) {
  return db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key);
}

/**
 * 查询需要在订阅节点中显示的公告。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Promise<Array>} node_show=1 的公告列表
 */
async function listNodeShowAnnouncements(db) {
  return db.prepare(`
    SELECT id, title, content, node_show, created_at, updated_at
    FROM announcements
    WHERE COALESCE(node_show, 0) = 1
    ORDER BY pinned DESC, created_at DESC, id DESC
  `).all();
}

/**
 * 查询指定服务器的节点快照详情。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} serverId - 服务器 ID
 * @returns {Promise<Array>} 节点快照列表
 */
async function listServerNodes(db, serverId) {
  return db.prepare(`
    SELECT inbound_id, remark, port, protocol, settings, stream_settings
    FROM xui_nodes
    WHERE server_id = ?
  `).all(serverId);
}

module.exports = {
  findSubscriptionUserById,
  findLatestUserSubscription,
  listEnabledUserCfIps,
  listOnlineServers,
  listOnlineServersForDisplay,
  listNodeSnapshots,
  listUserNodeConfigs,
  listUserSubscriptionSources,
  upsertSubscriptionSource,
  saveUserSubscriptionCache,
  replaceUserSubscriptionId,
  deleteUserSubscriptionCaches,
  findSubscriptionContentByToken,
  findSubscriptionUserBySubId,
  findSystemSettingByKey,
  listNodeShowAnnouncements,
  listServerNodes
};
