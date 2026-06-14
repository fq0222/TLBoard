/**
 * 套餐类型辅助模块。
 * 职责：统一 plan_type 取值、限时/不限时判断、套餐天数校验和限时续费重置预览。
 */

const { formatTraffic } = require('../../shared/utils/format-traffic');

const PLAN_TYPES = {
  LIFETIME: 'lifetime',
  TIMED: 'timed'
};

/**
 * 归一化套餐类型。
 * @param {string|null|undefined} value - 数据库或请求中的 plan_type 原始值
 * @returns {string} 仅返回 lifetime 或 timed，历史空值按 lifetime 处理
 */
function normalizePlanType(value) {
  return value === PLAN_TYPES.TIMED ? PLAN_TYPES.TIMED : PLAN_TYPES.LIFETIME;
}

/**
 * 判断套餐是否为不限时套餐。
 * @param {object} plan - 套餐对象，读取 plan_type 字段
 * @returns {boolean} 空值和未知值均按历史不限时套餐处理
 */
function isLifetimePlan(plan) {
  return normalizePlanType(plan?.plan_type) === PLAN_TYPES.LIFETIME;
}

/**
 * 判断套餐是否为限时套餐。
 * @param {object} plan - 套餐对象，读取 plan_type 字段
 * @returns {boolean} 仅显式 timed 返回 true
 */
function isTimedPlan(plan) {
  return normalizePlanType(plan?.plan_type) === PLAN_TYPES.TIMED;
}

/**
 * 校验套餐有效天数与类型是否匹配。
 * @param {object} plan - 套餐对象，读取 plan_type 和 duration_days
 * @returns {{valid: boolean, message?: string}} lifetime 必须为 0，timed 必须大于 0
 */
function validatePlanDuration(plan) {
  const planType = normalizePlanType(plan?.plan_type);
  const durationDays = Number(plan?.duration_days || 0);

  if (planType === PLAN_TYPES.LIFETIME && (!Number.isFinite(durationDays) || durationDays !== 0)) {
    return {
      valid: false,
      message: '不限时套餐的有效天数必须为 0'
    };
  }

  if (planType === PLAN_TYPES.TIMED && (!Number.isFinite(durationDays) || durationDays <= 0)) {
    return {
      valid: false,
      message: '限时套餐的有效天数必须大于 0'
    };
  }

  return { valid: true };
}

/**
 * 构建限时套餐续费重置预览。
 * @param {object} user - 用户当前用量与过期时间，读取 traffic_used、traffic_limit、expire_at
 * @param {object} plan - 续费套餐，读取 traffic_limit 和 duration_days
 * @param {number} now - 当前秒级时间戳，默认使用系统当前时间
 * @returns {object} 剩余流量/时间、重置后流量和到期时间；仅剩余流量和时间同时存在时需要确认
 */
function buildTimedRenewResetPreview(user, plan, now = Math.floor(Date.now() / 1000)) {
  const trafficUsed = Number(user?.traffic_used || 0);
  const trafficLimit = Number(user?.traffic_limit || 0);
  const expireAt = Number(user?.expire_at || 0);
  const remainingTraffic = Math.max(0, trafficLimit - trafficUsed);
  const remainingSeconds = expireAt > now ? expireAt - now : 0;
  const resetTrafficLimit = Number(plan?.traffic_limit || 0);
  const durationSeconds = Number(plan?.duration_days || 0) * 24 * 60 * 60;
  const resetExpireAt = now + durationSeconds;

  return {
    requires_confirm: remainingTraffic > 0 && remainingSeconds > 0,
    remaining_traffic: remainingTraffic,
    remaining_traffic_text: formatTraffic(remainingTraffic),
    remaining_seconds: remainingSeconds,
    reset_traffic_limit: resetTrafficLimit,
    reset_traffic_limit_text: formatTraffic(resetTrafficLimit),
    reset_expire_at: resetExpireAt
  };
}

module.exports = {
  PLAN_TYPES,
  normalizePlanType,
  isLifetimePlan,
  isTimedPlan,
  validatePlanDuration,
  buildTimedRenewResetPreview
};
