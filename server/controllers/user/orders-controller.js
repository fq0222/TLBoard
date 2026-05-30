const { validationResult } = require('express-validator');
const { createLogger } = require('../../utils/logger');
const ordersService = require('../../services/user/orders-service');

const logger = createLogger('USER-ORDERS');

/**
 * 用户端订单控制器。
 * 负责参数校验、日志记录与旧响应结构兼容，
 * 具体订单查询与状态轮询逻辑下沉到 orders service。
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
 * 获取当前登录用户的订单列表。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function listOrders(req, res) {
  if (!validationResult(req).isEmpty()) {
    logger.warn('获取订单列表参数验证失败');
    return handleValidationFailure(res);
  }

  try {
    const data = await ordersService.listOrders(req.app.locals.db, req.user.id, req.query);
    logger.info(`获取订单列表成功，用户: ${req.user.email}，共 ${data.list.length} 条记录`);
    return res.json({
      code: 0,
      message: 'ok',
      data
    });
  } catch (error) {
    return handleControllerError(res, '获取订单列表', error);
  }
}

/**
 * 查询订单公共轮询状态，兼容支付结果页通过订单号或订单 ID 查询。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function getPublicOrderStatus(req, res) {
  if (!validationResult(req).isEmpty()) {
    logger.warn('公共轮询订单状态参数验证失败');
    return handleValidationFailure(res);
  }

  try {
    const data = await ordersService.getPublicOrderStatus(
      req.app.locals.db,
      req.params.id,
      req.user || null
    );
    logger.info(`订单状态查询成功: ${req.params.id} - ${data.status}`);
    return res.json({
      code: 0,
      message: 'ok',
      data
    });
  } catch (error) {
    return handleControllerError(res, '订单状态查询', error);
  }
}

/**
 * 查询当前用户自己的订单状态。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function getUserOrderStatus(req, res) {
  if (!validationResult(req).isEmpty()) {
    logger.warn('轮询订单状态参数验证失败');
    return handleValidationFailure(res);
  }

  try {
    const data = await ordersService.getUserOrderStatus(
      req.app.locals.db,
      req.user.id,
      req.params.id
    );
    logger.info(`轮询订单状态成功: ${req.params.id} - ${data.status}`);
    return res.json({
      code: 0,
      message: 'ok',
      data
    });
  } catch (error) {
    return handleControllerError(res, '轮询订单状态', error);
  }
}

module.exports = {
  listOrders,
  getPublicOrderStatus,
  getUserOrderStatus
};
