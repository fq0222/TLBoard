/**
 * 管理端流量统计推送服务。
 * 职责：在流量巡检计算完成后读取当前统计快照，并通知已订阅的 WebSocket 页面。
 */

const EventEmitter = require('events');
const trafficUsageStatsService = require('./traffic-usage-stats-service');

class TrafficUsagePushService extends EventEmitter {
  /**
   * 读取当前统计快照。
   *
   * @param {Object} db - 数据库实例。
   * @returns {Promise<Object>} 当前统计数据。
   */
  async getCurrentStats(db) {
    return trafficUsageStatsService.getCurrentTrafficUsageStats(db);
  }

  /**
   * 读取当前统计快照并广播给数据统计页面。
   *
   * @param {Object} db - 数据库实例。
   * @returns {Promise<Object>} 已广播的统计数据。
   */
  async publishCurrentStats(db) {
    const stats = await this.getCurrentStats(db);
    this.emit('stats', stats);
    return stats;
  }
}

module.exports = new TrafficUsagePushService();
