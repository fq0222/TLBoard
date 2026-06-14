/**
 * 用户续费资格判断
 *
 * 续费入口需要区分：
 * 1. 管理员手动禁用：不允许续费
 * 2. 流量超限禁用：允许续费，但 3 天内续费当前套餐免名额，超过 3 天则按目标套餐名额检查
 */

const DISABLE_REASONS = {
  ADMIN: 'admin',
  TRAFFIC_LIMIT: 'traffic_limit',
  EXPIRED: 'expired'
};

const RENEW_WINDOW_SECONDS = 3 * 24 * 60 * 60;

/**
 * 判断用户是否允许续费
 * @param {Object} user - 用户记录
 * @param {Object} plan - 目标套餐
 * @param {number} now - 当前 Unix 时间戳（秒）
 * @returns {{allowed: boolean, code?: number, message?: string, skipSalesLimit?: boolean}}
 */
function evaluateRenewEligibility(user, plan, now = Math.floor(Date.now() / 1000)) {
  const disableReason = user.disable_reason || null;
  const isDisabled = !user.enabled;
  const isRenewCurrentPlan = Number(user.plan_id) === Number(plan.id);
  const trafficUsedAt = Number(user.traffic_used_at || 0);
  const inRenewWindow = trafficUsedAt > 0 && (now - trafficUsedAt) <= RENEW_WINDOW_SECONDS;

  if (isDisabled) {
    if (disableReason === DISABLE_REASONS.ADMIN) {
      return {
        allowed: false,
        code: 2003,
        message: '账号已被禁用，请联系管理员'
      };
    }

    if (disableReason !== DISABLE_REASONS.TRAFFIC_LIMIT && disableReason !== DISABLE_REASONS.EXPIRED) {
      return {
        allowed: false,
        code: 2003,
        message: '账号当前状态异常，请联系管理员'
      };
    }
  }

  if (isRenewCurrentPlan && inRenewWindow) {
    return {
      allowed: true,
      skipSalesLimit: true
    };
  }

  if (plan.sales_limit !== -1 && Number(plan.sales_count) >= Number(plan.sales_limit)) {
    return {
      allowed: false,
      code: 1002,
      message: '该套餐已售罄'
    };
  }

  return {
    allowed: true,
    skipSalesLimit: false
  };
}

module.exports = {
  DISABLE_REASONS,
  RENEW_WINDOW_SECONDS,
  evaluateRenewEligibility
};
