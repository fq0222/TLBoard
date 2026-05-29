/**
 * 释放过期名额任务
 * 负责注册并执行套餐销售名额回收逻辑。
 */

const cron = require('node-cron');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('JOBS');

/**
 * 注册释放过期名额任务
 * 每天 5:00 执行，释放流量用完超过 3 天且未续费的用户名额。
 * @param {Object} context - 任务上下文
 * @param {Object} context.db - 数据库实例
 * @param {Array} context.cronTasks - cron 任务引用集合
 */
function registerReleaseExpiredSalesJob({ db, cronTasks }) {
  const task = cron.schedule('0 5 * * *', async () => {
    logger.info('开始执行释放过期名额任务...');
    await runReleaseExpiredSales(db);
  });

  cronTasks.push(task);
  logger.info('释放过期名额任务已注册（每天5:00执行）');
}

/**
 * 执行释放过期名额
 * 按套餐统计符合条件的用户，并回退对应套餐的 sales_count。
 * @param {Object} db - 数据库实例
 */
async function runReleaseExpiredSales(db) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const expiredUsers = await db.prepare(`
      SELECT u.id, u.email, u.plan_id, u.traffic_used_at, u.payment_count,
             p.name as plan_name, p.sales_count, p.sales_limit
      FROM users u
      JOIN plans p ON u.plan_id = p.id
      WHERE u.plan_id IS NOT NULL
        AND u.enabled = 0
        AND u.disable_reason = 'traffic_limit'
        AND u.traffic_used_at IS NOT NULL
        AND u.traffic_used_at < ? - 259200
        AND u.payment_count > 0
        AND NOT EXISTS (
          SELECT 1 FROM orders o
          WHERE o.user_id = u.id
            AND o.status = 'paid'
            AND o.created_at > u.traffic_used_at
        )
    `).all(now);

    if (expiredUsers.length === 0) {
      return;
    }

    logger.info(`发现 ${expiredUsers.length} 个用户需要释放名额`);

    const planGroups = {};
    for (const user of expiredUsers) {
      logger.info(`待释放用户: ${user.email}, 套餐: ${user.plan_name}, 付款次数: ${user.payment_count}, 流量用完: ${new Date(user.traffic_used_at * 1000).toLocaleString()}, 当前已售: ${user.sales_count}/${user.sales_limit === -1 ? '不限' : user.sales_limit}`);

      if (!planGroups[user.plan_id]) {
        planGroups[user.plan_id] = {
          plan_name: user.plan_name,
          count: 0,
          current_sales: user.sales_count,
          sales_limit: user.sales_limit
        };
      }

      planGroups[user.plan_id].count++;
    }

    let releasedCount = 0;

    for (const [planId, group] of Object.entries(planGroups)) {
      const result = await db.prepare(`
        UPDATE plans
        SET sales_count = GREATEST(0, sales_count - ?)
        WHERE id = ?
      `).run(group.count, planId);

      if (result.changes > 0) {
        releasedCount += group.count;
        logger.info(`释放套餐 ${group.plan_name} 名额 ${group.count} 个，已售: ${group.current_sales} -> ${group.current_sales - group.count}`);
      }
    }

    if (releasedCount > 0) {
      logger.info(`释放过期名额完成，共释放 ${releasedCount} 个名额`);
    }
  } catch (error) {
    logger.error(`释放过期名额任务错误: ${error.message}`);
  }
}

module.exports = {
  registerReleaseExpiredSalesJob
};
