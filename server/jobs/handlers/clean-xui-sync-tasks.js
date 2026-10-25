/**
 * 同步任务历史清理：每天北京时间 12:00 删除一批过期终态任务，不补执行。
 */
const cron = require('node-cron');
const xuiSyncRepository = require('../../repositories/xui-sync-repository');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('JOBS');
const RETENTION_DAYS = 15;
const CLEANUP_LIMIT = 50;
const CLEANUP_SCHEDULE = '0 12 * * *';
const CLEANUP_TIMEZONE = 'Asia/Shanghai';

/**
 * 清理一批严格早于 15 天截止时间的终态同步任务，完成后记录数量与耗时。
 * @param {Object} db - 提供连接池的数据库代理，由仓储执行单批删除。
 * @returns {Promise<{success:boolean,deleted:number,error?:string}>} 成功返回数量，失败返回原因且不向 cron 抛错。
 */
async function runXuiSyncTaskCleanup(db) {
  const startedAt = Date.now();
  try {
    const cutoffCreatedAt = Math.floor(startedAt / 1000) - RETENTION_DAYS * 24 * 60 * 60;
    // 单次只调用仓储一批，不循环补删，避免历史积压时扩大单次删除范围。
    const deleted = await xuiSyncRepository.deleteExpiredTerminalTasks(db, cutoffCreatedAt, CLEANUP_LIMIT);
    logger.info(`3X-UI 同步历史清理完成: deleted=${deleted}, duration=${Date.now() - startedAt}ms`);
    return { success: true, deleted };
  } catch (error) {
    // Promise 可拒绝任意值；null 等非 Error 值也需要记录并正常返回。
    const message = error?.message || String(error);
    logger.error(`3X-UI 同步历史清理失败: error=${message}, duration=${Date.now() - startedAt}ms`);
    return { success: false, deleted: 0, error: message };
  }
}

/**
 * 仅注册每天北京时间 12:00 的独立清理任务，不在启动时立即执行。
 * @param {Object} context - 定时任务上下文。
 * @param {Object} context.db - 清理仓储使用的数据库代理。
 * @param {Array} context.cronTasks - 保存 cron 句柄，供统一停止任务时使用。
 * @returns {void}
 */
function registerCleanXuiSyncTasksJob({ db, cronTasks }) {
  const task = cron.schedule(CLEANUP_SCHEDULE, async () => {
    await runXuiSyncTaskCleanup(db);
  }, { timezone: CLEANUP_TIMEZONE });

  cronTasks.push(task);
  logger.info('3X-UI 同步历史清理任务已注册（每天 12:00 北京时间执行）');
}

module.exports = {
  runXuiSyncTaskCleanup,
  registerCleanXuiSyncTasksJob
};
