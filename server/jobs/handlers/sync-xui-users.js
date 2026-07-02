/**
 * 3X-UI 用户同步任务
 * 负责注册并执行用户节点状态巡检与补偿同步逻辑。
 */

const XuiService = require('../../integrations/xui/xui-service');
const xuiSyncRepository = require('../../repositories/xui-sync-repository');
const xuiNodeSnapshotService = require('../../services/shared/xui-node-snapshot-service');
const { createLogger } = require('../../utils/logger');
const { isValidXuiAuth, generateXuiAuth } = require('../../utils/xui-auth');
const xuiJobScheduler = require('../xui-job-scheduler');

const logger = createLogger('JOBS');

/**
 * 统一计算巡检补偿同步时写回 3X-UI 的总流量上限。
 *
 * @param {Object} user - 用户快照，需包含 traffic_limit
 * @returns {number} 总流量字节数
 */
function getXuiTotalTrafficLimit(user) {
  return Number(user?.traffic_limit) || 0;
}

/**
 * 从 3X-UI inbound 快照中解析客户端列表。
 *
 * @param {Object} inbound - 3X-UI inbound 原始对象
 * @returns {Array<Object>|null} 客户端快照；null 表示 settings 解析失败，应跳过该 inbound
 */
function parseInboundClientsSnapshot(inbound) {
  if (!inbound || !inbound.settings) {
    return [];
  }

  if (typeof inbound.settings === 'string') {
    try {
      const settings = JSON.parse(inbound.settings || '{}');
      return Array.isArray(settings.clients) ? settings.clients : [];
    } catch (error) {
      return null;
    }
  }

  if (typeof inbound.settings === 'object') {
    return Array.isArray(inbound.settings.clients) ? inbound.settings.clients : [];
  }

  return [];
}

/**
 * 同步一台 3X-UI 服务器上的用户状态
 * 历史实现保留，仅用于对照旧巡检逻辑。
 * @param {Object} db - 数据库实例
 * @param {Object} server - 3X-UI 服务器配置
 * @param {Array} users - 需要巡检同步的用户列表
 */
