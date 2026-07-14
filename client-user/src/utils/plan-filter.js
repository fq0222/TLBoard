/**
 * 按套餐时长类型筛选首页套餐。
 *
 * @param {Array<Object>} plans - 后端返回的套餐列表。
 * @param {'all'|'limited'|'unlimited'} durationType - 当前选择的分类。
 * @returns {Array<Object>} 符合分类条件的套餐列表。
 */
export function filterPlansByDurationType(plans, durationType) {
  if (durationType === 'limited') {
    return plans.filter((plan) => Number(plan.duration_days) !== 0)
  }

  if (durationType === 'unlimited') {
    return plans.filter((plan) => Number(plan.duration_days) === 0)
  }

  return plans
}
