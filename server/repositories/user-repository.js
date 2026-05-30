/**
 * 用户仓储。
 * 负责 auth 与 admin users 模块涉及的 users/orders/cf_ip/xui 相关 SQL 访问，
 * 保持 route/controller/service 不直接拼接查询语句。
 */

async function findUserByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

async function findUserRegisterSnapshotByEmail(db, email) {
  return db.prepare('SELECT id, enabled, expire_at FROM users WHERE email = ?').get(email);
}

async function findEnabledPlanById(db, planId) {
  return db.prepare('SELECT * FROM plans WHERE id = ? AND enabled = 1').get(planId);
}

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

async function markOrderExpiredByOutTradeNo(db, outTradeNo) {
  await db.prepare(`
    UPDATE orders SET status = 'expired'
    WHERE out_trade_no = ?
  `).run(outTradeNo);
}

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

async function findLoginUserByEmail(db, email) {
  return db.prepare(`
    SELECT u.*, p.name as plan_name
    FROM users u
    LEFT JOIN plans p ON u.plan_id = p.id
    WHERE u.email = ?
  `).get(email);
}

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

async function hasUserCfIps(db, userId) {
  return db.prepare('SELECT 1 FROM user_cf_ips WHERE user_id = ? LIMIT 1').get(userId);
}

async function hasUserSubscriptionCache(db, subId) {
  return db.prepare('SELECT 1 FROM user_subscriptions WHERE sub_id = ?').get(subId);
}

async function countUsers(db, whereClause, params) {
  return db.prepare(`SELECT COUNT(*) as total FROM users u ${whereClause}`).get(...params);
}

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

async function listUserOrders(db, userId) {
  return db.prepare(`
    SELECT id, out_trade_no, plan_id, amount, status, paid_at, created_at
    FROM orders
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 10
  `).all(userId);
}

async function listUserCfIps(db, userId) {
  return db.prepare(`
    SELECT cp.id, cp.ip, cp.port, cp.location
    FROM user_cf_ips uci
    JOIN cf_ip_pool cp ON uci.ip_pool_id = cp.id
    WHERE uci.user_id = ?
  `).all(userId);
}

async function updateUserFields(db, userId, updates, values) {
  await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values, userId);
}

async function findEnabledCfIpsByIds(db, ipPoolIds) {
  return db.prepare(`
    SELECT id, ip, port, location
    FROM cf_ip_pool
    WHERE id = ANY(?) AND enabled = 1
  `).all(ipPoolIds);
}

async function replaceUserCfIps(db, userId, ipPoolIds) {
  await db.prepare('DELETE FROM user_cf_ips WHERE user_id = ?').run(userId);
  const insertStatement = db.prepare('INSERT INTO user_cf_ips (user_id, ip_pool_id) VALUES (?, ?)');

  for (const ipPoolId of ipPoolIds) {
    await insertStatement.run(userId, ipPoolId);
  }
}

async function findActiveCfIpsForUser(db, userId) {
  return db.prepare(`
    SELECT cp.id, cp.ip, cp.port, cp.location
    FROM user_cf_ips uci
    JOIN cf_ip_pool cp ON uci.ip_pool_id = cp.id
    WHERE uci.user_id = ? AND cp.enabled = 1
  `).all(userId);
}

async function listActiveXuiServersForSubscription(db) {
  return db.prepare(`
    SELECT id, name, api_url, host, client_port, sub_url
    FROM xui_servers
    WHERE status = 1
  `).all();
}

async function listOnlineXuiServersForSync(db) {
  return db.prepare(`
    SELECT id, name, api_url, api_token
    FROM xui_servers
    WHERE status = 1
  `).all();
}

async function listUserNodeConfigsByServer(db, userId, serverId) {
  return db.prepare(`
    SELECT unc.uuid, unc.auth, unc.sub_id, xn.remark, xn.protocol, xn.inbound_id
    FROM user_node_configs unc
    JOIN xui_nodes xn ON unc.server_id = xn.server_id AND unc.inbound_id = xn.inbound_id
    WHERE unc.user_id = ? AND unc.server_id = ?
  `).all(userId, serverId);
}

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

async function listNodeSyncTargetsByServer(db) {
  return db.prepare(`
    SELECT server_id, inbound_id
    FROM xui_nodes
    WHERE user_count > 0
  `).all();
}

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
