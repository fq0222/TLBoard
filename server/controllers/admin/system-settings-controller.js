const { validationResult } = require('express-validator');
const {
  legacySuccess,
  legacyFail,
  legacyValidationError
} = require('../../shared/response/api-response');
const { createLogger } = require('../../utils/logger');
const systemSettingsService = require('../../services/admin/system-settings-service');

const logger = createLogger('ADMIN-SYSTEM-SETTINGS');

/**
 * 管理端系统设置控制器。
 * 职责：处理参数校验、日志与旧响应格式，具体配置规则下沉到 system-settings-service。
 */

/**
 * 处理 express-validator 校验失败。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {boolean} 是否已返回错误响应
 */
function handleValidationFailure(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return false;
  }

  legacyValidationError(res, {
    message: errors.array()[0]?.msg || '参数校验失败'
  });
  return true;
}

/**
 * 输出兼容旧接口的系统错误响应。
 *
 * @param {Object} res - Express 响应对象
 * @param {string} action - 当前操作描述
 * @param {Error} error - 错误对象
 * @returns {Object} Express 响应结果
 */
function handleControllerError(res, action, error) {
  logger.error(`${action}失败: ${error.message}`);
  return legacyFail(res);
}

async function getTrafficConfig(req, res) {
  try {
    const data = await systemSettingsService.getTrafficConfig(req.app.locals.db);
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '获取流量配置', error);
  }
}

async function saveTrafficConfig(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const data = await systemSettingsService.saveTrafficConfig(req.app.locals.db, {
      traffic_usage_multiplier: Number(req.body.traffic_usage_multiplier),
      referral_reward_traffic: Math.floor(Number(req.body.referral_reward_traffic))
    });

    logger.info(
      `保存流量配置成功: multiplier=${data.traffic_usage_multiplier}, referralRewardTraffic=${data.referral_reward_traffic}`
    );
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '保存流量配置', error);
  }
}

async function getEmailConfig(req, res) {
  try {
    const data = await systemSettingsService.getEmailConfig(req.app.locals.db);
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '获取邮件配置', error);
  }
}

async function saveEmailConfig(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const data = await systemSettingsService.saveEmailConfig(req.app.locals.db, req.body);
    logger.info('保存邮件配置成功');
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '保存邮件配置', error);
  }
}

async function getResourceConfig(req, res) {
  try {
    const data = await systemSettingsService.getResourceConfig(req.app.locals.db);
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '获取资源配置', error);
  }
}

async function saveResourceConfig(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const data = await systemSettingsService.saveResourceConfig(req.app.locals.db, req.body);
    logger.info(`保存资源配置成功: ${JSON.stringify(data)}`);
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '保存资源配置', error);
  }
}

async function getSubscriptionConfig(req, res) {
  try {
    const data = await systemSettingsService.getSubscriptionConfig(req.app.locals.db);
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '获取订阅配置', error);
  }
}

async function saveSubscriptionConfig(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const data = await systemSettingsService.saveSubscriptionConfig(req.app.locals.db, {
      clash_config_name: String(req.body.clash_config_name).trim(),
      clash_profile_update_interval: Number(req.body.clash_profile_update_interval),
      telegram_channel_url: String(req.body.telegram_channel_url || '').trim(),
      online_customer_service_url: String(req.body.online_customer_service_url || '').trim()
    });

    logger.info(
      `保存订阅配置成功: name=${data.clash_config_name}, interval=${data.clash_profile_update_interval}`
    );
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '保存订阅配置', error);
  }
}

module.exports = {
  getTrafficConfig,
  saveTrafficConfig,
  getEmailConfig,
  saveEmailConfig,
  getResourceConfig,
  saveResourceConfig,
  getSubscriptionConfig,
  saveSubscriptionConfig
};
