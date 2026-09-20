/**
 * 读取推广奖励百分比。
 * 职责：兼容接口直接返回百分比或仅返回奖励系数的情况，供多个推广入口统一展示。
 * 关键参数：summary 为推广汇总接口数据。
 * 核心分支：优先使用 reward_percent；缺失时由 reward_coefficient 换算；非法值返回 0。
 *
 * @param {Object} summary - 推广汇总数据
 * @returns {number} 奖励百分比
 */
export function normalizeReferralRewardPercent(summary = {}) {
  const directPercent = Number(summary.reward_percent)
  if (Number.isFinite(directPercent) && directPercent >= 0) {
    return directPercent
  }

  const coefficient = Number(summary.reward_coefficient)
  if (!Number.isFinite(coefficient) || coefficient < 0) {
    return 0
  }

  return Number((coefficient * 100).toFixed(2))
}

/**
 * 计算指定实付金额对应的推广奖励示例。
 * 职责：避免页面把“实付 100 元”的奖励金额写死，确保后台调整系数后文案同步更新。
 * 关键参数：paidAmount 为元单位示例金额，summary 为推广汇总接口数据。
 * 核心分支：奖励系数非法时返回 0；合法时保留两位精度并去除多余小数。
 *
 * @param {number} paidAmount - 好友实际支付金额，单位元
 * @param {Object} summary - 推广汇总数据
 * @returns {number} 奖励金额，单位元
 */
export function calculateReferralRewardAmount(paidAmount, summary = {}) {
  const amount = Number(paidAmount)
  const coefficient = Number(summary.reward_coefficient)
  if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(coefficient) || coefficient < 0) {
    return 0
  }

  return Number((amount * coefficient).toFixed(2))
}
