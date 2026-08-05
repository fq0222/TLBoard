/**
 * 管理端留言板控制器
 * 负责管理留言列表、精选展示状态、删除和统计。
 */

const { validationResult } = require('express-validator');
const {
  legacySuccess,
  legacyFail,
  legacyValidationError
} = require('../../shared/response/api-response');
const { parsePagination } = require('../../shared/utils/pagination');
const { createLogger } = require('../../utils/logger');
const feedbackService = require('../../services/shared/feedback-service');

const logger = createLogger('ADMIN-FEEDBACK');

/**
 * 输出旧接口兼容错误响应。
 * 职责：复用管理端现有错误响应形态。
 * 关键参数：业务错误 expose=true 时透出状态码和提示。
 * 核心分支语义：未知错误统一返回 500。
 *
 * @param {Object} res - Express 响应对象
 * @param {Error} error - 错误对象
 * @returns {Object} Express 响应
 */
function respondLegacyError(res, error) {
  if (error && error.expose) {
    return legacyFail(res, {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message
    });
  }

  return legacyFail(res);
}

/**
 * 获取留言统计。
 * 职责：返回全部留言、精选留言和总投票数。
 * 关键参数：无。
 * 核心分支语义：失败时返回旧格式 500。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应
 */
async function getStats(req, res) {
  try {
    const data = await feedbackService.getStats(req.app.locals.db);
    return legacySuccess(res, data);
  } catch (error) {
    logger.error(`获取留言统计失败: ${error.message}`);
    return legacyFail(res);
  }
}

/**
 * 获取留言列表。
 * 职责：分页返回所有用户留言供管理员处理。
 * 关键参数：page/limit 来自查询参数。
 * 核心分支语义：参数错误返回 400；正常返回分页对象。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应
 */
async function listMessages(req, res) {
  try {
    if (!validationResult(req).isEmpty()) {
      return legacyValidationError(res);
    }

    const data = await feedbackService.listAdminMessages(
      req.app.locals.db,
      parsePagination(req.query)
    );

    return legacySuccess(res, data);
  } catch (error) {
    logger.error(`获取留言列表失败: ${error.message}`);
    return legacyFail(res);
  }
}

/**
 * 更新留言精选展示状态。
 * 职责：管理员选择某条留言是否展示到用户端。
 * 关键参数：req.body.featured 为目标状态。
 * 核心分支语义：留言不存在或参数错误时返回明确错误。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应
 */
async function updateFeatured(req, res) {
  try {
    if (!validationResult(req).isEmpty()) {
      return legacyValidationError(res);
    }

    const data = await feedbackService.updateFeatured(
      req.app.locals.db,
      parseInt(req.params.id, 10),
      !!req.body.featured
    );

    logger.info(`管理员 ${req.admin.username} 更新留言 ${req.params.id} 展示状态: ${data.featured}`);
    return legacySuccess(res, data);
  } catch (error) {
    logger.error(`更新留言展示状态失败: ${error.message}`);
    return respondLegacyError(res, error);
  }
}

/**
 * 删除留言。
 * 职责：管理员删除留言并清理投票。
 * 关键参数：req.params.id 为留言 ID。
 * 核心分支语义：删除使用 service 事务，失败时不会留下半删除状态。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应
 */
async function deleteMessage(req, res) {
  try {
    if (!validationResult(req).isEmpty()) {
      return legacyValidationError(res);
    }

    const data = await feedbackService.deleteMessage(
      req.app.locals.db,
      parseInt(req.params.id, 10)
    );

    logger.info(`管理员 ${req.admin.username} 删除留言 ${req.params.id} 成功`);
    return legacySuccess(res, data);
  } catch (error) {
    logger.error(`删除留言失败: ${error.message}`);
    return respondLegacyError(res, error);
  }
}

module.exports = {
  getStats,
  listMessages,
  updateFeatured,
  deleteMessage
};
