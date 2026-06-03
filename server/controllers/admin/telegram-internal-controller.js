const { validationResult } = require('express-validator');
const { legacyFail, legacySuccess, legacyValidationError } = require('../../shared/response/api-response');
const { createLogger } = require('../../utils/logger');
const telegramAdminService = require('../../services/admin/telegram-admin-service');
const telegramMonitorService = require('../../services/shared/telegram-monitor-service');

const logger = createLogger('ADMIN-TELEGRAM-INTERNAL');

function createPermissionDeniedError() {
  const error = new Error('当前 chat 未绑定管理员');
  error.isLegacyBusinessError = true;
  error.statusCode = 403;
  error.code = 1004;
  error.data = null;
  return error;
}

/**
 * 处理参数校验失败。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {boolean} 是否已输出响应
 */
function handleValidationFailure(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return false;
  }

  logger.warn(`Telegram 内部接口参数校验失败: ${JSON.stringify(errors.array())}`);
  legacyValidationError(res, {
    message: errors.array()[0]?.msg || '参数校验失败'
  });
  return true;
}

/**
 * 输出内部接口错误响应。
 *
 * @param {Object} res - Express 响应对象
 * @param {string} action - 当前动作
 * @param {Error} error - 异常对象
 * @returns {Object} Express 响应
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
 * 返回 Telegram 内部 API 健康状态。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Object} Express 响应
 */
function getHealth(req, res) {
  return legacySuccess(res, {
    service: 'subscription-manager',
    status: 'ok',
    time: Math.floor(Date.now() / 1000)
  });
}

/**
 * 验证管理员绑定码。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应
 */
async function verifyAdminBindCode(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const data = await telegramAdminService.verifyAdminBindCode(req.app.locals.db, req.body);
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '验证管理员绑定码', error);
  }
}

/**
 * 按 chat_id 查询管理员绑定状态。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应
 */
async function getAdminByChatId(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const data = await telegramAdminService.getAdminByChatId(req.app.locals.db, req.params.chatId);
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '查询管理员绑定状态', error);
  }
}

/**
 * 查询服务器健康总览。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应
 */
async function getServersHealthSummary(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const admin = await telegramAdminService.getAdminByChatId(req.app.locals.db, req.query.chat_id);
    if (!admin.bound) {
      throw createPermissionDeniedError();
    }
    const data = await telegramMonitorService.getServersHealthSummary(req.app.locals.db, req.query);
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '查询服务器健康总览', error);
  }
}

/**
 * 查询单台服务器健康详情。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应
 */
async function getServerHealthDetail(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const admin = await telegramAdminService.getAdminByChatId(req.app.locals.db, req.query.chat_id);
    if (!admin.bound) {
      throw createPermissionDeniedError();
    }
    const data = await telegramMonitorService.getServerHealthDetail(req.app.locals.db, req.params.serverId);
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '查询服务器健康详情', error);
  }
}

/**
 * 查询告警列表。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应
 */
async function listAlerts(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const admin = await telegramAdminService.getAdminByChatId(req.app.locals.db, req.query.chat_id);
    if (!admin.bound) {
      throw createPermissionDeniedError();
    }
    const data = await telegramMonitorService.listAlerts(req.app.locals.db, req.query);
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '查询告警列表', error);
  }
}

/**
 * 拉取待发送告警。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应
 */
async function listPendingAlerts(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const data = await telegramMonitorService.listPendingAlerts(req.app.locals.db, req.query);
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '拉取待发送告警', error);
  }
}

/**
 * 接收告警发送回执。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应
 */
async function markAlertSent(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const data = await telegramMonitorService.markAlertSent(
      req.app.locals.db,
      req.params.alertId,
      req.body
    );
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '更新告警发送状态', error);
  }
}

/**
 * 管理员代查用户概览。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应
 */
async function lookupAdminUser(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const admin = await telegramAdminService.getAdminByChatId(req.app.locals.db, req.query.chat_id);
    if (!admin.bound) {
      throw createPermissionDeniedError();
    }
    const data = await telegramAdminService.lookupUserOverview(req.app.locals.db, req.query);
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '管理员代查用户概览', error);
  }
}

module.exports = {
  getAdminByChatId,
  getHealth,
  getServerHealthDetail,
  getServersHealthSummary,
  listAlerts,
  listPendingAlerts,
  lookupAdminUser,
  markAlertSent,
  verifyAdminBindCode
};
