/**
 * 定时任务管理
 * 集中管理所有后台定时任务，方便维护、启动和统一清理。
 *
 * 任务配置表：
 * +------------------------+----------------+----------------+------------------+
 * | 任务名称               | 启动时执行     | 首次延迟       | 执行间隔         |
 * +------------------------+----------------+----------------+------------------+
 * | 标记过期订单           | 是             | 无             | 10 分钟          |
 * | 删除过期订单           | 是             | 5 分钟         | 1 小时           |
 * | 清理僵尸用户           | 是             | 2 分钟         | 30 分钟          |
 * | 3X-UI 用户同步         | 是             | 1 分钟         | 4 小时           |
 * | 3X-UI 同步重试队列     | 是             | 30 秒          | 1 分钟           |
 * | 流量同步               | 是             | 10 分钟        | 1 小时           |
 * | 工单自动关闭           | 是             | 3 分钟         | 1 小时           |
 * | 释放过期名额           | 否             | 无             | 每天 5:00        |
 * | 邮件群发               | 否             | 无             | 每天 9:00        |
 * | 清理邮件日志           | 否             | 无             | 每天 3:00        |
 * | 3X-UI 数据库备份       | 否             | 无             | 每天 4:00        |
 * +------------------------+----------------+----------------+------------------+
 *
 * 任务说明：
 * - 标记过期订单：将超过 30 分钟未支付的 pending 订单标记为 expired
 * - 删除过期订单：删除超过 1 小时的 expired 订单
 * - 清理僵尸用户：删除未支付且超过 30 分钟的用户（enabled=0, payment_count=0）
 * - 3X-UI 用户同步：确保所有已付费用户都在 3X-UI 节点中，并修复 sub_id、flow、流量上限等状态
 * - 3X-UI 同步重试队列：处理注册、续费、启用/禁用等同步失败后的补偿任务
 * - 流量同步：从 3X-UI 服务器同步用户流量数据到本地数据库
 * - 工单自动关闭：关闭用户已读后超过 24 小时无新回复的 pending 工单
 * - 释放过期名额：释放流量用完超过 3 天且未续费的用户名额
 * - 邮件群发：处理待发送的邮件群发任务，每日限额 200 封
 * - 清理邮件日志：清理超过 30 天的邮件发送日志
 * - 3X-UI 数据库备份：备份所有 3X-UI 服务器的 x-ui.db 到 server/backupDB
 */

const cron = require('node-cron');
const XuiService = require('../services/xui-service');
const trafficManager = require('../services/traffic-manager');
const orderService = require('../services/order-service');
const xuiSyncTaskService = require('../services/xui-sync-task-service');
const { processCampaigns, cleanLogs } = require('./email-campaign');
const { registerXuiDbBackupJob } = require('./backupDB');
const { createLogger } = require('../utils/logger');

const logger = createLogger('JOBS');

// 保存所有定时任务引用，便于统一清理
const intervals = [];
const cronTasks = [];

// 3X-UI 同步重试队列使用进程内锁，避免上一轮超时未结束时并发启动下一轮
let isXuiSyncTaskRunning = false;

/**
 * 注册标记过期订单任务
 * 启动时立即执行一次，之后每 10 分钟执行一次。
 * @param {Object} db - 数据库实例
 */
function registerMarkExpiredJob(db) {
  // 启动时立即执行一次
  runMarkExpired(db);

  const interval = setInterval(async () => {
    await runMarkExpired(db);
  }, 10 * 60 * 1000); // 每10分钟执行一次
  
  intervals.push(interval);
  logger.info('标记过期订单任务已注册（每10分钟执行一次）');
}

/**
 * 执行标记过期订单
 * 将超过 30 分钟未支付的 pending 订单标记为 expired。
 * @param {Object} db - 数据库实例
 */
async function runMarkExpired(db) {
  try {
    const expireTime = Math.floor(Date.now() / 1000) - 30 * 60; // 30分钟前
    
    const result = await db.prepare(`
      UPDATE orders SET status = 'expired'
      WHERE status = 'pending' AND created_at < ?
    `).run(expireTime);
    
    if (result.changes > 0) {
      logger.info(`标记 ${result.changes} 个超时订单为过期`);
    }
  } catch (error) {
    logger.error(`标记过期订单任务错误: ${error.message}`);
  }
}

