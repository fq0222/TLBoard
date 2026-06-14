const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../../config');
const vmqService = require('../../integrations/vmq/vmq-service');
const sharedEmailService = require('../../integrations/email/email-service');
const userRepository = require('../../repositories/user-repository');
const emailRepository = require('../../repositories/email-repository');
const referralService = require('../referral-service');
const { DISABLE_REASONS } = require('../shared/renew-policy');

const TELEGRAM_CHANNEL_URL_KEY = 'telegram_channel_url';
const PASSWORD_RESET_MESSAGE = '如果该邮箱已注册，重置密码邮件已发送，请查收。';
const PASSWORD_RESET_TOKEN_TTL_SECONDS = 15 * 60;
const PASSWORD_RESET_DAILY_WINDOW_SECONDS = 24 * 60 * 60;
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

/**
 * 用户认证服务。
 * 负责注册下单、登录、资料聚合等用户认证相关业务编排，
 * 保持旧接口的业务语义与错误码兼容。
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
 * 获取当前秒级时间戳。
 *
 * @returns {number} 秒级 Unix 时间戳
 */
function getNowTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * 生成密码重置邮件 HTML 内容。
 * 职责：把一次性重置链接和频率限制说明封装成固定安全文案。
 *
 * @param {string} resetUrl - 不包含邮箱或用户 ID 的重置链接
 * @returns {string} 邮件 HTML 内容
 */
function buildPasswordResetEmailContent(resetUrl) {
  return `
    <div style="margin:0;padding:32px 16px;background:#eef4f2;font-family:Arial,'Microsoft YaHei',sans-serif;color:#14213d;line-height:1.7;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #dce7e4;border-radius:16px;overflow:hidden;">
        <div style="padding:24px 28px;background:#0f766e;color:#ffffff;">
          <div style="font-size:14px;letter-spacing:0;font-weight:700;opacity:0.9;">天澜大陆消息</div>
          <h2 style="margin:8px 0 0;font-size:24px;line-height:1.35;font-weight:700;">密码重置</h2>
        </div>
        <div style="padding:28px;">
          <p style="margin:0 0 18px;font-size:15px;color:#334155;">你正在申请重置天澜大陆账号密码，请点击下方按钮完成操作。</p>
          <div style="margin:26px 0;text-align:center;">
            <a href="${resetUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:13px 30px;border-radius:10px;background:#0f766e;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;">重置密码</a>
          </div>
          <div style="margin:22px 0;padding:14px 16px;border-left:4px solid #f59e0b;background:#fff7ed;border-radius:8px;color:#7c2d12;font-size:14px;">
            该链接只能使用一次，有效期为 15 分钟。每天只能申请重置一次密码。
          </div>
          <p style="margin:18px 0 0;font-size:14px;color:#64748b;">如果这不是你本人发起的请求，请忽略本邮件。为了账号安全，请不要将邮件转发给他人。</p>
        </div>
        <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px;">
          此邮件由系统自动发送，请勿直接回复。
        </div>
      </div>
    </div>
  `;
}

/**
 * 获取今日零点秒级时间戳。
 * 职责：与邮件群发任务保持同一日配额统计口径。
 *
 * @returns {number} 今日零点秒级时间戳
 */
function getTodayStartTimestamp() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor(today.getTime() / 1000);
}

/**
 * 检查 Brevo 每日总邮件配额是否仍有余量。
 * 职责：让密码重置邮件计入并遵守后台配置的每日总发送限制。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Promise<{allowed:boolean,todayCount:number,dailyLimit:number}>} 配额状态
 */
async function checkDailyEmailQuota(db) {
  const todayCountRow = await emailRepository.countTodayEmailLogs(db, getTodayStartTimestamp());
  const dailyLimitRow = await emailRepository.findBrevoDailyLimit(db);
  const todayCount = Number(todayCountRow?.count || 0);
  const dailyLimit = dailyLimitRow ? parseInt(dailyLimitRow.value, 10) : 200;

  return {
    allowed: todayCount < dailyLimit,
    todayCount,
    dailyLimit
  };
}

