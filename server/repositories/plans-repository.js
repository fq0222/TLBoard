/**
 * 套餐仓储。
 * 负责 plans / users 相关的套餐数据访问，供管理端套餐模块复用。
 */

async function listPlans(db) {
  return db.prepare(`
    SELECT *
    FROM plans
    ORDER BY sort_order ASC, id ASC
  `).all();
}

/**
 * 根据套餐 ID 查询套餐详情。
 *
 * @param {Object} db - 数据库实例
 * @param {number} planId - 套餐 ID
 * @returns {Promise<Object|undefined>} 套餐记录
 */
async function findPlanById(db, planId) {
  return db.prepare('SELECT * FROM plans WHERE id = ?').get(planId);
}

/**
 * 创建套餐记录。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 套餐写入参数
 * @returns {Promise<Object>} 插入结果
 */
async function createPlan(db, payload) {
  const {
    name,
    description,
    price,
    durationDays,
    trafficLimit,
    sortOrder,
    enabled,
    salesLimit
  } = payload;

  return db.prepare(`
    INSERT INTO plans (name, description, price, duration_days, traffic_limit, sort_order, enabled, sales_limit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    description,
    price,
    durationDays,
    trafficLimit,
    sortOrder,
    enabled,
    salesLimit
  );
}

/**
 * 按动态字段更新套餐记录。
 *
 * @param {Object} db - 数据库实例
 * @param {number} planId - 套餐 ID
 * @param {Array<string>} updates - 更新语句片段
 * @param {Array<*>} values - 绑定参数
 * @returns {Promise<void>}
 */
async function updatePlanFields(db, planId, updates, values) {
  await db.prepare(`UPDATE plans SET ${updates.join(', ')} WHERE id = ?`).run(...values, planId);
}

/**
 * 统计仍在使用指定套餐的用户数量。
 *
 * @param {Object} db - 数据库实例
 * @param {number} planId - 套餐 ID
 * @returns {Promise<Object>} 统计结果
 */
async function countUsersByPlanId(db, planId) {
  return db.prepare('SELECT COUNT(*) as count FROM users WHERE plan_id = ?').get(planId);
}

/**
 * 删除套餐记录。
 *
 * @param {Object} db - 数据库实例
 * @param {number} planId - 套餐 ID
 * @returns {Promise<void>}
 */
async function deletePlan(db, planId) {
  await db.prepare('DELETE FROM plans WHERE id = ?').run(planId);
}

module.exports = {
  listPlans,
  findPlanById,
  createPlan,
  updatePlanFields,
  countUsersByPlanId,
  deletePlan
};
