/**
 * 判断是否为家宽 IP 套餐。
 * @param {Object} plan - 后端返回的套餐对象。
 * @returns {boolean} plan_type 为 home_ip 时返回 true。
 */
export function isHomeIpPlan(plan) {
  return plan?.plan_type === 'home_ip'
}

/**
 * 过滤流量套餐。
 * @param {Array<Object>} plans - 套餐列表。
 * @returns {Array<Object>} 排除家宽 IP 后的流量套餐列表。
 */
export function filterTrafficPlans(plans) {
  return (plans || []).filter((plan) => !isHomeIpPlan(plan))
}

/**
 * 过滤家宽 IP 套餐。
 * @param {Array<Object>} plans - 套餐列表。
 * @returns {Array<Object>} 仅包含家宽 IP 的套餐列表。
 */
export function filterHomeIpPlans(plans) {
  return (plans || []).filter((plan) => isHomeIpPlan(plan))
}

/**
 * 从流量套餐中选择默认推荐套餐。
 * @param {Array<Object>} plans - 原始套餐列表。
 * @returns {number|null} 推荐套餐 ID，没有可用套餐时返回 null。
 */
export function resolveRecommendedTrafficPlanId(plans) {
  const trafficPlans = filterTrafficPlans(plans)
  const preferred = trafficPlans.find((plan) => plan.is_recommended || plan.recommended)
  if (preferred) return preferred.id

  const availablePlans = trafficPlans.filter((plan) => !plan.is_soldout)
  if (availablePlans.length > 0) return availablePlans[0].id

  return trafficPlans[0]?.id ?? null
}

/**
 * 构建套餐页展示数据。
 * @param {Array<Object>} plans - 原始套餐列表。
 * @param {number|null} recommendedPlanId - 当前推荐的流量套餐 ID。
 * @returns {Array<Object>} 补齐推荐标记和时长文案后的套餐列表。
 */
export function buildDisplayPlans(plans, recommendedPlanId) {
  return (plans || []).map((plan) => ({
    ...plan,
    isRecommended: plan.id === recommendedPlanId,
    durationText: Number(plan.duration_days) === 0 ? '不限时套餐' : `${plan.duration_days} 天周期`
  }))
}