/**
 * 申请密码重置邮件。
 * 职责：始终返回模糊提示；邮箱存在且未超过每日限制时创建高熵 Token 并发送邮件。
 * 核心分支：未知邮箱直接返回；今日已申请直接返回；邮件发送失败不向前端暴露账号状态。
 *
 * @param {Object} db - 数据库代理对象
 * @param {{email:string,ip:string,baseUrl:string}} payload - 申请参数
 * @returns {Promise<{message:string}>} 模糊提示结果
 */
async function requestPasswordReset(db, payload) {
  const email = String(payload.email || '').trim().toLowerCase();
  const user = await userRepository.findPasswordResetUserByEmail(db, email);
  if (!user) {
    return {
      message: PASSWORD_RESET_MESSAGE,
      audit: {
        status: 'unknown_email'
      }
    };
  }

  const now = getNowTimestamp();
  const createdAfter = now - PASSWORD_RESET_DAILY_WINDOW_SECONDS;
  const todayCount = await userRepository.countPasswordResetTokensSince(db, user.id, createdAfter);
  if (Number(todayCount?.count || 0) >= 1) {
    return {
      message: PASSWORD_RESET_MESSAGE,
      audit: {
        status: 'daily_limit_reached',
        userId: user.id
      }
    };
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = now + PASSWORD_RESET_TOKEN_TTL_SECONDS;
  const baseUrl = String(payload.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) {
    return {
      message: PASSWORD_RESET_MESSAGE,
      audit: {
        status: 'missing_base_url',
        userId: user.id
      }
    };
  }

  const quota = await checkDailyEmailQuota(db);
  if (!quota.allowed) {
    return {
      message: PASSWORD_RESET_MESSAGE,
      audit: {
        status: 'daily_email_limit_reached',
        userId: user.id,
        todayCount: quota.todayCount,
        dailyLimit: quota.dailyLimit
      }
    };
  }

  await userRepository.createPasswordResetToken(db, {
    userId: user.id,
    token,
    expiresAt,
    requestIp: payload.ip || '',
    createdAt: now
  });

  const resetUrl = `${baseUrl}/reset-password?token=${token}`;
  const emailResult = await sharedEmailService.sendEmail(db, {
    to: user.email,
    subject: '【天澜大陆消息】密码重置',
    content: buildPasswordResetEmailContent(resetUrl)
  });

  if (emailResult?.success) {
    await emailRepository.createEmailLog(db, {
      userId: user.id,
      email: user.email,
      subject: '【天澜大陆消息】密码重置',
      status: 'sent',
      sentAt: now,
      createdAt: now
    });
  }

  return {
    message: PASSWORD_RESET_MESSAGE,
    audit: {
      status: emailResult?.success ? 'email_sent' : 'email_send_failed',
      userId: user.id,
      error: emailResult?.error || ''
    }
  };
}

/**
 * 使用一次性 Token 重置密码。
 * 职责：验证 Token 存在、未过期、未使用；提交后立即标记已使用，再更新密码。
 * 核心分支：Token 无效拒绝；有效 Token 会先失效，密码不合规则不会保留重试机会。
 *
 * @param {Object} db - 数据库代理对象
 * @param {{token:string,password:string}} payload - 重置参数
 * @returns {Promise<{reset:boolean}>} 重置结果
 */
async function resetPassword(db, payload) {
  const token = String(payload.token || '').trim();
  const password = String(payload.password || '');
  const now = getNowTimestamp();
  const resetToken = await userRepository.findPasswordResetToken(db, token);

  if (!resetToken || resetToken.used_at || Number(resetToken.expires_at) < now) {
    throw createLegacyBusinessError('重置链接无效或已过期，请重新申请', {
      code: 2010
    });
  }

  await userRepository.markPasswordResetTokenUsed(db, token, now);

  if (!PASSWORD_PATTERN.test(password)) {
    throw createLegacyBusinessError('密码需至少8位，并同时包含字母和数字', {
      code: 1001
    });
  }

  const passwordHash = await bcrypt.hash(password, config.security.bcryptRounds);
  await userRepository.updateUserPasswordHash(db, resetToken.user_id, passwordHash, now);

  return { reset: true };
}

/**
 * 获取官方 Telegram 频道链接。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Promise<string>} 频道链接
 */
async function getTelegramChannelUrl(db) {
  const setting = await userRepository.findSystemSettingByKey(db, TELEGRAM_CHANNEL_URL_KEY);
  return String(setting?.value || '').trim();
}

/**
 * 格式化流量值，兼容空值与字符串数字。
 *
 * @param {*} bytes - 原始流量值
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
 * 统一计算用户的套餐流量和总流量。
 *
 * @param {Object} user - 用户记录，需包含 traffic_limit
 * @returns {{planTrafficLimit:number,referralTrafficLimit:number,totalTrafficLimit:number}} 流量权益汇总
 */
function getUserTrafficEntitlement(user) {
  const planTrafficLimit = Number(user?.traffic_limit) || 0;

  return {
    planTrafficLimit,
    referralTrafficLimit: 0,
    totalTrafficLimit: planTrafficLimit
  };
}

/**
 * 判断禁用用户是否应被登录入口拦截。
 * 职责：区分管理员封禁账号和流量超限暂停节点，流量超限用户仍需登录后续费。
 *
 * @param {Object} user - 登录查询返回的用户记录
 * @returns {boolean} 是否需要拒绝登录
 */
function shouldBlockDisabledUserLogin(user) {
  if (user.enabled) {
    return false;
  }

  return user.disable_reason !== DISABLE_REASONS.TRAFFIC_LIMIT;
}

/**
 * 推导用户端个人中心账号状态。
 * 职责：账号未禁用统一显示正常；禁用时按 disable_reason 区分管理员禁用和流量超限续费。
 *
 * @param {Object} user - 用户资料记录
 * @returns {{status:string,status_text:string}} 前端展示状态
 */
function buildUserProfileStatus(user) {
  if (user.enabled) {
    return {
      status: 'active',
      status_text: '正常'
    };
  }

  if (user.disable_reason === DISABLE_REASONS.TRAFFIC_LIMIT) {
    return {
      status: 'renew',
      status_text: '续费'
    };
  }

  return {
    status: 'disabled',
    status_text: '禁用'
  };
}

/**
 * 格式化用户到期时间，兼容不限期账号。
 *
 * @param {*} timestamp - 秒级时间戳
 * @returns {string} 格式化后的时间文本
 */
function formatTime(timestamp) {
  if (!timestamp || timestamp === 0 || timestamp === '0') {
    return '无限期';
  }

  return new Date(Number(timestamp) * 1000).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false
  });
}

