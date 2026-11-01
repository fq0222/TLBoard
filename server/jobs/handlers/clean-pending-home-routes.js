/**
 * 家宽 routing 残留清理任务。
 * 每天北京时间 12:00 重试 pending_cleanup_server_ids 中仍未完成的远端删除。
 */
const cron = require('node-cron');
const homeRoutingService = require('../../services/shared/home-routing-service');
const { createLogger } = require('../../utils/logger');
const xuiJobScheduler = require('../xui-job-scheduler');

const logger = createLogger('JOBS');
const CLEANUP_SCHEDULE = '0 12 * * *';
const CLEANUP_TIMEZONE = 'Asia/Shanghai';

/**
 * 执行一次家宽 routing 残留清理并记录汇总。
 * @param {Object} db - 数据库代理对象。
 * @returns {Promise<Object>} 成功时返回清理统计，失败时返回可读错误且不向 cron 抛出。
 * 核心分支：业务服务已隔离单用户失败；这里只收口整批查询等顶层异常。
 */
async function runPendingHomeRouteCleanup(db) {
  const startedAt = Date.now();
  try {
    const summary = await homeRoutingService.cleanupPendingHomeRoutes(db, logger);
    logger.info(
      `家宽 routing 残留清理完成: scanned=${summary.scannedUsers}, cleaned=${summary.cleanedServers}, `
      + `offline=${summary.skippedOfflineServers}, failed=${summary.failedServers}, `
      + `invalid=${summary.invalidRoutes}, duration=${Date.now() - startedAt}ms`
    );
    return { success: true, ...summary };
  } catch (error) {
    const message = error?.message || String(error);
    logger.error(`家宽 routing 残留清理失败: error=${message}, duration=${Date.now() - startedAt}ms`);
    return { success: false, error: message };
  }
}

/**
 * 将家宽 routing 残留清理提交到统一 XUI 后台队列。
 * @param {Object} db - 数据库代理对象。
 * @returns {boolean} 成功加入队列时为 true，同名任务已运行或等待而被合并时为 false。
 * 核心分支：只负责入队，必须等队列执行 handler 后才开始清理。
 */
function schedulePendingHomeRouteCleanup(db) {
  return xuiJobScheduler.schedule('home-routing-pending-cleanup', async () => {
    await runPendingHomeRouteCleanup(db);
  });
}

/**
 * 注册每天北京时间 12:00 的家宽 routing 残留清理任务。
 * @param {Object} context - 定时任务上下文。
 * @param {Object} context.db - 数据库代理对象。
 * @param {Array} context.cronTasks - 统一保存 cron 句柄的集合。
 * @returns {void}
 * 核心分支：只注册 cron；到点后提交 XUI 队列，不在服务启动或 cron 回调中直接清理。
 */
function registerPendingHomeRouteCleanupJob({ db, cronTasks }) {
  const task = cron.schedule(CLEANUP_SCHEDULE, () => {
    schedulePendingHomeRouteCleanup(db);
  }, { timezone: CLEANUP_TIMEZONE });

  cronTasks.push(task);
  logger.info('家宽 routing 残留清理任务已注册（每天 12:00 北京时间执行）');
}

module.exports = {
  runPendingHomeRouteCleanup,
  schedulePendingHomeRouteCleanup,
  registerPendingHomeRouteCleanupJob
};