/**
 * 注册删除过期订单任务
 * 启动后延迟 5 分钟执行第一次，之后每 1 小时执行一次。
 * @param {Object} db - 数据库实例
 */
function registerDeleteExpiredJob(db) {
  // 启动时延迟5分钟执行第一次
  setTimeout(async () => {
    await runDeleteExpired(db);
  }, 5 * 60 * 1000);

  const interval = setInterval(async () => {
    await runDeleteExpired(db);
  }, 60 * 60 * 1000); // 每1小时执行一次
  
  intervals.push(interval);
  logger.info('删除过期订单任务已注册（每1小时执行一次）');
}

/**
 * 执行删除过期订单
 * 删除超过 1 小时的 expired 订单。
 * @param {Object} db - 数据库实例
 */
async function runDeleteExpired(db) {
  try {
    const deleteTime = Math.floor(Date.now() / 1000) - 1 * 60 * 60; // 1小时前
    
    const result = await db.prepare(`
      DELETE FROM orders 
      WHERE status = 'expired' AND created_at < ?
    `).run(deleteTime);
    
    if (result.changes > 0) {
      logger.info(`删除 ${result.changes} 个过期订单`);
    }
  } catch (error) {
    logger.error(`删除过期订单任务错误: ${error.message}`);
  }
}

/**
 * 注册清理僵尸用户任务
 * 启动后延迟 2 分钟执行第一次，之后每 30 分钟执行一次。
 * @param {Object} db - 数据库实例
 */
function registerCleanZombieUsersJob(db) {
  // 启动时延迟2分钟执行第一次
  setTimeout(async () => {
    await runCleanZombieUsers(db);
  }, 2 * 60 * 1000);

  const interval = setInterval(async () => {
    await runCleanZombieUsers(db);
  }, 30 * 60 * 1000); // 每30分钟执行一次
  
  intervals.push(interval);
  logger.info('清理僵尸用户任务已注册（每30分钟执行一次）');
}

/**
 * 执行清理僵尸用户
 * 删除未支付且超过 30 分钟的用户（enabled=0, payment_count=0）。
 * @param {Object} db - 数据库实例
 */
async function runCleanZombieUsers(db) {
  try {
    const expireTime = Math.floor(Date.now() / 1000) - 30 * 60; // 30分钟前
    
    const result = await db.prepare(`
      DELETE FROM users 
      WHERE enabled = 0 
      AND payment_count = 0 
      AND created_at < ?
    `).run(expireTime);
    
    if (result.changes > 0) {
      logger.info(`清理 ${result.changes} 个僵尸用户`);
    }
  } catch (error) {
    logger.error(`清理僵尸用户任务错误: ${error.message}`);
  }
}

/**
 * 同步一台 3X-UI 服务器上的用户状态
 * 负责补添加缺失用户、修复 sub_id、补充 direct 节点 flow，并巡检补偿已存在用户的流量上限、到期时间和启用状态。
 * @param {Object} db - 数据库实例
 * @param {Object} server - 3X-UI 服务器配置
 * @param {Array} users - 需要巡检同步的用户列表
 */