/**
 * 创建注册待支付订单并返回 VMQ 支付信息。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - 注册与支付参数
 * @returns {Promise<Object>} 下单结果
 */
async function registerAndPay(db, payload) {
  const {
    email,
    password,
    plan_id: planId
  } = payload;
  const payType = Number(payload.pay_type || config.payment.vmqDefaultType || 2);
  const existingUser = await userRepository.findUserRegisterSnapshotByEmail(db, email);

  if (existingUser) {
    const now = getNowTimestamp();
    const expireAt = Number(existingUser.expire_at) || 0;
    if (existingUser.enabled && (expireAt === 0 || expireAt > now)) {
      throw createLegacyBusinessError('该邮箱已注册，如需续费请先登录', {
        code: 2001
      });
    }
  }

  const plan = await userRepository.findEnabledPlanById(db, planId);
  if (!plan) {
    throw createLegacyBusinessError('套餐不存在或已下架');
  }

  if (plan.sales_limit !== -1 && plan.sales_count >= plan.sales_limit) {
    throw createLegacyBusinessError('该套餐已售罄', {
      code: 1002
    });
  }

  const subscriptionToken = crypto.randomUUID();
  const subId = crypto.randomBytes(8).toString('hex');
  const passwordHash = await bcrypt.hash(password, config.security.bcryptRounds);
  const now = getNowTimestamp();
  // 注册归因：推广码只用于绑定订单来源，无效或自推时返回 null，不阻断正常注册下单。
  const referrerUserId = await referralService.resolveReferrerByCode(db, payload.referral_code, email);

  const transaction = db.transaction(async (transactionDb) => {
    let userId;
    if (existingUser) {
      await userRepository.updateRegisteredUserForPlan(transactionDb, {
        userId: existingUser.id,
        passwordHash,
        planId,
        subscriptionToken,
        subId,
        trafficLimit: plan.traffic_limit,
        updatedAt: now
      });
      userId = existingUser.id;
    } else {
      const userResult = await userRepository.createRegisteredUser(transactionDb, {
        email,
        passwordHash,
        planId,
        subscriptionToken,
        subId,
        trafficLimit: plan.traffic_limit
      });
      userId = Number(userResult.lastInsertRowid);
    }

    const outTradeNo = `ORD${Date.now()}${Math.random().toString(36).substr(2, 9)}`;
    const orderResult = await userRepository.createPendingOrder(transactionDb, {
      userId,
      email,
      planId,
      amount: plan.price,
      outTradeNo,
      referrerUserId
    });

    return {
      userId,
      orderId: Number(orderResult.lastInsertRowid),
      outTradeNo,
      plan
    };
  });

  const transactionResult = await transaction();
  const amount = (Number(transactionResult.plan.price) / 100).toFixed(2);
  const vmqResult = await vmqService.createOrder({
    payId: transactionResult.outTradeNo,
    param: String(transactionResult.userId),
    type: payType,
    price: amount,
    isHtml: 0
  });

  if (Number(vmqResult.code) !== 1 || !vmqResult.data) {
    await userRepository.markOrderExpiredByOutTradeNo(db, transactionResult.outTradeNo);
    throw createLegacyBusinessError(vmqResult.msg || '创建VMQ支付订单失败', {
      statusCode: 502,
      code: 5002
    });
  }

  if (Number(vmqResult.data.isAuto) === 1) {
    await userRepository.markOrderExpiredByOutTradeNo(db, transactionResult.outTradeNo);

    try {
      await vmqService.closeOrder(vmqResult.data.orderId);
    } catch (error) {
      // 关闭失败仅记录兼容行为，保持主流程返回原业务错误。
    }

    throw createLegacyBusinessError(
      '当前支付通道需要用户手动输入金额，存在少付风险，请更换VMQ监控通道配置后再试',
      {
        statusCode: 502,
        code: 5003
      }
    );
  }

  const realAmount = Math.round(Number(vmqResult.data.reallyPrice) * 100);
  await userRepository.updateOrderPaymentInfo(db, {
    outTradeNo: transactionResult.outTradeNo,
    tradeNo: vmqResult.data.orderId,
    paymentUrl: vmqResult.data.payUrl,
    amount: realAmount
  });

  return {
    order_id: transactionResult.orderId,
    user_id: transactionResult.userId,
    out_trade_no: transactionResult.outTradeNo,
    vmq_order_id: vmqResult.data.orderId,
    pay_type: vmqResult.data.payType,
    really_price: vmqResult.data.reallyPrice,
    payment_url: vmqResult.data.payUrl,
    expire_in: Number(vmqResult.data.timeOut || 5) * 60
  };
}

