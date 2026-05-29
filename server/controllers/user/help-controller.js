/**
 * 用户端帮助中心控制器。
 * 负责处理请求校验结果、调用服务层，并通过 shared 兼容响应层返回结果。
 */

const { validationResult } = require('express-validator');
const {
  legacySuccess,
  legacyFail,
  legacyValidationError,
  legacyNotFound
} = require('../../shared/response/api-response');
const { createLogger } = require('../../utils/logger');
const helpService = require('../../services/user/help-service');

const logger = createLogger('USER-HELP');

/**
 * 返回帮助中心图片。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Object} Express 响应结果
 */
function getHelpImage(req, res) {
  try {
    if (!validationResult(req).isEmpty()) {
      return legacyNotFound(res, { message: '图片不存在' });
    }

    const imageFile = helpService.resolveHelpImageFile(req.params.filename);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    if (!imageFile.isInsideUploadRoot) {
      return legacyNotFound(res, { message: '图片不存在' });
    }

    return res.sendFile(imageFile.filePath, (error) => {
      if (error && !res.headersSent) {
        legacyNotFound(res, { message: '图片不存在' });
      }
    });
  } catch (error) {
    logger.error(`读取帮助中心图片错误: ${error.message}`);
    return legacyFail(res);
  }
}

/**
 * 返回帮助文章列表。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function listHelpArticles(req, res) {
  try {
    if (!validationResult(req).isEmpty()) {
      return legacyValidationError(res);
    }

    const data = await helpService.listHelpArticles(req.app.locals.db, req.helpListQuery);
    return legacySuccess(res, data);
  } catch (error) {
    logger.error(`获取帮助文章列表错误: ${error.message}`);
    return legacyFail(res);
  }
}

/**
 * 返回帮助文章分类。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function listHelpCategories(req, res) {
  try {
    const data = await helpService.listHelpCategories(req.app.locals.db);
    return legacySuccess(res, data);
  } catch (error) {
    logger.error(`获取帮助文章分类错误: ${error.message}`);
    return legacyFail(res);
  }
}

/**
 * 返回帮助文章详情。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function getHelpArticleDetail(req, res) {
  try {
    if (!validationResult(req).isEmpty()) {
      return legacyValidationError(res);
    }

    const article = await helpService.getHelpArticleById(req.app.locals.db, parseInt(req.params.id, 10));
    if (!article) {
      return legacyNotFound(res, { message: '文章不存在' });
    }

    return legacySuccess(res, article);
  } catch (error) {
    logger.error(`获取帮助文章详情错误: ${error.message}`);
    return legacyFail(res);
  }
}

module.exports = {
  getHelpImage,
  listHelpArticles,
  listHelpCategories,
  getHelpArticleDetail
};
