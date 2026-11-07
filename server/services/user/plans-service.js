const { formatTraffic } = require('../../shared/utils/format-traffic');
const planRepository = require('../../repositories/plan-repository');
const referralRepository = require('../../repositories/referral-repository');
const planSalesService = require('../shared/plan-sales-service');
const { normalizePlanType, isHomeIpPlan } = require('../shared/plan-type');

/**
 * 用户端套餐服务
 * 负责组装用户端套餐列表展示数据。
 */

/**
 * 获取用户端当前首页可见的已上架套餐列表。
 * 职责：校验当前推广码后查询套餐，保留实时销量和售罄计算。
 * 核心分支：空值、超长、不存在或禁用推广码均按普通首页返回，不产生参数错误。
 *
 * @param {Object} db - 数据库实例
 * @param {*} referralCode - 当前首页查询参数中的推广码，转为字符串并去除首尾空白
 * @returns {Promise<Array<Object>>} 格式化后的套餐列表
 */
async function listAvailablePlans(db, referralCode = '') {
  const normalizedReferralCode = String(referralCode ?? '').trim();
  let includeReferralHome = false;

  // 仅对非空且长度合规的推广码查库；仓储只返回启用记录，其他情况保持普通首页。
  if (normalizedReferralCode && normalizedReferralCode.length <= 64) {
    includeReferralHome = !!(await referralRepository.findEnabledReferralCode(db, normalizedReferralCode));
  }

  const plans = await planSalesService.annotatePlansWithCurrentSalesCount(
    db,
    await planRepository.findEnabledPlans(db, includeReferralHome)
  );

  return plans.map((plan) => ({
    id: plan.id,
    name: plan.name,
    description: plan.description,
    price: plan.price,
    price_text: (plan.price / 100).toFixed(2),
    duration_days: plan.duration_days,
    traffic_limit: plan.traffic_limit,
    traffic_text: isHomeIpPlan(plan) ? '不限制流量' : formatTraffic(plan.traffic_limit),
    plan_type: normalizePlanType(plan.plan_type),
    home_proxy_tag: plan.home_proxy_tag || '',
    show_on_home: plan.show_on_home === undefined ? 1 : Number(plan.show_on_home),
    show_on_referral_home: Number(plan.show_on_referral_home) === 1 ? 1 : 0,
    sort_order: plan.sort_order,
    sales_limit: plan.sales_limit,
    sales_count: plan.sales_count,
    is_soldout: Number(plan.sales_limit) !== -1 && Number(plan.sales_count) >= Number(plan.sales_limit)
  }));
}

module.exports = {
  listAvailablePlans
};
