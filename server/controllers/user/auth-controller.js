const { validationResult } = require('express-validator');
const { createLogger } = require('../../utils/logger');
const { generateSubscriptionUrls } = require('../../utils/site-url');
const authService = require('../../services/user/auth-service');

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
        traffic_used: profile.traffic_used,
        traffic_limit: profile.traffic_limit,
        traffic_used_text: profile.traffic_used_text,
        traffic_limit_text: profile.traffic_limit_text,
        traffic_percent: profile.traffic_percent,
        expire_at: profile.expire_at,
        expire_text: profile.expire_text,
        enabled: profile.enabled,
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
  getProfile,
  completeOnboarding
};
