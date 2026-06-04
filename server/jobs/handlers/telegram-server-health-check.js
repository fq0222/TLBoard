/**
 * Telegram 服务器健康巡检任务。
 * 负责注册定时巡检，并安全调用 Telegram 健康服务。
 */

const telegramMonitorService = require('../../services/shared/telegram-monitor-service');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('JOBS');

/**
 * 安全执行 Telegram 健康巡检，避免重入和未处理异常。
 *
 * @param {Object} db - 数据库实例
 * @param {{running: boolean}} state - 当前任务运行状态
 * @returns {Promise<void>}
 */
async function runTelegramServerHealthCheckSafely(db, state) {
  if (state.running) {
    logger.warn('Telegram服务器健康巡检任务仍在执行，跳过本轮触发');
    return;
  }

  state.running = true;
  try {
    await telegramMonitorService.checkAllServersHealth(db);
  } catch (error) {
    logger.error(`Telegram服务器健康巡检任务执行失败: ${error.message}`);
  } finally {
    state.running = false;
  }
}

/**
 * 注册 Telegram 服务器健康巡检任务。
 * 启动后延迟 13 分钟执行第一次，之后每 40 分钟执行一次。
 *
 * @param {Object} context - 任务上下文
 * @param {Object} context.db - 数据库实例
 * @param {Array} context.intervals - 间隔任务引用集合
 * @param {Function} context.registerTimeout - 延迟任务注册函数
 */
function registerTelegramServerHealthCheckJob({ db, intervals, registerTimeout }) {
  const state = {
    running: false
  };

  registerTimeout(() => {
    void runTelegramServerHealthCheckSafely(db, state);
  }, 13 * 60 * 1000);

  const interval = setInterval(() => {
    void runTelegramServerHealthCheckSafely(db, state);
  }, 40 * 60 * 1000);

  intervals.push(interval);
  logger.info('Telegram服务器健康巡检任务已注册（每40分钟执行一次）');
}

module.exports = {
  registerTelegramServerHealthCheckJob
};
