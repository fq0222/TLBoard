/**
 * 套餐仓储
 * 负责读取用户端套餐列表所需的 plans 表数据。
 */

/**
 * 查询所有已上架套餐。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Array<Object>>} 套餐记录列表
 */
async function findEnabledPlans(db) {
  return db.prepare(`
    SELECT id, name, description, price, duration_days, traffic_limit, plan_type, show_on_home, sort_order, sales_limit, sales_count
    FROM plans
    WHERE enabled = 1 AND show_on_home = 1
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
  if (planType === 'timed') {
    return db.prepare(`
      SELECT id, name, description, price, duration_days, traffic_limit, plan_type, show_on_home, sort_order, sales_limit, sales_count
      FROM plans
      WHERE enabled = 1 AND plan_type = ?
      ORDER BY sort_order ASC, id ASC
    `).all(planType);
  }

  return db.prepare(`
    SELECT id, name, description, price, duration_days, traffic_limit, plan_type, show_on_home, sort_order, sales_limit, sales_count
    FROM plans
    WHERE enabled = 1 AND (plan_type = 'lifetime' OR plan_type IS NULL OR plan_type = '')
    ORDER BY sort_order ASC, id ASC
  `).all();
}

module.exports = {
  findEnabledPlans,
  findEnabledPlansByType
};
