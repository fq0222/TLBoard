/**
 * 按套餐时长类型筛选首页套餐。
 *
 * @param {Array<Object>} plans - 后端返回的套餐列表。
 * @param {'all'|'limited'|'unlimited'|'home_ip'} durationType - 当前选择的分类。
 * @returns {Array<Object>} 符合分类条件的套餐列表。
 */
export function filterPlansByDurationType(plans, durationType) {
  if (durationType === 'limited') {
    return plans.filter((plan) => plan.plan_type === 'timed')
  }

  if (durationType === 'unlimited') {
    return plans.filter((plan) => plan.plan_type === 'lifetime' || plan.plan_type == null || plan.plan_type === '')
  }

  if (durationType === 'home_ip') {
    return plans.filter((plan) => plan.plan_type === 'home_ip')
  }

  return plans
}