async function legacySyncUsersToServer(db, server, users) {
  try {
    const xuiService = await XuiService.getInstance(server.api_url, server.api_token, {
      apiVersion: server.panel_version || '3.0.2'
    });
    const inboundsResult = await xuiService.getInbounds();

    if (!inboundsResult.success) {
      logger.warn(`获取服务器 ${server.name} 的 inbounds 失败: ${inboundsResult.message}`);
      return;
    }

    let syncCount = 0;

    for (const inbound of inboundsResult.data) {
      let existingClients = [];
      try {
        const settings = JSON.parse(inbound.settings || '{}');
        existingClients = settings.clients || [];
      } catch (e) {
        continue;
      }

      const existingEmails = existingClients.map(client => client.email);
      const usersToAdd = users.filter(user => {
        const nodeEmail = `${user.email}-${inbound.remark || inbound.id}`;
        return !existingEmails.includes(nodeEmail);
      });

      for (const user of usersToAdd) {
        try {
          const expiryTime = user.expire_at ? user.expire_at * 1000 : 0;
          const totalGB = getXuiTotalTrafficLimit(user);
          const nodeEmail = `${user.email}-${inbound.remark || inbound.id}`;
          const existingConfig = await xuiSyncRepository.findUserNodeConfig(
            db,
            user.id,
            server.id,
            inbound.id
          );

          let configUuid;
          let configSubId;

          if (existingConfig) {
            configUuid = existingConfig.uuid;
            configSubId = existingConfig.sub_id;
          } else {
            const crypto = require('crypto');
            configUuid = crypto.randomUUID();
            configSubId = crypto.randomBytes(8).toString('hex');
            await xuiSyncRepository.saveUserNodeConfig(db, {
              userId: user.id,
              serverId: server.id,
              inboundId: inbound.id,
              uuid: configUuid,
              auth: '',
              subId: configSubId
            });
            logger.info(`保存用户节点配置: user=${user.email}, server=${server.id}, inbound=${inbound.id}, uuid=${configUuid}, sub_id=${configSubId}`);
          }

          const addOpts = {
            email: nodeEmail,
            id: configUuid,
            enable: user.enabled === 1,
            expiryTime,
            totalGB,
            limitIp: 0,
            tgId: 0,
            subId: configSubId
          };

          if (inbound.remark && inbound.remark.toLowerCase().includes('direct')) {
            addOpts.flow = 'xtls-rprx-vision';
          }

          const result = await xuiService.addClient(inbound.id, inbound.protocol, addOpts);

          if (result.success) {
            syncCount++;
            logger.info(`同步用户 ${user.email} 到服务器 ${server.name} 的 inbound ${inbound.id} 成功`);
          } else if (result.message && result.message.includes('Duplicate email')) {
            logger.info(`用户 ${user.email} 已存在于 3X-UI，跳过`);
          }
        } catch (error) {
          logger.error(`同步用户 ${user.email} 到 inbound ${inbound.id} 失败: ${error.message}`);
        }
      }
    }

    for (const inbound of inboundsResult.data) {
      let existingClients = [];
      try {
        const settings = JSON.parse(inbound.settings || '{}');
        existingClients = settings.clients || [];
      } catch (e) {
        continue;
      }

      logger.info(`检查 inbound ${inbound.id} (${inbound.remark}): ${existingClients.length} 个客户端`);

      const existingClientsMap = {};
      for (const client of existingClients) {
        existingClientsMap[client.email] = client;
      }

      for (const user of users) {
        const nodeEmail = `${user.email}-${inbound.remark || inbound.id}`;
        const xuiClient = existingClientsMap[nodeEmail];

        if (!xuiClient) {
          logger.info(`用户 ${user.email} 不在 inbound ${inbound.id} 中(期望 email: ${nodeEmail})`);
          continue;
        }

        logger.info(`找到用户: ${nodeEmail}, xuiClient.subId=${xuiClient.subId || '空'}, xuiClient.flow=${xuiClient.flow || '空'}`);

        const dbConfig = await xuiSyncRepository.findUserNodeConfig(
          db,
          user.id,
          server.id,
          inbound.id
        );

        if (!dbConfig) {
          const crypto = require('crypto');
          const newSubId = crypto.randomBytes(8).toString('hex');
          await xuiSyncRepository.saveUserNodeConfig(db, {
            userId: user.id,
            serverId: server.id,
            inboundId: inbound.id,
            uuid: xuiClient.id,
            auth: '',
            subId: newSubId
          });
          logger.info(`为已存在用户创建配置: user=${user.email}, server=${server.id}, inbound=${inbound.id}, uuid=${xuiClient.id}, sub_id=${newSubId}`);

          const updateOpts = { subId: newSubId };
          if (inbound.remark && inbound.remark.toLowerCase().includes('direct')) {
            updateOpts.flow = 'xtls-rprx-vision';
          }

          logger.info(`更新 3X-UI: user=${user.email}, inbound=${inbound.id}, remark=${inbound.remark}, updateOpts=${JSON.stringify(updateOpts)}`);
          const updateResult = await xuiService.updateClient(inbound.id, nodeEmail, updateOpts);
          if (updateResult.success) {
            logger.info(`更新 3X-UI sub_id 成功: user=${user.email}, inbound=${inbound.id}, sub_id=${newSubId}`);
          } else {
            logger.warn(`更新 3X-UI sub_id 失败: user=${user.email}, inbound=${inbound.id}, error=${updateResult.message}`);
          }
          continue;
        }

        if (xuiClient.subId !== dbConfig.sub_id) {
          logger.info(`sub_id 不一致，更新 3X-UI: user=${user.email}, inbound=${inbound.id}, db=${dbConfig.sub_id}, xui=${xuiClient.subId || '空'}`);
          const updateOpts = { subId: dbConfig.sub_id };
          if (inbound.remark && inbound.remark.toLowerCase().includes('direct')) {
            updateOpts.flow = 'xtls-rprx-vision';
          }

          logger.info(`更新 3X-UI: user=${user.email}, inbound=${inbound.id}, remark=${inbound.remark}, updateOpts=${JSON.stringify(updateOpts)}`);
          const updateResult = await xuiService.updateClient(inbound.id, nodeEmail, updateOpts);
          if (updateResult.success) {
            logger.info(`更新 sub_id 成功: user=${user.email}, inbound=${inbound.id}, sub_id=${dbConfig.sub_id}`);
          } else {
            logger.warn(`更新 sub_id 失败: user=${user.email}, inbound=${inbound.id}, error=${updateResult.message}`);
          }
        }

        if (inbound.remark && inbound.remark.toLowerCase().includes('direct') && !xuiClient.flow) {
          logger.info(`direct 节点缺少 flow，补齐: user=${user.email}, inbound=${inbound.id}`);
          const updateResult = await xuiService.updateClient(inbound.id, nodeEmail, {
            subId: dbConfig.sub_id,
            flow: 'xtls-rprx-vision'
          });
          if (updateResult.success) {
            logger.info(`补充 flow 成功: user=${user.email}, inbound=${inbound.id}`);
          } else {
            logger.warn(`补充 flow 失败: user=${user.email}, inbound=${inbound.id}, error=${updateResult.message}`);
          }
        }

        const expectedTotalGB = getXuiTotalTrafficLimit(user);
        const actualTotalGB = Number(xuiClient.totalGB || 0);
        const expectedExpiryTime = user.expire_at ? Number(user.expire_at) * 1000 : 0;
        const actualExpiryTime = Number(xuiClient.expiryTime || 0);
        const expectedEnabled = user.enabled === 1;
        const actualEnabled = xuiClient.enable !== false;

        if (
          actualTotalGB !== expectedTotalGB ||
          actualExpiryTime !== expectedExpiryTime ||
          actualEnabled !== expectedEnabled
        ) {
          const updateOpts = {
            subId: dbConfig.sub_id,
            totalGB: expectedTotalGB / (1024 * 1024 * 1024),
            expiryTime: expectedExpiryTime,
            enabled: expectedEnabled
          };

          if (inbound.remark && inbound.remark.toLowerCase().includes('direct')) {
            updateOpts.flow = xuiClient.flow || 'xtls-rprx-vision';
          }

          logger.info(`3X-UI 用户状态不一致，补同步: user=${user.email}, inbound=${inbound.id}, totalGB=${actualTotalGB}->${expectedTotalGB}, expiryTime=${actualExpiryTime}->${expectedExpiryTime}, enabled=${actualEnabled}->${expectedEnabled}`);
          const updateResult = await xuiService.updateClient(inbound.id, nodeEmail, updateOpts);
          if (updateResult.success) {
            logger.info(`补同步用户状态成功: user=${user.email}, inbound=${inbound.id}`);
          } else {
            logger.warn(`补同步用户状态失败: user=${user.email}, inbound=${inbound.id}, error=${updateResult.message}`);
          }
        }
      }
    }

    if (syncCount > 0) {
      logger.info(`服务器 ${server.name} 同步完成，新增 ${syncCount} 个用户`);
    }
  } catch (error) {
    logger.error(`同步服务器 ${server.name} 错误: ${error.message}`);
  }
}

