/**
 * 订单服务封装
 * 处理订单支付成功后的统一激活逻辑
 */

// 日志工具
const logger = {
  info: (msg) => console.log(`[ORDER-SERVICE] [INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[ORDER-SERVICE] [ERROR] ${new Date().toISOString()} - ${msg}`),
  warn: (msg) => console.warn(`[ORDER-SERVICE] [WARN] ${new Date().toISOString()} - ${msg}`)
};

/**
 * 完成已支付订单
 * 统一更新订单状态、用户套餐和到期时间
 * @param {Object} db - 数据库实例
 * @param {string} outTradeNo - 商户订单号
 * @param {string|null} [tradeNo=null] - 第三方订单号
 * @returns {Promise<Object>} 处理结果
 */
async function completePaidOrder(db, outTradeNo, tradeNo = null) {
  // 查询订单及用户当前到期时间，用于续费场景累计有效期
  const order = await db.prepare(`
    SELECT o.*, u.expire_at as current_expire_at
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    WHERE o.out_trade_no = ?
  `).get(outTradeNo);

  if (!order) {
    logger.warn(`Order not found: ${outTradeNo}`);
    return { handled: false, reason: 'order_not_found' };
  }

  if (order.status === 'paid') {
    return { handled: true, alreadyPaid: true, order };
  }

  const plan = await db.prepare('SELECT * FROM plans WHERE id = ?').get(order.plan_id);
  if (!plan) {
    logger.error(`Plan not found for order ${outTradeNo}: ${order.plan_id}`);
    return { handled: false, reason: 'plan_not_found', order };
  }

  // 如果用户当前套餐尚未过期，则在现有到期时间基础上顺延
  const now = Math.floor(Date.now() / 1000);
  const currentExpireAt = Number(order.current_expire_at || 0);
  const baseExpireAt = currentExpireAt > now ? currentExpireAt : now;
  const expireAt = baseExpireAt + (Number(plan.duration_days) * 24 * 60 * 60);
  const finalTradeNo = tradeNo || order.trade_no;

  // 订单和用户信息需要同时更新，避免出现支付成功但账号未激活的中间状态
  const transaction = db.transaction(async () => {
    await db.prepare(`
      UPDATE orders SET
        status = 'paid',
        trade_no = ?,
        paid_at = ?
      WHERE out_trade_no = ?
    `).run(finalTradeNo, now, outTradeNo);

    await db.prepare(`
      UPDATE users SET
        enabled = 1,
        plan_id = ?,
        traffic_limit = ?,
        expire_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(plan.id, plan.traffic_limit, expireAt, now, order.user_id);
  });

  await transaction();

  logger.info(`Order paid: ${outTradeNo}, user=${order.email}, expire_at=${expireAt}`);
  return { handled: true, alreadyPaid: false, order, plan, expireAt };
}

module.exports = {
  completePaidOrder
};
