/**
 * 订单服务封装
 * 处理订单支付成功后的统一激活逻辑，并负责把用户状态同步到 3X-UI。
 *
 * 说明：
 * - 本地订单和用户权益先落库，避免支付成功后账号未激活
 * - 3X-UI 同步通过 xui_sync_tasks 持久化队列补偿
 * - users.sync_status 只表示用户端等待流程是否结束，不代表 3X-UI 实际成功
 */

const crypto = require('crypto');
const XuiService = require('./xui-service');
const trafficManager = require('./traffic-manager');
const xuiSyncTaskService = require('./xui-sync-task-service');
const { createLogger } = require('../utils/logger');

const logger = createLogger('ORDER-SERVICE');

/**
 * 清理用户单个节点的原始订阅模板缓存
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {number} serverId - 服务器 ID
 * @param {number} inboundId - inbound ID
 * @returns {Promise<void>}
 */
async function clearSubscriptionSourceCache(db, userId, serverId, inboundId) {
  await db.prepare(`
    DELETE FROM user_subscription_sources
    WHERE user_id = ? AND server_id = ? AND inbound_id = ?
  `).run(userId, serverId, inboundId);
}

/**
 * 为用户在单个节点上生成独立的 UUID 和 sub_id
 * @returns {object} { uuid, subId }
 */
function generateNodeCredentials() {
  return {
    uuid: crypto.randomUUID(),
    subId: crypto.randomBytes(8).toString('hex')
  };
}

/**
 * 将字节数转换为 3X-UI updateClient 接口需要的 GB 数值
 * @param {number|string} bytes - 字节数
 * @returns {number} GB 数值
 */
function bytesToGB(bytes) {
  return Number(bytes || 0) / (1024 * 1024 * 1024);
}

/**
 * 生成写入同步任务 payload 的套餐快照，避免把整条套餐记录写进队列。
 * @param {Object} plan - 套餐信息
 * @returns {Object} 精简后的套餐信息
 */
function buildPayloadPlan(plan) {
  return {
    id: plan.id,
    traffic_limit: plan.traffic_limit
  };
}

/**
 * 确保用户在某个 3X-UI inbound 上有本地节点配置
 *
 * 如果 3X-UI 已有客户端，优先沿用已有 UUID/subId，避免覆盖用户当前可用配置；
 * 如果不存在，则生成新的 UUID/subId 并写入 user_node_configs。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} user - 用户信息
 * @param {Object} server - 3X-UI 服务器信息
 * @param {Object} inbound - 3X-UI inbound 信息
 * @param {Object|null} existingClient - 3X-UI 已存在的客户端信息
 * @returns {Promise<{uuid: string, subId: string}>}
 */
async function ensureNodeConfig(db, user, server, inbound, existingClient = null) {
  const existingConfig = await db.prepare(
    'SELECT id, uuid, sub_id FROM user_node_configs WHERE user_id = ? AND server_id = ? AND inbound_id = ?'
  ).get(user.id, server.id, inbound.id);

  if (existingConfig) {
    return {
      uuid: existingConfig.uuid,
      subId: existingConfig.sub_id
    };
  }

  const credentials = generateNodeCredentials();
  const uuid = existingClient?.uuid || credentials.uuid;
  const subId = existingClient?.subId || credentials.subId;

  await db.prepare(`
    INSERT INTO user_node_configs (user_id, server_id, inbound_id, uuid, sub_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_id, server_id, inbound_id) DO NOTHING
  `).run(user.id, server.id, inbound.id, uuid, subId);

  logger.info(`保存用户节点配置: user=${user.email}, server=${server.id}, inbound=${inbound.id}, uuid=${uuid}, sub_id=${subId}`);
  await clearSubscriptionSourceCache(db, user.id, server.id, inbound.id);
  return { uuid, subId };
}

/**
 * 同步用户到所有在线的 3X-UI 服务器
 *
 * 此函数会真实返回同步结果，供重试队列判断是否需要再次补偿。
 * 但无论成功失败，finally 中都会把 users.sync_status 写为 2，
 * 表示“用户端等待流程结束”，避免注册/支付页面长时间阻塞。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} user - 用户信息，包含 id/email/expire_at/traffic_limit
 * @param {Object} plan - 套餐信息
 * @returns {Promise<{success: boolean, message?: string, successCount?: number, failureCount?: number}>}
 */
