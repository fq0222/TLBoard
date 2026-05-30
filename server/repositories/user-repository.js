/**
 * 用户仓储。
 * 负责 auth 与 admin users 模块涉及的 users/orders/cf_ip/xui 相关 SQL 访问，
 * 保持 route/controller/service 不直接拼接查询语句。
 */

/**
 * 根据邮箱查询完整用户记录。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} email - 用户邮箱
 * @returns {Promise<Object|undefined>} 用户记录
 */
async function findUserByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

/**
 * 查询注册流程需要的用户快照信息。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} email - 用户邮箱
 * @returns {Promise<Object|undefined>} 用户快照
 */
async function findUserRegisterSnapshotByEmail(db, email) {
  return db.prepare('SELECT id, enabled, expire_at FROM users WHERE email = ?').get(email);
}

/**
 * 查询启用中的套餐记录。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number|string} planId - 套餐 ID
 * @returns {Promise<Object|undefined>} 套餐记录
 */
async function findEnabledPlanById(db, planId) {
  return db.prepare('SELECT * FROM plans WHERE id = ? AND enabled = 1').get(planId);
}

/**
 * 为已存在但已失效的用户更新注册套餐信息。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - 更新参数
 * @returns {Promise<void>}
 */
async function updateRegisteredUserForPlan(db, payload) {
  const {
    userId,
    passwordHash,
    planId,
    subscriptionToken,
    subId,
    trafficLimit,
    updatedAt
  } = payload;

  await db.prepare(`
    UPDATE users SET
      password_hash = ?,
      plan_id = ?,
      subscription_token = ?,
      sub_id = ?,
      traffic_used = 0,
      traffic_limit = ?,
      enabled = 0,
      updated_at = ?
    WHERE id = ?
  `).run(
    passwordHash,
    planId,
    subscriptionToken,
    subId,
    trafficLimit,
    updatedAt,
    userId
  );
}

/**
 * 创建新的待支付注册用户。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - 新用户参数
 * @returns {Promise<Object>} 插入结果
 */
async function createRegisteredUser(db, payload) {
  const {
    email,
    passwordHash,
    planId,
    subscriptionToken,
    subId,
    trafficLimit
  } = payload;

  return db.prepare(`
    INSERT INTO users (email, password_hash, plan_id, subscription_token, sub_id, traffic_used, traffic_limit, enabled)
    VALUES (?, ?, ?, ?, ?, 0, ?, 0)
  `).run(
    email,
    passwordHash,
    planId,
    subscriptionToken,
    subId,
    trafficLimit
  );
}

/**
 * 创建注册流程的待支付订单。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - 订单参数
 * @returns {Promise<Object>} 插入结果
 */
