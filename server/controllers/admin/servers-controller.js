const { validationResult } = require('express-validator');
const {
  legacySuccess,
  legacyFail,
  legacyValidationError
} = require('../../shared/response/api-response');
const { createLogger } = require('../../utils/logger');
const serversService = require('../../services/admin/servers-service');

const logger = createLogger('ADMIN-SERVERS');

/**
 * 管理端 3X-UI 服务器控制器。
 * 负责参数校验、日志记录与旧响应结构兼容，具体业务逻辑下沉到 servers service。
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

async function listServers(req, res) {
  try {
    const result = await serversService.listServers(req.app.locals.db);
    logger.info(`获取服务器列表成功，共 ${result.servers.length} 台服务器`);
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '获取服务器列表', error);
  }
}

async function createServer(req, res) {
  if (handleValidationFailure(req, res, '添加服务器')) {
    return;
  }

  try {
    const result = await serversService.createServer(req.app.locals.db, req.body);
    logger.info(`添加服务器成功: ${result.name} (ID: ${result.id})`);
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '添加服务器', error);
  }
}

async function updateServer(req, res) {
  if (handleValidationFailure(req, res, '修改服务器')) {
    return;
  }

  try {
    const result = await serversService.updateServer(
      req.app.locals.db,
      parseInt(req.params.id, 10),
      req.body
    );
    logger.info(`修改服务器成功: ${result.name} (ID: ${result.id})`);
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '修改服务器', error);
  }
}

async function deleteServer(req, res) {
  if (handleValidationFailure(req, res, '删除服务器')) {
    return;
  }

  try {
    const result = await serversService.deleteServer(
      req.app.locals.db,
      parseInt(req.params.id, 10)
    );
    logger.info(`删除服务器成功: ID ${req.params.id}`);
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '删除服务器', error);
  }
}

async function getServerDetail(req, res) {
  if (handleValidationFailure(req, res, '获取服务器详情')) {
    return;
  }

  try {
    const result = await serversService.getServerDetail(
      req.app.locals.db,
      parseInt(req.params.id, 10)
    );
    logger.info(`获取服务器详情成功: ${result.server.name}`);
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '获取服务器详情', error);
  }
}

async function syncServer(req, res) {
  if (handleValidationFailure(req, res, '同步服务器')) {
    return;
  }

  try {
    const result = await serversService.syncServer(
      req.app.locals.db,
      parseInt(req.params.id, 10)
    );
    logger.info(`同步服务器成功: ID ${req.params.id}`);
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '同步服务器', error);
  }
}

async function updateServerUser(req, res) {
  if (handleValidationFailure(req, res, '更新服务器用户')) {
    return;
  }

  try {
    const result = await serversService.updateServerUser(
      req.app.locals.db,
      parseInt(req.params.id, 10),
      req.body
    );
    logger.info(`更新服务器用户成功: ${req.body.email}`);
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '更新服务器用户', error);
  }
}

async function deleteServerUser(req, res) {
  if (handleValidationFailure(req, res, '删除服务器用户')) {
    return;
  }

  try {
    const result = await serversService.deleteServerUser(
      req.app.locals.db,
      parseInt(req.params.id, 10),
      req.body
    );
    logger.info(`删除服务器用户成功: ${req.body.email}`);
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '删除服务器用户', error);
  }
}

/**
 * 启动 3X-UI 数据库手动备份任务。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function runBackupTask(req, res) {
  try {
    const result = await serversService.runBackupTask(req.app.locals.db);
    logger.info(`启动 3X-UI 备份任务成功: taskId=${result.id}`);
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '启动 3X-UI 备份任务', error);
  }
}

module.exports = {
  listServers,
  createServer,
  updateServer,
  deleteServer,
  getServerDetail,
  syncServer,
  runBackupTask,
  updateServerUser,
  deleteServerUser
};
