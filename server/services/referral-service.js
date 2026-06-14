const crypto = require('crypto');
const { parsePagination } = require('../shared/utils/pagination');
const { getUserAppBaseUrl } = require('../shared/utils/site-url');
const referralRepository = require('../repositories/referral-repository');
const { createLogger } = require('../utils/logger');

const logger = createLogger('REFERRAL');

/**
 * 推广系统服务。
 *
 * 职责：处理推广码生成、点击记录、奖励发放、用户与管理端汇总等业务规则。
 * 关键参数：大多数函数首参为 db；req 仅用于生成当前站点推广链接。
 * 核心分支：无效推广码、自推、无奖励配置、重复回调等业务情况在此层消化。
 */

/**
 * 格式化流量值。
 *
 * 职责：将字节数转换为 B/KB/MB/GB/TB 文本。
 * 关键参数：bytes 可为 null、undefined、空字符串或数字字符串。
 * 核心分支：空值、非数字和 0 统一返回 0 B；其他数值按 1024 进制格式化。
 *
 * @param {*} bytes - 原始字节数
 * @returns {string} 格式化后的流量文本
 */
function formatTraffic(bytes) {
  if (bytes === null || bytes === undefined || bytes === '') return '0 B';
  const numBytes = Number(bytes);
  if (isNaN(numBytes) || numBytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.floor(Math.log(numBytes) / Math.log(k));
  return parseFloat((numBytes / Math.pow(k, index)).toFixed(2)) + ' ' + sizes[index];
}

/**
 * 格式化金额。
 *
 * 职责：将分单位金额转换成元文本。
 * 关键参数：amount 可为 null、undefined、数字或数字字符串。
 * 核心分支：空值、非数字和小于等于 0 时显示 0.00 元。
 *
 * @param {*} amount - 金额，单位分
 * @returns {string} 格式化后的金额文本
 */
function formatAmount(amount) {
  const cents = Number(amount);
  if (!Number.isFinite(cents) || cents <= 0) {
    return '0.00 元';
  }

  return `${(cents / 100).toFixed(2)} 元`;
}

/**
 * 生成推广码。
 *
 * 职责：生成不可预测的十六进制推广码。
 * 关键参数：无外部入参，使用 crypto.randomBytes 获取随机源。
 * 核心分支：无条件分支，调用失败时由 crypto 抛出异常。
 *
 * @returns {string} 32 位十六进制推广码
 */
function generateReferralCode() {
  return crypto.randomBytes(16).toString('hex');
}

const REFERRAL_CODE_WRITE_MAX_ATTEMPTS = 5;

/**
 * 判断错误是否来自 referral_codes.code 唯一冲突。
 *
 * 职责：仅识别推广码值撞码，供生成新 code 后有限重试使用。
 * 关键参数：error 为数据库写入异常，可能包含 code/constraint/message 字段。
 * 核心分支：PostgreSQL 23505 且约束或消息指向 referral_codes 的 code 冲突时返回 true。
 *
 * @param {Error} error - 数据库错误
 * @returns {boolean} 是否为推广码 code 唯一冲突
 */
function isReferralCodeUniqueConflict(error) {
  if (!error) {
    return false;
  }

  const constraint = String(error.constraint || '').toLowerCase();
  const message = String(error.message || '').toLowerCase();
  const isDuplicate = error.code === '23505' ||
    message.includes('duplicate') ||
    message.includes('unique');

  return isDuplicate && (
    constraint === 'referral_codes_code_key' ||
    message.includes('referral_codes_code_key')
  );
}

/**
 * 使用新生成的推广码执行写入，并在 code 唯一冲突时有限重试。
 *
 * 职责：集中保护创建/重置推广码时的随机 code 撞码场景。
 * 关键参数：codeFactory 负责生成候选 code，writeWithCode 负责执行具体写入。
 * 核心分支：code 唯一冲突且未超过次数时换码重试，其他错误和最终失败原样抛出。
 *
 * @param {Function} codeFactory - 推广码生成函数
 * @param {Function} writeWithCode - 接收 code 并写入数据库的函数
 * @param {number} [maxAttempts] - 最大尝试次数
 * @returns {Promise<Object>} 写入结果
 */
async function retryReferralCodeWrite(codeFactory, writeWithCode, maxAttempts = REFERRAL_CODE_WRITE_MAX_ATTEMPTS) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const code = codeFactory();

    try {
      return await writeWithCode(code);
    } catch (error) {
      if (!isReferralCodeUniqueConflict(error)) {
        throw error;
      }

      lastError = error;
      if (attempt === maxAttempts) {
        break;
      }
    }
  }

  throw lastError;
}

