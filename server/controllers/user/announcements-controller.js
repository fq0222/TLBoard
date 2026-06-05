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

/**
 * 获取当前用户首页公告弹窗信息。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function getLatestPopupAnnouncement(req, res) {
  try {
    const data = await announcementsService.getLatestAnnouncementPopup(req.app.locals.db, req.user.id);
    return legacySuccess(res, data);
  } catch (error) {
    logger.error(`获取公告弹窗错误: ${error.message}`);
    return legacyFail(res);
  }
}

/**
 * 上报当前用户已关闭公告弹窗。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function reportPopupClose(req, res) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('公告弹窗关闭上报参数校验失败');
      return legacyValidationError(res);
    }

    const announcementId = parseInt(req.params.id, 10);
    const data = await announcementsService.reportAnnouncementPopupClose(
      req.app.locals.db,
      req.user.id,
      announcementId
    );

    return legacySuccess(res, data);
  } catch (error) {
    logger.error(`公告弹窗关闭上报错误: ${error.message}`);
    return legacyFail(res, {
      statusCode: error.statusCode || 500,
      code: error.statusCode === 404 ? 404 : 500,
      message: error.statusCode === 404 ? error.message : undefined
    });
  }
}

module.exports = {
  getAnnouncements,
  getLatestPopupAnnouncement,
  reportPopupClose
};
