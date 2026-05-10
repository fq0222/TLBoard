/**
 * 定时任务管理
 * 集中管理所有定时任务，方便维护
 * 
 * 任务配置表：
 * +------------------------+----------------+----------------+------------------+
 * | 任务名称               | 启动时执行     | 首次延迟       | 执行间隔         |
 * +------------------------+----------------+----------------+------------------+
 * | 标记过期订单           | 是             | 无             | 10 分钟          |
 * | 删除过期订单           | 是             | 5 分钟         | 1 小时           |
 * | 清理僵尸用户           | 是             | 2 分钟         | 30 分钟          |
 * | 3X-UI 用户同步         | 是             | 7 分钟         | 4 小时           |
 * | 流量同步               | 是             | 10 分钟        | 1 小时           |
 * | 工单自动关闭           | 是             | 3 分钟         | 1 小时           |
 * | 释放过期名额           | 否             | 15 分钟        | 1 小时           |
 * +------------------------+----------------+----------------+------------------+
 * 
 * 任务说明：
 * - 标记过期订单：将超过 30 分钟未支付的 pending 订单标记为 expired
 * - 删除过期订单：删除超过 1 小时的 expired 订单
 * - 清理僵尸用户：删除未支付且超过 30 分钟的用户（enabled=0, payment_count=0）
 * - 3X-UI 用户同步：确保所有已付费用户都在 3X-UI 节点中
 * - 流量同步：从 3X-UI 服务器同步用户流量数据到本地数据库
 * - 工单自动关闭：关闭用户已读后超过24小时无新回复的 pending 工单
 * - 释放过期名额：释放流量用完超过3天且未续费的用户名额
 */

const XuiService = require('../services/xui-service');
const trafficManager = require('../services/traffic-manager');
const { createLogger } = require('../utils/logger');

const logger = createLogger('JOBS');

// 保存所有定时任务引用，便于统一清理
const intervals = [];

/**
 * 注册标记过期订单任务
 * 将超过30分钟未支付的 pending 订单标记为 expired
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
 * 删除超过1小时的 expired 订单
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
 * 删除未支付且超过30分钟的用户（enabled=0, payment_count=0）
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
 * 同步用户到3X-UI服务器
 * @param {Object} db - 数据库实例
 * @param {Object} server - 服务器信息
 * @param {Array} users - 需要同步的用户列表
 */
async function syncUsersToServer(db, server, users) {
  try {
    const xuiService = new XuiService(server.api_url, server.api_username, server.api_password);
    await xuiService.init();

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
      const usersToAdd = users.filter(user => !existingEmails.includes(user.email));

      // 添加缺失的用户
      for (const user of usersToAdd) {
        try {
          const expiryTime = user.expire_at ? user.expire_at * 1000 : 0;
          const totalGB = user.traffic_limit || 0;

          const result = await xuiService.addClient(inbound.id, inbound.protocol, {
            email: user.email,
            id: user.subscription_token,
            enable: user.enabled === 1,
            expiryTime: expiryTime,
            totalGB: totalGB,
            limitIp: 0,
            tgId: 0,
            subId: ''
          });

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

    if (syncCount > 0) {
      logger.info(`服务器 ${server.name} 同步完成，新增 ${syncCount} 个用户`);
    }
  } catch (error) {
    logger.error(`同步服务器 ${server.name} 错误: ${error.message}`);
  }
}

/**
 * 注册3X-UI用户同步任务
 * 每4小时检查一次，确保所有已付费用户都在3X-UI节点中
 * @param {Object} db - 数据库实例
 */
function registerXuiSyncJob(db) {
  // 启动时延迟7分钟执行第一次，避免启动时负载过高
  setTimeout(async () => {
    await runXuiSync(db);
  }, 7 * 60 * 1000);

  const interval = setInterval(async () => {
    await runXuiSync(db);
  }, 4 * 60 * 60 * 1000); // 每4小时执行一次
  
  intervals.push(interval);
  logger.info('3X-UI用户同步任务已注册（每4小时执行一次）');
}

/**
 * 注册流量同步任务
 * 每1小时从3X-UI服务器同步用户流量数据到本地数据库
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
 * 执行3X-UI用户同步
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
      SELECT id, name, api_url, api_username, api_password
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
 * 每小时检查一次，关闭满足条件的工单
 * 条件：状态为 pending，用户已读后超过24小时无新回复
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
 * 每小时检查一次，释放流量用完超过3天且未续费的用户名额
 * @param {Object} db - 数据库实例
 */
function registerReleaseExpiredSalesJob(db) {
  // 启动时延迟15分钟执行第一次
  setTimeout(async () => {
    await runReleaseExpiredSales(db);
  }, 15 * 60 * 1000);

  const interval = setInterval(async () => {
    await runReleaseExpiredSales(db);
  }, 60 * 60 * 1000); // 每1小时执行一次
  
  intervals.push(interval);
  logger.info('释放过期名额任务已注册（每1小时执行一次）');
}

/**
 * 执行释放过期名额
 * @param {Object} db - 数据库实例
 */
async function runReleaseExpiredSales(db) {
  try {
    // 查找需要释放名额的用户（流量用完超过3天且未续费）
    const expiredUsers = await db.prepare(`
      SELECT u.plan_id, COUNT(*) as expired_count
      FROM users u
      WHERE u.plan_id IS NOT NULL
        AND u.traffic_used_at IS NOT NULL
        AND u.traffic_used_at < EXTRACT(EPOCH FROM NOW()) - 259200
        AND NOT EXISTS (
          SELECT 1 FROM orders o 
          WHERE o.user_id = u.id 
            AND o.status = 'paid'
            AND o.created_at > u.traffic_used_at
        )
      GROUP BY u.plan_id
    `).all();

    let releasedCount = 0;

    for (const row of expiredUsers) {
      const result = await db.prepare(`
        UPDATE plans 
        SET sales_count = GREATEST(0, sales_count - ?)
        WHERE id = ?
      `).run(row.expired_count, row.plan_id);
      
      if (result.changes > 0) {
        releasedCount += row.expired_count;
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
 * 启动所有定时任务
 * @param {Object} db - 数据库实例
 */
function startAllJobs(db) {
  logger.info('正在启动所有定时任务...');
  registerMarkExpiredJob(db);
  registerDeleteExpiredJob(db);
  registerCleanZombieUsersJob(db);
  registerXuiSyncJob(db);
  registerTrafficSyncJob(db);
  registerTicketAutoCloseJob(db);
  registerReleaseExpiredSalesJob(db);
  logger.info(`所有定时任务已启动，共 ${intervals.length} 个任务`);
}

/**
 * 停止所有定时任务
 */
function stopAllJobs() {
  logger.info('正在停止所有定时任务...');
  intervals.forEach(interval => clearInterval(interval));
  intervals.length = 0;
  logger.info('所有定时任务已停止');
}

module.exports = {
  startAllJobs,
  stopAllJobs
};
