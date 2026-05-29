/**
 * 邮件群发任务
 * 负责注册并触发待发送邮件群发任务处理。
 */

const cron = require('node-cron');
const { processCampaigns } = require('../email-campaign');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('JOBS');

/**
 * 注册邮件群发任务
 * 每天 9:00 处理待发送的邮件群发任务。
 * @param {Object} context - 任务上下文
 * @param {Object} context.db - 数据库实例
 * @param {Array} context.cronTasks - cron 任务引用集合
 */
function registerEmailCampaignJob({ db, cronTasks }) {
  const task = cron.schedule('0 9 * * *', async () => {
    try {
      logger.info('处理邮件群发任务');
      await processCampaigns(db);
    } catch (error) {
      logger.error(`邮件群发任务错误: ${error.message}`);
    }
  });

  cronTasks.push(task);
  logger.info('邮件群发任务已注册（每天 9:00 执行）');
}

module.exports = {
  registerEmailCampaignJob
};
