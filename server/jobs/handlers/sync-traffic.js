/**
 * 流量同步任务
 * 负责注册并触发流量汇总与自动禁用处理。
 */

const trafficManager = require('../../services/traffic-manager');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('JOBS');

/**
 * 注册流量同步任务
 * 启动后延迟 10 分钟执行第一次，之后每 1 小时执行一次。
 * @param {Object} context - 任务上下文
 * @param {Object} context.db - 数据库实例
 * @param {Array} context.intervals - 间隔任务引用集合
 * @param {Function} context.registerTimeout - 延迟任务注册函数
 */
function registerTrafficSyncJob({ db, intervals, registerTimeout }) {
  registerTimeout(async () => {
    await trafficManager.syncTrafficAndHandleDisable(db);
  }, 10 * 60 * 1000);

  const interval = setInterval(async () => {
    await trafficManager.syncTrafficAndHandleDisable(db);
  }, 60 * 60 * 1000);

  intervals.push(interval);
  logger.info('流量同步任务已注册（每1小时执行一次）');
}

module.exports = {
  registerTrafficSyncJob
};
