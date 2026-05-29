const { validationResult } = require('express-validator');
const {
  legacySuccess,
  legacyFail,
  legacyValidationError
} = require('../../shared/response/api-response');
const { parsePagination } = require('../../shared/utils/pagination');
const { createLogger } = require('../../utils/logger');
const announcementsService = require('../../services/user/announcements-service');

const logger = createLogger('USER-ANNOUNCEMENTS');

/**
 * 用户端公告控制器
 * 负责处理用户端公告列表 HTTP 请求与响应。
 */

/**
 * 获取公告分页列表。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function getAnnouncements(req, res) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('获取公告列表参数校验失败');
      return legacyValidationError(res);
    }

    const pagination = parsePagination(req.query);
    const data = await announcementsService.listAnnouncements(req.app.locals.db, pagination);

    logger.info(`获取公告列表成功，共 ${data.list.length} 条公告`);

    return legacySuccess(res, data);
  } catch (error) {
    logger.error(`获取公告列表错误: ${error.message}`);
    return legacyFail(res);
  }
}

module.exports = {
  getAnnouncements
};
