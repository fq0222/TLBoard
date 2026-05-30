const { validationResult } = require('express-validator');
const {
  legacySuccess,
  legacyFail,
  legacyValidationError
} = require('../../shared/response/api-response');
const { createLogger } = require('../../utils/logger');
const cfOptimizeService = require('../../services/user/cf-optimize-service');

const logger = createLogger('USER-CF');

/**
 * 用户端 CF 优选控制器。
 * 负责参数校验、日志记录与旧响应结构兼容，具体业务逻辑下沉到 cf-optimize service。
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

async function getCfIps(req, res) {
  try {
    const result = await cfOptimizeService.getCfIps(req.app.locals.db, req.user);
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '获取CF IP池', error);
  }
}

async function applyCfIps(req, res) {
  if (handleValidationFailure(req, res, '应用优选IP')) {
    return;
  }

  try {
    const result = await cfOptimizeService.applyCfIpsByIds(
      req.app.locals.db,
      req,
      req.user,
      req.body.ip_ids
    );
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '应用优选IP', error);
  }
}

async function applyCfIpsByAddress(req, res) {
  if (handleValidationFailure(req, res, '通过IP地址应用优选IP')) {
    return;
  }

  try {
    const result = await cfOptimizeService.applyCfIpsByAddress(
      req.app.locals.db,
      req,
      req.user,
      req.body.ips
    );
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '通过IP地址应用优选IP', error);
  }
}

module.exports = {
  getCfIps,
  applyCfIps,
  applyCfIpsByAddress
};
