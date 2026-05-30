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
  createPendingRenewOrder,
  markOrderExpiredByOutTradeNo,
  updateOrderPaymentInfo,
  countUserOrders,
  listUserOrders,
  findUserOrderById,
  findUserOrderByOutTradeNo,
  findPublicOrderByOutTradeNo,
  findNotifyOrderByOutTradeNo,
  markPendingOrderExpiredById,
  countAdminOrders,
  listAdminOrders
};