/**
 * 校验用户邮箱和密码并签发登录令牌。
 *
 * @param {Object} db - 数据库代理对象
 * @param {{email:string,password:string}} payload - 登录参数
 * @returns {Promise<Object>} 登录结果
 */
async function login(db, payload) {
  const { email, password } = payload;
  const user = await userRepository.findLoginUserByEmail(db, email);

  if (!user) {
    throw createLegacyBusinessError('邮箱或密码错误', {
      code: 2002
    });
  }

  const isValidPassword = await bcrypt.compare(password, user.password_hash);
  if (!isValidPassword) {
    throw createLegacyBusinessError('邮箱或密码错误', {
      code: 2002
    });
  }

  if (shouldBlockDisabledUserLogin(user)) {
    throw createLegacyBusinessError('账号已被禁用，请联系管理员', {
      code: 2003
    });
  }

  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      plan_id: user.plan_id
    },
    config.user.jwtSecret,
    { expiresIn: config.user.jwtExpiresIn }
  );

  return {
    token,
    expires_in: 604800,
    user: {
      id: user.id,
      email: user.email,
      plan_name: user.plan_name,
      expire_at: user.expire_at,
      enabled: user.enabled
    }
  };
}

/**
 * 聚合当前用户资料与订阅状态。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<Object>} 资料结果
 */