async function createPendingOrder(db, payload) {
  const {
    userId,
    email,
    planId,
    amount,
    outTradeNo
  } = payload;

  return db.prepare(`
    INSERT INTO orders (user_id, email, plan_id, amount, out_trade_no, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).run(
    userId,
    email,
    planId,
    amount,
    outTradeNo
  );
}

/**
 * 按商户订单号将订单标记为过期。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} outTradeNo - 商户订单号
 * @returns {Promise<void>}
 */
async function markOrderExpiredByOutTradeNo(db, outTradeNo) {
  await db.prepare(`
    UPDATE orders SET status = 'expired'
    WHERE out_trade_no = ?
  `).run(outTradeNo);
}

/**
 * 更新订单的支付流水号、支付链接和实付金额。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - 支付信息
 * @returns {Promise<void>}
 */
async function updateOrderPaymentInfo(db, payload) {
  const {
    outTradeNo,
    tradeNo,
    paymentUrl,
    amount
  } = payload;

  await db.prepare(`
    UPDATE orders SET
      trade_no = ?,
      payment_url = ?,
      amount = ?
    WHERE out_trade_no = ?
  `).run(tradeNo, paymentUrl, amount, outTradeNo);
}

/**
 * 查询登录流程所需的用户和套餐信息。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} email - 用户邮箱
 * @returns {Promise<Object|undefined>} 用户记录
 */
async function findLoginUserByEmail(db, email) {
  return db.prepare(`
    SELECT u.*, p.name as plan_name
    FROM users u
    LEFT JOIN plans p ON u.plan_id = p.id
    WHERE u.email = ?
  `).get(email);
}

/**
 * 查询用户个人中心展示所需资料。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<Object|undefined>} 用户资料
 */
async function findUserProfileById(db, userId) {
  return db.prepare(`
    SELECT
      u.id, u.email, u.plan_id, u.subscription_token, u.sub_id,
      u.traffic_used, u.traffic_limit, u.expire_at, u.enabled, u.created_at,
      u.payment_count, u.sync_status,
      p.name as plan_name
    FROM users u
    LEFT JOIN plans p ON u.plan_id = p.id
    WHERE u.id = ?
  `).get(userId);
}

/**
 * 查询用户当前同步状态。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @returns {Promise<Object|undefined>} 同步状态记录
 */
async function findUserSyncStatusById(db, userId) {
  return db.prepare('SELECT sync_status FROM users WHERE id = ?').get(userId);
}

/**
 * 检查用户是否已分配 CF 优选 IP。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<Object|undefined>} 查询结果
 */
async function hasUserCfIps(db, userId) {
  return db.prepare('SELECT 1 FROM user_cf_ips WHERE user_id = ? LIMIT 1').get(userId);
}

/**
 * 检查用户订阅缓存是否已生成。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} subId - 订阅子 ID
 * @returns {Promise<Object|undefined>} 查询结果
 */
async function hasUserSubscriptionCache(db, subId) {
  return db.prepare('SELECT 1 FROM user_subscriptions WHERE sub_id = ?').get(subId);
}

/**
 * 统计管理端用户总数。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} whereClause - SQL 条件片段
 * @param {Array} params - 绑定参数
 * @returns {Promise<Object>} 统计结果
 */
async function countUsers(db, whereClause, params) {
  return db.prepare(`SELECT COUNT(*) as total FROM users u ${whereClause}`).get(...params);
}

/**
 * 查询管理端用户分页列表。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} whereClause - SQL 条件片段
 * @param {Array} params - 绑定参数
 * @param {number} limit - 分页数量
 * @param {number} offset - 分页偏移
 * @returns {Promise<Array>} 用户列表
 */
async function listUsers(db, whereClause, params, limit, offset) {
  return db.prepare(`
    SELECT
      u.id, u.email, u.plan_id, u.traffic_used, u.traffic_limit,
      u.expire_at, u.enabled, u.created_at,
      p.name as plan_name
    FROM users u
    LEFT JOIN plans p ON u.plan_id = p.id
    ${whereClause}
    ORDER BY u.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
}

/**
 * 查询管理端用户详情。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<Object|undefined>} 用户详情
 */
async function findUserDetailById(db, userId) {
  return db.prepare(`
    SELECT
      u.id, u.email, u.plan_id, u.subscription_token, u.sub_id,
      u.traffic_used, u.traffic_limit, u.expire_at, u.enabled, u.created_at,
      p.name as plan_name
    FROM users u
    LEFT JOIN plans p ON u.plan_id = p.id
    WHERE u.id = ?
  `).get(userId);
}

/**
 * 查询用户最近订单列表。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<Array>} 订单列表
 */
async function listUserOrders(db, userId) {
  return db.prepare(`
    SELECT id, out_trade_no, plan_id, amount, status, paid_at, created_at
    FROM orders
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 10
  `).all(userId);
}

/**
 * 查询用户绑定的 CF 优选 IP 列表。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<Array>} IP 列表
 */
async function listUserCfIps(db, userId) {
  return db.prepare(`
    SELECT cp.id, cp.ip, cp.port, cp.location
    FROM user_cf_ips uci
    JOIN cf_ip_pool cp ON uci.ip_pool_id = cp.id
    WHERE uci.user_id = ?
  `).all(userId);
}

/**
 * 按动态字段更新用户记录。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @param {Array<string>} updates - 更新表达式列表
 * @param {Array} values - 绑定值列表
 * @returns {Promise<void>}
 */
async function updateUserFields(db, userId, updates, values) {
  await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values, userId);
}

/**
 * 查询指定 ID 列表里仍启用的 CF IP。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Array<number>} ipPoolIds - IP 池 ID 列表
 * @returns {Promise<Array>} IP 列表
 */
async function findEnabledCfIpsByIds(db, ipPoolIds) {
  return db.prepare(`
    SELECT id, ip, port, location
    FROM cf_ip_pool
    WHERE id = ANY(?) AND enabled = 1
  `).all(ipPoolIds);
}

/**
 * 覆盖用户绑定的 CF IP 关系。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @param {Array<number>} ipPoolIds - IP 池 ID 列表
 * @returns {Promise<void>}
 */
