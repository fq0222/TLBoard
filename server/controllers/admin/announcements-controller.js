const { validationResult } = require('express-validator');
const {
  legacySuccess,
  legacyFail,
  legacyValidationError
} = require('../../shared/response/api-response');
const { parsePagination } = require('../../shared/utils/pagination');
const { createLogger } = require('../../utils/logger');
const announcementsService = require('../../services/admin/announcements-service');

const logger = createLogger('ADMIN-ANNOUNCEMENTS');

/**
 * 管理端公告控制器
 * 负责参数校验、旧响应结构兼容，以及请求级日志记录。
 */

/**
 * 统一输出兼容旧接口的错误响应。
 *
 * @param {Object} res - Express 响应对象
 * @param {string} action - 当前操作描述
 * @param {Error} error - 业务异常或系统异常
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

/**
 * 获取管理端公告分页列表。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function listAnnouncements(req, res) {
  try {
    if (!validationResult(req).isEmpty()) {
      logger.warn('获取公告列表参数校验失败');
      return legacyValidationError(res);
    }

    const pagination = parsePagination(req.query);
    const data = await announcementsService.listAnnouncements(req.app.locals.db, pagination);

    logger.info(`获取公告列表成功，共 ${data.list.length} 条公告`);
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '获取公告列表', error);
  }
}

/**
 * 创建公告。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function createAnnouncement(req, res) {
  try {
    if (!validationResult(req).isEmpty()) {
      logger.warn('添加公告参数校验失败');
      return legacyValidationError(res);
    }

    const data = await announcementsService.createAnnouncement(req.app.locals.db, {
      title: req.body.title,
      content: req.body.content === undefined ? null : req.body.content,
      pinned: req.body.pinned === undefined ? false : req.body.pinned,
      enabled: req.body.enabled === undefined ? true : req.body.enabled,
      popup_show_limit: req.body.popup_show_limit === undefined ? 0 : req.body.popup_show_limit
    });

    logger.info(`添加公告成功: ${data.title} (ID: ${data.id})`);
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '添加公告', error);
  }
}

/**
 * 更新公告。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function updateAnnouncement(req, res) {
  try {
    if (!validationResult(req).isEmpty()) {
      logger.warn('修改公告参数校验失败');
      return legacyValidationError(res);
    }

    const announcementId = parseInt(req.params.id, 10);
    const data = await announcementsService.updateAnnouncement(req.app.locals.db, announcementId, req.body);

    logger.info(`修改公告成功: ${data.title} (ID: ${announcementId})`);
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '修改公告', error);
  }
}

/**
 * 删除公告。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function deleteAnnouncement(req, res) {
  try {
    if (!validationResult(req).isEmpty()) {
      logger.warn('删除公告参数校验失败');
      return legacyValidationError(res);
    }

    const announcementId = parseInt(req.params.id, 10);
    const data = await announcementsService.deleteAnnouncement(req.app.locals.db, announcementId);

    logger.info(`删除公告成功: ID ${announcementId}`);
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '删除公告', error);
  }
}

module.exports = {
  listAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement
};