async function getProfile(db, userId) {
  const user = await userRepository.findUserProfileById(db, userId);
  if (!user) {
    throw createLegacyBusinessError('用户不存在', {
      code: 2004
    });
  }

  const cfOptimized = !!(await userRepository.hasUserCfIps(db, userId));
  const subscriptionReady = cfOptimized && !!(await userRepository.hasUserSubscriptionCache(db, user.sub_id));
  const telegramChannelUrl = await getTelegramChannelUrl(db);
  const trafficUsed = Number(user.traffic_used) || 0;
  const {
    planTrafficLimit,
    referralTrafficLimit,
    totalTrafficLimit
  } = getUserTrafficEntitlement(user);
  const trafficPercent = totalTrafficLimit > 0
    ? Math.round((trafficUsed / totalTrafficLimit) * 100 * 100) / 100
    : 0;
  const profileStatus = buildUserProfileStatus(user);

  return {
    id: user.id,
    email: user.email,
    plan_id: user.plan_id,
    plan_name: user.plan_name,
    sub_id: user.sub_id,
    cf_optimized: cfOptimized,
    subscription_ready: subscriptionReady,
    telegram_channel_url: telegramChannelUrl,
    traffic_used: user.traffic_used,
    plan_traffic_limit: planTrafficLimit,
    plan_traffic_limit_text: formatTraffic(planTrafficLimit),
    referral_traffic_limit: referralTrafficLimit,
    referral_traffic_limit_text: formatTraffic(referralTrafficLimit),
    total_traffic_limit: totalTrafficLimit,
    total_traffic_limit_text: formatTraffic(totalTrafficLimit),
    // 兼容旧字段：旧页面继续读取总流量上限，避免把套餐流量误显示为总额度。
    traffic_limit: totalTrafficLimit,
    traffic_used_text: formatTraffic(user.traffic_used),
    traffic_limit_text: formatTraffic(totalTrafficLimit),
    traffic_percent: trafficPercent,
    balance: Number(user.balance) || 0,
    balance_text: `${((Number(user.balance) || 0) / 100).toFixed(2)} 元`,
    expire_at: user.expire_at,
    expire_text: formatTime(user.expire_at),
    enabled: user.enabled,
    disable_reason: user.disable_reason,
    status: profileStatus.status,
    status_text: profileStatus.status_text,
    created_at: user.created_at,
    payment_count: user.payment_count,
    sync_status: user.sync_status,
    onboarding_completed: !!user.onboarding_completed
  };
}

/**
 * 标记当前用户已完成新手引导。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<Object>} 完成状态
 */
async function completeOnboarding(db, userId) {
  await userRepository.markUserOnboardingCompleted(db, userId);
  return {
    onboarding_completed: true
  };
}

module.exports = {
  registerAndPay,
  login,
  requestPasswordReset,
  resetPassword,
  getProfile,
  completeOnboarding
};
