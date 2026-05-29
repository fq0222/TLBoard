/**
 * 用户端套餐路由
 * 处理套餐列表查询。
 */

const express = require('express');
const {
  legacySuccess,
  legacyFail
} = require('../../shared/response/api-response');
const { formatTraffic } = require('../../shared/utils/format-traffic');
const { createLogger } = require('../../utils/logger');

const router = express.Router();
const logger = createLogger('USER-PLANS');

/**
 * GET /api/user/plans
 * 获取已上架套餐列表。
 */
router.get('/', async (req, res) => {
  try {
    const db = req.app.locals.db;

    const plans = await db.prepare(`
      SELECT id, name, description, price, duration_days, traffic_limit, sort_order, sales_limit, sales_count
      FROM plans
      WHERE enabled = 1
      ORDER BY sort_order ASC, id ASC
    `).all();

    const formattedPlans = plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      price: plan.price,
      price_text: (plan.price / 100).toFixed(2),
      duration_days: plan.duration_days,
      traffic_limit: plan.traffic_limit,
      traffic_text: formatTraffic(plan.traffic_limit),
      sort_order: plan.sort_order,
      sales_limit: plan.sales_limit,
      sales_count: plan.sales_count,
      is_soldout: plan.sales_limit !== -1 && plan.sales_count >= plan.sales_limit
    }));

    logger.info(`获取套餐列表成功，共 ${formattedPlans.length} 个套餐`);

    return legacySuccess(res, {
      plans: formattedPlans
    });
  } catch (error) {
    logger.error(`获取套餐列表错误: ${error.message}`);
    return legacyFail(res);
  }
});

module.exports = router;