async function syncUsersToServer(db, server, users) {
  try {
    const xuiService = await XuiService.getInstance(server.api_url, server.api_token);

    // 获取所有inbounds
    const inboundsResult = await xuiService.getInbounds();
    if (!inboundsResult.success) {
      logger.warn(`获取服务器 ${server.name} 的inbounds失败: ${inboundsResult.message}`);
      return;
    }

    let syncCount = 0;

    for (const inbound of inboundsResult.data) {
      // 获取当前inbound的客户端列表
      let existingClients = [];
      try {
        const settings = JSON.parse(inbound.settings || '{}');
        existingClients = settings.clients || [];
      } catch (e) {
        continue;
      }

      // 找出需要添加的用户（在数据库中存在但不在3xui中）
      const existingEmails = existingClients.map(c => c.email);
      const usersToAdd = users.filter(user => {
        const nodeEmail = `${user.email}-${inbound.remark || inbound.id}`;
        return !existingEmails.includes(nodeEmail);
      });

      // 添加缺失的用户
      for (const user of usersToAdd) {
        try {
          const expiryTime = user.expire_at ? user.expire_at * 1000 : 0;
          const totalGB = user.traffic_limit || 0;

          // 为每个节点生成唯一的邮箱标识（邮箱-节点备注）
          const nodeEmail = `${user.email}-${inbound.remark || inbound.id}`;

          // 检查是否已有配置
          const existingConfig = await db.prepare(
            'SELECT id, uuid, sub_id FROM user_node_configs WHERE user_id = ? AND server_id = ? AND inbound_id = ?'
          ).get(user.id, server.id, inbound.id);

          let configUuid, configSubId;

          if (existingConfig) {
            // 使用数据库中的配置
            configUuid = existingConfig.uuid;
            configSubId = existingConfig.sub_id;
          } else {
            // 生成新的配置
            const crypto = require('crypto');
            configUuid = crypto.randomUUID();
            configSubId = crypto.randomBytes(8).toString('hex');
            await db.prepare(
              'INSERT INTO user_node_configs (user_id, server_id, inbound_id, uuid, sub_id) VALUES (?, ?, ?, ?, ?)'
            ).run(user.id, server.id, inbound.id, configUuid, configSubId);
            logger.info(`保存用户节点配置: user=${user.email}, server=${server.id}, inbound=${inbound.id}, uuid=${configUuid}, sub_id=${configSubId}`);
          }

          const addOpts = {
            email: nodeEmail,
            id: configUuid,
            enable: user.enabled === 1,
            expiryTime: expiryTime,
            totalGB: totalGB,
            limitIp: 0,
            tgId: 0,
            subId: configSubId
          };
          // direct 节点需要 flow 参数
          if (inbound.remark && inbound.remark.toLowerCase().includes('direct')) {
            addOpts.flow = 'xtls-rprx-vision';
          }
          const result = await xuiService.addClient(inbound.id, inbound.protocol, addOpts);

          if (result.success) {
            syncCount++;
            logger.info(`同步用户 ${user.email} 到服务器 ${server.name} 的inbound ${inbound.id} 成功`);
          } else if (result.message && result.message.includes('Duplicate email')) {
            // 邮箱已存在（可能在其他 inbound 中），跳过
            logger.info(`用户 ${user.email} 已存在于 3X-UI，跳过`);
          }
        } catch (error) {
          logger.error(`同步用户 ${user.email} 到inbound ${inbound.id} 失败: ${error.message}`);
        }
      }
    }

    // 检查已存在用户的 sub_id 是否一致
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
          logger.info(`用户 ${user.email} 不在 inbound ${inbound.id} 中 (期望 email: ${nodeEmail})`);
          continue;
        }

        logger.info(`找到用户: ${nodeEmail}, xuiClient.subId=${xuiClient.subId || '空'}, xuiClient.flow=${xuiClient.flow || '空'}`);

        // 获取数据库中的配置
        const dbConfig = await db.prepare(
          'SELECT uuid, sub_id FROM user_node_configs WHERE user_id = ? AND server_id = ? AND inbound_id = ?'
        ).get(user.id, server.id, inbound.id);

        if (!dbConfig) {
          // 数据库中没有配置，创建一个
          const crypto = require('crypto');
          const newSubId = crypto.randomBytes(8).toString('hex');
          await db.prepare(
            'INSERT INTO user_node_configs (user_id, server_id, inbound_id, uuid, sub_id) VALUES (?, ?, ?, ?, ?)'
          ).run(user.id, server.id, inbound.id, xuiClient.id, newSubId);
          logger.info(`为已存在用户创建配置: user=${user.email}, server=${server.id}, inbound=${inbound.id}, uuid=${xuiClient.id}, sub_id=${newSubId}`);

          // 更新 3X-UI 中的 sub_id
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

        // 检查 sub_id 是否一致
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

        // direct 节点检查 flow 是否需要补充
        if (inbound.remark && inbound.remark.toLowerCase().includes('direct') && !xuiClient.flow) {
          logger.info(`direct 节点缺少 flow，补充: user=${user.email}, inbound=${inbound.id}`);
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

        // 巡检补偿：已存在用户也要对齐流量上限、到期时间和启用状态
        const expectedTotalGB = Number(user.traffic_limit || 0);
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
 * 注册 3X-UI 用户同步任务
 * 启动后延迟 1 分钟执行第一次，之后每 4 小时执行一次。
 * @param {Object} db - 数据库实例
 */
async function syncUsersToServer(db, server, users) {
  try {
    const crypto = require('crypto');
    const xuiService = await XuiService.getInstance(server.api_url, server.api_token);
    const inboundsResult = await xuiService.getInbounds();
    if (!inboundsResult.success) {
      logger.warn(`获取服务器 ${server.name} 的inbounds失败: ${inboundsResult.message}`);
      return;
    }

    let syncCount = 0;

    for (const inbound of inboundsResult.data) {
      for (const user of users) {
        try {
          const nodeEmail = `${user.email}-${inbound.remark || inbound.id}`;
          const expiryTime = user.expire_at ? Number(user.expire_at) * 1000 : 0;
          const totalBytes = Number(user.traffic_limit || 0);
          const existingConfig = await db.prepare(
            'SELECT uuid, sub_id FROM user_node_configs WHERE user_id = ? AND server_id = ? AND inbound_id = ?'
          ).get(user.id, server.id, inbound.id);

          const desiredClient = {
            id: existingConfig?.uuid || crypto.randomUUID(),
            email: nodeEmail,
            enable: user.enabled === 1,
            expiryTime,
            totalGB: totalBytes,
            subId: existingConfig?.sub_id || crypto.randomBytes(8).toString('hex')
          };

          if (inbound.remark && inbound.remark.toLowerCase().includes('direct')) {
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
            syncCount++;
            logger.info(`同步用户 ${user.email} 到服务器 ${server.name} 的inbound ${inbound.id} 成功: action=${syncResult.action}`);
          } else {
            logger.warn(`同步用户 ${user.email} 到服务器 ${server.name} 的inbound ${inbound.id} 失败: ${syncResult.message}`);
          }
        } catch (error) {
          logger.error(`同步用户 ${user.email} 到inbound ${inbound.id} 失败: ${error.message}`);
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

function registerXuiSyncJob(db) {
  // 启动时延迟1分钟执行第一次
  setTimeout(async () => {
    await runXuiSync(db);
  }, 1 * 60 * 1000);

  const interval = setInterval(async () => {
    await runXuiSync(db);
  }, 4 * 60 * 60 * 1000); // 每4小时执行一次
  
  intervals.push(interval);
  logger.info('3X-UI用户同步任务已注册（每4小时执行一次）');
}

/**
 * 注册 3X-UI 同步重试队列 worker
 * 首次延迟 30 秒执行，之后每 1 分钟处理一次到期 pending 任务；具体重试间隔由 xui_sync_tasks.next_retry_at 控制。
 * @param {Object} db - 数据库实例
 */
function registerXuiSyncTaskJob(db) {
  setTimeout(async () => {
    await runXuiSyncTasks(db);
  }, 30 * 1000);

  const interval = setInterval(async () => {
    await runXuiSyncTasks(db);
  }, 60 * 1000);
  intervals.push(interval);
  logger.info('3X-UI 同步重试队列 worker 已注册（每 1 分钟执行一次）');
}

/**
 * 注册流量同步任务
 * 启动后延迟 10 分钟执行第一次，之后每 1 小时执行一次。
 * @param {Object} db - 数据库实例
 */
function registerTrafficSyncJob(db) {
  // 启动时延迟10分钟执行第一次，避免启动时负载过高
  setTimeout(async () => {
    await trafficManager.syncTrafficAndHandleDisable(db);
  }, 10 * 60 * 1000);

  const interval = setInterval(async () => {
    await trafficManager.syncTrafficAndHandleDisable(db);
  }, 60 * 60 * 1000); // 每1小时执行一次
  
  intervals.push(interval);
  logger.info('流量同步任务已注册（每1小时执行一次）');
}

/**
 * 获取队列任务执行时的最新用户同步快照
 *
 * 队列 payload 是创建任务时的快照，续费后可能已经过期。
 * 真实执行前必须重新读取 users 表，避免旧任务把新流量上限覆盖回旧值。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} task - 同步任务
 * @param {Object} payload - 任务 payload
 * @returns {Promise<Object|null>} 最新用户信息
 */
async function getLatestUserForSyncTask(db, task, payload) {
  const userId = task.user_id || payload.user?.id;
  if (!userId) return null;

  const user = await db.prepare(`
    SELECT id, email, subscription_token, enabled, traffic_limit, expire_at
    FROM users
    WHERE id = ?
  `).get(userId);

  if (!user) {
    return null;
  }

  const payloadUser = payload.user || {};
  if (
    Number(payloadUser.traffic_limit || 0) !== Number(user.traffic_limit || 0) ||
    Number(payloadUser.expire_at || 0) !== Number(user.expire_at || 0)
  ) {
    logger.info(`3X-UI 同步队列任务使用最新用户状态: task=${task.id}, user=${user.email}, traffic_limit=${payloadUser.traffic_limit || 0}->${user.traffic_limit || 0}, expire_at=${payloadUser.expire_at || 0}->${user.expire_at || 0}`);
  }

  return user;
}

/**
 * 执行 3X-UI 同步重试队列
 * 根据任务类型分发到用户同步或启用/禁用同步逻辑；handler 返回 success=false 时，队列服务会自动安排下一次重试。
 * @param {Object} db - 数据库实例
 */
async function runXuiSyncTasks(db) {
  if (isXuiSyncTaskRunning) {
    logger.info('3X-UI 同步重试队列上一轮仍在执行，本轮跳过');
    return;
  }

  isXuiSyncTaskRunning = true;
  const startTime = Date.now();
  let result = { processed: 0, success: 0, failed: 0, finalFailed: 0 };
  let hasExecutableTasks = false;
  let status = 'failed';

  try {
    result = await xuiSyncTaskService.processDueTasks(db, async task => {
      const payload = task.payload_data || {};

      if (
        task.task_type === xuiSyncTaskService.TASK_TYPES.INITIAL_USER_SYNC ||
        task.task_type === xuiSyncTaskService.TASK_TYPES.RENEW_SYNC ||
        task.task_type === xuiSyncTaskService.TASK_TYPES.USER_SYNC
      ) {
        const currentUser = await getLatestUserForSyncTask(db, task, payload);
        if (!currentUser) {
          logger.warn(`3X-UI 同步队列任务对应用户不存在，跳过任务: task=${task.id}, user=${task.user_id || payload.user?.id || 'unknown'}`);
          return { success: true, message: '用户不存在，任务已跳过' };
        }
        return orderService.syncUserToXuiServers(db, currentUser, payload.plan || {});
      }

      if (task.task_type === xuiSyncTaskService.TASK_TYPES.ENABLE_SYNC) {
        const ok = await trafficManager.syncDisableStatusToXui(db, task.user_id, false);
        return { success: ok, message: ok ? 'ok' : '同步启用状态失败' };
      }

      if (task.task_type === xuiSyncTaskService.TASK_TYPES.DISABLE_SYNC) {
        const ok = await trafficManager.syncDisableStatusToXui(db, task.user_id, true);
        return { success: ok, message: ok ? 'ok' : '同步禁用状态失败' };
      }

      return { success: false, message: `未知任务类型: ${task.task_type}` };
    }, {
      onStart: tasks => {
        hasExecutableTasks = true;
        logger.info(`开始执行 3X-UI 同步重试队列任务: count=${tasks.length}`);
      }
    });

    status = 'success';
  } catch (error) {
    logger.error(`3X-UI 同步重试队列执行错误: ${error.message}`);
  } finally {
    const duration = Date.now() - startTime;
    if (hasExecutableTasks || result.processed > 0) {
      logger.info(`3X-UI 同步重试队列任务执行结束: status=${status}, processed=${result.processed}, success=${result.success}, failed=${result.failed}, finalFailed=${result.finalFailed}, duration=${duration}ms`);
    }
    isXuiSyncTaskRunning = false;
  }
}

/**
 * 执行 3X-UI 用户同步巡检
 * 查询所有启用且未过期用户，并逐台在线服务器执行同步补偿。
 * @param {Object} db - 数据库实例
 */
async function runXuiSync(db) {
  try {
    logger.info('开始执行3X-UI用户同步任务...');

    // 查询所有已启用且未过期的用户（expire_at为0或'0'表示无限期）
    const now = Math.floor(Date.now() / 1000);
    const users = await db.prepare(`
      SELECT id, email, subscription_token, enabled, traffic_limit, expire_at
      FROM users
      WHERE enabled = 1 AND (expire_at = 0 OR expire_at = '0' OR expire_at IS NULL OR expire_at > ?)
    `).all(now);

    if (users.length === 0) {
      logger.info('没有需要同步的用户');
      return;
    }

    logger.info(`需要同步的用户数量: ${users.length}`);

    // 查询所有在线服务器
    const servers = await db.prepare(`
      SELECT id, name, api_url, api_token
      FROM xui_servers
      WHERE status = 1
    `).all();

    if (servers.length === 0) {
      logger.info('没有在线的3X-UI服务器');
      return;
    }

    logger.info(`在线服务器数量: ${servers.length}`);

    // 对每个服务器执行同步
    for (const server of servers) {
      await syncUsersToServer(db, server, users);
    }

    logger.info('3X-UI用户同步任务完成');
  } catch (error) {
    logger.error(`3X-UI用户同步任务错误: ${error.message}`);
  }
}

/**
 * 注册工单自动关闭任务
 * 启动后延迟 3 分钟执行第一次，之后每 1 小时执行一次。
 * @param {Object} db - 数据库实例
 */
function registerTicketAutoCloseJob(db) {
  // 启动时延迟3分钟执行第一次
  setTimeout(async () => {
    await runTicketAutoClose(db);
  }, 3 * 60 * 1000);

  const interval = setInterval(async () => {
    await runTicketAutoClose(db);
  }, 60 * 60 * 1000); // 每1小时执行一次
  
  intervals.push(interval);
  logger.info('工单自动关闭任务已注册（每1小时执行一次）');
}

/**
 * 执行工单自动关闭
 * 关闭管理员已回复、用户已读且超过 24 小时无新回复的 pending 工单。
 * @param {Object} db - 数据库实例
 */
async function runTicketAutoClose(db) {
  try {
    const result = await db.prepare(`
      UPDATE tickets 
      SET status = 'closed', closed_at = EXTRACT(EPOCH FROM NOW()), updated_at = EXTRACT(EPOCH FROM NOW())
      WHERE status = 'pending' 
        AND last_read_at IS NOT NULL 
        AND last_read_at < EXTRACT(EPOCH FROM NOW()) - 86400
        AND last_reply_at <= last_read_at
    `).run();
    
    if (result.changes > 0) {
      logger.info(`自动关闭 ${result.changes} 个超时工单`);
    }
  } catch (error) {
    logger.error(`工单自动关闭任务错误: ${error.message}`);
  }
}

/**
 * 注册释放过期名额任务
 * 每天 5:00 执行，释放流量用完超过 3 天且未续费的用户名额。
 * @param {Object} db - 数据库实例
 */
function registerReleaseExpiredSalesJob(db) {
  const task = cron.schedule('0 5 * * *', async () => {
    logger.info('开始执行释放过期名额任务...');
    await runReleaseExpiredSales(db);
  });
  cronTasks.push(task);
  logger.info('释放过期名额任务已注册（每天5:00执行）');
}

/**
 * 执行释放过期名额
 * 按套餐统计符合条件的用户，并回退对应套餐的 sales_count。
 * @param {Object} db - 数据库实例
 */
async function runReleaseExpiredSales(db) {
  try {
    const now = Math.floor(Date.now() / 1000);
    
    // 查找需要释放名额的用户
    // 条件：被禁用、付过款、流量用完超过3天、未续费
    // 说明：从未付款的用户不会增加 sales_count，所以不需要释放
    const expiredUsers = await db.prepare(`
      SELECT u.id, u.email, u.plan_id, u.traffic_used_at, u.payment_count,
             p.name as plan_name, p.sales_count, p.sales_limit
      FROM users u
      JOIN plans p ON u.plan_id = p.id
      WHERE u.plan_id IS NOT NULL
        AND u.enabled = 0
        AND u.traffic_used_at IS NOT NULL
        AND u.traffic_used_at < ? - 259200
        AND u.payment_count > 0
        AND NOT EXISTS (
          SELECT 1 FROM orders o 
          WHERE o.user_id = u.id 
            AND o.status = 'paid'
            AND o.created_at > u.traffic_used_at
        )
    `).all(now);

    if (expiredUsers.length === 0) {
      return;
    }

    logger.info(`发现 ${expiredUsers.length} 个用户需要释放名额`);

    // 按套餐分组统计
    const planGroups = {};
    for (const user of expiredUsers) {
      logger.info(`待释放用户: ${user.email}, 套餐: ${user.plan_name}, 付款次数: ${user.payment_count}, 流量用完: ${new Date(user.traffic_used_at * 1000).toLocaleString()}, 当前已售: ${user.sales_count}/${user.sales_limit === -1 ? '不限' : user.sales_limit}`);
      
      if (!planGroups[user.plan_id]) {
        planGroups[user.plan_id] = {
          plan_name: user.plan_name,
          count: 0,
          current_sales: user.sales_count,
          sales_limit: user.sales_limit
        };
      }
      planGroups[user.plan_id].count++;
    }

    let releasedCount = 0;

    for (const [planId, group] of Object.entries(planGroups)) {
      const result = await db.prepare(`
        UPDATE plans 
        SET sales_count = GREATEST(0, sales_count - ?)
        WHERE id = ?
      `).run(group.count, planId);
      
      if (result.changes > 0) {
        releasedCount += group.count;
        logger.info(`释放套餐 ${group.plan_name} 名额 ${group.count} 个，已售: ${group.current_sales} -> ${group.current_sales - group.count}`);
      }
    }

    if (releasedCount > 0) {
      logger.info(`释放过期名额完成，共释放 ${releasedCount} 个名额`);
    }
  } catch (error) {
    logger.error(`释放过期名额任务错误: ${error.message}`);
  }
}

/**
 * 注册邮件群发任务
 * 每天 9:00 处理待发送的邮件群发任务。
 */
function registerEmailCampaignJob(db) {
  const task = cron.schedule('0 9 * * *', async () => {
    logger.info('处理邮件群发任务')
    await processCampaigns(db)
  })
  cronTasks.push(task)
  logger.info('邮件群发任务已注册（每天 9:00 执行）');
}

/**
 * 注册清理邮件日志任务
 * 每天 3:00 清理超过 30 天的邮件发送日志。
 */
function registerCleanEmailLogsJob(db) {
  const task = cron.schedule('0 3 * * *', async () => {
    logger.info('清理邮件日志')
    await cleanLogs(db, 30)
  })
  cronTasks.push(task)
  logger.info('清理邮件日志任务已注册（每天 3:00 执行）');
}

/**
 * 启动所有定时任务
 * @param {Object} db - 数据库实例
 */
function startAllJobs(db) {
  logger.info('正在启动所有定时任务...');
  registerMarkExpiredJob(db);
  registerDeleteExpiredJob(db);
  registerCleanZombieUsersJob(db);
  registerXuiSyncJob(db);
  registerXuiSyncTaskJob(db);
  registerTrafficSyncJob(db);
  registerTicketAutoCloseJob(db);
  registerReleaseExpiredSalesJob(db);
  registerEmailCampaignJob(db);
  registerCleanEmailLogsJob(db);
  registerXuiDbBackupJob(db, cronTasks);
  logger.info(`所有定时任务已启动，共 ${intervals.length} 个间隔任务，${cronTasks.length} 个定时任务`);
}

/**
 * 停止所有定时任务
 * 清理 setInterval 和 cron task 引用，供应用退出时调用。
 */
function stopAllJobs() {
  logger.info('正在停止所有定时任务...');
  intervals.forEach(interval => clearInterval(interval));
  intervals.length = 0;
  cronTasks.forEach(task => task.stop());
  cronTasks.length = 0;
  logger.info('所有定时任务已停止');
}

module.exports = {
  startAllJobs,
  stopAllJobs
};
