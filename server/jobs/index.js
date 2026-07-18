/**
 * 定时任务注册中心
 * 统一管理所有后台定时任务的注册、启动和停止，不承载具体业务实现。
 *
 * 任务配置表：
 * +------------------------+--------------+--------------------+----------------------+
 * | 任务名称               | 启动时执行   | 首次延迟           | 执行间隔             |
 * +------------------------+--------------+--------------------+----------------------+
 * | 标记过期订单           | 是           | 无                 | 10 分钟              |
 * | 删除过期订单           | 是           | 5 分钟             | 1 小时               |
 * | 清理僵尸用户           | 是           | 2 分钟             | 30 分钟              |
 * | 3X-UI 用户同步         | 是           | 1 分钟             | 4 小时               |
 * | 3X-UI 同步重试队列     | 是           | 30 秒              | 3 分钟               |
 * | 流量同步               | 是           | 10 分钟            | 30 分钟              |
 * | 工单自动关闭           | 是           | 3 分钟             | 1 小时               |
 * | 释放过期名额           | 否           | 无                 | 每天 5:00            |
 * | 邮件群发               | 否           | 无                 | 每天 9:00            |
 * | 清理邮件日志           | 否           | 无                 | 每天 3:00            |
 * | 3X-UI 数据库备份       | 否           | 无                 | 每天 4:00            |
 * | 批量订阅任务恢复       | 否           | 15 秒              | 无（仅启动后一次）   |
 * | Telegram 健康巡检      | 否           | 13 分钟            | 40 分钟              |
 * +------------------------+--------------+--------------------+----------------------+
 *
 * 任务说明：
 * - 标记过期订单：将超过 30 分钟未支付的 pending 订单标记为 expired
 * - 删除过期订单：删除超过 1 小时的 expired 订单
 * - 清理僵尸用户：删除未支付且超过 30 分钟的用户（enabled=0, payment_count=0）
 * - 3X-UI 用户同步：确保所有已付费用户都在 3X-UI 节点中，并修复 sub_id、flow、流量上限等状态
 * - 3X-UI 同步重试队列：处理注册、续费、启用、禁用等同步失败后的补偿任务
 * - 流量同步：从 3X-UI 服务器同步用户流量数据到本地数据库
 * - 工单自动关闭：关闭用户已读后超过 24 小时无新回复的 pending 工单
 * - 释放过期名额：释放流量用完超过 3 天且未续费的用户名额
 * - 邮件群发：处理待发送的邮件群发任务，每日限额 200 封
 * - 清理邮件日志：清理超过 30 天的邮件发送日志
 * - 3X-UI 数据库备份：备份所有 3X-UI 服务器的 x-ui.db 到 server/backupDB
 * - 批量订阅任务恢复：应用启动后恢复未完成的批量订阅生成任务
 * - Telegram 健康巡检：定期巡检 Telegram 服务器健康状态并发送必要告警
 */

const { createLogger } = require('../utils/logger');
const { registerMarkExpiredJob } = require('./handlers/mark-expired-orders');
const { registerDeleteExpiredJob } = require('./handlers/delete-expired-orders');
const { registerCleanZombieUsersJob } = require('./handlers/clean-zombie-users');
const { registerXuiSyncJob } = require('./handlers/sync-xui-users');
const { registerXuiSyncTaskJob } = require('./handlers/sync-xui-tasks');
const { registerTrafficSyncJob } = require('./handlers/sync-traffic');
const { registerTicketAutoCloseJob } = require('./handlers/auto-close-tickets');
const { registerReleaseExpiredSalesJob } = require('./handlers/release-expired-sales');
const { registerEmailCampaignJob } = require('./handlers/process-email-campaigns');
const { registerCleanEmailLogsJob } = require('./handlers/clean-email-logs');
const { registerBackupXuiDbJob } = require('./handlers/backup-xui-db');
const { registerBatchSubscriptionTaskJob } = require('./handlers/resume-batch-subscription-tasks');
const { registerTelegramServerHealthCheckJob } = require('./handlers/telegram-server-health-check');
const xuiJobScheduler = require('./xui-job-scheduler');

const logger = createLogger('JOBS');

// 保存所有定时任务引用，便于统一清理
const intervals = [];
const timeouts = [];
const cronTasks = [];
let isStarted = false;

/**
 * 注册延迟任务句柄
 * 统一收口 setTimeout 引用，便于 stopAllJobs() 清理尚未触发的延迟任务。
 *
 * @param {Function} callback - 延迟执行函数
 * @param {number} delay - 延迟毫秒数
 * @returns {NodeJS.Timeout} timeout 句柄
 */
function registerTimeout(callback, delay) {
  const timeout = setTimeout(async () => {
    try {
      await callback();
    } finally {
      const index = timeouts.indexOf(timeout);
      if (index !== -1) {
        timeouts.splice(index, 1);
      }
    }
  }, delay);

  timeouts.push(timeout);
  return timeout;
}

/**
 * 清理当前已注册的任务句柄
 * 供停止流程和启动失败回滚复用，避免残留半初始化状态。
 */
function cleanupJobHandles() {
  intervals.forEach(interval => clearInterval(interval));
  intervals.length = 0;

  timeouts.forEach(timeout => clearTimeout(timeout));
  timeouts.length = 0;

  cronTasks.forEach(task => task.stop());
  cronTasks.length = 0;

  xuiJobScheduler.stop();
}

/**
 * 启动所有定时任务
 * 按既有顺序注册任务，避免改变现有启动行为。
 *
 * @param {Object} db - 数据库实例
 */
function startAllJobs(db) {
  if (isStarted) {
    logger.warn('定时任务已启动，跳过重复注册');
    return;
  }

  logger.info('正在启动所有定时任务...');

  try {
    const context = { db, intervals, timeouts, cronTasks, registerTimeout };
    registerMarkExpiredJob(context);
    registerDeleteExpiredJob(context);
    registerCleanZombieUsersJob(context);
    registerXuiSyncJob(context);
    registerXuiSyncTaskJob(context);
    registerTrafficSyncJob(context);
    registerTicketAutoCloseJob(context);
    registerReleaseExpiredSalesJob(context);
    registerEmailCampaignJob(context);
    registerCleanEmailLogsJob(context);
    registerBackupXuiDbJob(context);
    registerBatchSubscriptionTaskJob(context);
    registerTelegramServerHealthCheckJob(context);
  } catch (error) {
    cleanupJobHandles();
    logger.error(`启动定时任务失败: ${error.message}`);
    throw error;
  }

  isStarted = true;
  logger.info(`所有定时任务已启动，共 ${intervals.length} 个间隔任务，${cronTasks.length} 个定时任务`);
}

/**
 * 停止所有定时任务
 * 清理 setInterval 和 cron task 引用，供应用退出时调用。
 */
function stopAllJobs() {
  logger.info('正在停止所有定时任务...');

  cleanupJobHandles();
  isStarted = false;

  logger.info('所有定时任务已停止');
}

module.exports = {
  startAllJobs,
  stopAllJobs
};
