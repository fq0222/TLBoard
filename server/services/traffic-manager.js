/**
 * 流量管理模块
 * 负责流量统计、禁用检查和 3X-UI 同步
 */

const XuiService = require('./xui-service');
const xuiSyncTaskService = require('./xui-sync-task-service');
const { withUserStatusLock } = require('./user-status-lock');
const { DISABLE_REASONS } = require('./renew-policy');
const { createLogger } = require('../utils/logger');
const trafficRepository = require('../repositories/traffic-repository');

const logger = createLogger('TRAFFIC-MANAGER');

const DEFAULT_TRAFFIC_USAGE_MULTIPLIER = 1.0;

function formatTrafficForLog(bytes) {
  if (bytes === null || bytes === undefined || bytes === '') {
    return '0 B (0 B)';
  }

  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B (0 B)';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const formattedSize = unitIndex === 0 ? `${size}` : size.toFixed(2);
  return `${formattedSize} ${units[unitIndex]} (${value} B)`;
}

/**
 * 获取流量统计倍率配置。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<number>} 流量倍率
 */
async function getTrafficUsageMultiplier(db) {
  try {
    const row = await trafficRepository.findTrafficUsageMultiplierSetting(db);
    const multiplier = Number(row?.value);
    if (!Number.isFinite(multiplier) || multiplier < 0) {
      return DEFAULT_TRAFFIC_USAGE_MULTIPLIER;
    }
    return multiplier;
  } catch (error) {
    logger.warn(`获取流量统计倍率失败，使用默认倍率: ${error.message}`);
    return DEFAULT_TRAFFIC_USAGE_MULTIPLIER;
  }
}

/**
 * 获取所有服务器的流量数据
 * @param {Object} db - 数据库实例
 * @returns {Promise<Object>} 服务器流量数据 { serverId: { email: { up, down, total } } }
 */
async function fetchAllServerTraffic(db) {
  try {
    const servers = await trafficRepository.listOnlineServers(db);

    if (servers.length === 0) {
      logger.warn('没有在线服务器');
      return {};
    }

    logger.info(`开始获取 ${servers.length} 台服务器的流量数据`);

    const serverTrafficData = {};

    const promises = servers.map(async (server) => {
      try {
        const xuiService = await XuiService.getInstance(server.api_url, server.api_token);

        const inboundsResult = await xuiService.getInbounds();
        if (!inboundsResult.success) {
          logger.warn(`获取服务器 ${server.name} 的 inbounds 失败: ${inboundsResult.message}`);
          return;
        }

        const serverData = {};

        for (const inbound of inboundsResult.data) {
          const clientStats = inbound.clientStats || [];

          for (const client of clientStats) {
            const email = client.email;
            if (!email) continue;

            if (!serverData[email]) {
              serverData[email] = {
                up: 0,
                down: 0,
                total: 0
              };
            }

            serverData[email].up += client.up || 0;
            serverData[email].down += client.down || 0;
            serverData[email].total += (client.up || 0) + (client.down || 0);
          }
        }

        serverTrafficData[server.id] = serverData;
        logger.info(`获取服务器 ${server.name} 流量数据成功，${Object.keys(serverData).length} 个用户`);
      } catch (error) {
        logger.error(`获取服务器 ${server.name} 流量数据错误: ${error.message}`);
      }
    });

    await Promise.all(promises);

    logger.info(`获取所有服务器流量数据完成，共 ${Object.keys(serverTrafficData).length} 台服务器`);
    return serverTrafficData;
  } catch (error) {
    logger.error(`获取服务器流量数据错误: ${error.message}`);
    return {};
  }
}

/**
 * 计算用户总流量（增量更新）
 * 使用事务保护，批量查询和写入同步日志
 * @param {Object} db - 数据库实例（需要有 pool 属性）
 * @param {Object} serverTrafficData - 服务器流量数据
 * @returns {Promise<Object>} 用户流量数据 { userId: { email, trafficUsed, trafficLimit, isOverLimit } }
 */
