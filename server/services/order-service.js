/**
 * 订单服务封装
 * 处理订单支付成功后的统一激活逻辑
 */

const crypto = require('crypto');
const XuiService = require('./xui-service');
const trafficManager = require('./traffic-manager');
const { createLogger } = require('../utils/logger');

const logger = createLogger('ORDER-SERVICE');

/**
 * 为用户在节点上生成独立的 UUID 和 sub_id
 * @returns {object} { uuid, subId }
 */
function generateNodeCredentials() {
  return {
    uuid: crypto.randomUUID(),
    subId: crypto.randomBytes(8).toString('hex')  // 16 位十六进制
  };
}

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

        // 为每个 inbound 添加或更新用户
        for (const inbound of inboundsResult.data) {
          try {
            // 计算到期时间（毫秒）
            const expiryTime = user.expire_at ? user.expire_at * 1000 : 0;
            
            // 流量限制（字节）- 优先使用用户实际流量限制（续费场景累加后的值）
            const totalGB = user.traffic_limit || plan.traffic_limit || 0;

            // 为每个节点生成唯一的邮箱标识（邮箱-节点备注）
            const nodeEmail = `${user.email}-${inbound.remark || inbound.id}`;

            // 先尝试获取用户是否已存在（使用新的邮箱格式）
            const existingClient = await xuiService.getClientByEmail(inbound.id, nodeEmail);
            
            if (existingClient.success) {
              // 用户已存在，检查是否已有配置
              const existingConfig = await db.prepare(
                'SELECT id, uuid, sub_id FROM user_node_configs WHERE user_id = ? AND server_id = ? AND inbound_id = ?'
              ).get(user.id, server.id, inbound.id);

              let configUuid = existingClient.uuid;
              let configSubId = existingClient.subId;

              if (!existingConfig) {
                // 没有配置，使用 3X-UI 中已有的信息创建
                const credentials = generateNodeCredentials();
                configUuid = existingClient.uuid || credentials.uuid;
                configSubId = existingClient.subId || credentials.subId;
                await db.prepare(
                  'INSERT INTO user_node_configs (user_id, server_id, inbound_id, uuid, sub_id) VALUES (?, ?, ?, ?, ?)'
                ).run(user.id, server.id, inbound.id, configUuid, configSubId);
                logger.info(`补充用户节点配置: user=${user.email}, server=${server.id}, inbound=${inbound.id}, uuid=${configUuid}, sub_id=${configSubId}`);
              } else {
                // 已有配置，使用数据库中的值
                configUuid = existingConfig.uuid;
                configSubId = existingConfig.sub_id;
              }

              // 检查 3X-UI 中的 sub_id 是否与数据库一致
              if (existingClient.subId !== configSubId) {
                logger.info(`sub_id 不一致，更新 3X-UI: user=${user.email}, db=${configSubId}, xui=${existingClient.subId}`);
              }

              // 更新用户（使用数据库中的 sub_id）
              const updateOpts = {
                expiryTime: expiryTime,
                totalGB: totalGB / (1024 * 1024 * 1024), // 字节转GB
                enabled: true,
                subId: configSubId
              };
              // direct 节点需要 flow 参数
              if (inbound.remark && inbound.remark.toLowerCase().includes('direct')) {
                updateOpts.flow = 'xtls-rprx-vision';
              }
              logger.info(`更新用户: user=${user.email}, inbound=${inbound.id}, remark=${inbound.remark}, updateOpts=${JSON.stringify(updateOpts)}`);
              const updateResult = await xuiService.updateClient(inbound.id, nodeEmail, updateOpts);
              
              if (updateResult.success) {
                logger.info(`更新用户 ${user.email} 到服务器 ${server.name} 的 inbound ${inbound.id} 成功`);
              } else {
                logger.warn(`更新用户 ${user.email} 到服务器 ${server.name} 的 inbound ${inbound.id} 失败: ${updateResult.message}`);
              }
            } else {
              // 用户不存在，添加新用户
              // 生成独立的 UUID 和 sub_id
              const credentials = generateNodeCredentials();

              // 保存到 user_node_configs 表
              await db.prepare(
                'INSERT INTO user_node_configs (user_id, server_id, inbound_id, uuid, sub_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id, server_id, inbound_id) DO NOTHING'
              ).run(user.id, server.id, inbound.id, credentials.uuid, credentials.subId);
              logger.info(`保存用户节点配置: user=${user.email}, server=${server.id}, inbound=${inbound.id}, uuid=${credentials.uuid}`);

              // 添加到 3X-UI
              const addOpts = {
                email: nodeEmail,
                id: credentials.uuid,
                enable: true,
                expiryTime: expiryTime,
                totalGB: totalGB,
                limitIp: 0,
                tgId: 0,
                subId: credentials.subId
              };
              // direct 节点需要 flow 参数
              if (inbound.remark && inbound.remark.toLowerCase().includes('direct')) {
                addOpts.flow = 'xtls-rprx-vision';
              }
              logger.info(`添加用户: user=${user.email}, inbound=${inbound.id}, remark=${inbound.remark}, addOpts=${JSON.stringify(addOpts)}`);
              const addResult = await xuiService.addClient(inbound.id, inbound.protocol, addOpts);

              if (addResult.success) {
                logger.info(`添加用户 ${user.email} 到服务器 ${server.name} 的 inbound ${inbound.id} 成功，UUID: ${credentials.uuid}`);
              } else {
                logger.warn(`添加用户 ${user.email} 到服务器 ${server.name} 的 inbound ${inbound.id} 失败: ${addResult.message}`);
              }
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
    SELECT o.*, u.expire_at as current_expire_at, u.traffic_limit as current_traffic_limit, 
           u.email, u.subscription_token, u.plan_id as current_plan_id
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
  // duration_days为0表示无限期，expireAt设为0
  const expireAt = plan.duration_days === 0 ? 0 : baseExpireAt + (Number(plan.duration_days) * 24 * 60 * 60);
  const finalTradeNo = tradeNo || order.trade_no;

  // 判断是否为续费订单（REN前缀）- 提升到transaction外部以便后续使用
  const isRenewOrder = order.out_trade_no.startsWith('REN');
  let newTrafficLimit;

  if (isRenewOrder) {
    // 续费场景：当前流量 + 新套餐流量
    const currentTrafficLimit = Number(order.current_traffic_limit || 0);
    const planTrafficLimit = Number(plan.traffic_limit || 0);
    newTrafficLimit = currentTrafficLimit + planTrafficLimit;
    logger.info(`续费订单流量累加: ${currentTrafficLimit} + ${planTrafficLimit} = ${newTrafficLimit}`);
  } else {
    // 新购场景：直接使用套餐流量
    newTrafficLimit = Number(plan.traffic_limit || 0);
  }

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
        payment_count = payment_count + 1,
        updated_at = ?
      WHERE id = ?
    `).run(plan.id, newTrafficLimit, expireAt, now, order.user_id);

    // 更新套餐销售数量
    if (isRenewOrder) {
      // 续费订单
      const currentPlanId = order.current_plan_id;
      if (currentPlanId && currentPlanId !== plan.id) {
        // 切换套餐：旧套餐 -1，新套餐 +1
        await db.prepare('UPDATE plans SET sales_count = GREATEST(0, sales_count - 1) WHERE id = ?').run(currentPlanId);
        await db.prepare('UPDATE plans SET sales_count = sales_count + 1 WHERE id = ?').run(plan.id);
        logger.info(`续费切换套餐: 旧套餐 ${currentPlanId} -1, 新套餐 ${plan.id} +1`);
      } else if (!currentPlanId) {
        // 用户之前没有套餐：新套餐 +1
        await db.prepare('UPDATE plans SET sales_count = sales_count + 1 WHERE id = ?').run(plan.id);
        logger.info(`续费新套餐: ${plan.id} +1`);
      }
      // 续费相同套餐：不变
    } else {
      // 新购订单：新套餐 +1
      await db.prepare('UPDATE plans SET sales_count = sales_count + 1 WHERE id = ?').run(plan.id);
      logger.info(`新购订单: ${plan.id} +1`);
    }
  });

  await transaction();

  // 检查用户是否需要解除禁用（流量用完被禁用的情况）
  const user = await db.prepare('SELECT enabled FROM users WHERE id = ?').get(order.user_id);
  if (user && user.enabled === 0) {
    logger.info(`用户 ${order.email} 已禁用，开始解除禁用`);
    
    // 更新本地数据库
    await db.prepare(`
      UPDATE users SET enabled = 1, traffic_used_at = NULL WHERE id = ?
    `).run(order.user_id);
    
    // 异步同步到3X-UI
    trafficManager.syncDisableStatusToXui(db, order.user_id, false).catch(err => {
      logger.error(`后台同步解除禁用到 3X-UI 失败: ${err.message}`);
    });
    
    logger.info(`用户 ${order.email} 解除禁用成功`);
  }

  logger.info(`Order paid: ${outTradeNo}, user=${order.email}, expire_at=${expireAt}, traffic_limit=${newTrafficLimit}`);

  // 同步用户到 3X-UI 服务器（异步执行，不阻塞返回）
  const userInfo = {
    id: order.user_id,
    email: order.email,
    subscription_token: order.subscription_token,
    expire_at: expireAt,
    traffic_limit: newTrafficLimit
  };
  syncUserToXuiServers(db, userInfo, plan).catch(err => {
    logger.error(`后台同步用户到 3X-UI 失败: ${err.message}`);
  });

  return { handled: true, alreadyPaid: false, order, plan, expireAt };
}

module.exports = {
  completePaidOrder,
  syncUserToXuiServers
};
