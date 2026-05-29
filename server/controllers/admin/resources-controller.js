const multer = require('multer');
const { validationResult } = require('express-validator');
const {
  legacySuccess,
  legacyFail,
  legacyValidationError
} = require('../../shared/response/api-response');
const { createLogger } = require('../../utils/logger');
const resourcesService = require('../../services/admin/resources-service');

const logger = createLogger('ADMIN-RESOURCES');

/**
 * 管理端资源控制器。
 * 负责参数校验、上传流程接入与旧接口响应结构兼容。
 */

function handleValidationFailure(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return false;
  }

  legacyValidationError(res);
  return true;
}

/**
 * 输出兼容旧接口的错误响应。
 *
 * @param {Object} res - Express 响应对象
 * @param {string} action - 当前操作描述
 * @param {Error} error - 错误对象
 * @returns {Object} Express 响应结果
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
  return legacyFail(res);
}

async function getConfig(req, res) {
  try {
    const config = await resourcesService.getResourceConfig(req.app.locals.db);
    return legacySuccess(res, config);
  } catch (error) {
    return handleControllerError(res, '获取资源配置', error);
  }
}

async function saveConfig(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const config = await resourcesService.saveResourceConfig(req.app.locals.db, req.body);
    return legacySuccess(res, config);
  } catch (error) {
    return handleControllerError(res, '保存资源配置', error);
  }
}

async function listResources(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const result = await resourcesService.getResourceList(req.app.locals.db, req.query);
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '获取资源列表', error);
  }
}

/**
 * 创建上传处理器。
 * 路由层保留 storage 挂载，控制器负责把上传结果接入 service。
 *
 * @param {Object} options - 上传配置
 * @param {Object} options.storage - multer 存储配置
 * @returns {Function} Express 路由处理器
 */
function createUploadHandler(options) {
  const { storage } = options;

  return async function uploadResource(req, res) {
    try {
      const config = await resourcesService.getResourceConfig(req.app.locals.db);
      const upload = multer({
        storage,
        limits: {
          fileSize: config.max_file_size * 1024 * 1024
        }
      }).single('file');

      upload(req, res, async (error) => {
        if (error) {
          if (error.code === 'LIMIT_FILE_SIZE') {
            return legacyValidationError(res, {
              message: `文件大小超过限制，最大允许${config.max_file_size}MB`
            });
          }

          return legacyValidationError(res, {
            message: error.message
          });
        }

        if (!req.file) {
          return legacyValidationError(res, {
            message: '请选择要上传的文件'
          });
        }

        try {
          const resource = await resourcesService.createUploadedResource(
            req.app.locals.db,
            req.file,
            req.body.name
          );

          return legacySuccess(res, resource);
        } catch (serviceError) {
          return handleControllerError(res, '上传文件', serviceError);
        }
      });
    } catch (error) {
      return handleControllerError(res, '上传文件', error);
    }
  };
}

async function updateResource(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const resource = await resourcesService.updateResource(
      req.app.locals.db,
      parseInt(req.params.id, 10),
      req.body
    );

    return legacySuccess(res, resource);
  } catch (error) {
    return handleControllerError(res, '更新资源', error);
  }
}

async function deleteResource(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const result = await resourcesService.removeResource(
      req.app.locals.db,
      parseInt(req.params.id, 10)
    );

    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '删除资源', error);
  }
}

async function refreshToken(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const resource = await resourcesService.refreshResourceToken(
      req.app.locals.db,
      parseInt(req.params.id, 10)
    );

    return legacySuccess(res, resource);
  } catch (error) {
    return handleControllerError(res, '刷新 token', error);
  }
}

async function updateExpireAt(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const expireAt = req.body.expire_at === undefined
      || req.body.expire_at === null
      || req.body.expire_at === ''
      ? null
      : parseInt(req.body.expire_at, 10);
    const resource = await resourcesService.setResourceExpireAt(
      req.app.locals.db,
      parseInt(req.params.id, 10),
      expireAt
    );

    return legacySuccess(res, resource);
  } catch (error) {
    return handleControllerError(res, '设置过期时间', error);
  }
}

async function distributeResource(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const result = await resourcesService.distributeResource(
      req.app.locals.db,
      parseInt(req.params.id, 10),
      req.body.user_ids,
      req.body.expire_minutes
    );

    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '分发资源', error);
  }
}

async function listDistributions(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const result = await resourcesService.getResourceDistributions(
      req.app.locals.db,
      parseInt(req.params.id, 10)
    );

    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '获取分发列表', error);
  }
}

async function batchExpireDistributions(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const result = await resourcesService.batchExpireDistributions(
      req.app.locals.db,
      req.body.ids,
      req.body.expire_minutes
    );

    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '批量设置过期时间', error);
  }
}

async function deleteDistribution(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const result = await resourcesService.removeDistribution(
      req.app.locals.db,
      parseInt(req.params.id, 10)
    );

    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '删除分发记录', error);
  }
}

module.exports = {
  getConfig,
  saveConfig,
  listResources,
  createUploadHandler,
  updateResource,
  deleteResource,
  refreshToken,
  updateExpireAt,
  distributeResource,
  listDistributions,
  batchExpireDistributions,
  deleteDistribution
};