async function calculateUserTotalTraffic(db, serverTrafficData) {
  const serverIds = Object.keys(serverTrafficData);
  if (serverIds.length === 0) {
    logger.info('没有服务器流量数据');
    return {};
  }

  const users = await trafficRepository.listEnabledUsersForTrafficSync(db);

  if (users.length === 0) {
    logger.info('没有启用的用户');
    return {};
  }

  logger.info(`开始计算 ${users.length} 个用户的流量，${serverIds.length} 台服务器`);

  const now = Math.floor(Date.now() / 1000);
  const trafficUsageMultiplier = await getTrafficUsageMultiplier(db);
  logger.info(`当前流量统计倍率: ${trafficUsageMultiplier}`);

  try {
    const result = await trafficRepository.withTrafficSyncTransaction(db, async (client) => {
      const syncLogRows = await trafficRepository.listTrafficSyncLogs(client);
      const syncLogMap = new Map();
      for (const row of syncLogRows) {
        syncLogMap.set(`${row.user_id}-${row.server_id}`, Number(row.last_sync_traffic) || 0);
      }

      const userTrafficData = {};
      const syncLogUpdates = [];

      for (const user of users) {
        let totalIncrement = 0;

        for (const serverId of serverIds) {
          const serverData = serverTrafficData[serverId];

          let userTotalTraffic = 0;
          let found = false;
          for (const [email, data] of Object.entries(serverData)) {
            if (email.startsWith(user.email + '-')) {
              userTotalTraffic += data.total || 0;
              found = true;
            }
          }

          if (!found) {
            continue;
          }

          const lastSyncTraffic = syncLogMap.get(`${user.id}-${serverId}`) || 0;
          const currentTraffic = userTotalTraffic;

          let increment = 0;
          let rawIncrement = 0;
          if (currentTraffic >= lastSyncTraffic) {
            rawIncrement = currentTraffic - lastSyncTraffic;
            increment = Math.round(rawIncrement * trafficUsageMultiplier);
          } else {
            logger.warn(
              `服务器 ${serverId} 用户 ${user.email} 流量回退: 当前 ${currentTraffic} < 上次 ${lastSyncTraffic}，本次不累加，仅重置同步基线`
            );
          }

          if (increment > 0) {
            logger.info(
              `用户流量增量: email=${user.email}, 已用流量=${formatTrafficForLog(user.traffic_used || 0)}, ` +
              `上次流量=${formatTrafficForLog(lastSyncTraffic)}, 当前流量=${formatTrafficForLog(currentTraffic)}, 本次增量=${formatTrafficForLog(rawIncrement)}, ` +
              `倍率=${trafficUsageMultiplier}, 倍率后增量=${formatTrafficForLog(increment)}`
            );
          }

          totalIncrement += increment;
          syncLogUpdates.push({ userId: user.id, serverId, currentTraffic, now });
        }

        const newTrafficUsed = (Number(user.traffic_used) || 0) + totalIncrement;
        const trafficLimit = Number(user.traffic_limit) || 0;
        const isOverLimit = trafficLimit > 0 && newTrafficUsed >= trafficLimit;

        userTrafficData[user.id] = {
          email: user.email,
          trafficUsed: newTrafficUsed,
          trafficLimit,
          isOverLimit,
          increment: totalIncrement
        };
      }

      await trafficRepository.upsertTrafficSyncLogs(client, syncLogUpdates);
      return {
        userTrafficData,
        syncLogUpdateCount: syncLogUpdates.length
      };
    });

    logger.info(`计算用户流量完成，${Object.keys(result.userTrafficData).length} 个用户，${result.syncLogUpdateCount} 条同步记录更新`);
    return result.userTrafficData;
  } catch (error) {
    logger.error(`计算用户流量事务失败，已回滚: ${error.message}`);
    throw error;
  }
}

/**
 * 更新本地数据库的流量统计
 * @param {Object} db - 数据库实例
 * @param {Object} userTrafficData - 用户流量数据
 */
async function updateTrafficInDatabase(db, userTrafficData) {
  try {
    const userIds = Object.keys(userTrafficData);

    if (userIds.length === 0) {
      logger.info('没有需要更新的用户流量数据');
      return;
    }

    logger.info(`开始更新 ${userIds.length} 个用户的流量数据`);

    let updatedCount = 0;

    for (const userId of userIds) {
      const data = userTrafficData[userId];

      try {
        await trafficRepository.updateUserTrafficUsed(
          db,
          userId,
          data.trafficUsed,
          Math.floor(Date.now() / 1000)
        );

        updatedCount++;
      } catch (error) {
        logger.error(`更新用户 ${data.email} 流量数据错误: ${error.message}`);
      }
    }

    logger.info(`更新用户流量数据完成，${updatedCount}/${userIds.length} 个用户`);
  } catch (error) {
    logger.error(`更新用户流量数据错误: ${error.message}`);
  }
}