async function syncUserToXuiServers(db, user, plan = {}) {
  let successCount = 0;
  let failureCount = 0;
  let lastError = '';

  try {
    const servers = await db.prepare(`
      SELECT id, name, api_url, api_token
      FROM xui_servers
      WHERE status = 1
    `).all();

    if (servers.length === 0) {
      logger.warn('没有在线的 3X-UI 服务器，跳过同步');
      return { success: false, message: '没有在线的 3X-UI 服务器' };
    }

    logger.info(`开始同步用户 ${user.email} 到 ${servers.length} 个 3X-UI 服务器`);
    // 1=同步中：仅用于用户端短轮询等待，不作为最终成功标识
    await db.prepare('UPDATE users SET sync_status = 1 WHERE id = ?').run(user.id);

    for (const server of servers) {
      try {
        const xuiService = await XuiService.getInstance(server.api_url, server.api_token);
        const inboundsResult = await xuiService.getInbounds();

        if (!inboundsResult.success) {
          failureCount++;
          lastError = inboundsResult.message || '获取 inbounds 失败';
          logger.warn(`获取服务器 ${server.name} 的 inbounds 失败: ${lastError}`);
          continue;
        }

        for (const inbound of inboundsResult.data) {
          try {
            // 每个 inbound 使用“邮箱-节点备注”作为 3X-UI 客户端标识
            const nodeEmail = `${user.email}-${inbound.remark || inbound.id}`;
            const expiryTime = user.expire_at ? Number(user.expire_at) * 1000 : 0;
            const totalBytes = Number(user.traffic_limit || plan.traffic_limit || 0);
            const existingClient = await xuiService.getClientByEmail(inbound.id, nodeEmail);

            if (existingClient.success) {
              // 已存在则更新过期时间、流量上限、启用状态和 subId
              const config = await ensureNodeConfig(db, user, server, inbound, existingClient);
              const updateOpts = {
                expiryTime,
                totalGB: bytesToGB(totalBytes),
                enabled: true,
                subId: config.subId
              };

              if (inbound.remark && inbound.remark.toLowerCase().includes('direct')) {
                updateOpts.flow = 'xtls-rprx-vision';
              }

              logger.info(`更新用户: user=${user.email}, inbound=${inbound.id}, remark=${inbound.remark}, updateOpts=${JSON.stringify(updateOpts)}`);
              const updateResult = await xuiService.updateClient(inbound.id, nodeEmail, updateOpts);

              if (updateResult.success) {
                successCount++;
                logger.info(`更新用户 ${user.email} 到服务器 ${server.name} 的 inbound ${inbound.id} 成功`);
              } else {
                failureCount++;
                lastError = updateResult.message || '更新 3X-UI 用户失败';
                logger.warn(`更新用户 ${user.email} 到服务器 ${server.name} 的 inbound ${inbound.id} 失败: ${lastError}`);
              }
            } else {
              // 不存在则创建新客户端，并保存本地节点配置
              const config = await ensureNodeConfig(db, user, server, inbound);
              const addOpts = {
                email: nodeEmail,
                id: config.uuid,
                enable: true,
                expiryTime,
                totalGB: totalBytes,
                limitIp: 0,
                tgId: 0,
                subId: config.subId
              };

              if (inbound.remark && inbound.remark.toLowerCase().includes('direct')) {
                addOpts.flow = 'xtls-rprx-vision';
              }

              logger.info(`添加用户: user=${user.email}, inbound=${inbound.id}, remark=${inbound.remark}, addOpts=${JSON.stringify(addOpts)}`);
              const addResult = await xuiService.addClient(inbound.id, inbound.protocol, addOpts);

              if (addResult.success) {
                successCount++;
                logger.info(`添加用户 ${user.email} 到服务器 ${server.name} 的 inbound ${inbound.id} 成功，UUID: ${config.uuid}`);
              } else {
                failureCount++;
                lastError = addResult.message || '添加 3X-UI 用户失败';
                logger.warn(`添加用户 ${user.email} 到服务器 ${server.name} 的 inbound ${inbound.id} 失败: ${lastError}`);
              }
            }
          } catch (error) {
            failureCount++;
            lastError = error.message;
            logger.error(`同步用户到 inbound ${inbound.id} 错误: ${error.message}`);
          }
        }
      } catch (error) {
        failureCount++;
        lastError = error.message;
        logger.error(`同步用户到服务器 ${server.name} 错误: ${error.message}`);
      }
    }

    logger.info(`用户 ${user.email} 同步结束，成功 ${successCount} 个，失败 ${failureCount} 个`);
    if (failureCount > 0 || successCount === 0) {
      return {
        success: false,
        message: lastError || '3X-UI 同步未完成',
        successCount,
        failureCount
      };
    }

    return { success: true, successCount, failureCount };
  } catch (error) {
    logger.error(`同步用户到 3X-UI 错误: ${error.message}`);
    return { success: false, message: error.message, successCount, failureCount: failureCount + 1 };
  } finally {
    // 2=等待结束：失败也结束等待，真实失败由 xui_sync_tasks 继续补偿
    await db.prepare('UPDATE users SET sync_status = 2 WHERE id = ?').run(user.id);
    logger.info(`用户 ${user.email} 同步状态更新为 2（等待结束）`);
  }
}

/**
 * 创建 3X-UI 同步任务并立即尝试执行一次
 *
 * 立即尝试成功时任务会标记 success；失败时任务会回到 pending 并按退避时间重试。
 *
 * @param {Object} db - 数据库实例
 * @param {string} taskType - xuiSyncTaskService.TASK_TYPES 中的任务类型
 * @param {Object} userInfo - 用户同步快照
 * @param {Object} plan - 套餐信息
 * @returns {Promise<number>} 同步任务 ID
 */
