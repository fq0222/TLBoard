/**
 * 清理僵尸用户任务
 * 负责注册并执行未支付用户的定期清理逻辑。
 */

const { createLogger } = require('../../utils/logger');

const logger = createLogger('JOBS');

/**
 * 注册清理僵尸用户任务
 * 启动后延迟 2 分钟执行第一次，之后每 30 分钟执行一次。
 * @param {Object} context - 任务上下文
 * @param {Object} context.db - 数据库实例
 * @param {Array} context.intervals - 间隔任务引用集合
 * @param {Function} context.registerTimeout - 延迟任务注册函数
 */
function registerCleanZombieUsersJob({ db, intervals, registerTimeout }) {
  registerTimeout(async () => {
    await runCleanZombieUsers(db);
  }, 2 * 60 * 1000);

  const interval = setInterval(async () => {
    await runCleanZombieUsers(db);
  }, 30 * 60 * 1000);

  intervals.push(interval);
  logger.info('清理僵尸用户任务已注册（每30分钟执行一次）');
}

/**
 * 执行清理僵尸用户
 * 删除未支付且超过 12 小时的用户（enabled=0, payment_count=0）。
 * @param {Object} db - 数据库实例
 */
async function runCleanZombieUsers(db) {
  try {
    const expireTime = Math.floor(Date.now() / 1000) - 12 * 60 * 60;
    const result = await db.prepare(`
      DELETE FROM users
      WHERE enabled = 0
      AND payment_count = 0
      AND created_at < ?
    `).run(expireTime);

    if (result.changes > 0) {
      logger.info(`清理 ${result.changes} 个僵尸用户`);
    }
  } catch (error) {
    logger.error(`清理僵尸用户任务错误: ${error.message}`);
  }
}

module.exports = {
  registerCleanZombieUsersJob,
  runCleanZombieUsers
};
