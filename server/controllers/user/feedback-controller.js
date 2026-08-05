/**
 * 用户端留言板控制器
 * 负责处理用户留言提交、精选留言展示和投票请求。
 */

const { validationResult } = require('express-validator');
const {
  legacySuccess,
  legacyFail,
  legacyValidationError
} = require('../../shared/response/api-response');
const { createLogger } = require('../../utils/logger');
const feedbackService = require('../../services/shared/feedback-service');

const logger = createLogger('USER-FEEDBACK');

/**
 * 输出旧接口兼容错误响应。
 * 职责：复用项目既有 {code,message,data} 响应结构。
 * 关键参数：error.expose 为 true 时透出业务提示。
 * 核心分支语义：业务错误按自身状态码返回，未知错误返回 500。
 *
 * @param {Object} res - Express 响应对象
 * @param {Error} error - 错误对象
 * @returns {Object} Express 响应
 */
function respondLegacyError(res, error) {
  if (error && error.expose) {
    return legacyFail(res, {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message
    });
  }

  return legacyFail(res);
}

/**
 * 获取精选留言。
 * 职责：返回用户端展示区需要的留言和当前用户投票状态。
 * 关键参数：req.user.id 来自用户鉴权中间件。
 * 核心分支语义：接口失败时记录日志并返回旧格式 500。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应
 */
async function listFeatured(req, res) {
  try {
    const data = await feedbackService.listFeaturedMessages(req.app.locals.db, req.user.id);
    return legacySuccess(res, data);
  } catch (error) {
    logger.error(`获取精选留言失败: ${error.message}`);
    return legacyFail(res);
  }
}

/**
 * 创建留言。
 * 职责：让当前用户提交 150 字以内改进建议。
 * 关键参数：req.body.content 为留言内容。
 * 核心分支语义：参数校验失败返回 400；业务校验失败透出提示。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应
 */
async function createMessage(req, res) {
  try {
    if (!validationResult(req).isEmpty()) {
      return legacyValidationError(res);
    }

    const data = await feedbackService.createMessage(
      req.app.locals.db,
      req.user.id,
      req.body.content
    );

    logger.info(`用户 ${req.user.email} 提交留言成功: ${data.id}`);
    return legacySuccess(res, data);
  } catch (error) {
    logger.error(`创建留言失败: ${error.message}`);
    return respondLegacyError(res, error);
  }
}

/**
 * 给精选留言投票。
 * 职责：执行单用户单留言一票限制。
 * 关键参数：req.params.id 为留言 ID。
 * 核心分支语义：重复投票返回幂等成功，不产生第二条记录。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应
 */
async function voteMessage(req, res) {
  try {
    if (!validationResult(req).isEmpty()) {
      return legacyValidationError(res);
    }

    const data = await feedbackService.voteMessage(
      req.app.locals.db,
      req.user.id,
      parseInt(req.params.id, 10)
    );

    return legacySuccess(res, data);
  } catch (error) {
    logger.error(`留言投票失败: ${error.message}`);
    return respondLegacyError(res, error);
  }
}

module.exports = {
  listFeatured,
  createMessage,
  voteMessage
};
