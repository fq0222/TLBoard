const { formatTraffic } = require('../../shared/utils/format-traffic');
const plansRepository = require('../../repositories/plans-repository');
const planSalesService = require('../shared/plan-sales-service');
const {
  PLAN_TYPES,
  normalizePlanType,
  isHomeIpPlan,
  validatePlanDuration
} = require('../shared/plan-type');

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
 * 获取套餐类型展示文案。
 *
 * @param {string|null|undefined} planType - 原始套餐类型，空值按历史不限时套餐处理
 * @returns {string} 管理端列表展示用中文类型名
 */
function getPlanTypeText(planType) {
  const normalizedPlanType = normalizePlanType(planType);
  if (normalizedPlanType === PLAN_TYPES.HOME_IP) {
    return '家宽IP套餐';
  }
  return normalizedPlanType === PLAN_TYPES.TIMED ? '限时套餐' : '不限时套餐';
}

/**
 * 将管理端布尔输入归一化为数据库整数。
 *
 * @param {boolean|string|number} value - 路由校验后的布尔值，兼容 true/false、'true'/'false'、1/0、'1'/'0'
 * @returns {number} 明确开启返回 1，明确关闭返回 0，其他值按关闭处理
 */
function normalizeBooleanFlag(value) {
  if (value === true || value === 'true' || value === 1 || value === '1') {
    return 1;
  }

  return 0;
}

/**
 * 推断创建套餐时的套餐类型。
 *
 * @param {Object} payload - 创建套餐参数，读取 plan_type 和 duration_days
 * @returns {string} 显式 plan_type 优先；缺省时 0 天按不限时套餐，其他天数按限时套餐兼容旧管理端
 */
function resolveCreatePlanType(payload) {
  if (payload.plan_type !== undefined) {
    return normalizePlanType(payload.plan_type);
  }

  return Number(payload.duration_days) === 0 ? PLAN_TYPES.LIFETIME : PLAN_TYPES.TIMED;
}

/**
 * 归一化家宽 IP tag。
 *
 * @param {*} value - 管理端提交的 home_proxy_tag
 * @returns {string} 去除首尾空白后的 tag
 */
function normalizeHomeProxyTag(value) {
  return String(value || '').trim();
}

/**
 * 校验家宽 IP 套餐绑定的 tag。
 * 职责：只有 home_ip 套餐必须绑定已存在的 home_proxies.tag。
 * 核心分支：非家宽套餐返回 null，家宽套餐返回已归一化 tag。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} plan - 套餐草稿
 * @returns {Promise<string|null>} 家宽 tag 或空值
 */
async function validateHomeIpPlan(db, plan) {
  if (!isHomeIpPlan(plan)) {
    return null;
  }

  const tag = normalizeHomeProxyTag(plan.home_proxy_tag);
  if (!tag) {
    throw createLegacyBusinessError('家宽 IP 套餐必须绑定 tag');
  }

  const homeProxy = await db.prepare('SELECT * FROM home_proxies WHERE tag = ?').get(tag);
  if (!homeProxy) {
    throw createLegacyBusinessError('绑定的家宽 IP tag 不存在');
  }

  return tag;
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
    plan_type: normalizePlanType(plan.plan_type),
    plan_type_text: getPlanTypeText(plan.plan_type),
    home_proxy_tag: plan.home_proxy_tag || '',
    show_on_home: plan.show_on_home === undefined ? 1 : Number(plan.show_on_home),
    sort_order: plan.sort_order,
    enabled: plan.enabled,
    sales_limit: plan.sales_limit,
    sales_count: plan.sales_count,
    updated_at: plan.updated_at,
    created_at: plan.created_at
  };
}

async function listPlans(db) {
  const plans = await planSalesService.annotatePlansWithCurrentSalesCount(
    db,
    await plansRepository.listPlans(db)
  );

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
  const normalizedPlanType = resolveCreatePlanType(payload);
  const durationCheck = validatePlanDuration({
    plan_type: normalizedPlanType,
    duration_days: payload.duration_days
  });

  if (!durationCheck.valid) {
    throw createLegacyBusinessError(durationCheck.message);
  }
  const homeProxyTag = await validateHomeIpPlan(db, {
    plan_type: normalizedPlanType,
    home_proxy_tag: payload.home_proxy_tag
  });
  const trafficLimit = normalizedPlanType === PLAN_TYPES.HOME_IP ? 0 : payload.traffic_limit;

  const result = await plansRepository.createPlan(db, {
    name: payload.name,
    description: payload.description || null,
    price: payload.price,
    durationDays: payload.duration_days,
    trafficLimit,
    planType: normalizedPlanType,
    homeProxyTag,
    showOnHome: payload.show_on_home === undefined ? 1 : normalizeBooleanFlag(payload.show_on_home),
    sortOrder: payload.sort_order === undefined ? 0 : payload.sort_order,
    enabled: payload.enabled === undefined ? 1 : (payload.enabled ? 1 : 0),
    salesLimit: payload.sales_limit === undefined ? -1 : payload.sales_limit
  });

  const createdPlan = await plansRepository.findPlanById(db, result.lastInsertRowid);
  createdPlan.sales_count = await planSalesService.getCurrentSalesCount(db, createdPlan);
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

  const nextPlan = {
    ...existingPlan,
    plan_type: payload.plan_type === undefined ? existingPlan.plan_type : normalizePlanType(payload.plan_type),
    duration_days: payload.duration_days === undefined ? existingPlan.duration_days : payload.duration_days,
    home_proxy_tag: payload.home_proxy_tag === undefined ? existingPlan.home_proxy_tag : payload.home_proxy_tag
  };
  const durationCheck = validatePlanDuration(nextPlan);
  if (!durationCheck.valid) {
    throw createLegacyBusinessError(durationCheck.message);
  }
  const homeProxyTag = await validateHomeIpPlan(db, nextPlan);
  const nextPlanType = normalizePlanType(nextPlan.plan_type);

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
  if (payload.traffic_limit !== undefined || nextPlanType === PLAN_TYPES.HOME_IP) {
    updates.push('traffic_limit = ?');
    values.push(nextPlanType === PLAN_TYPES.HOME_IP ? 0 : payload.traffic_limit);
  }
  if (payload.plan_type !== undefined) {
    updates.push('plan_type = ?');
    values.push(nextPlanType);
  }
  if (payload.home_proxy_tag !== undefined || payload.plan_type !== undefined) {
    updates.push('home_proxy_tag = ?');
    values.push(nextPlanType === PLAN_TYPES.HOME_IP ? homeProxyTag : null);
  }
  if (payload.show_on_home !== undefined) {
    updates.push('show_on_home = ?');
    values.push(normalizeBooleanFlag(payload.show_on_home));
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
  updatedPlan.sales_count = await planSalesService.getCurrentSalesCount(db, updatedPlan);
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
