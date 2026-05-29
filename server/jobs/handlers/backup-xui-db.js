/**
 * 3X-UI 数据库备份任务
 * 负责创建并注册 3X-UI 数据库备份 cron 任务。
 */

const cron = require('node-cron');
const { backupXuiDatabases } = require('../backupDB');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('JOBS');

/**
 * 注册 3X-UI 数据库备份任务
 * 每天凌晨 4 点执行一次，保持原有 cron 语义和备份逻辑不变。
 * @param {Object} context - 任务上下文
 * @param {Object} context.db - 数据库实例
 * @param {Array} context.cronTasks - cron 任务引用集合
 */
function registerBackupXuiDbJob({ db, cronTasks }) {
  const task = cron.schedule('0 4 * * *', async () => {
    try {
      logger.info('开始执行 3X-UI 数据库备份任务');
      await backupXuiDatabases(db);
    } catch (error) {
      logger.error(`3X-UI 数据库备份任务错误: ${error.message}`);
    }
  });

  cronTasks.push(task);
  logger.info('3X-UI 数据库备份任务已注册（每天 4:00 执行）');
}

module.exports = {
  registerBackupXuiDbJob
};
