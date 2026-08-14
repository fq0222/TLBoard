const { validationResult } = require('express-validator');
const { createLogger } = require('../../utils/logger');
const { generateSubscriptionUrls, getUserAppBaseUrl } = require('../../utils/site-url');
const authService = require('../../services/user/auth-service');
const ipLocationService = require('../../services/shared/ip-location-service');

const logger = createLogger('USER-AUTH');

/**
 * 用户认证控制器。
 * 负责参数校验结果、日志记录与旧响应结构兼容，
 * 具体认证业务下沉到 user auth service。
 */

function respondValidationError(res, errors) {
  const firstError = errors.array()[0];
  return res.status(400).json({
    code: 1001,
    message: firstError?.msg || '参数校验失败',
    data: {
      errors: errors.array()
    }
  });
}

/**
 * 输出兼容旧接口的业务异常或系统异常响应。
 *
 * @param {Object} res - Express 响应对象
 * @param {string} action - 当前操作描述
 * @param {Error} error - 捕获到的异常对象
 * @returns {Object} Express 响应结果
 */
function respondLegacyError(res, action, error) {
  if (error && error.isLegacyBusinessError) {
    logger.warn(`${action}失败: ${error.message}`);
    return res.status(error.statusCode).json({
      code: error.code,
      message: error.message,
      data: error.data
    });
  }

  logger.error(`${action}错误: ${error.message}`);
  return res.status(500).json({
    code: 500,
    message: '服务器内部错误',
    data: null
  });
}

/**
 * 处理注册并下单接口。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function registerAndPay(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('注册参数校验失败');
    return respondValidationError(res, errors);
  }

  try {
    const data = await authService.registerAndPay(req.app.locals.db, req.body);
    logger.info(`用户注册成功: ${req.body.email}，订单号: ${data.out_trade_no}`);
    return res.json({
      code: 0,
      message: 'ok',
      data
    });
  } catch (error) {
    return respondLegacyError(res, '用户注册', error);
  }
}

/**
 * 处理用户登录接口。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function login(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('登录参数校验失败');
    return respondValidationError(res, errors);
  }

  try {
    const data = await authService.login(req.app.locals.db, req.body);
    logger.info(`用户登录成功: ${req.body.email}`);
    ipLocationService.recordUserIpLocation(req.app.locals.db, data.user.id, 'login', req.ip || req.socket.remoteAddress)
      .catch((error) => logger.warn(`记录登录 IP 归属地失败: ${error.message}`));
    return res.json({
      code: 0,
      message: 'ok',
      data
    });
  } catch (error) {
    return respondLegacyError(res, '用户登录', error);
  }
}

/**
 * 获取当前登录用户资料。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function getProfile(req, res) {
  try {
    const profile = await authService.getProfile(req.app.locals.db, req.user.id);
    const urls = generateSubscriptionUrls(req, profile.sub_id);

    logger.info(`获取用户信息成功: ${profile.email}`);
    ipLocationService.recordUserIpLocation(req.app.locals.db, profile.id, 'login', req.ip || req.socket.remoteAddress)
      .catch((error) => logger.warn(`记录个人中心 IP 归属地失败: ${error.message}`));
    return res.json({
      code: 0,
      message: 'ok',
      data: {
        id: profile.id,
        email: profile.email,
        plan_id: profile.plan_id,
        plan_name: profile.plan_name,
        subscription_url: profile.cf_optimized ? urls.subscription_url : '',
        clash_url: profile.cf_optimized ? urls.clash_url : '',
        cf_optimized: profile.cf_optimized,
        subscription_ready: profile.subscription_ready,
        telegram_channel_url: profile.telegram_channel_url,
        traffic_used: profile.traffic_used,
        plan_traffic_limit: profile.plan_traffic_limit,
        plan_traffic_limit_text: profile.plan_traffic_limit_text,
        referral_traffic_limit: profile.referral_traffic_limit,
        referral_traffic_limit_text: profile.referral_traffic_limit_text,
        total_traffic_limit: profile.total_traffic_limit,
        total_traffic_limit_text: profile.total_traffic_limit_text,
        traffic_limit: profile.traffic_limit,
        traffic_used_text: profile.traffic_used_text,
        traffic_limit_text: profile.traffic_limit_text,
        traffic_percent: profile.traffic_percent,
        balance: profile.balance,
        balance_text: profile.balance_text,
        expire_at: profile.expire_at,
        expire_text: profile.expire_text,
        enabled: profile.enabled,
        disable_reason: profile.disable_reason,
        status: profile.status,
        status_text: profile.status_text,
        created_at: profile.created_at,
        payment_count: profile.payment_count,
        sync_status: profile.sync_status,
        onboarding_completed: profile.onboarding_completed
      }
    });
  } catch (error) {
    return respondLegacyError(res, '获取用户信息', error);
  }
}

/**
 * 记录密码重置申请的内部审计日志。
 * 职责：在不暴露给前端的前提下，让服务端日志能区分未知邮箱、每日限制和邮件发送结果。
 *
 * @param {string} email - 用户提交的邮箱
 * @param {Object} audit - 服务层返回的审计状态
 * @returns {void}
 */
