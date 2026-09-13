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
 * 将用户当前套餐固定置顶，其余套餐按权重和 ID 稳定排序。
 * @param {Array<Object>} plans - 同一分类下的套餐列表。
 * @param {number|null} currentPlanId - 当前套餐 ID，没有当前套餐时传 null。
 * @returns {Array<Object>} 不修改原数组的有序套餐列表。
 */
export function sortPlansWithCurrentFirst(plans, currentPlanId) {
  return [...(plans || [])].sort((left, right) => {
    if (left.id === currentPlanId) return -1
    if (right.id === currentPlanId) return 1

    const weightDifference = Number(left.sort_order || 0) - Number(right.sort_order || 0)
    return weightDifference || Number(left.id) - Number(right.id)
  })
}

/**
 * 截取套餐列表的指定页。
 * @param {Array<Object>} plans - 已排序套餐列表。
 * @param {number} page - 从 1 开始的页码。
 * @param {number} pageSize - 每页套餐数量。
 * @returns {Array<Object>} 当前页套餐。
 */
export function paginatePlans(plans, page, pageSize) {
  const start = (Math.max(1, Number(page)) - 1) * pageSize
  return (plans || []).slice(start, start + pageSize)
}

/**
 * 计算指定套餐所在页，用于处理带套餐 ID 的定向跳转。
 * @param {Array<Object>} plans - 已排序套餐列表。
 * @param {number} planId - 需要显示的套餐 ID。
 * @param {number} pageSize - 每页套餐数量。
 * @returns {number} 从 1 开始的页码，未找到时返回第一页。
 */
export function resolvePlanPage(plans, planId, pageSize) {
  const index = (plans || []).findIndex((plan) => plan.id === planId)
  return index < 0 ? 1 : Math.floor(index / pageSize) + 1
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
