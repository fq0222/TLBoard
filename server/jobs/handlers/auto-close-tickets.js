/**
 * 工单自动关闭任务
 * 负责注册并执行超时 pending 工单的自动关闭逻辑。
 */

const { createLogger } = require('../../utils/logger');

const logger = createLogger('JOBS');

/**
 * 注册工单自动关闭任务
 * 启动后延迟 3 分钟执行第一次，之后每 1 小时执行一次。
 * @param {Object} context - 任务上下文
 * @param {Object} context.db - 数据库实例
 * @param {Array} context.intervals - 间隔任务引用集合
 * @param {Function} context.registerTimeout - 延迟任务注册函数
 */
function registerTicketAutoCloseJob({ db, intervals, registerTimeout }) {
  registerTimeout(async () => {
    await runTicketAutoClose(db);
  }, 3 * 60 * 1000);

  const interval = setInterval(async () => {
    await runTicketAutoClose(db);
  }, 60 * 60 * 1000);

  intervals.push(interval);
  logger.info('工单自动关闭任务已注册（每1小时执行一次）');
}

/**
 * 执行工单自动关闭
 * 关闭管理员已回复、用户已读且超过 24 小时无新回复的 pending 工单。
 * @param {Object} db - 数据库实例
 */
async function runTicketAutoClose(db) {
  try {
    const result = await db.prepare(`
      UPDATE tickets
      SET status = 'closed', closed_at = EXTRACT(EPOCH FROM NOW()), updated_at = EXTRACT(EPOCH FROM NOW())
      WHERE status = 'pending'
        AND last_read_at IS NOT NULL
        AND last_read_at < EXTRACT(EPOCH FROM NOW()) - 86400
        AND last_reply_at <= last_read_at
    `).run();

    if (result.changes > 0) {
      logger.info(`自动关闭 ${result.changes} 个超时工单`);
    }
  } catch (error) {
    logger.error(`工单自动关闭任务错误: ${error.message}`);
  }
}

module.exports = {
  registerTicketAutoCloseJob
};
