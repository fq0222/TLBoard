/**
 * 清理邮件日志任务
 * 负责注册并触发历史邮件日志清理。
 */

const cron = require('node-cron');
const { cleanLogs } = require('../email-campaign');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('JOBS');

/**
 * 注册清理邮件日志任务
 * 每天 3:00 清理超过 30 天的邮件发送日志。
 * @param {Object} context - 任务上下文
 * @param {Object} context.db - 数据库实例
 * @param {Array} context.cronTasks - cron 任务引用集合
 */
function registerCleanEmailLogsJob({ db, cronTasks }) {
  const task = cron.schedule('0 3 * * *', async () => {
    try {
      logger.info('清理邮件日志');
      await cleanLogs(db, 30);
    } catch (error) {
      logger.error(`清理邮件日志任务错误: ${error.message}`);
    }
  });

  cronTasks.push(task);
  logger.info('清理邮件日志任务已注册（每天 3:00 执行）');
}

module.exports = {
  registerCleanEmailLogsJob
};
