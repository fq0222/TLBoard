/**
 * 套餐仓储
 * 负责读取用户端套餐列表所需的 plans 表数据。
 */

/**
 * 查询当前首页可见的已上架套餐。
 * 职责：根据推广码校验结果切换首页可见性条件，使用单次查询避免重复套餐。
 * 核心分支：普通模式只展示 show_on_home，推广模式额外展示 show_on_referral_home。
 *
 * @param {Object} db - 数据库实例
 * @param {boolean} includeReferralHome - 当前请求是否携带有效启用推广码
 * @returns {Promise<Array<Object>>} 套餐记录列表
 */
async function findEnabledPlans(db, includeReferralHome = false) {
  const visibilityCondition = includeReferralHome
    ? '(show_on_home = 1 OR show_on_referral_home = 1)'
    : 'show_on_home = 1';

  return db.prepare(`
    SELECT id, name, description, price, duration_days, traffic_limit, plan_type, home_proxy_tag, show_on_home, show_on_referral_home, sort_order, sales_limit, sales_count
    FROM plans
    WHERE enabled = 1
      AND ${visibilityCondition}
    ORDER BY sort_order ASC, id ASC
  `).all();
}

/**
 * 按套餐类型查询所有已上架套餐。
 *
 * @param {Object} db - 数据库实例
 * @param {string} planType - 套餐类型，timed 仅匹配显式类型，lifetime 兼容历史空类型
 * @returns {Promise<Array<Object>>} 同类型且已上架的套餐记录列表，续费场景不按首页可见性过滤
 */
async function findEnabledPlansByType(db, planType) {
  if (planType === 'timed' || planType === 'home_ip') {
    return db.prepare(`
      SELECT id, name, description, price, duration_days, traffic_limit, plan_type, home_proxy_tag, show_on_home, sort_order, sales_limit, sales_count
      FROM plans
      WHERE enabled = 1 AND plan_type = ?
      ORDER BY sort_order ASC, id ASC
    `).all(planType);
  }

  return db.prepare(`
    SELECT id, name, description, price, duration_days, traffic_limit, plan_type, home_proxy_tag, show_on_home, sort_order, sales_limit, sales_count
    FROM plans
    WHERE enabled = 1 AND (plan_type = 'lifetime' OR plan_type IS NULL OR plan_type = '')
    ORDER BY sort_order ASC, id ASC
  `).all();
}

/**
 * 查询用户续费页可切换的全部流量套餐。
 * 职责：返回 timed 与 lifetime 两类已启用流量套餐，续费页不受首页展示开关限制。
 * 核心分支：历史空 plan_type 按 lifetime 处理，home_ip 套餐由独立查询追加。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Array<Object>>} 可续费或切换的流量套餐记录
 */
async function findEnabledTrafficRenewPlans(db) {
  return db.prepare(`
    SELECT id, name, description, price, duration_days, traffic_limit, plan_type, home_proxy_tag, show_on_home, sort_order, sales_limit, sales_count
    FROM plans
    WHERE enabled = 1
      AND COALESCE(plan_type, 'lifetime') != 'home_ip'
    ORDER BY sort_order ASC, id ASC
  `).all();
}

module.exports = {
  findEnabledPlans,
  findEnabledPlansByType,
  findEnabledTrafficRenewPlans
};
