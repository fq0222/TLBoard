/**
 * 订单仓储。
 * 负责 orders / users / plans 相关的订单与续费 SQL 访问，
 * 供 user renew、user orders、admin orders 等模块复用。
 */

/**
 * 根据用户 ID 查询用户记录。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<Object|undefined>} 用户记录
 */
async function findUserById(db, userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

/**
 * 查询可续费或购买的启用套餐。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number|string} planId - 套餐 ID
 * @returns {Promise<Object|undefined>} 套餐记录
 */
async function findEnabledPlanById(db, planId) {
  return db.prepare('SELECT * FROM plans WHERE id = ? AND enabled = 1').get(planId);
}

/**
 * 按套餐 ID 查询套餐记录，不限制启用状态。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number|string} planId - 套餐 ID
 * @returns {Promise<Object|undefined>} 套餐记录
 */
async function findPlanById(db, planId) {
  return db.prepare('SELECT * FROM plans WHERE id = ?').get(planId);
}

/**
 * 创建待支付续费订单。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - 续费订单数据
 * @returns {Promise<Object>} 插入结果
 */
async function createPendingRenewOrder(db, payload) {
  const {
    userId,
    email,
    planId,
    amount,
    outTradeNo,
    createdAt
  } = payload;

  return db.prepare(`
    INSERT INTO orders (user_id, email, plan_id, amount, out_trade_no, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(userId, email, planId, amount, outTradeNo, createdAt);
}

/**
 * 按订单号将订单标记为已过期。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} outTradeNo - 商户订单号
 * @returns {Promise<void>}
 */
async function markOrderExpiredByOutTradeNo(db, outTradeNo) {
  await db.prepare('UPDATE orders SET status = \'expired\' WHERE out_trade_no = ?').run(outTradeNo);
}

/**
 * 清理单个用户节点的原始订阅缓存。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - 缓存定位参数
 * @returns {Promise<void>}
 */
async function clearUserSubscriptionSourceCache(db, payload) {
  const {
    userId,
    serverId,
    inboundId
  } = payload;

  await db.prepare(`
    DELETE FROM user_subscription_sources
    WHERE user_id = ? AND server_id = ? AND inbound_id = ?
  `).run(userId, serverId, inboundId);
}

/**
 * 写入 VMQ 回传的支付信息。
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
    UPDATE orders
    SET trade_no = ?, payment_url = ?, amount = ?
    WHERE out_trade_no = ?
  `).run(tradeNo, paymentUrl, amount, outTradeNo);
}

/**
 * 更新用户同步状态。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @param {number} syncStatus - 同步状态
 * @returns {Promise<void>}
 */
async function updateUserSyncStatus(db, userId, syncStatus) {
  await db.prepare('UPDATE users SET sync_status = ? WHERE id = ?').run(syncStatus, userId);
}

/**
 * 查询订单支付完成处理所需的订单与用户快照。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} outTradeNo - 商户订单号
 * @returns {Promise<Object|undefined>} 订单与用户快照
 */
async function findPaidOrderContextByOutTradeNo(db, outTradeNo) {
  return db.prepare(`
    SELECT o.*, o.id, o.referrer_user_id,
           u.expire_at as current_expire_at, u.traffic_limit as current_traffic_limit,
           u.traffic_used as current_traffic_used,
           u.email, u.subscription_token, u.plan_id as current_plan_id, u.enabled as current_enabled,
           u.disable_reason as current_disable_reason, u.payment_count as current_payment_count,
           cp.plan_type as current_plan_type
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    LEFT JOIN plans cp ON u.plan_id = cp.id
    WHERE o.out_trade_no = ?
  `).get(outTradeNo);
}

/**
 * 扣减用户余额。
 *
 * 职责：在余额支付续费时按分扣减 users.balance。
 * 关键参数：payload.userId 为付款用户，payload.amount 为扣减金额，单位分。
 * 核心分支：SQL 条件要求余额充足，调用方通过 changes 判断是否扣款成功。
 *
 * @param {Object} db - 数据库代理对象
 * @param {{userId:number,amount:number}} payload - 扣款参数
 * @returns {Promise<Object>} 更新结果
 */
async function decrementUserBalance(db, payload) {
  const {
    userId,
    amount
  } = payload;

  return db.prepare(`
    UPDATE users
    SET balance = COALESCE(balance, 0) - ?
    WHERE id = ? AND COALESCE(balance, 0) >= ?
  `).run(amount, userId, amount);
}

/**
 * 将订单标记为已支付。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - 订单支付结果
 * @returns {Promise<void>}
 */
async function markOrderPaid(db, payload) {
  const {
    outTradeNo,
    tradeNo,
    paidAt
  } = payload;

  await db.prepare(`
    UPDATE orders SET
      status = 'paid',
      trade_no = ?,
      paid_at = ?
    WHERE out_trade_no = ?
  `).run(tradeNo, paidAt, outTradeNo);
}

/**
 * 写入支付完成后的用户权益，并无条件清空上一次续费提醒状态。
 * 核心分支：resetTrafficUsed 仅控制已用流量重置，不影响提醒状态清空。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - 用户权益数据
 * @returns {Promise<void>}
 */
async function updateUserAfterPaidOrder(db, payload) {
  const {
    userId,
    planId,
    trafficLimit,
    expireAt,
    resetTrafficUsed,
    updatedAt
  } = payload;

  const updates = [
    'enabled = 1',
    'plan_id = ?',
    'traffic_limit = ?',
    'traffic_used_at = NULL',
    'disable_reason = NULL',
    'renewal_notice_attempted_at = NULL',
    'renewal_notice_reason = NULL',
    'expire_at = ?',
    'payment_count = payment_count + 1',
    'updated_at = ?'
  ];
  const values = [planId, trafficLimit, expireAt, updatedAt];

  if (resetTrafficUsed) {
    updates.splice(3, 0, 'traffic_used = 0');
  }

  values.push(userId);
  await db.prepare(`
    UPDATE users SET
      ${updates.join(',\n      ')}
    WHERE id = ?
  `).run(...values);
}

/**
 * 增加套餐售卖计数。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} planId - 套餐 ID
 * @returns {Promise<void>}
 */
async function incrementPlanSalesCount(db, planId) {
  await db.prepare('UPDATE plans SET sales_count = sales_count + 1 WHERE id = ?').run(planId);
}

/**
 * 回收套餐售卖计数，最低不小于 0。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} planId - 套餐 ID
 * @returns {Promise<void>}
 */
async function decrementPlanSalesCount(db, planId) {
  await db.prepare('UPDATE plans SET sales_count = GREATEST(0, sales_count - 1) WHERE id = ?').run(planId);
}

/**
 * 统计当前用户的订单总数。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @param {string|undefined} status - 可选状态筛选
 * @returns {Promise<Object>} 统计结果
 */
async function countUserOrders(db, userId, status) {
  let whereClause = 'WHERE o.user_id = ?';
  const params = [userId];

  if (status) {
    whereClause += ' AND o.status = ?';
    params.push(status);
  }

  return db.prepare(`SELECT COUNT(*) as total FROM orders o ${whereClause}`).get(...params);
}

/**
 * 查询当前用户的订单分页列表。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - 查询参数
 * @returns {Promise<Array>} 订单记录列表
 */
async function listUserOrders(db, payload) {
  const {
    userId,
    status,
    limit,
    offset
  } = payload;

  let whereClause = 'WHERE o.user_id = ?';
  const params = [userId];

  if (status) {
    whereClause += ' AND o.status = ?';
    params.push(status);
  }

  return db.prepare(`
    SELECT
      o.id, o.out_trade_no, o.trade_no, o.payment_url,
      p.name as plan_name, o.amount, o.status, o.paid_at, o.created_at
    FROM orders o
    LEFT JOIN plans p ON o.plan_id = p.id
    ${whereClause}
    ORDER BY o.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
}

/**
 * 按订单 ID 查询用户自己的订单。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} orderId - 订单 ID
 * @param {number} userId - 用户 ID
 * @returns {Promise<Object|undefined>} 订单记录
 */
async function findUserOrderById(db, orderId, userId) {
  return db.prepare(`
    SELECT id, user_id, out_trade_no, trade_no, status, payment_url
    FROM orders
    WHERE id = ? AND user_id = ?
  `).get(orderId, userId);
}

/**
 * 按订单号查询用户自己的订单。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} outTradeNo - 商户订单号
 * @param {number} userId - 用户 ID
 * @returns {Promise<Object|undefined>} 订单记录
 */
async function findUserOrderByOutTradeNo(db, outTradeNo, userId) {
  return db.prepare(`
    SELECT id, user_id, out_trade_no, trade_no, status, payment_url
    FROM orders
    WHERE out_trade_no = ? AND user_id = ?
  `).get(outTradeNo, userId);
}

/**
 * 按订单号查询公共订单状态所需字段。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} outTradeNo - 商户订单号
 * @returns {Promise<Object|undefined>} 订单记录
 */
async function findPublicOrderByOutTradeNo(db, outTradeNo) {
  return db.prepare(`
    SELECT id, user_id, out_trade_no, trade_no, status, payment_url
    FROM orders
    WHERE out_trade_no = ?
  `).get(outTradeNo);
}

/**
 * 查询支付回调处理所需的订单字段。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} outTradeNo - 商户订单号
 * @returns {Promise<Object|undefined>} 订单记录
 */
async function findNotifyOrderByOutTradeNo(db, outTradeNo) {
  return db.prepare(`
    SELECT amount, trade_no, status
    FROM orders
    WHERE out_trade_no = ?
  `).get(outTradeNo);
}

/**
 * 仅在待支付状态下将订单标记为过期。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} orderId - 订单 ID
 * @returns {Promise<void>}
 */
async function markPendingOrderExpiredById(db, orderId) {
  await db.prepare(`
    UPDATE orders SET status = 'expired'
    WHERE id = ? AND status = 'pending'
  `).run(orderId);
}

/**
 * 统计管理端订单总数。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} filters - 管理端筛选条件
 * @returns {Promise<Object>} 统计结果
 */
async function countAdminOrders(db, filters) {
  const { whereClause, params } = buildAdminOrderFilters(filters);
  return db.prepare(`SELECT COUNT(*) as total FROM orders o ${whereClause}`).get(...params);
}

/**
 * 查询管理端订单分页列表。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - 查询参数
 * @returns {Promise<Array>} 订单记录列表
 */
async function listAdminOrders(db, payload) {
  const {
    filters,
    limit,
    offset
  } = payload;
  const { whereClause, params } = buildAdminOrderFilters(filters);

  return db.prepare(`
    SELECT
      o.id, o.out_trade_no, o.email, o.user_id,
      o.amount, o.status, o.paid_at, o.created_at,
      p.name as plan_name
    FROM orders o
    LEFT JOIN plans p ON o.plan_id = p.id
    ${whereClause}
    ORDER BY o.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
}

/**
 * 统计管理端订单全局汇总。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Promise<Object>} 订单总金额与订单类型统计
 */
async function summarizeAdminOrders(db) {
  return db.prepare(`
    SELECT
      COALESCE(SUM(amount), 0) as total_amount,
      SUM(CASE WHEN out_trade_no LIKE 'ORD%' THEN 1 ELSE 0 END) as ord_count,
      SUM(CASE WHEN out_trade_no LIKE 'REN%' THEN 1 ELSE 0 END) as ren_count
    FROM orders
  `).get();
}

/**
 * 构造管理端订单查询的 where 条件与绑定参数。
 *
 * @param {Object} [filters={}] - 筛选条件
 * @returns {{whereClause:string,params:Array}} SQL 片段与参数
 */
function buildAdminOrderFilters(filters = {}) {
  const {
    status,
    email,
    startDate,
    endDate
  } = filters;
  let whereClause = 'WHERE 1=1';
  const params = [];

  if (status) {
    whereClause += ' AND o.status = ?';
    params.push(status);
  }

  if (email) {
    whereClause += ' AND o.email LIKE ?';
    params.push(`%${email}%`);
  }

  if (startDate) {
    whereClause += ' AND o.created_at >= ?';
    params.push(Math.floor(new Date(startDate).getTime() / 1000));
  }

  if (endDate) {
    whereClause += ' AND o.created_at <= ?';
    params.push(Math.floor(new Date(endDate).getTime() / 1000) + 86400);
  }

  return {
    whereClause,
    params
  };
}

module.exports = {
  findUserById,
  findEnabledPlanById,
  findPlanById,
  createPendingRenewOrder,
  markOrderExpiredByOutTradeNo,
  clearUserSubscriptionSourceCache,
  updateOrderPaymentInfo,
  decrementUserBalance,
  updateUserSyncStatus,
  findPaidOrderContextByOutTradeNo,
  markOrderPaid,
  updateUserAfterPaidOrder,
  incrementPlanSalesCount,
  decrementPlanSalesCount,
  countUserOrders,
  listUserOrders,
  findUserOrderById,
  findUserOrderByOutTradeNo,
  findPublicOrderByOutTradeNo,
  findNotifyOrderByOutTradeNo,
  markPendingOrderExpiredById,
  countAdminOrders,
  listAdminOrders,
  summarizeAdminOrders
};