function logPasswordResetAudit(email, audit = {}) {
  switch (audit.status) {
    case 'unknown_email':
      logger.info(`密码重置申请已模糊处理: ${email}，邮箱不存在或未注册`);
      break;
    case 'daily_limit_reached':
      logger.info(`密码重置申请已模糊处理: ${email}，该邮箱今天已经申请过一次`);
      break;
    case 'missing_base_url':
      logger.warn(`密码重置申请未发送邮件: ${email}，用户端站点地址未配置`);
      break;
    case 'email_send_failed':
      logger.warn(`密码重置邮件发送失败: ${email}，原因: ${audit.error || '未知错误'}`);
      break;
    case 'email_sent':
      logger.info(`密码重置邮件已发送: ${email}`);
      break;
    default:
      logger.info(`密码重置申请已处理: ${email}`);
  }
}

/**
 * 构造密码重置申请的公开响应数据。
 * 职责：过滤内部审计字段，保证接口仍不暴露邮箱是否注册或是否已触发每日限制。
 *
 * @param {Object} data - 服务层结果
 * @returns {{message:string}} 公开响应数据
 */
function buildPublicPasswordResetResponse(data) {
  return {
    message: data.message
  };
}

/**
 * 处理忘记密码申请。
 * 职责：校验邮箱格式并调用服务层发送一次性重置链接，响应始终保持模糊提示。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function requestPasswordReset(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('密码重置申请参数校验失败');
    return respondValidationError(res, errors);
  }

  try {
    const data = await authService.requestPasswordReset(req.app.locals.db, {
      email: req.body.email,
      ip: req.ip || req.socket.remoteAddress,
      baseUrl: getUserAppBaseUrl(req)
    });
    logPasswordResetAudit(req.body.email, data.audit);
    return res.json({
      code: 0,
      message: data.message,
      data: buildPublicPasswordResetResponse(data)
    });
  } catch (error) {
    return respondLegacyError(res, '密码重置申请', error);
  }
}

/**
 * 处理密码重置提交。
 * 职责：接收 URL Token 与新密码，交由服务层完成一次性 Token 校验和密码更新。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function resetPassword(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('密码重置提交参数校验失败');
    return respondValidationError(res, errors);
  }

  try {
    const data = await authService.resetPassword(req.app.locals.db, req.body);
    logger.info('密码重置成功');
    return res.json({
      code: 0,
      message: '密码重置成功，请使用新密码登录',
      data
    });
  } catch (error) {
    return respondLegacyError(res, '密码重置提交', error);
  }
}

/**
 * 标记当前登录用户已完成新手引导。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function completeOnboarding(req, res) {
  try {
    const data = await authService.completeOnboarding(req.app.locals.db, req.user.id);
    logger.info(`用户新手引导已完成: ${req.user.email}`);
    return res.json({
      code: 0,
      message: 'ok',
      data
    });
  } catch (error) {
    return respondLegacyError(res, '完成新手引导', error);
  }
}

module.exports = {
  registerAndPay,
  login,
  requestPasswordReset,
  resetPassword,
  getProfile,
  completeOnboarding
};
