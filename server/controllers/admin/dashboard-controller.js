const { legacySuccess, legacyFail } = require('../../shared/response/api-response');
const { createLogger } = require('../../utils/logger');
const dashboardService = require('../../services/admin/dashboard-service');

const logger = createLogger('ADMIN-DASHBOARD');

/**
 * 管理端仪表盘控制器
 * 负责处理仪表盘统计接口的 HTTP 请求与响应。
 */

/**
 * 获取系统统计数据。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function getStats(req, res) {
  try {
    const stats = await dashboardService.getDashboardStats(req.app.locals.db);

    logger.info(`获取统计数据成功: ${JSON.stringify(stats)}`);

    return legacySuccess(res, stats);
  } catch (error) {
    logger.error(`获取统计数据错误: ${error.message}`);
    return legacyFail(res);
  }
}

/**
 * 获取最近一轮服务器流量统计。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function getTrafficUsageStats(req, res) {
  try {
    const stats = await dashboardService.getTrafficUsageStats(req.app.locals.db);
    return legacySuccess(res, stats);
  } catch (error) {
    logger.error(`获取服务器流量统计错误: ${error.message}`);
    return legacyFail(res);
  }
}

module.exports = {
  getStats,
  getTrafficUsageStats
};
