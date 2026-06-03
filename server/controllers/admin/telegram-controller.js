const { validationResult } = require('express-validator');
const { legacyFail, legacySuccess, legacyValidationError } = require('../../shared/response/api-response');
const { createLogger } = require('../../utils/logger');
const config = require('../../config');
const telegramAdminService = require('../../services/admin/telegram-admin-service');

const logger = createLogger('ADMIN-TELEGRAM');

function handleValidationFailure(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return false;
  }

  logger.warn(`Telegram 管理接口参数校验失败: ${JSON.stringify(errors.array())}`);
  legacyValidationError(res, {
    message: errors.array()[0]?.msg || '参数校验失败'
  });
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
  return legacyFail(res, {
    code: 500,
    message: '服务器内部错误',
    data: null
  });
}

async function getTelegramConfig(req, res) {
  try {
    return legacySuccess(res, {
      internal_api_enabled: !!config.telegram.internalApiEnabled,
      has_internal_api_secret: !!config.telegram.internalApiSecret,
      internal_api_allowed_skew_seconds: Number(config.telegram.internalApiAllowedSkewSeconds) || 300,
      internal_api_path_prefix: '/api/internal/telegram'
    });
  } catch (error) {
    return handleControllerError(res, '获取 Telegram 配置', error);
  }
}

async function createAdminBindCode(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const targetAdminId = Number(req.body.admin_id || req.admin.id);
    if (!req.admin.is_super && targetAdminId !== Number(req.admin.id)) {
      return legacyFail(res, {
        statusCode: 403,
        code: 1004,
        message: '无权限为其他管理员生成绑定码',
        data: null
      });
    }

    const data = await telegramAdminService.createAdminBindCode(req.app.locals.db, {
      admin_id: targetAdminId,
      created_by_admin_id: req.admin.id,
      expires_in_seconds: req.body.expires_in_seconds
    });

    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '生成管理员绑定码', error);
  }
}

async function listAdminBindings(req, res) {
  try {
    const data = await telegramAdminService.listAdminBindings(req.app.locals.db);
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '查询管理员绑定列表', error);
  }
}

module.exports = {
  createAdminBindCode,
  getTelegramConfig,
  listAdminBindings
};

