const { createLogger } = require('../../utils/logger');
const { legacySuccess, legacyFail } = require('../../shared/response/api-response');
const publicSettingsService = require('../../services/user/public-settings-service');

const logger = createLogger('USER-PUBLIC-SETTINGS');

/**
 * 用户端公开设置控制器。
 * 职责：提供匿名页面可读取的设置白名单，保持旧接口响应结构。
 */

/**
 * 获取公开设置。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function getPublicSettings(req, res) {
  try {
    const data = await publicSettingsService.getPublicSettings(req.app.locals.db);
    return legacySuccess(res, data);
  } catch (error) {
    logger.error(`获取公开设置失败: ${error.message}`);
    return legacyFail(res);
  }
}

module.exports = {
  getPublicSettings
};