async function replaceUserCfIps(db, userId, ipPoolIds) {
  await db.prepare('DELETE FROM user_cf_ips WHERE user_id = ?').run(userId);
  const insertStatement = db.prepare('INSERT INTO user_cf_ips (user_id, ip_pool_id) VALUES (?, ?)');

  for (const ipPoolId of ipPoolIds) {
    await insertStatement.run(userId, ipPoolId);
  }
}

/**
 * 查询用户当前启用的 CF 优选 IP。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<Array>} IP 列表
 */
async function findActiveCfIpsForUser(db, userId) {
  return db.prepare(`
    SELECT cp.id, cp.ip, cp.port, cp.location
    FROM user_cf_ips uci
    JOIN cf_ip_pool cp ON uci.ip_pool_id = cp.id
    WHERE uci.user_id = ? AND cp.enabled = 1
  `).all(userId);
}

/**
 * 查询生成订阅所需的在线 3X-UI 服务器。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Promise<Array>} 服务器列表
 */
async function listActiveXuiServersForSubscription(db) {
  return db.prepare(`
    SELECT id, name, api_url, host, client_port, sub_url
    FROM xui_servers
    WHERE status = 1
  `).all();
}

/**
 * 查询同步用户信息所需的在线 3X-UI 服务器。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Promise<Array>} 服务器列表
 */
async function listOnlineXuiServersForSync(db) {
  return db.prepare(`
    SELECT id, name, api_url, api_token
    FROM xui_servers
    WHERE status = 1
  `).all();
}

/**
 * 查询某个服务器上用户已有的节点配置。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @param {number} serverId - 服务器 ID
 * @returns {Promise<Array>} 节点配置列表
 */
async function listUserNodeConfigsByServer(db, userId, serverId) {
  return db.prepare(`
    SELECT unc.uuid, unc.auth, unc.sub_id, xn.remark, xn.protocol, xn.inbound_id
    FROM user_node_configs unc
    JOIN xui_nodes xn ON unc.server_id = xn.server_id AND unc.inbound_id = xn.inbound_id
    WHERE unc.user_id = ? AND unc.server_id = ?
  `).all(userId, serverId);
}

/**
 * 保存用户订阅缓存，已存在时执行覆盖更新。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - 订阅缓存数据
 * @returns {Promise<void>}
 */
async function saveUserSubscriptionCache(db, payload) {
  const {
    userId,
    subId,
    nodesData,
    updatedAt
  } = payload;

  await db.pool.query(
    `
      INSERT INTO user_subscriptions (user_id, sub_id, nodes_data, updated_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (sub_id) DO UPDATE SET
        nodes_data = EXCLUDED.nodes_data,
        updated_at = EXCLUDED.updated_at
    `,
    [userId, subId, nodesData, updatedAt]
  );
}

/**
 * 查询需要同步用户状态的节点目标集合。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Promise<Array>} 节点目标列表
 */
async function listNodeSyncTargetsByServer(db) {
  return db.prepare(`
    SELECT server_id, inbound_id
    FROM xui_nodes
    WHERE user_count > 0
  `).all();
}

/**
 * 根据服务器与入站 ID 查询节点信息。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} serverId - 服务器 ID
 * @param {number} inboundId - 入站 ID
 * @returns {Promise<Object|undefined>} 节点信息
 */
async function findXuiNodeByServerAndInbound(db, serverId, inboundId) {
  return db.prepare(`
    SELECT remark, protocol
    FROM xui_nodes
    WHERE server_id = ? AND inbound_id = ?
  `).get(serverId, inboundId);
}

module.exports = {
  findUserByEmail,
  findUserRegisterSnapshotByEmail,
  findEnabledPlanById,
  updateRegisteredUserForPlan,
  createRegisteredUser,
  createPendingOrder,
  markOrderExpiredByOutTradeNo,
  updateOrderPaymentInfo,
  findLoginUserByEmail,
  findUserProfileById,
  findUserSyncStatusById,
  hasUserCfIps,
  hasUserSubscriptionCache,
  countUsers,
  listUsers,
  findUserDetailById,
  listUserOrders,
  listUserCfIps,
  updateUserFields,
  findEnabledCfIpsByIds,
  replaceUserCfIps,
  findActiveCfIpsForUser,
  listActiveXuiServersForSubscription,
  listOnlineXuiServersForSync,
  listUserNodeConfigsByServer,
  saveUserSubscriptionCache,
  listNodeSyncTargetsByServer,
  findXuiNodeByServerAndInbound
};
