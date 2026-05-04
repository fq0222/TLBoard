/**
 * 定时任务管理
 * 集中管理所有定时任务，方便维护
 */

const XuiService = require('../services/xui-service');
const { createLogger } = require('../utils/logger');

const logger = createLogger('JOBS');

// 保存所有定时任务引用，便于统一清理
const intervals = [];

/**
 * 注册订单自动过期任务
 * 每10分钟检查一次，超过30分钟未支付的订单自动标记为过期
 * @param {Object} db - 数据库实例
 */
function registerOrderExpireJob(db) {
  const interval = setInterval(async () => {
    try {
      const expireTime = Math.floor(Date.now() / 1000) - 30 * 60; // 30分钟前
      const result = await db.prepare(`
        UPDATE orders SET status = 'expired'
        WHERE status = 'pending' AND created_at < ?
      `).run(expireTime);
      
      if (result.changes > 0) {
        logger.info(`自动过期 ${result.changes} 个超时订单`);
      }
    } catch (error) {
      logger.error(`订单自动过期任务错误: ${error.message}`);
    }
  }, 10 * 60 * 1000); // 每10分钟执行一次
  
  intervals.push(interval);
  logger.info('订单自动过期任务已注册');
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
  // 启动时延迟5分钟执行第一次，避免启动时负载过高
  setTimeout(async () => {
    await runXuiSync(db);
  }, 5 * 60 * 1000);

  const interval = setInterval(async () => {
    await runXuiSync(db);
  }, 4 * 60 * 60 * 1000); // 每4小时执行一次
  
  intervals.push(interval);
  logger.info('3X-UI用户同步任务已注册（每4小时执行一次）');
}

/**
 * 注册流量同步任务
 * 每3小时从3X-UI服务器同步用户流量数据到本地数据库
 * @param {Object} db - 数据库实例
 */
function registerTrafficSyncJob(db) {
  // 启动时延迟10分钟执行第一次，避免启动时负载过高
  setTimeout(async () => {
    await runTrafficSync(db);
  }, 10 * 60 * 1000);

  const interval = setInterval(async () => {
    await runTrafficSync(db);
  }, 3 * 60 * 60 * 1000); // 每3小时执行一次
  
  intervals.push(interval);
  logger.info('流量同步任务已注册（每3小时执行一次）');
}

/**
 * 执行流量同步
 * 从3X-UI服务器获取用户流量数据并更新到本地数据库
 * @param {Object} db - 数据库实例
 */
async function runTrafficSync(db) {
  try {
    logger.info('开始执行流量同步任务...');

    // 查询所有已启用的用户
    const users = await db.prepare(`
      SELECT id, email
      FROM users
      WHERE enabled = 1
    `).all();

    if (users.length === 0) {
      logger.info('没有需要同步流量的用户');
      return;
    }

    logger.info(`需要同步流量的用户数量: ${users.length}`);

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

    let updatedCount = 0;

    // 对每个服务器执行流量同步
    for (const server of servers) {
      try {
        const xuiService = new XuiService(server.api_url, server.api_username, server.api_password);
        await xuiService.init();

        // 获取所有inbounds
        const inboundsResult = await xuiService.getInbounds();
        if (!inboundsResult.success) {
          logger.warn(`获取服务器 ${server.name} 的inbounds失败: ${inboundsResult.message}`);
          continue;
        }

        // 遍历所有inbound，收集用户流量数据
        for (const inbound of inboundsResult.data) {
          const clientStats = inbound.clientStats || [];
          
          for (const client of clientStats) {
            // 查找匹配的用户
            const user = users.find(u => u.email === client.email);
            if (user) {
              // 计算总流量（上行 + 下行）
              const trafficUsed = (client.up || 0) + (client.down || 0);
              
              // 更新数据库中的流量数据
              await db.prepare(`
                UPDATE users SET traffic_used = ?, updated_at = ? WHERE id = ?
              `).run(trafficUsed, Math.floor(Date.now() / 1000), user.id);
              
              updatedCount++;
            }
          }
        }
      } catch (error) {
        logger.error(`同步服务器 ${server.name} 流量错误: ${error.message}`);
      }
    }

    logger.info(`流量同步任务完成，更新了 ${updatedCount} 个用户的流量数据`);
  } catch (error) {
    logger.error(`流量同步任务错误: ${error.message}`);
  }
}

/**
 * 执行3X-UI用户同步
 * @param {Object} db - 数据库实例
 */
async function runXuiSync(db) {
  try {
    logger.info('开始执行3X-UI用户同步任务...');

    // 查询所有已启用且未过期的用户
    const now = Math.floor(Date.now() / 1000);
    const users = await db.prepare(`
      SELECT id, email, subscription_token, enabled, traffic_limit, expire_at
      FROM users
      WHERE enabled = 1 AND expire_at > ?
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
 * 启动所有定时任务
 * @param {Object} db - 数据库实例
 */
function startAllJobs(db) {
  logger.info('正在启动所有定时任务...');
  registerOrderExpireJob(db);
  registerXuiSyncJob(db);
  registerTrafficSyncJob(db);
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
