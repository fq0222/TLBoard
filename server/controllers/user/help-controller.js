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
const helpVideoService = require('../../services/user/help-video-service');

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
 * 返回帮助中心视频。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Object} Express 响应结果
 */
async function getHelpVideo(req, res) {
  try {
    if (!validationResult(req).isEmpty()) {
      return legacyNotFound(res, { message: '视频不存在' });
    }

    const videoFile = helpService.resolveHelpVideoFile(req.params.filename);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    if (!videoFile.isInsideUploadRoot) {
      return legacyNotFound(res, { message: '视频不存在' });
    }

    let videoInfo;
    try {
      videoInfo = helpVideoService.buildVideoInfo(videoFile);
    } catch {
      return legacyNotFound(res, { message: '视频不存在' });
    }

    const videoConfig = await helpVideoService.getBlogVideoConfig(req.app.locals.db);
    const responseInfo = helpVideoService.buildVideoResponse(videoInfo, req.headers.range);
    const { stream, activeStreamCount, cleanup } = helpVideoService.createVideoStream(
      videoInfo,
      responseInfo.streamOptions,
      videoConfig.speedLimit
    );
    const limitText = videoConfig.speedLimit > 0
      ? `全局限速 ${videoConfig.speedLimitKb}KB/s, 当前活跃视频流 ${activeStreamCount}`
      : '不限速';

    res.status(responseInfo.statusCode);
    Object.entries(responseInfo.headers).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    stream.on('error', (streamError) => {
      logger.error(`读取帮助中心视频文件错误: ${streamError.message}`);
      if (!res.headersSent) {
        legacyNotFound(res, { message: '视频不存在' });
      }
    });

    res.on('close', () => {
      if (!res.writableEnded) {
        cleanup();
        logger.warn(`帮助中心视频传输中断(${limitText}): ${videoInfo.filename}`);
      }
    });

    logger.info(`读取帮助中心视频(${limitText}): ${videoInfo.filename}`);
    return stream.pipe(res);
  } catch (error) {
    if (error?.isLegacyBusinessError) {
      if (error.headers) {
        Object.entries(error.headers).forEach(([key, value]) => res.setHeader(key, value));
      }
      return res.status(error.statusCode).json({
        code: error.code,
        message: error.message,
        data: error.data
      });
    }

    logger.error(`读取帮助中心视频错误: ${error.message}`);
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

    logger.info(
      `用户访问帮助文章: articleId=${article.id}, articleTitle=${JSON.stringify(article.title || '')}, user=${req.user?.email || req.user?.id || 'unknown'}`
    );

    return legacySuccess(res, article);
  } catch (error) {
    logger.error(`获取帮助文章详情错误: ${error.message}`);
    return legacyFail(res);
  }
}

module.exports = {
  getHelpImage,
  getHelpVideo,
  listHelpArticles,
  listHelpCategories,
  getHelpArticleDetail
};
