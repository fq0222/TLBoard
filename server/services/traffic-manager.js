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
 * @param {Object} db - 数据库实例
 * @param {Object} serverTrafficData - 服务器流量数据
 * @returns {Promise<Object>} 用户流量数据 { userId: { email, trafficUsed, trafficLimit, isOverLimit } }
 */
async function calculateUserTotalTraffic(db, serverTrafficData) {
  // TODO: 实现
}

/**
 * 更新本地数据库的流量统计
 * @param {Object} db - 数据库实例
 * @param {Object} userTrafficData - 用户流量数据
 */
async function updateTrafficInDatabase(db, userTrafficData) {
  // TODO: 实现
}

/**
 * 检查并禁用超量用户
 * @param {Object} db - 数据库实例
 * @param {Object} userTrafficData - 用户流量数据
 */
async function checkAndDisableOverLimitUsers(db, userTrafficData) {
  // TODO: 实现
}

/**
 * 同步禁用状态到3X-UI
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户ID
 * @param {boolean} disable - 是否禁用
 * @returns {Promise<boolean>} 是否成功
 */
async function syncDisableStatusToXui(db, userId, disable) {
  // TODO: 实现
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