/**
 * 获取禁用前需要再次确认的用户最新状态
 * @param {Object} db - 数据库实例
 * @param {number|string} userId - 用户 ID
 * @returns {Promise<Object|undefined>} 最新用户状态快照
 */
async function getLatestUserDisableState(db, userId) {
  return trafficRepository.findLatestUserDisableState(db, userId);
}

/**
 * 检查并禁用超量用户
 * @param {Object} db - 数据库实例
 * @param {Object} userTrafficData - 用户流量数据
 * @returns {Promise<{disabledCount: number, retryCount: number}>} 禁用数量与待重试数量
 */
async function checkAndDisableOverLimitUsers(db, userTrafficData) {
  try {
    const userIds = Object.keys(userTrafficData);

    if (userIds.length === 0) {
      logger.info('没有需要检查的用户');
      return;
    }

    logger.info(`开始检查 ${userIds.length} 个用户的流量限制`);

    let disabledCount = 0;
    let retryCount = 0;

    for (const userId of userIds) {
      const data = userTrafficData[userId];

      if (!data.isOverLimit) {
        continue;
      }

      const lockedResult = await withUserStatusLock(db, Number(userId), async () => {
        const latestUser = await getLatestUserDisableState(db, userId);
        if (!latestUser || latestUser.enabled === 0) {
          logger.info(`用户 ${data.email} 当前已是禁用状态，跳过重复禁用`);
          return { success: true, action: 'skip-disabled' };
        }

        const latestUsed = Number(latestUser.traffic_used) || 0;
        const latestLimit = Number(latestUser.traffic_limit) || 0;
        const stillOverLimit = latestLimit > 0 && latestUsed >= latestLimit;

        if (!stillOverLimit) {
          logger.info(
            `用户 ${data.email} 二次校验后未超限，跳过禁用: latestUsed=${latestUsed}, latestLimit=${latestLimit}`
          );
          return { success: true, action: 'skip-rechecked' };
        }

        logger.info(`用户 ${data.email} 流量超限，开始禁用: ${latestUsed}/${latestLimit}`);

        const syncSuccess = await syncDisableStatusToXui(db, userId, true, { skipLock: true });
        if (!syncSuccess) {
          return {
            success: false,
            retryable: true,
            message: `同步禁用状态到3X-UI失败: user=${userId}`
          };
        }

        await trafficRepository.disableUserByTrafficLimit(
          db,
          userId,
          Math.floor(Date.now() / 1000),
          DISABLE_REASONS.TRAFFIC_LIMIT
        );

        return { success: true, action: 'disabled' };
      });

      if (lockedResult.retryable) {
        retryCount++;
        logger.warn(`用户 ${data.email} 状态锁忙或禁用同步失败，等待重试: ${lockedResult.message}`);
        continue;
      }

      if (lockedResult.success && lockedResult.action === 'disabled') {
        disabledCount++;
        logger.info(`禁用用户 ${data.email} 成功`);
      }

      if (!lockedResult.success && lockedResult.message) {
        logger.error(`禁用用户 ${data.email} 错误: ${lockedResult.message}`);
      }
    }

    logger.info(`检查用户流量限制完成，禁用 ${disabledCount} 个用户，待重试 ${retryCount} 个用户`);
    return { disabledCount, retryCount };
  } catch (error) {
    logger.error(`检查用户流量限制错误: ${error.message}`);
    return { disabledCount: 0, retryCount: 0 };
  }
}

/**
 * 同步禁用状态到 3X-UI
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {boolean} disable - 是否禁用
 * @param {Object} [options={}] - 同步选项
 * @param {boolean} [options.skipLock=false] - 是否跳过外层 userId 锁，供已持锁路径复用
 * @returns {Promise<boolean>} 是否成功
 */
