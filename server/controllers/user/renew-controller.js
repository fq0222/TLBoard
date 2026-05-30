const { validationResult } = require('express-validator');
const { createLogger } = require('../../utils/logger');
const renewService = require('../../services/user/renew-service');

const logger = createLogger('USER-RENEW');

/**
 * 用户端续费控制器。
 * 负责参数校验、日志记录与旧 `{ code, message, data }` 响应兼容，
 * 具体续费业务下沉到 renew service。
 */

function handleValidationFailure(res) {
  return res.status(400).json({
    code: 1001,
    message: '参数校验失败',
    data: null
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
function handleControllerError(res, action, error) {
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
 * 创建续费订单并返回支付信息。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function createRenewOrder(req, res) {
  if (!validationResult(req).isEmpty()) {
    logger.warn('续费参数校验失败');
    return handleValidationFailure(res);
  }

  try {
    const data = await renewService.createRenewOrder(req.app.locals.db, req.user.id, req.body);
    logger.info(`续费订单支付链接生成成功: ${data.out_trade_no}`);
    return res.json({
      code: 0,
      message: 'ok',
      data
    });
  } catch (error) {
    return handleControllerError(res, '续费接口', error);
  }
}

module.exports = {
  createRenewOrder
};
