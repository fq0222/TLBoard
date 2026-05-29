/**
 * 用户端工单控制器
 * 负责处理用户端工单请求的校验结果、响应兼容与日志记录。
 */

const { validationResult } = require('express-validator');
const {
  legacySuccess,
  legacyFail,
  legacyValidationError
} = require('../../shared/response/api-response');
const { parsePagination } = require('../../shared/utils/pagination');
const { createLogger } = require('../../utils/logger');
const userTicketsService = require('../../services/user/tickets-service');

const logger = createLogger('USER-TICKETS');

/**
 * 输出用户端旧接口兼容错误响应。
 *
 * @param {Object} res - Express 响应对象
 * @param {Error} error - 业务异常对象
 * @returns {Object} Express 响应结果
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
 * 获取用户未读工单数量。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function getUnreadCount(req, res) {
  try {
    const data = await userTicketsService.getUnreadCount(req.app.locals.db, req.user.id);
    return legacySuccess(res, data);
  } catch (error) {
    logger.error(`获取未读工单数量错误: ${error.message}`);
    return legacyFail(res);
  }
}

/**
 * 获取当前用户工单列表。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function listTickets(req, res) {
  try {
    if (!validationResult(req).isEmpty()) {
      return legacyValidationError(res);
    }

    const pagination = parsePagination(req.query);
    const data = await userTicketsService.listTickets(req.app.locals.db, req.user.id, pagination);
    return legacySuccess(res, data);
  } catch (error) {
    logger.error(`获取工单列表错误: ${error.message}`);
    return legacyFail(res);
  }
}

/**
 * 创建工单。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function createTicket(req, res) {
  try {
    if (!validationResult(req).isEmpty()) {
      return legacyValidationError(res);
    }

    const ticket = await userTicketsService.createTicket(req.app.locals.db, req.user.id, req.body);

    logger.info(`用户 ${req.user.email} 创建工单成功: ${ticket.id}`);
    return legacySuccess(res, ticket);
  } catch (error) {
    logger.error(`创建工单错误: ${error.message}`);
    return legacyFail(res);
  }
}

/**
 * 获取工单详情。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function getTicketDetail(req, res) {
  try {
    if (!validationResult(req).isEmpty()) {
      return legacyValidationError(res);
    }

    const ticket = await userTicketsService.getTicketDetail(
      req.app.locals.db,
      req.user.id,
      parseInt(req.params.id, 10)
    );

    return legacySuccess(res, ticket);
  } catch (error) {
    logger.error(`获取工单详情错误: ${error.message}`);
    return respondLegacyError(res, error);
  }
}

/**
 * 回复工单。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function addReply(req, res) {
  try {
    if (!validationResult(req).isEmpty()) {
      return legacyValidationError(res);
    }

    const reply = await userTicketsService.addReply(
      req.app.locals.db,
      req.user.id,
      parseInt(req.params.id, 10),
      req.body.content
    );

    logger.info(`用户 ${req.user.email} 回复工单 ${req.params.id} 成功`);
    return legacySuccess(res, reply);
  } catch (error) {
    logger.error(`回复工单错误: ${error.message}`);
    return respondLegacyError(res, error);
  }
}

/**
 * 关闭工单。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function closeTicket(req, res) {
  try {
    if (!validationResult(req).isEmpty()) {
      return legacyValidationError(res);
    }

    const data = await userTicketsService.closeTicket(
      req.app.locals.db,
      req.user.id,
      parseInt(req.params.id, 10)
    );

    logger.info(`用户 ${req.user.email} 关闭工单 ${req.params.id} 成功`);
    return legacySuccess(res, data);
  } catch (error) {
    logger.error(`关闭工单错误: ${error.message}`);
    return respondLegacyError(res, error);
  }
}

module.exports = {
  getUnreadCount,
  listTickets,
  createTicket,
  getTicketDetail,
  addReply,
  closeTicket
};
