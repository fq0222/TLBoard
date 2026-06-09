/**
 * 流量管理模块
 * 负责流量统计、禁用检查和 3X-UI 同步
 */

const XuiService = require('../../integrations/xui/xui-service');
const xuiSyncTaskService = require('../../integrations/xui/xui-sync-task-service');
const { withUserStatusLock } = require('./user-status-lock');
const { DISABLE_REASONS } = require('./renew-policy');
const { createLogger } = require('../../utils/logger');
const trafficRepository = require('../../repositories/traffic-repository');

const logger = createLogger('TRAFFIC-MANAGER');

const DEFAULT_TRAFFIC_USAGE_MULTIPLIER = 1.0;

/**
 * 判断面板失败是否属于鉴权失败。
 *
 * @param {string} message - 失败消息
 * @returns {boolean} 是否为鉴权失败
 */

/**
 * 将面板访问失败归类为 API 故障或鉴权故障。
 *
 * @param {string} message - 失败消息
 * @returns {{panelApiStatus: string, panelAuthStatus: string, failureReason: string}}
 */

/**
 * 记录单台服务器的面板健康成功状态。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} server - 服务器配置
 * @param {number} checkedAt - 检查时间
 * @returns {Promise<void>}
 */

/**
 * 记录单台服务器的面板健康失败状态。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} server - 服务器配置
 * @param {number} checkedAt - 检查时间
 * @param {string} message - 失败消息
 * @returns {Promise<void>}
 */
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
 * 统一计算流量同步与禁用判断使用的总流量额度。
 *
 * @param {Object} user - 用户快照，需包含 traffic_limit/referral_traffic_limit
 * @returns {number} 套餐流量与推广流量汇总后的总上限
 */
function getTotalTrafficLimit(user) {
  return (Number(user?.traffic_limit) || 0) + (Number(user?.referral_traffic_limit) || 0);
}

/**
 * 将 3X-UI 客户端启用字段统一转换为布尔值。
 *
 * @param {*} value - 3X-UI 返回的 enable/enabled 字段
 * @returns {boolean} 是否启用，缺省按启用处理
 */
