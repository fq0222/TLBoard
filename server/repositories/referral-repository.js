/**
 * 推广系统仓储。
 *
 * 职责：集中封装 referral_codes、referral_clicks、referral_rewards 及相关用户配置 SQL。
 * 关键参数：所有函数首参均为项目 db 实例，其余参数为 SQL 绑定值或查询条件。
 * 核心分支：本文件不承载业务判断，仅按传入条件拼装和执行查询。
 */

/**
 * 查询用户自己的推广码。
 *
 * 职责：按用户 ID 读取推广码记录。
 * 关键参数：userId 为推广人用户 ID。
 * 核心分支：不存在时由数据库代理返回 null/undefined，调用方决定是否创建。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @returns {Promise<Object|undefined>} 推广码记录
 */
async function findReferralCodeByUserId(db, userId) {
  return db.prepare(`
    SELECT rc.*, u.email
    FROM referral_codes rc
    JOIN users u ON u.id = rc.user_id
    WHERE rc.user_id = ?
  `).get(userId);
}

/**
 * 查询启用中的推广码。
 *
 * 职责：按 code 读取可用推广码，并带出推广人邮箱用于防止自推。
 * 关键参数：code 为用户提交或链接携带的推广码。
 * 核心分支：SQL 仅返回 enabled = 1 的记录，禁用或不存在均返回空。
 *
 * @param {Object} db - 数据库实例
 * @param {string} code - 推广码
 * @returns {Promise<Object|undefined>} 启用中的推广码记录
 */
async function findEnabledReferralCode(db, code) {
  return db.prepare(`
    SELECT rc.*, u.email
    FROM referral_codes rc
    JOIN users u ON u.id = rc.user_id
    WHERE rc.code = ? AND rc.enabled = 1
  `).get(code);
}

/**
 * 新增或覆盖用户推广码。
 *
 * 职责：为用户创建推广码；用户已有记录时更新 code、enabled 与更新时间。
 * 关键参数：payload.userId 为用户 ID，payload.code 为新推广码，payload.enabled 控制启用状态。
 * 核心分支：依赖 PostgreSQL ON CONFLICT(user_id) 保证幂等写入。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 推广码写入参数
 * @returns {Promise<Object>} 写入后的推广码记录
 */
async function upsertReferralCode(db, payload) {
  const {
    userId,
    code,
    enabled = 1,
    updatedAt = Math.floor(Date.now() / 1000)
  } = payload;

  const result = await db.pool.query(
    `
      INSERT INTO referral_codes (user_id, code, enabled, updated_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id) DO UPDATE SET
        code = EXCLUDED.code,
        enabled = EXCLUDED.enabled,
        updated_at = EXCLUDED.updated_at
      RETURNING *
    `,
    [userId, code, enabled, updatedAt]
  );

  return result.rows[0];
}

/**
 * 记录推广链接点击。
 *
 * 职责：写入一次有效推广码点击记录。
 * 关键参数：payload.referrerUserId 为推广人，payload.code/ip/userAgent 为点击上下文。
 * 核心分支：不判断推广码是否有效，调用前由 service 决定是否记录。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 点击记录参数
 * @returns {Promise<Object>} 插入结果
 */
async function recordReferralClick(db, payload) {
  const {
    referrerUserId,
    code,
    ip,
    userAgent
  } = payload;

  return db.prepare(`
    INSERT INTO referral_clicks (referrer_user_id, code, ip, user_agent)
    VALUES (?, ?, ?, ?)
  `).run(referrerUserId, code, ip || null, userAgent || null);
}

/**
 * 统计用户推广点击数。
 *
 * 职责：按推广人用户 ID 统计点击记录数量。
 * 关键参数：userId 为推广人用户 ID。
 * 核心分支：无记录时 SQL COUNT 返回 0。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 推广人用户 ID
 * @returns {Promise<Object>} 统计行
 */
async function countReferralClicks(db, userId) {
  return db.prepare(`
    SELECT COUNT(*) as count
    FROM referral_clicks
    WHERE referrer_user_id = ?
  `).get(userId);
}

/**
 * 汇总用户推广奖励。
 *
 * 职责：统计奖励笔数与奖励流量总和。
 * 关键参数：userId 为推广人用户 ID。
 * 核心分支：无奖励时 COALESCE 保证 total 为 0。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 推广人用户 ID
 * @returns {Promise<Object>} 汇总行
 */
