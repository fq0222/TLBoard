const { validationResult } = require('express-validator');
const { legacySuccess, legacyFail, legacyValidationError } = require('../../shared/response/api-response');
const { createLogger } = require('../../utils/logger');
const { generateSubscriptionUrls } = require('../../utils/site-url');
const subscriptionService = require('../../services/user/subscription-service');

const logger = createLogger('USER-SUB');

/**
 * 用户端订阅控制器。
 * 负责订阅相关参数校验、旧响应结构兼容、日志记录与订阅文本输出，
 * 具体订阅生成与缓存修复逻辑下沉到 user subscription service。
 */

/**
 * 统一处理控制器异常，兼容旧接口 code/message/data 结构。
 *
 * @param {Object} res - Express 响应对象
 * @param {string} action - 当前动作描述
 * @param {Error} error - 异常对象
 * @returns {Object} Express 响应结果
 */
function handleControllerError(res, action, error) {
  if (error && error.isLegacyBusinessError) {
    logger.warn(`${action}失败: ${error.message}`);
    return legacyFail(res, {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      data: error.data
    });
  }

  logger.error(`${action}错误: ${error.message}`);
  return legacyFail(res, {
    code: 500,
    message: '服务器内部错误',
    data: null
  });
}

/**
 * 处理参数校验失败。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {boolean} 是否已输出失败响应
 */
function handleValidationFailure(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return false;
  }

  logger.warn(`参数校验失败: ${JSON.stringify(errors.array())}`);
  legacyValidationError(res, {
    message: errors.array()[0]?.msg || '参数校验失败'
  });
  return true;
}

/**
 * 生成订阅链接并写回用户订阅缓存。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function generateSubscription(req, res) {
  try {
    const subId = await subscriptionService.generateSubscription(
      req.app.locals.db,
      req.user.id,
      logger
    );
    const urls = generateSubscriptionUrls(req, subId);
    return legacySuccess(res, urls);
  } catch (error) {
    return handleControllerError(res, '生成订阅链接', error);
  }
}

/**
 * 获取当前用户的订阅链接与节点展示信息。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function getSubscriptionInfo(req, res) {
  try {
    const data = await subscriptionService.getSubscriptionInfo(
      req.app.locals.db,
      req.user.id
    );
    const urls = generateSubscriptionUrls(req, data.subId);

    logger.info(`获取订阅信息成功: userId=${req.user.id}`);
    return legacySuccess(res, {
      subscription_url: data.cfOptimized ? urls.subscription_url : '',
      clash_url: data.cfOptimized ? urls.clash_url : '',
      v2ray_url: data.cfOptimized ? urls.v2ray_url : '',
      cf_optimized: data.cfOptimized,
      expire_at: data.expire_at,
      expire_text: data.expire_text,
      traffic_used: data.traffic_used,
      plan_traffic_limit: data.plan_traffic_limit,
      plan_traffic_limit_text: data.plan_traffic_limit_text,
      referral_traffic_limit: data.referral_traffic_limit,
      referral_traffic_limit_text: data.referral_traffic_limit_text,
      total_traffic_limit: data.total_traffic_limit,
      total_traffic_limit_text: data.total_traffic_limit_text,
      traffic_limit: data.traffic_limit,
      traffic_used_text: data.traffic_used_text,
      traffic_limit_text: data.traffic_limit_text,
      traffic_percent: data.traffic_percent,
      nodes: data.nodes
    });
  } catch (error) {
    return handleControllerError(res, '获取订阅信息', error);
  }
}

/**
 * 输出 Base64 / Clash 等订阅文本内容。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function getSubscriptionContent(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const result = await subscriptionService.getSubscriptionContent(
      req.app.locals.db,
      req.params.token,
      req.query
    );

    res.setHeader('Content-Type', result.contentType);
    Object.entries(result.headers).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
    res.send(result.body);
    logger.info(`获取订阅内容成功: ${result.email}`);
  } catch (error) {
    return handleControllerError(res, '获取订阅内容', error);
  }
}

module.exports = {
  generateSubscription,
  getSubscriptionInfo,
  getSubscriptionContent
};
