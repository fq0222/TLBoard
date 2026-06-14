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
const XuiService = require('../../integrations/xui/xui-service');
const trafficManager = require('./traffic-manager');
const xuiSyncTaskService = require('../../integrations/xui/xui-sync-task-service');
const { DISABLE_REASONS } = require('./renew-policy');
const { isTimedPlan } = require('./plan-type');
const { createLogger } = require('../../utils/logger');
const { isValidXuiAuth, generateXuiAuth } = require('../../utils/xui-auth');
const orderRepository = require('../../repositories/order-repository');
const xuiSyncRepository = require('../../repositories/xui-sync-repository');
const referralService = require('../referral-service');

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
  await orderRepository.clearUserSubscriptionSourceCache(db, {
    userId,
    serverId,
    inboundId
  });
}

/**
 * 为用户在单个节点上生成独立的节点凭据和 sub_id
 * @param {string} strategy - 节点策略，用于区分 uuid/auth 型协议
 * @returns {object} { uuid, auth, subId }
 */
function generateNodeCredentials(strategy = 'direct') {
  const subId = crypto.randomBytes(8).toString('hex');

  if (strategy === 'hy2') {
    return {
      uuid: '',
      auth: generateXuiAuth(),
      subId
    };
  }

  return {
    uuid: crypto.randomUUID(),
    auth: '',
    subId
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
 * 统一计算同步到 3X-UI 时应使用的总流量上限。
 *
 * @param {Object} user - 用户快照，可包含 traffic_limit/total_traffic_limit
 * @param {Object} [plan={}] - 套餐快照，可包含 total_traffic_limit 或 traffic_limit
 * @returns {number} 传给 3X-UI 的总字节数
 */
function getXuiTotalTrafficLimit(user, plan = {}) {
  const payloadTotal = Number(plan?.total_traffic_limit);
  if (Number.isFinite(payloadTotal) && payloadTotal >= 0) {
    return payloadTotal;
  }

  if (Number.isFinite(Number(user?.total_traffic_limit))) {
    return Number(user.total_traffic_limit);
  }

  return Number(user?.traffic_limit ?? plan?.traffic_limit) || 0;
}

/**
 * 将本地用户启用状态归一化为 3X-UI enable 布尔值。
 * 职责：确保数据库返回的 0/'0'/false 都会同步为禁用。
 * 关键参数：value 是 users.enabled 当前值。
 * 核心分支：只有 1/'1'/true 视为启用，其余值默认禁用。
 *
 * @param {*} value - 本地 users.enabled 值。
 * @returns {boolean} 3X-UI 客户端 enable 状态。
 */
function normalizeUserEnabled(value) {
  return value === true || value === 1 || value === '1';
}

/**
 * 生成写入同步任务 payload 的套餐快照，避免把整条套餐记录写进队列。
 * @param {Object} plan - 套餐信息
 * @returns {Object} 精简后的套餐信息
 */
function buildPayloadPlan(plan) {
  return {
    id: plan.id,
    traffic_limit: plan.traffic_limit,
    total_traffic_limit: Number(plan.traffic_limit || 0)
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
 * @returns {Promise<{uuid: string, auth: string, subId: string}>}
 */
async function ensureNodeConfig(db, user, server, inbound, existingClient = null, strategy = 'direct') {
  const existingConfig = await xuiSyncRepository.findUserNodeConfig(
    db,
    user.id,
    server.id,
    inbound.id
  );

  if (existingConfig) {
    let auth = existingConfig.auth || '';
    if (strategy === 'hy2' && !isValidXuiAuth(auth)) {
      auth = generateXuiAuth();
      await xuiSyncRepository.saveUserNodeConfig(db, {
        userId: user.id,
        serverId: server.id,
        inboundId: inbound.id,
        uuid: existingConfig.uuid,
        auth,
        subId: existingConfig.sub_id
      });
      logger.info(`修正非法 hy2 auth: user=${user.email}, server=${server.id}, inbound=${inbound.id}`);
    }

    return {
      uuid: existingConfig.uuid,
      auth,
      subId: existingConfig.sub_id
    };
  }

  const credentials = generateNodeCredentials(strategy);
  const uuid = existingClient?.uuid || credentials.uuid;
  const auth = existingClient?.auth || credentials.auth;
  const subId = existingClient?.subId || credentials.subId;

  await xuiSyncRepository.saveUserNodeConfig(db, {
    userId: user.id,
    serverId: server.id,
    inboundId: inbound.id,
    uuid,
    auth,
    subId
  });

  logger.info(`保存用户节点配置: user=${user.email}, server=${server.id}, inbound=${inbound.id}, uuid=${uuid}, sub_id=${subId}`);
  await clearSubscriptionSourceCache(db, user.id, server.id, inbound.id);
  return { uuid, auth, subId };
}

/**
 * 同步用户到所有在线的 3X-UI 服务器
 *
 * 历史实现，保留仅用于对照旧逻辑。
 * 当前真实使用的是下方新的 syncUserToXuiServers()，避免旧分支继续扩散。
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
async function legacySyncUserToXuiServers(db, user, plan = {}) {
  let successCount = 0;
  let failureCount = 0;
  let lastError = '';

  try {
    const servers = await xuiSyncRepository.listOnlineXuiServers(db);

    if (servers.length === 0) {
      logger.warn('没有在线的 3X-UI 服务器，跳过同步');
      return { success: false, message: '没有在线的 3X-UI 服务器' };
    }

    logger.info(`开始同步用户 ${user.email} 到 ${servers.length} 个 3X-UI 服务器`);
    // 1=同步中：仅用于用户端短轮询等待，不作为最终成功标识
    await orderRepository.updateUserSyncStatus(db, user.id, 1);

    for (const server of servers) {
      try {
        const xuiService = await XuiService.getInstance(server.api_url, server.api_token, {
          apiVersion: server.panel_version || '3.0.2'
        });
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
            const totalBytes = getXuiTotalTrafficLimit(user, plan);
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
                enable: normalizeUserEnabled(user.enabled),
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
    await orderRepository.updateUserSyncStatus(db, user.id, 2);
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
async function syncUserToXuiServers(db, user, plan = {}) {
  let successCount = 0;
  let failureCount = 0;
  let lastError = '';

  try {
    const servers = await xuiSyncRepository.listOnlineXuiServers(db);

    if (servers.length === 0) {
      logger.warn('没有在线的 3X-UI 服务器，跳过同步');
      return { success: false, message: '没有在线的 3X-UI 服务器' };
    }

    logger.info(`开始同步用户 ${user.email} 到 ${servers.length} 个 3X-UI 服务器`);
    await orderRepository.updateUserSyncStatus(db, user.id, 1);

    for (const server of servers) {
      try {
        const xuiService = await XuiService.getInstance(server.api_url, server.api_token, {
          apiVersion: server.panel_version || '3.0.2'
        });
        const inboundsResult = await xuiService.getInbounds();

        if (!inboundsResult.success) {
          failureCount++;
          lastError = inboundsResult.message || '获取 inbounds 失败';
          logger.warn(`获取服务器 ${server.name} 的 inbounds 失败: ${lastError}`);
          continue;
        }

        for (const inbound of inboundsResult.data) {
          try {
            const nodeEmail = `${user.email}-${inbound.remark || inbound.id}`;
            const expiryTime = user.expire_at ? Number(user.expire_at) * 1000 : 0;
            const totalBytes = getXuiTotalTrafficLimit(user, plan);
            const strategy = inbound.remark && inbound.remark.toLowerCase().includes('hy2')
              ? 'hy2'
              : (inbound.remark && inbound.remark.toLowerCase().includes('direct') ? 'direct' : 'cf');
            const existingClient = await xuiService.getClientByEmail(inbound.id, nodeEmail);
            const config = await ensureNodeConfig(
              db,
              user,
              server,
              inbound,
              existingClient.success ? existingClient : null,
              strategy
            );
            const desiredClient = {
              id: config.uuid,
              auth: config.auth,
              email: nodeEmail,
              enable: normalizeUserEnabled(user.enabled),
              expiryTime,
              totalGB: totalBytes,
              subId: config.subId,
              strategy,
              protocol: inbound.protocol
            };

            if (strategy === 'direct') {
              desiredClient.flow = 'xtls-rprx-vision';
            }

            const syncResult = await xuiService.upsertUniqueClient(db, {
              userId: user.id,
              serverId: server.id,
              inbound,
              email: nodeEmail,
              desiredClient
            });

            if (syncResult.success) {
              successCount++;
              logger.info(`同步用户 ${user.email} 到服务器 ${server.name} 的 inbound ${inbound.id} 成功: action=${syncResult.action}`);
            } else {
              failureCount++;
              lastError = syncResult.message || '同步 3X-UI 用户失败';
              logger.warn(`同步用户 ${user.email} 到服务器 ${server.name} 的 inbound ${inbound.id} 失败: ${lastError}`);
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
    await orderRepository.updateUserSyncStatus(db, user.id, 2);
    logger.info(`用户 ${user.email} 同步状态更新为 2（等待结束）`);
  }
}

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
 * 计算支付成功后应写入用户的套餐权益。
 *
 * 职责：按订单类型和套餐类型统一生成 traffic_limit、expire_at 和是否清零已用流量。
 * 关键参数：order 为支付订单及当前用户快照，plan 为目标套餐，now 为支付完成时间戳。
 * 核心分支：限时套餐续费从支付时间重置流量和到期；其他续费沿用不限时套餐累加契约。
 *
 * @param {Object} order - 订单与当前用户权益快照
 * @param {Object} plan - 套餐记录
 * @param {number} [now=Math.floor(Date.now() / 1000)] - 支付完成时间戳
 * @returns {{trafficLimit:number,expireAt:number,resetTrafficUsed:boolean}} 用户权益结果
 */
function calculatePaidOrderEntitlement(order, plan, now = Math.floor(Date.now() / 1000)) {
  const isRenewOrder = order.out_trade_no.startsWith('REN');

  if (isRenewOrder && isTimedPlan(plan)) {
    return {
      trafficLimit: Number(plan.traffic_limit || 0),
      expireAt: now + (Number(plan.duration_days) * 24 * 60 * 60),
      resetTrafficUsed: true
    };
  }

  const currentExpireAt = Number(order.current_expire_at || 0);
  const baseExpireAt = currentExpireAt > now ? currentExpireAt : now;
  const expireAt = plan.duration_days === 0 ? 0 : baseExpireAt + (Number(plan.duration_days) * 24 * 60 * 60);

  if (isRenewOrder) {
    const currentTrafficLimit = Number(order.current_traffic_limit || 0);
    const planTrafficLimit = Number(plan.traffic_limit || 0);
    return {
      trafficLimit: currentTrafficLimit + planTrafficLimit,
      expireAt,
      resetTrafficUsed: false
    };
  }

  return {
    trafficLimit: Number(plan.traffic_limit || 0),
    expireAt,
    resetTrafficUsed: false
  };
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
  const order = await orderRepository.findPaidOrderContextByOutTradeNo(db, outTradeNo);

  if (!order) {
    logger.warn(`Order not found: ${outTradeNo}`);
    return { handled: false, reason: 'order_not_found' };
  }

  if (order.status === 'paid') {
    return { handled: true, alreadyPaid: true, order };
  }

  const plan = await orderRepository.findPlanById(db, order.plan_id);
  if (!plan) {
    logger.error(`Plan not found for order ${outTradeNo}: ${order.plan_id}`);
    return { handled: false, reason: 'plan_not_found', order };
  }

  const now = Math.floor(Date.now() / 1000);
  const entitlement = calculatePaidOrderEntitlement(order, plan, now);
  const expireAt = entitlement.expireAt;
  const newTrafficLimit = entitlement.trafficLimit;
  const resetTrafficUsed = entitlement.resetTrafficUsed;
  const finalTradeNo = tradeNo || order.trade_no;
  const isRenewOrder = order.out_trade_no.startsWith('REN');

  if (isRenewOrder && resetTrafficUsed) {
    logger.info(`限时套餐续费重置权益: traffic_limit=${newTrafficLimit}, expire_at=${expireAt}`);
  } else if (isRenewOrder) {
    logger.info(`续费订单流量累加: traffic_limit=${newTrafficLimit}, expire_at=${expireAt}`);
  }

  const transaction = db.transaction(async (transactionDb) => {
    await orderRepository.markOrderPaid(transactionDb, {
      outTradeNo,
      tradeNo: finalTradeNo,
      paidAt: now
    });

    await orderRepository.updateUserAfterPaidOrder(transactionDb, {
      userId: order.user_id,
      planId: plan.id,
      trafficLimit: newTrafficLimit,
      expireAt,
      resetTrafficUsed,
      updatedAt: now
    });

    if (isRenewOrder) {
      const currentPlanId = order.current_plan_id;
      if (currentPlanId && currentPlanId !== plan.id) {
        await orderRepository.decrementPlanSalesCount(transactionDb, currentPlanId);
        await orderRepository.incrementPlanSalesCount(transactionDb, plan.id);
        logger.info(`续费切换套餐: 旧套餐 ${currentPlanId} -1, 新套餐 ${plan.id} +1`);
      } else if (!currentPlanId) {
        await orderRepository.incrementPlanSalesCount(transactionDb, plan.id);
        logger.info(`续费新套餐 ${plan.id} +1`);
      }
    } else {
      await orderRepository.incrementPlanSalesCount(transactionDb, plan.id);
      logger.info(`新购订单: ${plan.id} +1`);
    }

    // 首单奖励：仅新购、支付前 payment_count 为 0 且订单带推广人时，在同一事务内发放。
    if (!isRenewOrder && Number(order.current_payment_count || 0) === 0 && order.referrer_user_id) {
      await referralService.issueFirstPaymentReward(transactionDb, order);
    }
  });

  await transaction();

  // 流量用完被禁用的用户续费后，先恢复本地状态，再异步同步 3X-UI
  if (isRenewOrder
    && Number(order.current_enabled) === 0
    && order.current_disable_reason === DISABLE_REASONS.TRAFFIC_LIMIT) {
    logger.info(`用户 ${order.email} 已禁用，开始解除禁用`);

    trafficManager.enqueueUserStatusSync(db, order.user_id, false)
      .then(result => {
        if (result.success) {
          logger.info(`用户 ${order.email} 解禁状态已立即同步到 3X-UI`);
          return;
        }

        if (result.retryable) {
          logger.warn(`用户 ${order.email} 解禁状态未立即同步，已进入重试队列`);
        }
      })
      .catch(error => {
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
    traffic_limit: newTrafficLimit,
    total_traffic_limit: newTrafficLimit
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
  enqueueAndTryUserSync,
  calculatePaidOrderEntitlement
};