/**
 * 获取或创建用户推广码。
 *
 * 职责：用户已有推广码时复用，缺失时创建新推广码。
 * 关键参数：userId 为当前用户 ID，codeFactory 仅供测试注入固定随机码。
 * 核心分支：存在记录直接返回；不存在时调用 upsert 创建启用推广码。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {Function} [codeFactory] - 推广码生成函数
 * @returns {Promise<Object>} 推广码记录
 */
async function getOrCreateReferralCode(db, userId, codeFactory = generateReferralCode) {
  const existingCode = await referralRepository.findReferralCodeByUserId(db, userId);
  if (existingCode) {
    return existingCode;
  }

  return retryReferralCodeWrite(codeFactory, code => referralRepository.upsertReferralCode(db, {
    userId,
    code,
    enabled: 1
  }));
}

/**
 * 构造推广链接。
 *
 * 职责：基于当前请求协议和域名生成用户可分享的推广 URL。
 * 关键参数：req.protocol 与 req.get('host') 来自 Express 请求，code 为推广码。
 * 核心分支：推广码统一 encodeURIComponent，保证特殊字符不会破坏查询串。
 *
 * @param {Object} req - Express 请求对象
 * @param {string} code - 推广码
 * @returns {string} 推广链接
 */
function buildReferralLink(req, code) {
  const baseUrl = getUserAppBaseUrl(req);
  if (!baseUrl) {
    const hostname = req && req.hostname ? req.hostname : '';
    if (!hostname) {
      return `/?ref=${encodeURIComponent(code)}`;
    }

    return `${req.protocol || 'http'}://${hostname}:30000/?ref=${encodeURIComponent(code)}`;
  }

  return `${baseUrl}/?ref=${encodeURIComponent(code)}`;
}

/**
 * 获取用户推广汇总。
 *
 * 职责：聚合推广码、推广链接、点击数、奖励笔数和奖励余额。
 * 关键参数：req 用于生成 referral_url，userId 为当前用户 ID。
 * 核心分支：推广码缺失时自动创建；统计缺失时使用 0 兜底。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} req - Express 请求对象
 * @param {number} userId - 用户 ID
 * @param {Function} [codeFactory] - 推广码生成函数
 * @returns {Promise<Object>} 用户推广汇总
 */
async function getUserReferralSummary(db, req, userId, codeFactory = generateReferralCode) {
  const referralCode = await getOrCreateReferralCode(db, userId, codeFactory);
  const clickRow = await referralRepository.countReferralClicks(db, userId);
  const rewardRow = await referralRepository.sumReferralRewards(db, userId);
  const rewardAmount = Number(rewardRow && rewardRow.total !== undefined ? rewardRow.total : 0);

  return {
    code: referralCode.code,
    enabled: !!referralCode.enabled,
    referral_url: buildReferralLink(req, referralCode.code),
    click_count: Number((clickRow && clickRow.count) || 0),
    reward_count: Number((rewardRow && rewardRow.count) || 0),
    reward_amount: Number.isFinite(rewardAmount) ? rewardAmount : 0,
    reward_amount_text: formatAmount(rewardAmount)
  };
}

/**
 * 记录推广点击。
 *
 * 职责：仅对存在且启用的推广码落库点击记录。
 * 关键参数：payload.code 为推广码，payload.ip/userAgent 为点击上下文。
 * 核心分支：code 为空或无有效推广码时返回 recorded=false；有效时写入点击并返回 true。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 点击参数
 * @returns {Promise<{recorded:boolean}>} 点击记录结果
 */
async function recordClick(db, payload) {
  const code = payload && payload.code ? String(payload.code).trim() : '';
  if (!code) {
    return { recorded: false };
  }

  const referralCode = await referralRepository.findEnabledReferralCode(db, code);
  if (!referralCode) {
    return { recorded: false };
  }

  await referralRepository.recordReferralClick(db, {
    referrerUserId: referralCode.user_id,
    code: referralCode.code || code,
    ip: payload.ip,
    userAgent: payload.userAgent
  });

  return { recorded: true };
}

