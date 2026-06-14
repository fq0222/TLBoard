const { formatTraffic } = require('../../shared/utils/format-traffic');
const planRepository = require('../../repositories/plan-repository');
const { normalizePlanType } = require('../shared/plan-type');

/**
 * 用户端套餐服务
 * 负责组装用户端套餐列表展示数据。
 */

/**
 * 获取用户端已上架套餐列表。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Array<Object>>} 格式化后的套餐列表
 */
async function listAvailablePlans(db) {
  const plans = await planRepository.findEnabledPlans(db);

  return plans.map((plan) => ({
    id: plan.id,
    name: plan.name,
    description: plan.description,
    price: plan.price,
    price_text: (plan.price / 100).toFixed(2),
    duration_days: plan.duration_days,
    traffic_limit: plan.traffic_limit,
    traffic_text: formatTraffic(plan.traffic_limit),
    plan_type: normalizePlanType(plan.plan_type),
    show_on_home: plan.show_on_home === undefined ? 1 : Number(plan.show_on_home),
    sort_order: plan.sort_order,
    sales_limit: plan.sales_limit,
    sales_count: plan.sales_count,
    is_soldout: plan.sales_limit !== -1 && plan.sales_count >= plan.sales_limit
  }));
}

module.exports = {
  listAvailablePlans
};
