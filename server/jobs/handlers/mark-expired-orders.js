/**
 * 标记过期订单任务
 * 负责注册并执行未支付订单的过期标记逻辑。
 */

const { createLogger } = require('../../utils/logger');

const logger = createLogger('JOBS');

/**
 * 注册标记过期订单任务
 * 启动时立即执行一次，之后每 10 分钟执行一次。
 * @param {Object} context - 任务上下文
 * @param {Object} context.db - 数据库实例
 * @param {Array} context.intervals - 间隔任务引用集合
 */
function registerMarkExpiredJob({ db, intervals }) {
  runMarkExpired(db);

  const interval = setInterval(async () => {
    await runMarkExpired(db);
  }, 10 * 60 * 1000);

  intervals.push(interval);
  logger.info('标记过期订单任务已注册（每10分钟执行一次）');
}

/**
 * 执行标记过期订单
 * 将超过 30 分钟未支付的 pending 订单标记为 expired。
 * @param {Object} db - 数据库实例
 */
async function runMarkExpired(db) {
  try {
    const expireTime = Math.floor(Date.now() / 1000) - 30 * 60;
    const result = await db.prepare(`
      UPDATE orders SET status = 'expired'
      WHERE status = 'pending' AND created_at < ?
    `).run(expireTime);

    if (result.changes > 0) {
      logger.info(`标记 ${result.changes} 个超时订单为过期`);
    }
  } catch (error) {
    logger.error(`标记过期订单任务错误: ${error.message}`);
  }
}

module.exports = {
  registerMarkExpiredJob
};
