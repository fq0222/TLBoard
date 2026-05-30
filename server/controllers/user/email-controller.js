/**
 * 用户端 Email 控制器。
 * 负责参数校验、请求日志以及旧响应结构兼容，教程与预设邮件逻辑下沉到 service。
 */

const { validationResult } = require('express-validator');
const {
  legacySuccess,
  legacyFail,
  legacyValidationError
} = require('../../shared/response/api-response');
const { createLogger } = require('../../utils/logger');
const userEmailService = require('../../services/user/email-service');

const logger = createLogger('USER-EMAIL');

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
    message: error.message,
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

async function sendTutorialEmail(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const result = await userEmailService.sendTutorialEmail(
      req.app.locals.db,
      req.user.id,
      req.body.type
    );

    if (result.success) {
      logger.info(`用户 ${req.user.email} 请求教程邮件成功: ${req.body.type}`);
      return legacySuccess(res, null, { message: '教程邮件已发送，请到邮箱查看' });
    }

    logger.error(`发送教程邮件失败: ${result.error}`);
    return legacyFail(res, {
      code: 500,
      message: `发送失败: ${result.error}`,
      data: null
    });
  } catch (error) {
    return handleControllerError(res, '请求教程邮件', error);
  }
}

async function sendPresetEmail(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const result = await userEmailService.sendPresetEmail(
      req.app.locals.db,
      req.user.id,
      req.params.action,
      req.body.variables || {}
    );

    if (result.success) {
      logger.info(`用户 ${req.user.email} 发送预设邮件成功: ${req.params.action}`);
      return legacySuccess(res, null, { message: '邮件已发送' });
    }

    logger.error(`发送预设邮件失败: ${result.error}`);
    return legacyFail(res, {
      code: 500,
      message: `发送失败: ${result.error}`,
      data: null
    });
  } catch (error) {
    return handleControllerError(res, '发送预设邮件', error);
  }
}

module.exports = {
  sendTutorialEmail,
  sendPresetEmail
};