/**
 * 同步一台 3X-UI 服务器上的用户状态
 * 负责按节点策略补齐唯一用户配置和订阅相关字段。
 * @param {Object} db - 数据库实例
 * @param {Object} server - 3X-UI 服务器配置
 * @param {Array} users - 需要巡检同步的用户列表
 */
async function syncUsersToServer(db, server, users) {
  try {
    const crypto = require('crypto');
    const xuiService = await XuiService.getInstance(server.api_url, server.api_token, {
      apiVersion: server.panel_version || '3.0.2'
    });
    const inboundsResult = await xuiService.getInbounds();

    if (!inboundsResult.success) {
      logger.warn(`获取服务器 ${server.name} 的 inbounds 失败: ${inboundsResult.message}`);
      return;
    }

    const refreshResult = await xuiNodeSnapshotService.refreshServerNodeSnapshots(
      db,
      server.id,
      inboundsResult.data
    );
    logger.info(`服务器 ${server.name} 节点快照已刷新: ${refreshResult.nodeCount} 个节点`);

    let syncCount = 0;

    for (const inbound of inboundsResult.data) {
      const existingClientsSnapshot = parseInboundClientsSnapshot(inbound);
      if (existingClientsSnapshot === null) {
        logger.warn(`服务器 ${server.name} inbound ${inbound.id} 的 settings 解析失败，跳过该 inbound 本轮用户同步`);
        continue;
      }

      for (const user of users) {
        try {
          const nodeEmail = `${user.email}-${inbound.remark || inbound.id}`;
          const expiryTime = user.expire_at ? Number(user.expire_at) * 1000 : 0;
          const totalBytes = getXuiTotalTrafficLimit(user);
          const strategy = inbound.remark && inbound.remark.toLowerCase().includes('hy2')
            ? 'hy2'
            : (inbound.remark && inbound.remark.toLowerCase().includes('direct') ? 'direct' : 'cf');
          const existingConfig = await xuiSyncRepository.findUserNodeConfig(
            db,
            user.id,
            server.id,
            inbound.id
          );

          const generatedAuth = strategy === 'hy2'
            ? generateXuiAuth()
            : '';
          const desiredAuth = strategy === 'hy2'
            ? (isValidXuiAuth(existingConfig?.auth) ? existingConfig.auth : generatedAuth)
            : '';

          if (strategy === 'hy2' && existingConfig?.auth && !isValidXuiAuth(existingConfig.auth)) {
            logger.info(`检测到非法 hy2 auth，准备重新生成: user=${user.email}, server=${server.id}, inbound=${inbound.id}`);
          }

          const desiredClient = {
            id: existingConfig?.uuid || (strategy === 'hy2' ? '' : crypto.randomUUID()),
            auth: desiredAuth,
            email: nodeEmail,
            enable: user.enabled === 1,
            expiryTime,
            totalGB: totalBytes,
            subId: existingConfig?.sub_id || crypto.randomBytes(8).toString('hex'),
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
            existingClientsSnapshot,
            desiredClient
          });

          if (syncResult.success) {
            syncCount++;
            logger.info(`同步用户 ${user.email} 到服务器 ${server.name} 的 inbound ${inbound.id} 成功: action=${syncResult.action}`);
          } else {
            logger.warn(`同步用户 ${user.email} 到服务器 ${server.name} 的 inbound ${inbound.id} 失败: ${syncResult.message}`);
          }
        } catch (error) {
          logger.error(`同步用户 ${user.email} 到 inbound ${inbound.id} 失败: ${error.message}`);
        }
      }
    }

    if (syncCount > 0) {
      logger.info(`服务器 ${server.name} 同步完成，成功 ${syncCount} 个用户`);
    }
  } catch (error) {
    logger.error(`同步服务器 ${server.name} 错误: ${error.message}`);
  }
}