/**
 * 根据推广码解析推广人。
 *
 * 职责：注册时把有效推广码转换为推广人用户 ID。
 * 关键参数：code 为注册请求携带的推广码，registeringEmail 为新注册邮箱。
 * 核心分支：推广码不存在、禁用、注册邮箱等于推广人邮箱时返回 null。
 *
 * @param {Object} db - 数据库实例
 * @param {string} code - 推广码
 * @param {string} registeringEmail - 注册邮箱
 * @returns {Promise<number|null>} 推广人用户 ID 或 null
 */
async function resolveReferrerByCode(db, code, registeringEmail) {
  const normalizedCode = code ? String(code).trim() : '';
  if (!normalizedCode) {
    return null;
  }

  const referralCode = await referralRepository.findEnabledReferralCode(db, normalizedCode);
  if (!referralCode) {
    return null;
  }

  const referrerEmail = String(referralCode.email || '').trim().toLowerCase();
  const normalizedRegisteringEmail = String(registeringEmail || '').trim().toLowerCase();
  if (referrerEmail && normalizedRegisteringEmail && referrerEmail === normalizedRegisteringEmail) {
    return null;
  }

  return referralCode.user_id;
}

/**
 * 判断错误是否为唯一约束冲突。
 *
 * 职责：识别重复支付回调导致的推广奖励重复插入。
 * 关键参数：error 为 repository 插入奖励时抛出的异常。
 * 核心分支：PostgreSQL 23505 或错误文本包含常见唯一冲突关键词时返回 true。
 *
 * @param {Error} error - 数据库错误
 * @returns {boolean} 是否为唯一约束冲突
 */
function isReferralRewardUniqueConstraintError(error) {
  if (!error) {
    return false;
  }

  const constraint = String(error.constraint || '').toLowerCase();
  const message = String(error.message || '').toLowerCase();
  const isDuplicate = error.code === '23505' ||
    message.includes('duplicate') ||
    message.includes('unique');

  return isDuplicate && (
    constraint.includes('referral_rewards') ||
    message.includes('referral_rewards')
  );
}

/**
 * 发放首单推广奖励。
 *
 * 职责：支付成功后按配置给推广人增加奖励余额。
 * 关键参数：order.id 为订单 ID，order.user_id 为被推荐人，order.referrer_user_id 为推广人。
 * 核心分支：无推广人或奖励配置小于等于 0 返回 false；唯一约束冲突视为重复回调返回 false。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} order - 已支付订单
 * @returns {Promise<boolean>} 是否发放成功
 */
async function issueFirstPaymentReward(db, order) {
  if (!order || !order.referrer_user_id) {
    return false;
  }

  const setting = await referralRepository.findReferralRewardSetting(db);
  const rewardCoefficient = Number(setting && setting.value);
  if (!Number.isFinite(rewardCoefficient) || rewardCoefficient <= 0) {
    logger.warn(
      `跳过首单推广奖励: order=${order.id}, referrer=${order.referrer_user_id}, setting=${setting ? setting.value : 'missing'}`
    );
    return false;
  }

  const orderAmount = Number(order.amount);
  const rewardAmount = Math.floor(orderAmount * rewardCoefficient);
  if (!Number.isFinite(orderAmount) || orderAmount <= 0 || rewardAmount <= 0) {
    logger.warn(
      `跳过首单推广余额奖励: order=${order.id}, referrer=${order.referrer_user_id}, amount=${order.amount}, coefficient=${rewardCoefficient}`
    );
    return false;
  }

  try {
    await referralRepository.insertReferralReward(db, {
      referrerUserId: order.referrer_user_id,
      referredUserId: order.user_id,
      orderId: order.id,
      rewardAmount
    });
  } catch (error) {
    if (isReferralRewardUniqueConstraintError(error)) {
      logger.warn(`跳过重复推广奖励: order=${order.id}, referrer=${order.referrer_user_id}`);
      return false;
    }

    throw error;
  }

  await referralRepository.incrementUserBalance(db, order.referrer_user_id, rewardAmount);
  return true;
}