async function enqueueAndTryUserSync(db, taskType, userInfo, plan) {
  const payload = {
    user: userInfo,
    plan: buildPayloadPlan(plan)
  };

  const taskId = await xuiSyncTaskService.enqueueTask(db, {
    userId: userInfo.id,
    taskType,
    payload
  });

  xuiSyncTaskService.processTask(db, {
    id: taskId,
    task_type: taskType,
    attempts: 0,
    payload_data: payload
  }, async () => syncUserToXuiServers(db, userInfo, plan)).catch(error => {
    logger.error(`后台处理 3X-UI 同步任务失败: ${error.message}`);
  });

  return taskId;
}

/**
 * 完成已支付订单
 *
 * 统一更新订单状态、用户套餐、到期时间、流量上限和套餐销售数量。
 * 本地事务完成后创建 3X-UI 同步任务，避免第三方接口失败影响支付落账。
 *
 * @param {Object} db - 数据库实例
 * @param {string} outTradeNo - 商户订单号
 * @param {string|null} [tradeNo=null] - 第三方订单号
 * @returns {Promise<Object>} 处理结果
 */
async function completePaidOrder(db, outTradeNo, tradeNo = null) {
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

  const now = Math.floor(Date.now() / 1000);
  const currentExpireAt = Number(order.current_expire_at || 0);
  const baseExpireAt = currentExpireAt > now ? currentExpireAt : now;
  const expireAt = plan.duration_days === 0 ? 0 : baseExpireAt + (Number(plan.duration_days) * 24 * 60 * 60);
  const finalTradeNo = tradeNo || order.trade_no;
  const isRenewOrder = order.out_trade_no.startsWith('REN');

  let newTrafficLimit;
  if (isRenewOrder) {
    // 续费场景：当前流量上限 + 新套餐流量上限
    const currentTrafficLimit = Number(order.current_traffic_limit || 0);
    const planTrafficLimit = Number(plan.traffic_limit || 0);
    newTrafficLimit = currentTrafficLimit + planTrafficLimit;
    logger.info(`续费订单流量累加: ${currentTrafficLimit} + ${planTrafficLimit} = ${newTrafficLimit}`);
  } else {
    newTrafficLimit = Number(plan.traffic_limit || 0);
  }

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

    if (isRenewOrder) {
      const currentPlanId = order.current_plan_id;
      if (currentPlanId && currentPlanId !== plan.id) {
        await db.prepare('UPDATE plans SET sales_count = GREATEST(0, sales_count - 1) WHERE id = ?').run(currentPlanId);
        await db.prepare('UPDATE plans SET sales_count = sales_count + 1 WHERE id = ?').run(plan.id);
        logger.info(`续费切换套餐: 旧套餐 ${currentPlanId} -1, 新套餐 ${plan.id} +1`);
      } else if (!currentPlanId) {
        await db.prepare('UPDATE plans SET sales_count = sales_count + 1 WHERE id = ?').run(plan.id);
        logger.info(`续费新套餐 ${plan.id} +1`);
      }
    } else {
      await db.prepare('UPDATE plans SET sales_count = sales_count + 1 WHERE id = ?').run(plan.id);
      logger.info(`新购订单: ${plan.id} +1`);
    }
  });

  await transaction();

  // 流量用完被禁用的用户续费后，先恢复本地状态，再异步同步 3X-UI
  const user = await db.prepare('SELECT enabled FROM users WHERE id = ?').get(order.user_id);
  if (user && user.enabled === 0) {
    logger.info(`用户 ${order.email} 已禁用，开始解除禁用`);
    await db.prepare('UPDATE users SET enabled = 1, traffic_used_at = NULL WHERE id = ?').run(order.user_id);

    trafficManager.syncDisableStatusToXui(db, order.user_id, false).catch(error => {
      logger.error(`后台同步解除禁用到 3X-UI 失败: ${error.message}`);
    });

    logger.info(`用户 ${order.email} 解除禁用成功`);
  }

  logger.info(`Order paid: ${outTradeNo}, user=${order.email}, expire_at=${expireAt}, traffic_limit=${newTrafficLimit}`);

  const userInfo = {
    id: order.user_id,
    email: order.email,
    subscription_token: order.subscription_token,
    expire_at: expireAt,
    traffic_limit: newTrafficLimit
  };

  const syncTaskType = isRenewOrder
    ? xuiSyncTaskService.TASK_TYPES.RENEW_SYNC
    : xuiSyncTaskService.TASK_TYPES.INITIAL_USER_SYNC;

  // 支付流程不等待 3X-UI 完全成功，失败由持久化队列继续重试
  enqueueAndTryUserSync(db, syncTaskType, userInfo, plan).catch(error => {
    logger.error(`创建 3X-UI 同步任务失败，降级为直接同步: ${error.message}`);
    syncUserToXuiServers(db, userInfo, plan).catch(syncError => {
      logger.error(`后台同步用户到 3X-UI 失败: ${syncError.message}`);
    });
  });

  return { handled: true, alreadyPaid: false, order, plan, expireAt };
}

module.exports = {
  completePaidOrder,
  syncUserToXuiServers,
  enqueueAndTryUserSync
};