async function sumReferralRewards(db, userId) {
  return db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(reward_traffic), 0) as total
    FROM referral_rewards
    WHERE referrer_user_id = ?
  `).get(userId);
}

/**
 * 查询用户推广奖励列表。
 *
 * 职责：按推广人用户 ID 分页列出奖励明细。
 * 关键参数：payload.userId 为推广人，payload.limit/offset 为分页参数。
 * 核心分支：排序固定按创建时间与 ID 倒序。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 查询参数
 * @returns {Promise<Array>} 奖励列表
 */
async function listReferralRewards(db, payload) {
  const {
    userId,
    limit,
    offset
  } = payload;

  return db.prepare(`
    SELECT
      rr.*,
      u.email as referred_email,
      o.out_trade_no,
      o.amount
    FROM referral_rewards rr
    LEFT JOIN users u ON u.id = rr.referred_user_id
    LEFT JOIN orders o ON o.id = rr.order_id
    WHERE rr.referrer_user_id = ?
    ORDER BY rr.created_at DESC, rr.id DESC
    LIMIT ? OFFSET ?
  `).all(userId, limit, offset);
}

/**
 * 插入推广奖励。
 *
 * 职责：记录首单奖励，唯一约束冲突由 service 识别为重复回调。
 * 关键参数：payload.referrerUserId/referredUserId/orderId/rewardTraffic 描述奖励归属与额度。
 * 核心分支：不做去重判断，依赖数据库 UNIQUE(referred_user_id/order_id)。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 奖励写入参数
 * @returns {Promise<Object>} 插入结果
 */
async function insertReferralReward(db, payload) {
  const {
    referrerUserId,
    referredUserId,
    orderId,
    rewardTraffic
  } = payload;

  return db.prepare(`
    INSERT INTO referral_rewards (referrer_user_id, referred_user_id, order_id, reward_traffic)
    VALUES (?, ?, ?, ?)
  `).run(referrerUserId, referredUserId, orderId, rewardTraffic);
}

/**
 * 增加用户推广奖励流量额度。
 *
 * 职责：将奖励流量累加到 users.referral_traffic_limit。
 * 关键参数：userId 为推广人，rewardTraffic 为本次奖励字节数。
 * 核心分支：COALESCE 兼容历史空值。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 推广人用户 ID
 * @param {number} rewardTraffic - 奖励字节数
 * @returns {Promise<Object>} 更新结果
 */
async function incrementUserReferralTraffic(db, userId, rewardTraffic) {
  return db.prepare(`
    UPDATE users
    SET referral_traffic_limit = COALESCE(referral_traffic_limit, 0) + ?
    WHERE id = ?
  `).run(rewardTraffic, userId);
}

/**
 * 读取推广奖励流量配置。
 *
 * 职责：从 system_settings 读取 referral_reward_traffic 配置。
 * 关键参数：无业务入参。
 * 核心分支：不存在时返回空，service 视为不发放奖励。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Object|undefined>} 配置行
 */
async function findReferralRewardSetting(db) {
  return db.prepare(`
    SELECT value
    FROM system_settings
    WHERE key = 'referral_reward_traffic'
  `).get();
}

/**
 * 构造管理端推广汇总筛选条件。
 *
 * 职责：把 filters 转换为 SQL where 片段与绑定参数。
 * 关键参数：filters.userId/email/code/enabled 分别筛选用户、邮箱、推广码和启用状态。
 * 核心分支：空筛选返回空 where；userId 非正整数时跳过；enabled 只在非空时参与筛选并兼容字符串布尔值。
 *
 * @param {Object} filters - 管理端筛选条件
 * @returns {{whereClause:string, params:Array}} SQL 条件与参数
 */
function buildAdminSummaryFilters(filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.userId !== undefined && filters.userId !== null && filters.userId !== '') {
    const userId = Number(filters.userId);
    if (Number.isInteger(userId) && userId > 0) {
      conditions.push('u.id = ?');
      params.push(userId);
    }
  }

  if (filters.email) {
    conditions.push('u.email LIKE ?');
    params.push(`%${filters.email}%`);
  }

  if (filters.code) {
    conditions.push('rc.code LIKE ?');
    params.push(`%${filters.code}%`);
  }

  if (filters.enabled !== undefined && filters.enabled !== null && filters.enabled !== '') {
    conditions.push('COALESCE(rc.enabled, 0) = ?');
    params.push(filters.enabled === true || filters.enabled === 1 || filters.enabled === '1' || filters.enabled === 'true' ? 1 : 0);
  }

  return {
    whereClause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params
  };
}

/**
 * 查询管理端推广汇总列表。
 *
 * 职责：分页返回用户、推广码、点击数与奖励汇总。
 * 关键参数：payload.filters 为筛选条件，payload.limit/offset 为分页参数。
 * 核心分支：使用 LEFT JOIN 保留尚未生成推广码的用户。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 查询参数
 * @returns {Promise<Array>} 管理端汇总列表
 */
async function listAdminReferralSummaries(db, payload) {
  const {
    filters = {},
    limit,
    offset
  } = payload;
  const { whereClause, params } = buildAdminSummaryFilters(filters);

  return db.prepare(`
    SELECT
      u.id as user_id,
      u.email,
      COALESCE(u.referral_traffic_limit, 0) as referral_traffic_limit,
      rc.code,
      rc.enabled,
      rc.created_at as code_created_at,
      COALESCE(click_stats.click_count, 0) as click_count,
      COALESCE(reward_stats.reward_count, 0) as reward_count,
      COALESCE(reward_stats.reward_traffic, 0) as reward_traffic
    FROM users u
    LEFT JOIN referral_codes rc ON rc.user_id = u.id
    LEFT JOIN (
      SELECT referrer_user_id, COUNT(*) as click_count
      FROM referral_clicks
      GROUP BY referrer_user_id
    ) click_stats ON click_stats.referrer_user_id = u.id
    LEFT JOIN (
      SELECT referrer_user_id, COUNT(*) as reward_count, COALESCE(SUM(reward_traffic), 0) as reward_traffic
      FROM referral_rewards
      GROUP BY referrer_user_id
    ) reward_stats ON reward_stats.referrer_user_id = u.id
    ${whereClause}
    ORDER BY reward_traffic DESC, click_count DESC, u.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
}

