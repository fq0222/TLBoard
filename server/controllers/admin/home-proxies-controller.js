const { validationResult } = require('express-validator');
const {
  legacySuccess,
  legacyFail,
  legacyValidationError
} = require('../../shared/response/api-response');
const { createLogger } = require('../../utils/logger');
const homeProxiesService = require('../../services/admin/home-proxies-service');

const logger = createLogger('ADMIN-HOME-PROXIES');

/**
 * 管理端家宽 IP 控制器。
 * 负责请求参数校验、日志记录和旧响应结构兼容，具体同步逻辑由 service 实现。
 */

function handleValidationFailure(req, res, action) {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return false;
  }

  logger.warn(`${action}参数验证失败`);
  legacyValidationError(res);
  return true;
}

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
  return legacyFail(res);
}

async function listHomeProxies(req, res) {
  try {
    const result = await homeProxiesService.listHomeProxies(req.app.locals.db);
    logger.info(`获取家宽 IP 列表成功，共 ${result.home_proxies.length} 条`);
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '获取家宽 IP 列表', error);
  }
}

async function createHomeProxy(req, res) {
  if (handleValidationFailure(req, res, '添加家宽 IP')) {
    return;
  }

  try {
    const result = await homeProxiesService.createHomeProxy(req.app.locals.db, req.body);
    logger.info(`添加家宽 IP 成功: ${result.tag}`);
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '添加家宽 IP', error);
  }
}

async function updateHomeProxy(req, res) {
  if (handleValidationFailure(req, res, '修改家宽 IP')) {
    return;
  }

  try {
    const result = await homeProxiesService.updateHomeProxy(
      req.app.locals.db,
      parseInt(req.params.id, 10),
      req.body
    );
    logger.info(`修改家宽 IP 成功: ${result.tag}`);
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '修改家宽 IP', error);
  }
}

async function deleteHomeProxy(req, res) {
  if (handleValidationFailure(req, res, '删除家宽 IP')) {
    return;
  }

  try {
    const result = await homeProxiesService.deleteHomeProxy(
      req.app.locals.db,
      parseInt(req.params.id, 10)
    );
    logger.info(`删除家宽 IP 成功: ID ${req.params.id}`);
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '删除家宽 IP', error);
  }
}

async function syncHomeProxy(req, res) {
  if (handleValidationFailure(req, res, '同步家宽 IP')) {
    return;
  }

  try {
    const result = await homeProxiesService.syncHomeProxy(
      req.app.locals.db,
      parseInt(req.params.id, 10)
    );
    logger.info(`同步家宽 IP 完成: ID ${req.params.id}, status=${result.sync_status}`);
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '同步家宽 IP', error);
  }
}

module.exports = {
  listHomeProxies,
  createHomeProxy,
  updateHomeProxy,
  deleteHomeProxy,
  syncHomeProxy
};
