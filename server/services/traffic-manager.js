/**
 * 流量管理模块
 * 负责流量统计、禁用检查和3X-UI同步
 */

const XuiService = require('./xui-service');
const { createLogger } = require('../utils/logger');

const logger = createLogger('TRAFFIC-MANAGER');

/**
 * 获取所有服务器的流量数据
 * @param {Object} db - 数据库实例
 * @returns {Promise<Object>} 服务器流量数据 { serverId: { email: { up, down, total } } }
 */
async function fetchAllServerTraffic(db) {
  try {
    // 查询所有在线服务器
    const servers = await db.prepare(`
      SELECT id, name, api_url, api_username, api_password
      FROM xui_servers
      WHERE status = 1
    `).all();

    if (servers.length === 0) {
      logger.warn('没有在线服务器');
      return {};
    }

    logger.info(`开始获取 ${servers.length} 台服务器的流量数据`);

    const serverTrafficData = {};

    // 并行获取所有服务器的流量数据
    const promises = servers.map(async (server) => {
      try {
        const xuiService = new XuiService(server.api_url, server.api_username, server.api_password);
        await xuiService.init();

        // 获取所有inbounds
        const inboundsResult = await xuiService.getInbounds();
        if (!inboundsResult.success) {
          logger.warn(`获取服务器 ${server.name} 的 inbounds 失败: ${inboundsResult.message}`);
          return;
        }

        const serverData = {};

        // 遍历所有inbound，收集用户流量数据
        for (const inbound of inboundsResult.data) {
          const clientStats = inbound.clientStats || [];

          for (const client of clientStats) {
            const email = client.email;
            if (!email) continue;

            // 累加同一用户在不同inbound的流量
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

  // 先查询用户（不需要事务）
  const users = await db.prepare(`
    SELECT id, email, traffic_used, traffic_limit
    FROM users
    WHERE enabled = 1
  `).all();

  if (users.length === 0) {
    logger.info('没有启用的用户');
    return {};
  }

  logger.info(`开始计算 ${users.length} 个用户的流量，${serverIds.length} 台服务器`);

  const now = Math.floor(Date.now() / 1000);

  // 获取专用连接用于事务
  const client = await db.pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // 批量获取所有同步记录（使用事务连接）
    const syncResult = await client.query(
      'SELECT user_id, server_id, last_sync_traffic FROM traffic_sync_log'
    );
    const syncLogMap = new Map();
    for (const row of syncResult.rows) {
      syncLogMap.set(`${row.user_id}-${row.server_id}`, Number(row.last_sync_traffic) || 0);
    }

    const userTrafficData = {};
    const syncLogUpdates = [];

    for (const user of users) {
      let totalIncrement = 0;

      for (const serverId of serverIds) {
        const serverData = serverTrafficData[serverId];
        const clientData = serverData[user.email];
        if (!clientData) continue;

        const lastSyncTraffic = syncLogMap.get(`${user.id}-${serverId}`) || 0;
        const currentTraffic = clientData.total;

        let increment = 0;
        if (currentTraffic >= lastSyncTraffic) {
          increment = currentTraffic - lastSyncTraffic;
        } else {
          logger.warn(`服务器 ${serverId} 用户 ${user.email} 流量重置: 当前 ${currentTraffic} < 上次 ${lastSyncTraffic}`);
          increment = currentTraffic;
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
        trafficLimit: trafficLimit,
        isOverLimit: isOverLimit,
        increment: totalIncrement
      };
    }

    // 批量写入同步日志（使用事务连接）
    if (syncLogUpdates.length > 0) {
      const values = [];
      const params = [];
      let paramIndex = 1;
      for (const update of syncLogUpdates) {
        values.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3})`);
        params.push(update.userId, update.serverId, update.currentTraffic, update.now);
        paramIndex += 4;
      }
      await client.query(
        `INSERT INTO traffic_sync_log (user_id, server_id, last_sync_traffic, last_sync_at)
         VALUES ${values.join(', ')}
         ON CONFLICT (user_id, server_id)
         DO UPDATE SET last_sync_traffic = EXCLUDED.last_sync_traffic, last_sync_at = EXCLUDED.last_sync_at`,
        params
      );
    }

    await client.query('COMMIT');
    logger.info(`计算用户流量完成，${Object.keys(userTrafficData).length} 个用户，${syncLogUpdates.length} 条同步记录更新`);
    return userTrafficData;
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error(`计算用户流量事务失败，已回滚: ${error.message}`);
    throw error;
  } finally {
    client.release();
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
        await db.prepare(`
          UPDATE users SET traffic_used = ?, updated_at = ? WHERE id = ?
        `).run(data.trafficUsed, Math.floor(Date.now() / 1000), userId);
        
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
 * 检查并禁用超量用户
 * @param {Object} db - 数据库实例
 * @param {Object} userTrafficData - 用户流量数据
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

    for (const userId of userIds) {
      const data = userTrafficData[userId];
      
      // 检查是否超限
      if (!data.isOverLimit) {
        continue;
      }

      // 检查用户当前状态
      const user = await db.prepare('SELECT enabled FROM users WHERE id = ?').get(userId);
      if (!user || user.enabled === 0) {
        continue;
      }

      logger.info(`用户 ${data.email} 流量超限，开始禁用: ${data.trafficUsed}/${data.trafficLimit}`);

      try {
        // 先同步到3X-UI
        const syncSuccess = await syncDisableStatusToXui(db, userId, true);
        
        if (syncSuccess) {
          // 更新本地数据库
          await db.prepare(`
            UPDATE users SET enabled = 0, traffic_used_at = ? WHERE id = ?
          `).run(Math.floor(Date.now() / 1000), userId);
          
          disabledCount++;
          logger.info(`禁用用户 ${data.email} 成功`);
        } else {
          logger.warn(`同步禁用状态到3X-UI失败，跳过用户 ${data.email}`);
        }
      } catch (error) {
        logger.error(`禁用用户 ${data.email} 错误: ${error.message}`);
      }
    }

    logger.info(`检查用户流量限制完成，禁用 ${disabledCount} 个用户`);
  } catch (error) {
    logger.error(`检查用户流量限制错误: ${error.message}`);
  }
}

/**
 * 同步禁用状态到3X-UI
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户ID
 * @param {boolean} disable - 是否禁用
 * @returns {Promise<boolean>} 是否成功
 */
async function syncDisableStatusToXui(db, userId, disable) {
  try {
    // 查询用户信息
    const user = await db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
    if (!user) {
      logger.warn(`用户不存在: ${userId}`);
      return false;
    }
    
    // 查询所有在线服务器
    const servers = await db.prepare(`
      SELECT id, name, api_url, api_username, api_password
      FROM xui_servers
      WHERE status = 1
    `).all();
    
    if (servers.length === 0) {
      logger.warn('没有在线服务器');
      return false;
    }
    
    logger.info(`开始同步禁用状态到 ${servers.length} 台服务器: 用户 ${user.email}, 禁用 ${disable}`);
    
    // 遍历服务器，同步禁用状态
    let successCount = 0;
    for (const server of servers) {
      try {
        const xuiService = new XuiService(server.api_url, server.api_username, server.api_password);
        await xuiService.init();
        
        // 获取所有inbound
        const inboundsResult = await xuiService.getInbounds();
        if (!inboundsResult.success) {
          logger.warn(`获取服务器 ${server.name} 的 inbounds 失败`);
          continue;
        }
        
        // 对每个inbound，查找匹配用户并更新
        for (const inbound of inboundsResult.data) {
          const updateResult = await xuiService.updateClient(inbound.id, user.email, {
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
 * 主函数：同步流量并处理禁用
 * @param {Object} db - 数据库实例
 */
async function syncTrafficAndHandleDisable(db) {
  // TODO: 实现
}

module.exports = {
  syncTrafficAndHandleDisable,
  fetchAllServerTraffic,
  calculateUserTotalTraffic,
  updateTrafficInDatabase,
  checkAndDisableOverLimitUsers,
  syncDisableStatusToXui
};
