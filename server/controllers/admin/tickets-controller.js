/**
 * 管理端工单控制器
 * 负责处理管理端工单请求的校验结果、响应兼容与日志记录。
 */

const { validationResult } = require('express-validator');
const {
  legacySuccess,
  legacyFail,
  legacyValidationError
} = require('../../shared/response/api-response');
const { parsePagination } = require('../../shared/utils/pagination');
const { createLogger } = require('../../utils/logger');
const adminTicketsService = require('../../services/admin/tickets-service');

const logger = createLogger('ADMIN-TICKETS');

/**
 * 输出管理端旧接口兼容错误响应。
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
 * 获取工单统计。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function getStats(req, res) {
  try {
    const data = await adminTicketsService.getStats(req.app.locals.db);
    return legacySuccess(res, data);
  } catch (error) {
    logger.error(`获取工单统计错误: ${error.message}`);
    return legacyFail(res);
  }
}

/**
 * 获取管理端工单列表。
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
    const data = await adminTicketsService.listTickets(req.app.locals.db, {
      page: pagination.page,
      limit: pagination.limit,
      status: req.query.status || null,
      keyword: req.query.keyword || null
    });

    return legacySuccess(res, data);
  } catch (error) {
    logger.error(`获取工单列表错误: ${error.message}`);
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

    const ticket = await adminTicketsService.getTicketDetail(
      req.app.locals.db,
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

    const reply = await adminTicketsService.addReply(
      req.app.locals.db,
      req.admin.id,
      parseInt(req.params.id, 10),
      req.body.content
    );

    logger.info(`管理员 ${req.admin.username} 回复工单 ${req.params.id} 成功`);
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

    const data = await adminTicketsService.closeTicket(
      req.app.locals.db,
      parseInt(req.params.id, 10)
    );

    logger.info(`管理员 ${req.admin.username} 关闭工单 ${req.params.id} 成功`);
    return legacySuccess(res, data);
  } catch (error) {
    logger.error(`关闭工单错误: ${error.message}`);
    return respondLegacyError(res, error);
  }
}

/**
 * 删除工单。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function deleteTicket(req, res) {
  try {
    if (!validationResult(req).isEmpty()) {
      return legacyValidationError(res);
    }

    const data = await adminTicketsService.deleteTicket(
      req.app.locals.db,
      parseInt(req.params.id, 10)
    );

    logger.info(`管理员 ${req.admin.username} 删除工单 ${req.params.id} 成功`);
    return legacySuccess(res, data);
  } catch (error) {
    logger.error(`删除工单错误: ${error.message}`);
    return respondLegacyError(res, error);
  }
}

module.exports = {
  getStats,
  listTickets,
  getTicketDetail,
  addReply,
  closeTicket,
  deleteTicket
};
