/**
 * 删除过期订单任务
 * 负责注册并执行历史过期订单清理逻辑。
 */

const { createLogger } = require('../../utils/logger');

const logger = createLogger('JOBS');

/**
 * 注册删除过期订单任务
 * 启动后延迟 5 分钟执行第一次，之后每 1 小时执行一次。
 * @param {Object} context - 任务上下文
 * @param {Object} context.db - 数据库实例
 * @param {Array} context.intervals - 间隔任务引用集合
 * @param {Function} context.registerTimeout - 延迟任务注册函数
 */
function registerDeleteExpiredJob({ db, intervals, registerTimeout }) {
  registerTimeout(async () => {
    await runDeleteExpired(db);
  }, 5 * 60 * 1000);

  const interval = setInterval(async () => {
    await runDeleteExpired(db);
  }, 60 * 60 * 1000);

  intervals.push(interval);
  logger.info('删除过期订单任务已注册（每1小时执行一次）');
}

/**
 * 执行删除过期订单
 * 删除超过 12 小时的 expired 订单。
 * @param {Object} db - 数据库实例
 */
async function runDeleteExpired(db) {
  try {
    const deleteTime = Math.floor(Date.now() / 1000) - 12 * 60 * 60;
    const result = await db.prepare(`
      DELETE FROM orders
      WHERE status = 'expired' AND created_at < ?
    `).run(deleteTime);

    if (result.changes > 0) {
      logger.info(`删除 ${result.changes} 个过期订单`);
    }
  } catch (error) {
    logger.error(`删除过期订单任务错误: ${error.message}`);
  }
}

module.exports = {
  registerDeleteExpiredJob,
  runDeleteExpired
};
