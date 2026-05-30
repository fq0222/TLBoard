const { formatTraffic } = require('../../shared/utils/format-traffic');
const plansRepository = require('../../repositories/plans-repository');

/**
 * 管理端套餐服务。
 * 负责套餐列表、创建、编辑、删除等业务规则，并保持旧接口字段结构不变。
 */

function createLegacyBusinessError(message, options = {}) {
  const error = new Error(message);
  error.isLegacyBusinessError = true;
  error.statusCode = options.statusCode || 400;
  error.code = options.code || 1001;
  error.data = options.data === undefined ? null : options.data;
  return error;
}

/**
 * 格式化套餐输出，统一补齐价格与流量展示字段。
 *
 * @param {Object} plan - 原始套餐记录
 * @returns {Object} 兼容旧接口的套餐对象
 */
function formatPlan(plan) {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    price: plan.price,
    price_text: (Number(plan.price) / 100).toFixed(2),
    duration_days: plan.duration_days,
    traffic_limit: plan.traffic_limit,
    traffic_text: formatTraffic(plan.traffic_limit),
    sort_order: plan.sort_order,
    enabled: plan.enabled,
    sales_limit: plan.sales_limit,
    sales_count: plan.sales_count,
    updated_at: plan.updated_at,
    created_at: plan.created_at
  };
}

async function listPlans(db) {
  const plans = await plansRepository.listPlans(db);

  return {
    list: plans.map(formatPlan)
  };
}

/**
 * 创建套餐。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 创建参数
 * @returns {Promise<Object>} 新建套餐
 */
async function createPlan(db, payload) {
  const result = await plansRepository.createPlan(db, {
    name: payload.name,
    description: payload.description || null,
    price: payload.price,
    durationDays: payload.duration_days,
    trafficLimit: payload.traffic_limit,
    sortOrder: payload.sort_order === undefined ? 0 : payload.sort_order,
    enabled: payload.enabled === undefined ? 1 : (payload.enabled ? 1 : 0),
    salesLimit: payload.sales_limit === undefined ? -1 : payload.sales_limit
  });

  const createdPlan = await plansRepository.findPlanById(db, result.lastInsertRowid);
  return formatPlan(createdPlan);
}

/**
 * 更新套餐。
 *
 * @param {Object} db - 数据库实例
 * @param {number} planId - 套餐 ID
 * @param {Object} payload - 更新参数
 * @returns {Promise<Object>} 更新后的套餐
 */
async function updatePlan(db, planId, payload) {
  const existingPlan = await plansRepository.findPlanById(db, planId);
  if (!existingPlan) {
    throw createLegacyBusinessError('套餐不存在');
  }

  const updates = [];
  const values = [];

  if (payload.name !== undefined) {
    updates.push('name = ?');
    values.push(payload.name);
  }
  if (payload.description !== undefined) {
    updates.push('description = ?');
    values.push(payload.description);
  }
  if (payload.price !== undefined) {
    updates.push('price = ?');
    values.push(payload.price);
  }
  if (payload.duration_days !== undefined) {
    updates.push('duration_days = ?');
    values.push(payload.duration_days);
  }
  if (payload.traffic_limit !== undefined) {
    updates.push('traffic_limit = ?');
    values.push(payload.traffic_limit);
  }
  if (payload.sort_order !== undefined) {
    updates.push('sort_order = ?');
    values.push(payload.sort_order);
  }
  if (payload.enabled !== undefined) {
    updates.push('enabled = ?');
    values.push(payload.enabled ? 1 : 0);
  }
  if (payload.sales_limit !== undefined) {
    updates.push('sales_limit = ?');
    values.push(payload.sales_limit);
  }

  if (updates.length === 0) {
    throw createLegacyBusinessError('没有要更新的字段');
  }

  await plansRepository.updatePlanFields(db, planId, updates, values);
  const updatedPlan = await plansRepository.findPlanById(db, planId);
  return formatPlan(updatedPlan);
}

/**
 * 删除套餐。
 *
 * @param {Object} db - 数据库实例
 * @param {number} planId - 套餐 ID
 * @returns {Promise<Object>} 删除结果
 */
async function deletePlan(db, planId) {
  const existingPlan = await plansRepository.findPlanById(db, planId);
  if (!existingPlan) {
    throw createLegacyBusinessError('套餐不存在');
  }

  const userCount = await plansRepository.countUsersByPlanId(db, planId);
  if (Number(userCount.count) > 0) {
    throw createLegacyBusinessError('该套餐下仍有活跃用户，无法删除');
  }

  await plansRepository.deletePlan(db, planId);
  return {
    message: '套餐已删除'
  };
}

module.exports = {
  listPlans,
  createPlan,
  updatePlan,
  deletePlan
};
