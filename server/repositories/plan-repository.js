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
    SELECT id, name, description, price, duration_days, traffic_limit, sort_order, sales_limit, sales_count
    FROM plans
    WHERE enabled = 1
    ORDER BY sort_order ASC, id ASC
  `).all();
}

module.exports = {
  findEnabledPlans
};
