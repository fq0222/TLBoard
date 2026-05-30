const { validationResult } = require('express-validator');
const { createLogger } = require('../../utils/logger');
const authService = require('../../services/admin/auth-service');

const logger = createLogger('ADMIN-AUTH');

/**
 * 管理端认证控制器。
 * 负责参数校验、日志记录与旧 `{ code, message, data }` 响应兼容，
 * 具体登录与改密业务下沉到 auth service。
 */

/**
 * 输出旧接口兼容的参数校验失败响应。
 *
 * @param {Object} res - Express 响应对象
 * @returns {Object} Express 响应结果
 */
function respondValidationError(res) {
  return res.status(400).json({
    code: 1001,
    message: '参数校验失败',
    data: null
  });
}

/**
 * 输出旧接口兼容的业务或系统错误响应。
 *
 * @param {Object} res - Express 响应对象
 * @param {string} action - 当前动作描述
 * @param {Error} error - 异常对象
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
 * 管理员登录控制器。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function login(req, res) {
  if (!validationResult(req).isEmpty()) {
    logger.warn('登录参数校验失败');
    return respondValidationError(res);
  }

  try {
    const data = await authService.login(req.app.locals.db, req.body);
    logger.info(`管理员登录成功: ${req.body.username}`);
    return res.json({
      code: 0,
      message: 'ok',
      data
    });
  } catch (error) {
    return respondLegacyError(res, '管理员登录', error);
  }
}

/**
 * 修改管理员密码控制器。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function updatePassword(req, res) {
  if (!validationResult(req).isEmpty()) {
    logger.warn('修改密码参数校验失败');
    return respondValidationError(res);
  }

  try {
    const data = await authService.updatePassword(req.app.locals.db, req.admin.id, req.body);
    logger.info(`管理员密码修改成功: ${req.admin.username}`);
    return res.json({
      code: 0,
      message: 'ok',
      data
    });
  } catch (error) {
    return respondLegacyError(res, '修改密码', error);
  }
}

module.exports = {
  login,
  updatePassword
};
