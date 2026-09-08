const { isHomeIpPlan } = require('./plan-type');

/**
 * 套餐售卖占用统计服务。
 * 负责把 plans.sales_count 的业务含义统一为“当前占用该套餐名额的用户数”。
 */

/**
 * 按套餐类型选择 users 表中表示套餐归属的字段。
 * 职责：流量套餐统计 users.plan_id，家宽 IP 套餐统计 users.home_plan_id。
 * 关键参数：plan 为套餐记录，需包含 plan_type。
 * 核心分支：home_ip 走家宽字段，其余套餐走主流量套餐字段。
 *
 * @param {Object} plan - 套餐记录。
 * @returns {string} users 表字段名。
 */
function getPlanOwnershipField(plan) {
  return isHomeIpPlan(plan) ? 'home_plan_id' : 'plan_id';
}

/**
 * 查询单个套餐当前占用用户数。
 * 职责：用于下单/续费前的强校验，避免依赖前端传回的展示值。
 * 关键参数：plan.id 为套餐 ID，plan_type 决定统计字段。
 * 核心分支：没有匹配用户时返回 0。
 *
 * @param {Object} db - 数据库代理对象。
 * @param {Object} plan - 套餐记录。
 * @returns {Promise<number>} 当前占用该套餐名额的用户数。
 */
async function getCurrentSalesCount(db, plan) {
  const field = getPlanOwnershipField(plan);
  const result = await db.prepare(`
    SELECT COUNT(*) as count
    FROM users
    WHERE ${field} = ?
      AND COALESCE(payment_count, 0) > 0
  `).get(plan.id);

  return Number(result?.count || 0);
}

/**
 * 为套餐列表批量覆盖实时售卖数。
 * 职责：让用户端、管理端和续费列表继续复用 sales_count 字段名。
 * 关键参数：plans 为待展示套餐列表。
 * 核心分支：家宽 IP 与流量套餐分别按不同归属字段批量统计，再按套餐类型写回。
 *
 * @param {Object} db - 数据库代理对象。
 * @param {Array<Object>} plans - 套餐列表。
 * @returns {Promise<Array<Object>>} 覆盖 sales_count 后的新套餐列表。
 */
async function annotatePlansWithCurrentSalesCount(db, plans) {
  if (!Array.isArray(plans) || plans.length === 0) {
    return [];
  }

  const trafficCounts = await db.prepare(`
    SELECT plan_id, COUNT(*) as count
    FROM users
    WHERE plan_id IS NOT NULL
      AND COALESCE(payment_count, 0) > 0
    GROUP BY plan_id
  `).all();
  const homeIpCounts = await db.prepare(`
    SELECT home_plan_id as plan_id, COUNT(*) as count
    FROM users
    WHERE home_plan_id IS NOT NULL
      AND COALESCE(payment_count, 0) > 0
    GROUP BY home_plan_id
  `).all();

  const trafficCountMap = buildCountMap(trafficCounts);
  const homeIpCountMap = buildCountMap(homeIpCounts);

  return plans.map((plan) => {
    const countMap = isHomeIpPlan(plan) ? homeIpCountMap : trafficCountMap;
    return {
      ...plan,
      sales_count: countMap.get(Number(plan.id)) || 0
    };
  });
}

/**
 * 将数据库分组统计结果转换为 Map。
 * @param {Array<Object>} rows - 包含 plan_id/count 的统计结果。
 * @returns {Map<number, number>} 套餐 ID 到占用数的映射。
 */
function buildCountMap(rows) {
  const countMap = new Map();
  for (const row of rows || []) {
    countMap.set(Number(row.plan_id), Number(row.count) || 0);
  }
  return countMap;
}

module.exports = {
  getCurrentSalesCount,
  annotatePlansWithCurrentSalesCount,
  __testables: {
    getPlanOwnershipField,
    buildCountMap
  }
};
