const { getUnixTimestamp, getStartOfToday } = require('../../shared/utils/time');
const dashboardRepository = require('../../repositories/dashboard-repository');
const trafficUsageStatsService = require('./traffic-usage-stats-service');

/**
 * 管理端仪表盘服务
 * 负责聚合仪表盘首页统计数据。
 */

/**
 * 获取管理端仪表盘统计数据。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Object>} 仪表盘统计结果
 */
async function getDashboardStats(db) {
  const todayTimestamp = getUnixTimestamp(getStartOfToday());
  const rawStats = await dashboardRepository.getDashboardStats(db, todayTimestamp);

  return {
    userCount: rawStats.userCount.count || 0,
    planCount: rawStats.planCount.count || 0,
    orderCount: rawStats.orderCount.count || 0,
    serverCount: rawStats.serverCount.count || 0,
    emailTodayCount: rawStats.emailTodayCount.count || 0,
    emailDailyLimit: rawStats.dailyLimitRow ? parseInt(rawStats.dailyLimitRow.value, 10) : 200,
    campaignDailyLimit: rawStats.campaignDailyLimitRow ? parseInt(rawStats.campaignDailyLimitRow.value, 10) : 100
  };
}

/**
 * 获取最近一轮服务器流量统计。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Object>} 最近一轮服务器流量统计
 */
async function getTrafficUsageStats(db) {
  return trafficUsageStatsService.getCurrentTrafficUsageStats(db);
}

module.exports = {
  getDashboardStats,
  getTrafficUsageStats
};
