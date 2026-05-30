const { validationResult } = require('express-validator');
const {
  legacySuccess,
  legacyFail,
  legacyValidationError
} = require('../../shared/response/api-response');
const { createLogger } = require('../../utils/logger');
const cfIpsService = require('../../services/admin/cf-ips-service');

const logger = createLogger('ADMIN-CF-IPS');

/**
 * 管理端 CF IP 池控制器。
 * 负责参数校验、日志记录与旧响应结构兼容，具体业务逻辑下沉到 cf-ips service。
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

async function listCfIps(req, res) {
  try {
    const result = await cfIpsService.listCfIps(req.app.locals.db, req.query);
    logger.info(`获取CF IP池列表成功，第 ${result.page} 页，共 ${result.list.length} 条记录`);
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '获取CF IP池列表', error);
  }
}

async function createCfIp(req, res) {
  if (handleValidationFailure(req, res, '添加CF IP')) {
    return;
  }

  try {
    const result = await cfIpsService.createCfIp(req.app.locals.db, req.body);
    logger.info(`添加CF IP成功: ${result.ip} (ID: ${result.id})`);
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '添加CF IP', error);
  }
}

async function updateCfIp(req, res) {
  if (handleValidationFailure(req, res, '修改CF IP')) {
    return;
  }

  try {
    const result = await cfIpsService.updateCfIp(
      req.app.locals.db,
      parseInt(req.params.id, 10),
      req.body
    );
    logger.info(`修改CF IP成功: ${result.ip} (ID: ${result.id})`);
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '修改CF IP', error);
  }
}

async function deleteCfIp(req, res) {
  if (handleValidationFailure(req, res, '删除CF IP')) {
    return;
  }

  try {
    const result = await cfIpsService.deleteCfIp(
      req.app.locals.db,
      parseInt(req.params.id, 10)
    );
    logger.info(`删除CF IP成功: ID ${req.params.id}`);
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '删除CF IP', error);
  }
}

async function importCfIps(req, res) {
  if (handleValidationFailure(req, res, '批量导入CF IP')) {
    return;
  }

  try {
    const result = await cfIpsService.importCfIps(req.app.locals.db, req.body);
    logger.info(`批量导入CF IP完成: 导入 ${result.imported} 个，跳过 ${result.skipped} 个`);
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '批量导入CF IP', error);
  }
}

module.exports = {
  listCfIps,
  createCfIp,
  updateCfIp,
  deleteCfIp,
  importCfIps
};