/**
 * 统计管理端推广汇总数量。
 *
 * 职责：按管理端筛选条件统计用户数量，用于分页。
 * 关键参数：filters 与 listAdminReferralSummaries 的筛选语义一致。
 * 核心分支：只统计用户维度，不受点击或奖励明细数量影响。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} filters - 管理端筛选条件
 * @returns {Promise<Object>} 统计行
 */
async function countAdminReferralSummaries(db, filters = {}) {
  const { whereClause, params } = buildAdminSummaryFilters(filters);

  return db.prepare(`
    SELECT COUNT(*) as total
    FROM users u
    LEFT JOIN referral_codes rc ON rc.user_id = u.id
    ${whereClause}
  `).get(...params);
}

/**
 * 设置用户推广码启用状态。
 *
 * 职责：管理端启用或禁用指定用户推广码。
 * 关键参数：userId 为用户 ID，enabled 为目标状态。
 * 核心分支：只更新已存在推广码，缺失时返回 changes 0。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {boolean} enabled - 是否启用
 * @returns {Promise<Object>} 更新结果
 */
async function setReferralCodeEnabled(db, userId, enabled) {
  return db.prepare(`
    UPDATE referral_codes
    SET enabled = ?, updated_at = EXTRACT(EPOCH FROM NOW())
    WHERE user_id = ?
  `).run(enabled ? 1 : 0, userId);
}

/**
 * 重置用户推广码。
 *
 * 职责：将指定用户推广码更新为新 code 并保持启用。
 * 关键参数：payload.userId 为用户 ID，payload.code 为新推广码。
 * 核心分支：仅更新已有记录，缺失时由 service 先创建或调用 upsert。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 重置参数
 * @returns {Promise<Object>} 更新结果
 */
async function resetReferralCode(db, payload) {
  const {
    userId,
    code,
    updatedAt = Math.floor(Date.now() / 1000)
  } = payload;

  return db.prepare(`
    UPDATE referral_codes
    SET code = ?, enabled = 1, updated_at = ?
    WHERE user_id = ?
  `).run(code, updatedAt, userId);
}

module.exports = {
  findReferralCodeByUserId,
  findEnabledReferralCode,
  upsertReferralCode,
  recordReferralClick,
  countReferralClicks,
  sumReferralRewards,
  listReferralRewards,
  insertReferralReward,
  incrementUserReferralTraffic,
  findReferralRewardSetting,
  listAdminReferralSummaries,
  countAdminReferralSummaries,
  setReferralCodeEnabled,
  resetReferralCode
};