async function syncDisableStatusToXui(db, userId, disable, options = {}) {
  if (!options.skipLock) {
    const lockedResult = await withUserStatusLock(db, Number(userId), async () => {
      const success = await syncDisableStatusToXui(db, userId, disable, { ...options, skipLock: true });
      return { success };
    });

    if (!lockedResult.success) {
      return false;
    }

    return !!lockedResult.success;
  }

  try {
    const user = await trafficRepository.findUserEmailById(db, userId);
    if (!user) {
      logger.warn(`用户不存在: ${userId}`);
      return false;
    }

    const servers = await trafficRepository.listOnlineServers(db);

    if (servers.length === 0) {
      logger.warn('没有在线服务器');
      return false;
    }

    logger.info(`开始同步禁用状态到 ${servers.length} 台服务器: 用户 ${user.email}, 禁用 ${disable}`);

    let successCount = 0;
    for (const server of servers) {
      try {
        const xuiService = await XuiService.getInstance(server.api_url, server.api_token);

        const inboundsResult = await xuiService.getInbounds();
        if (!inboundsResult.success) {
          logger.warn(`获取服务器 ${server.name} 的 inbounds 失败`);
          continue;
        }

        for (const inbound of inboundsResult.data) {
          const nodeEmail = `${user.email}-${inbound.remark || inbound.id}`;
          const updateResult = await xuiService.updateClient(inbound.id, nodeEmail, {
            enabled: !disable
          });

          if (updateResult.success) {
            successCount++;
            logger.info(`同步服务器 ${server.name} 的 inbound ${inbound.id} 成功`);
          } else {
            logger.warn(`同步服务器 ${server.name} 的 inbound ${inbound.id} 失败: ${updateResult.message}`);
          }
        }
      } catch (error) {
        logger.error(`同步服务器 ${server.name} 禁用状态错误: ${error.message}`);
      }
    }

    logger.info(`同步禁用状态完成: 用户 ${user.email}, 禁用 ${disable}, 成功 ${successCount} 个 inbound`);
    return successCount > 0;
  } catch (error) {
    logger.error(`同步禁用状态错误: ${error.message}`);
    return false;
  }
}

/**
 * 统一处理用户启用状态同步
 *
 * 先尝试立即同步到 3X-UI；如果锁忙或同步失败，则降级写入 xui_sync_tasks，
 * 交给现有重试队列继续补偿，避免直接丢失禁用/解禁动作。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {boolean} disable - 是否禁用
 * @returns {Promise<{success: boolean, retryable?: boolean, action: string}>}
 */
async function enqueueUserStatusSync(db, userId, disable) {
  const syncSuccess = await syncDisableStatusToXui(db, userId, disable);
  if (syncSuccess) {
    logger.info(`用户状态已立即同步到 3X-UI: user=${userId}, disable=${disable}`);
    return {
      success: true,
      action: disable ? 'disable' : 'enable'
    };
  }

  const taskType = disable
    ? xuiSyncTaskService.TASK_TYPES.DISABLE_SYNC
    : xuiSyncTaskService.TASK_TYPES.ENABLE_SYNC;

  await xuiSyncTaskService.enqueueTask(db, {
    userId,
    taskType,
    payload: { disable }
  });

  logger.warn(`用户状态同步已降级进入重试队列: user=${userId}, disable=${disable}, taskType=${taskType}`);

  return {
    success: false,
    retryable: true,
    action: 'queued'
  };
}

/**
 * 主函数：同步流量并处理禁用
 * @param {Object} db - 数据库实例
 */
async function syncTrafficAndHandleDisable(db) {
  try {
    logger.info('开始执行流量同步与禁用检查任务...');

    const serverTrafficData = await fetchAllServerTraffic(db);

    if (Object.keys(serverTrafficData).length === 0) {
      logger.info('没有获取到服务器流量数据，跳过后续步骤');
      return;
    }

    const userTrafficData = await calculateUserTotalTraffic(db, serverTrafficData);

    if (Object.keys(userTrafficData).length === 0) {
      logger.info('没有计算到用户流量数据，跳过后续步骤');
      return;
    }

    await updateTrafficInDatabase(db, userTrafficData);
    await checkAndDisableOverLimitUsers(db, userTrafficData);

    logger.info('流量同步与禁用检查任务完成');
  } catch (error) {
    logger.error(`流量同步与禁用检查任务错误: ${error.message}`);
  }
}

module.exports = {
  syncTrafficAndHandleDisable,
  fetchAllServerTraffic,
  calculateUserTotalTraffic,
  updateTrafficInDatabase,
  checkAndDisableOverLimitUsers,
  syncDisableStatusToXui,
  enqueueUserStatusSync,
  getLatestUserDisableState,
  getTrafficUsageMultiplier,
  formatTrafficForLog
};
