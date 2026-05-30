const { validationResult } = require('express-validator');
const { createLogger } = require('../../utils/logger');
const ordersService = require('../../services/admin/orders-service');

const logger = createLogger('ADMIN-ORDERS');

/**
 * 管理端订单控制器。
 * 负责参数校验、日志记录与旧响应结构兼容，
 * 具体订单查询逻辑下沉到 admin orders service。
 */

function handleValidationFailure(res) {
  return res.status(400).json({
    code: 1001,
    message: '参数校验失败',
    data: null
  });
}

/**
 * 输出管理端订单接口的统一异常响应。
 *
 * @param {Object} res - Express 响应对象
 * @param {string} action - 当前操作描述
 * @param {Error} error - 捕获到的异常对象
 * @returns {Object} Express 响应结果
 */
function handleControllerError(res, action, error) {
  logger.error(`${action}错误: ${error.message}`);
  return res.status(500).json({
    code: 500,
    message: '服务器内部错误',
    data: null
  });
}

/**
 * 获取管理端订单列表。
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
    const data = await ordersService.listOrders(req.app.locals.db, req.query);
    logger.info(`获取订单列表成功，共 ${data.list.length} 条记录`);
    return res.json({
      code: 0,
      message: 'ok',
      data
    });
  } catch (error) {
    return handleControllerError(res, '获取订单列表', error);
  }
}

module.exports = {
  listOrders
};