/**
 * 查询用户推广奖励列表。
 *
 * 职责：按用户维度分页返回奖励明细与总数。
 * 关键参数：query.page/query.limit 控制分页。
 * 核心分支：分页参数非法时使用默认值。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {Object} query - 查询参数
 * @returns {Promise<Object>} 分页奖励列表
 */
async function listUserRewards(db, userId, query = {}) {
  const { page, limit, offset } = parsePagination(query, {
    defaultPage: 1,
    defaultLimit: 20,
    maxLimit: 100
  });
  const rewardRow = await referralRepository.sumReferralRewards(db, userId);
  const list = await referralRepository.listReferralRewards(db, {
    userId,
    limit,
    offset
  });

  return {
    total: Number((rewardRow && rewardRow.count) || 0),
    page,
    limit,
    list
  };
}

/**
 * 查询管理端推广汇总列表。
 *
 * 职责：按筛选条件分页返回推广汇总。
 * 关键参数：query 同时包含分页和筛选字段。
 * 核心分支：enabled 透传给 repository 参与筛选，分页非法时使用默认值。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} query - 查询参数
 * @returns {Promise<Object>} 管理端分页汇总
 */
async function listAdminReferrals(db, query = {}) {
  const { page, limit, offset } = parsePagination(query, {
    defaultPage: 1,
    defaultLimit: 20,
    maxLimit: 100
  });
  const filters = {
    email: query.email,
    code: query.code,
    enabled: query.enabled
  };
  const totalRow = await referralRepository.countAdminReferralSummaries(db, filters);
  const list = await referralRepository.listAdminReferralSummaries(db, {
    filters,
    limit,
    offset
  });

  return {
    total: Number((totalRow && totalRow.total) || 0),
    page,
    limit,
    list
  };
}

/**
 * 查询管理端单个用户推广详情。
 *
 * 职责：返回指定用户的推广汇总与奖励分页。
 * 关键参数：userId 为目标用户，query 控制奖励分页。
 * 核心分支：复用汇总列表筛选 userId，并单独查询奖励明细。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {Object} query - 查询参数
 * @returns {Promise<Object>} 推广详情
 */
async function getAdminReferralDetail(db, userId, query = {}) {
  const rewards = await listUserRewards(db, userId, query);
  const summaries = await referralRepository.listAdminReferralSummaries(db, {
    filters: { userId },
    limit: 1,
    offset: 0
  });

  return {
    summary: summaries[0] || null,
    rewards
  };
}

/**
 * 设置用户推广码启用状态。
 *
 * 职责：管理端切换指定用户推广码状态。
 * 关键参数：enabled 为任意 truthy/falsy 值，最终转为布尔语义。
 * 核心分支：缺失推广码时不自动创建，仅返回 repository 更新结果。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {boolean} enabled - 是否启用
 * @returns {Promise<Object>} 更新结果
 */
async function setUserReferralEnabled(db, userId, enabled) {
  return referralRepository.setReferralCodeEnabled(db, userId, !!enabled);
}

/**
 * 重置用户推广码。
 *
 * 职责：为指定用户生成新推广码并写回。
 * 关键参数：userId 为目标用户，codeFactory 仅供测试注入固定随机码。
 * 核心分支：用户缺失推广码时先创建；已有推广码时重置为新码。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {Function} [codeFactory] - 推广码生成函数
 * @returns {Promise<Object>} 新推广码记录
 */
async function resetUserReferralCode(db, userId, codeFactory = generateReferralCode) {
  const existingCode = await referralRepository.findReferralCodeByUserId(db, userId);

  if (!existingCode) {
    return retryReferralCodeWrite(codeFactory, code => referralRepository.upsertReferralCode(db, {
      userId,
      code,
      enabled: 1
    }));
  }

  await retryReferralCodeWrite(codeFactory, code => referralRepository.resetReferralCode(db, {
    userId,
    code
  }));

  return referralRepository.findReferralCodeByUserId(db, userId);
}

module.exports = {
  formatTraffic,
  formatAmount,
  generateReferralCode,
  getOrCreateReferralCode,
  buildReferralLink,
  getUserReferralSummary,
  recordClick,
  resolveReferrerByCode,
  issueFirstPaymentReward,
  listUserRewards,
  listAdminReferrals,
  getAdminReferralDetail,
  setUserReferralEnabled,
  resetUserReferralCode
};