/**
 * 注册 3X-UI 用户同步任务
 * 启动后延迟 1 分钟执行第一次，之后每 4 小时执行一次。
 * @param {Object} context - 任务上下文
 * @param {Object} context.db - 数据库实例
 * @param {Array} context.intervals - 间隔任务引用集合
 * @param {Function} context.registerTimeout - 延迟任务注册函数
 */
function registerXuiSyncJob({ db, intervals, registerTimeout }) {
  registerTimeout(() => {
    scheduleXuiUserSync(db);
  }, 1 * 60 * 1000);

  const interval = setInterval(() => {
    scheduleXuiUserSync(db);
  }, 4 * 60 * 60 * 1000);

  intervals.push(interval);
  logger.info('3X-UI用户同步任务已注册（每4小时执行一次）');
}

/**
 * 将 3X-UI 用户同步提交到统一调度器。
 * 同名任务运行中或排队时由调度器合并，避免并发访问 3X-UI。
 *
 * @param {Object} db - 数据库实例
 * @returns {void}
 */
function scheduleXuiUserSync(db) {
  xuiJobScheduler.schedule('xui-user-sync', async () => {
    await runXuiSync(db);
  });
}

/**
 * 执行 3X-UI 用户同步巡检
 * 查询所有启用且未过期用户，并逐台在线服务器执行同步补偿。
 * @param {Object} db - 数据库实例
 */
async function runXuiSync(db) {
  try {
    logger.info('开始执行3X-UI用户同步任务...');

    const now = Math.floor(Date.now() / 1000);
    const users = await xuiSyncRepository.listUsersForXuiSync(db, now);

    if (users.length === 0) {
      logger.info('没有需要同步的用户');
      return;
    }

    logger.info(`需要同步的用户数量: ${users.length}`);

    const servers = await xuiSyncRepository.listOnlineXuiServers(db);

    if (servers.length === 0) {
      logger.info('没有在线的3X-UI服务器');
      return;
    }

    logger.info(`在线服务器数量: ${servers.length}`);

    for (const server of servers) {
      await syncUsersToServer(db, server, users);
    }

    logger.info('3X-UI用户同步任务完成');
  } catch (error) {
    logger.error(`3X-UI用户同步任务错误: ${error.message}`);
  }
}

module.exports = {
  registerXuiSyncJob
};
