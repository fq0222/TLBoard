const { legacySuccess, legacyFail } = require('../../shared/response/api-response');
const { createLogger } = require('../../utils/logger');
const syncStatusService = require('../../services/user/sync-status-service');

const logger = createLogger('SYNC-STATUS');

/**
 * 用户端同步状态控制器。
 * 负责日志记录与旧响应结构兼容，具体状态查询逻辑下沉到 sync-status service。
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

async function getSyncStatus(req, res) {
  try {
    const result = await syncStatusService.getSyncStatus(req.app.locals.db, req.user.id);
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '获取同步状态', error);
  }
}

module.exports = {
  getSyncStatus
};
