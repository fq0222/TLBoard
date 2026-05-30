const { validationResult } = require('express-validator');
const {
  legacySuccess,
  legacyFail,
  legacyValidationError
} = require('../../shared/response/api-response');
const { createLogger } = require('../../utils/logger');
const adminsService = require('../../services/admin/admins-service');

const logger = createLogger('ADMIN-MANAGE');

/**
 * 管理端管理员管理控制器。
 * 负责参数校验、日志记录与旧响应结构兼容，具体业务逻辑下沉到 admins service。
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

async function listAdmins(req, res) {
  try {
    const result = await adminsService.listAdmins(req.app.locals.db);
    logger.info(`获取管理员列表成功，共 ${result.list.length} 条记录`);
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '获取管理员列表', error);
  }
}

async function createAdmin(req, res) {
  if (handleValidationFailure(req, res, '添加管理员')) {
    return;
  }

  try {
    const result = await adminsService.createAdmin(req.app.locals.db, req.body);
    logger.info(`添加管理员成功: ${result.username} (ID: ${result.id})`);
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '添加管理员', error);
  }
}

async function deleteAdmin(req, res) {
  if (handleValidationFailure(req, res, '删除管理员')) {
    return;
  }

  try {
    const result = await adminsService.deleteAdmin(
      req.app.locals.db,
      parseInt(req.params.id, 10),
      req.admin.id
    );
    logger.info(`删除管理员成功: ID ${req.params.id}`);
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '删除管理员', error);
  }
}

module.exports = {
  listAdmins,
  createAdmin,
  deleteAdmin
};