function normalizeClientEnabled(value) {
  if (value === null || value === undefined || value === '') {
    return true;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized !== '0' && normalized !== 'false';
}

/**
 * 从 inbound.settings 中解析客户端配置，用于复用本轮流量拉取时的 3X-UI 状态快照。
 *
 * @param {Object} inbound - 3X-UI inbound 快照
 * @returns {Array} 客户端配置列表
 */
function extractInboundClients(inbound) {
  try {
    const settings = typeof inbound.settings === 'string'
      ? JSON.parse(inbound.settings || '{}')
      : (inbound.settings || {});
    return Array.isArray(settings.clients) ? settings.clients : [];
  } catch (error) {
    logger.warn(`解析 inbound ${inbound.id} 客户端配置失败: ${error.message}`);
    return [];
  }
}

/**
 * 根据节点协议和备注判断更新客户端时应使用的策略。
 *
 * @param {Object} inbound - 3X-UI inbound 快照
 * @returns {string} 更新策略：hy2 / direct / cf
 */
function getInboundUpdateStrategy(inbound = {}) {
  const remark = String(inbound.remark || '').toLowerCase();
  const protocol = String(inbound.protocol || '').toLowerCase();

  if (remark.includes('hy2') || protocol === 'hysteria' || protocol === 'hysteria2') {
    return 'hy2';
  }
  if (remark.includes('direct')) {
    return 'direct';
  }
  return 'cf';
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
        const xuiService = await XuiService.getInstance(server.api_url, server.api_token, {
          apiVersion: server.panel_version || '3.0.2'
        });

        const inboundsResult = await xuiService.getInbounds();
        if (!inboundsResult.success) {
          logger.warn(`获取服务器 ${server.name} 的 inbounds 失败: ${inboundsResult.message}`);
          return;
        }

        const serverData = {};

        for (const inbound of inboundsResult.data) {
          const clientStats = inbound.clientStats || [];
          const clients = extractInboundClients(inbound);
          const clientsByEmail = new Map(clients.map(client => [client.email, client]));

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

            const settingsClient = clientsByEmail.get(email);
            const enabledValue = client.enable !== undefined ? client.enable : settingsClient?.enable;
            serverData[email].up += client.up || 0;
            serverData[email].down += client.down || 0;
            serverData[email].total += (client.up || 0) + (client.down || 0);
            serverData[email].enabled = normalizeClientEnabled(enabledValue);
            serverData[email].enabledKnown = enabledValue !== undefined;
            serverData[email].inboundId = inbound.id;
            serverData[email].protocol = inbound.protocol || '';
            serverData[email].strategy = getInboundUpdateStrategy(inbound);
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
        const trafficLimit = getTotalTrafficLimit(user);
        const isOverLimit = trafficLimit > 0 && newTrafficUsed >= trafficLimit;

        userTrafficData[user.id] = {
          email: user.email,
          enabled: user.enabled,
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
async function checkAndDisableOverLimitUsers(db, userTrafficData, clientStatusSnapshot = {}) {
  try {
    const userIds = Object.keys(userTrafficData);

    if (userIds.length === 0) {
      logger.info('没有需要检查的用户');
      return;
    }

    logger.info(`开始检查 ${userIds.length} 个用户的流量限制`);

    let disabledCount = 0;
    let compensatedCount = 0;
    let retryCount = 0;

    for (const userId of userIds) {
      const data = userTrafficData[userId];

      if (!data.isOverLimit) {
        continue;
      }

      const lockedResult = await withUserStatusLock(db, Number(userId), async () => {
        const latestUser = await getLatestUserDisableState(db, userId);
        if (!latestUser) {
          logger.info(`用户 ${data.email} 不存在，跳过禁用检查`);
          return { success: true, action: 'skip-missing' };
        }

        const latestUsed = Number(latestUser.traffic_used) || 0;
        const latestLimit = getTotalTrafficLimit(latestUser);
        const stillOverLimit = latestLimit > 0 && latestUsed >= latestLimit;

        if (!stillOverLimit) {
          logger.info(
            `用户 ${data.email} 二次校验后未超限，跳过禁用: latestUsed=${latestUsed}, latestLimit=${latestLimit}`
          );
          return { success: true, action: 'skip-rechecked' };
        }

        if (latestUser.enabled === 0) {
          logger.info(`用户 ${data.email} 本地已禁用，开始补偿同步 3X-UI 禁用状态`);
          const syncSuccess = await syncDisableStatusToXui(db, userId, true, {
            skipLock: true,
            clientStatusSnapshot
          });
          if (!syncSuccess) {
            return {
              success: false,
              retryable: true,
              message: `补偿同步禁用状态到 3X-UI 失败: user=${userId}`
            };
          }

          return { success: true, action: 'compensated' };
        }

        logger.info(`用户 ${data.email} 流量超限，开始禁用: ${latestUsed}/${latestLimit}`);

        await trafficRepository.disableUserByTrafficLimit(
          db,
          userId,
          Math.floor(Date.now() / 1000),
          DISABLE_REASONS.TRAFFIC_LIMIT
        );

        const syncSuccess = await syncDisableStatusToXui(db, userId, true, {
          skipLock: true,
          clientStatusSnapshot
        });
        if (!syncSuccess) {
          return {
            success: false,
            retryable: true,
            action: 'disabled-retry',
            message: `同步禁用状态到3X-UI失败: user=${userId}`
          };
        }

        return { success: true, action: 'disabled' };
      });

      if (lockedResult.retryable) {
        retryCount++;
        if (lockedResult.action === 'disabled-retry') {
          disabledCount++;
        }
        logger.warn(`用户 ${data.email} 状态锁忙或禁用同步失败，等待重试: ${lockedResult.message}`);
        continue;
      }

      if (lockedResult.success && lockedResult.action === 'disabled') {
        disabledCount++;
        logger.info(`禁用用户 ${data.email} 成功`);
      }

      if (lockedResult.success && lockedResult.action === 'compensated') {
        compensatedCount++;
        logger.info(`补偿同步用户 ${data.email} 禁用状态成功`);
      }

      if (!lockedResult.success && lockedResult.message) {
        logger.error(`禁用用户 ${data.email} 错误: ${lockedResult.message}`);
      }
    }

    logger.info(`检查用户流量限制完成，禁用 ${disabledCount} 个用户，补偿同步 ${compensatedCount} 个用户，待重试 ${retryCount} 个用户`);
    return { disabledCount, compensatedCount, retryCount };
  } catch (error) {
    logger.error(`检查用户流量限制错误: ${error.message}`);
    return { disabledCount: 0, compensatedCount: 0, retryCount: 0 };
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

    const desiredEnabled = !disable;
    const clientStatusSnapshot = options.clientStatusSnapshot || {};
    let successCount = 0;
    let skippedCount = 0;
    let failureCount = 0;
    for (const server of servers) {
      try {
        const xuiService = await XuiService.getInstance(server.api_url, server.api_token, {
          apiVersion: server.panel_version || '3.0.2'
        });

        const snapshotEntries = Object.entries(clientStatusSnapshot[server.id] || {})
          .filter(([email]) => email.startsWith(`${user.email}-`));
        if (snapshotEntries.length > 0) {
          for (const [nodeEmail, snapshotClient] of snapshotEntries) {
            if (snapshotClient.enabledKnown && snapshotClient.enabled === desiredEnabled) {
              skippedCount++;
              continue;
            }

            const updateResult = await xuiService.updateClientByContext(snapshotClient.inboundId, nodeEmail, {
              enabled: desiredEnabled,
              protocol: snapshotClient.protocol || '',
              strategy: snapshotClient.strategy || 'direct'
            });

            if (updateResult.success) {
              successCount++;
              logger.info(`同步服务器 ${server.name} 的 inbound ${snapshotClient.inboundId} 成功`);
            } else {
              failureCount++;
              logger.warn(`同步服务器 ${server.name} 的 inbound ${snapshotClient.inboundId} 失败: ${updateResult.message}`);
            }
          }
          continue;
        }

        const inboundsResult = await xuiService.getInbounds();
        if (!inboundsResult.success) {
          failureCount++;
          logger.warn(`获取服务器 ${server.name} 的 inbounds 失败`);
          continue;
        }

        for (const inbound of inboundsResult.data) {
          const nodeEmail = `${user.email}-${inbound.remark || inbound.id}`;
          const updateResult = await xuiService.updateClientByContext(inbound.id, nodeEmail, {
            enabled: desiredEnabled,
            protocol: inbound.protocol || '',
            strategy: getInboundUpdateStrategy(inbound)
          });

          if (updateResult.success) {
            successCount++;
            logger.info(`同步服务器 ${server.name} 的 inbound ${inbound.id} 成功`);
          } else {
            failureCount++;
            logger.warn(`同步服务器 ${server.name} 的 inbound ${inbound.id} 失败: ${updateResult.message}`);
          }
        }
      } catch (error) {
        failureCount++;
        logger.error(`同步服务器 ${server.name} 禁用状态错误: ${error.message}`);
      }
    }

    logger.info(`同步禁用状态完成: 用户 ${user.email}, 禁用 ${disable}, 成功 ${successCount} 个 inbound，跳过 ${skippedCount} 个 inbound，失败 ${failureCount} 个 inbound`);
    return failureCount === 0 && successCount + skippedCount > 0;
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
    await checkAndDisableOverLimitUsers(db, userTrafficData, serverTrafficData);

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
