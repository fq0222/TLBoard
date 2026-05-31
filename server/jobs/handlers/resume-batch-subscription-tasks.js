/**
 * 批量订阅生成任务恢复器。
 * 应用启动后检查数据库中未完成的任务，并交给服务层等待 3X-UI 空闲后继续执行。
 */

const { createLogger } = require('../../utils/logger');
const batchSubscriptionService = require('../../services/admin/batch-subscription-service');

const logger = createLogger('BATCH-SUB-JOB');

/**
 * 注册批量订阅任务恢复检查。
 *
 * @param {Object} context - 定时任务上下文
 * @param {Object} context.db - 数据库代理对象
 * @param {Function} context.registerTimeout - 延迟任务注册函数
 * @returns {void}
 */
function registerBatchSubscriptionTaskJob(context) {
  context.registerTimeout(async () => {
    logger.info('检查未完成批量订阅生成任务');
    await batchSubscriptionService.resumeUnfinishedTask(context.db);
  }, 15 * 1000);
}

module.exports = {
  registerBatchSubscriptionTaskJob
};
