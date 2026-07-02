/**
 * 流量同步任务。
 * 负责注册并触发流量汇总与自动禁用处理。
 */

const trafficManager = require('../../services/shared/traffic-manager');
const { createLogger } = require('../../utils/logger');
const xuiJobScheduler = require('../xui-job-scheduler');

const logger = createLogger('JOBS');

/**
 * 注册流量同步任务。
 * 启动后延迟 10 分钟执行第一次，之后每 30 分钟执行一次。
 *
 * @param {Object} context - 任务上下文
 * @param {Object} context.db - 数据库实例
 * @param {Array} context.intervals - 间隔任务引用集合
 * @param {Function} context.registerTimeout - 延迟任务注册函数
 */
function registerTrafficSyncJob({ db, intervals, registerTimeout }) {
  registerTimeout(() => {
    scheduleTrafficSync(db);
  }, 10 * 60 * 1000);

  const interval = setInterval(() => {
    scheduleTrafficSync(db);
  }, 30 * 60 * 1000);

  intervals.push(interval);
  logger.info('流量同步任务已注册（每 30 分钟执行一次）');
}

/**
 * 将流量同步提交到统一调度器。
 * 同名任务运行中或排队时由调度器合并，避免并发访问 3X-UI。
 *
 * @param {Object} db - 数据库实例
 * @returns {void}
 */
function scheduleTrafficSync(db) {
  xuiJobScheduler.schedule('traffic-sync', async () => {
    await trafficManager.syncTrafficAndHandleDisable(db);
  });
}

module.exports = {
  registerTrafficSyncJob
};
