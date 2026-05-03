/**
 * 订单服务封装
 * 处理订单支付成功后的统一激活逻辑
 */

const XuiService = require('./xui-service');
const { createLogger } = require('../utils/logger');

const logger = createLogger('ORDER-SERVICE');

/**
 * 同步用户到所有在线的 3X-UI 服务器
 * @param {Object} db - 数据库实例
 * @param {Object} user - 用户信息
 * @param {Object} plan - 套餐信息
 */
async function syncUserToXuiServers(db, user, plan) {
  try {
    // 查询所有在线的 3X-UI 服务器
    const servers = await db.prepare(`
      SELECT id, name, api_url, api_username, api_password
      FROM xui_servers
      WHERE status = 1
    `).all();

    if (servers.length === 0) {
      logger.warn('没有在线的 3X-UI 服务器，跳过同步');
      return;
    }

    logger.info(`开始同步用户 ${user.email} 到 ${servers.length} 个 3X-UI 服务器`);

    for (const server of servers) {
      try {
        const xuiService = new XuiService(server.api_url, server.api_username, server.api_password);
        await xuiService.init();

        // 获取该服务器的所有 inbounds
        const inboundsResult = await xuiService.getInbounds();
        if (!inboundsResult.success) {
          logger.warn(`获取服务器 ${server.name} 的 inbounds 失败: ${inboundsResult.message}`);
          continue;
        }

        // 为每个 inbound 添加用户
        for (const inbound of inboundsResult.data) {
          try {
            // 计算到期时间（毫秒）
            const expiryTime = user.expire_at ? user.expire_at * 1000 : 0;
            
            // 流量限制（字节）
            const totalGB = plan.traffic_limit || 0;

            const result = await xuiService.addClient(inbound.id, inbound.protocol, {
              email: user.email,
              id: user.subscription_token, // 使用 subscription_token 作为 UUID
              enable: true,
              expiryTime: expiryTime,
              totalGB: totalGB,
              limitIp: 0,
              tgId: 0,
              subId: ''
            });

            if (result.success) {
              logger.info(`同步用户 ${user.email} 到服务器 ${server.name} 的 inbound ${inbound.id} 成功`);
            } else {
              logger.warn(`同步用户 ${user.email} 到服务器 ${server.name} 的 inbound ${inbound.id} 失败: ${result.message}`);
            }
          } catch (error) {
            logger.error(`同步用户到 inbound ${inbound.id} 错误: ${error.message}`);
          }
        }
      } catch (error) {
        logger.error(`同步用户到服务器 ${server.name} 错误: ${error.message}`);
      }
    }

    logger.info(`用户 ${user.email} 同步完成`);
  } catch (error) {
    logger.error(`同步用户到 3X-UI 错误: ${error.message}`);
  }
}

/**
 * 完成已支付订单
 * 统一更新订单状态、用户套餐和到期时间，并同步到 3X-UI
 * @param {Object} db - 数据库实例
 * @param {string} outTradeNo - 商户订单号
 * @param {string|null} [tradeNo=null] - 第三方订单号
 * @returns {Promise<Object>} 处理结果
 */
async function completePaidOrder(db, outTradeNo, tradeNo = null) {
  // 查询订单及用户当前到期时间，用于续费场景累计有效期
  const order = await db.prepare(`
    SELECT o.*, u.expire_at as current_expire_at, u.email, u.subscription_token
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

  // 同步用户到 3X-UI 服务器（异步执行，不阻塞返回）
  const userInfo = {
    id: order.user_id,
    email: order.email,
    subscription_token: order.subscription_token,
    expire_at: expireAt
  };
  syncUserToXuiServers(db, userInfo, plan).catch(err => {
    logger.error(`后台同步用户到 3X-UI 失败: ${err.message}`);
  });

  return { handled: true, alreadyPaid: false, order, plan, expireAt };
}

module.exports = {
  completePaidOrder
};
