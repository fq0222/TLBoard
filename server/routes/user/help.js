/**
 * 用户端帮助中心路由
 * 处理帮助文章、分类和图片读取。
 */

const express = require('express');
const path = require('path');
const { param, query, validationResult } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth-user');
const {
  legacySuccess,
  legacyFail,
  legacyValidationError,
  legacyNotFound
} = require('../../shared/response/api-response');
const { parsePagination } = require('../../shared/utils/pagination');
const { createLogger } = require('../../utils/logger');
const blogService = require('../../services/blog-service');

const router = express.Router();
const logger = createLogger('USER-HELP');
const UPLOAD_DIR = path.join(__dirname, '../../uploads/blog-images');

/**
 * GET /api/user/help/images/:filename
 * 读取帮助中心图片。
 */
router.get('/images/:filename', [
  param('filename').custom((value) => blogService.isSafeBlogImageFilename(value))
], (req, res) => {
  try {
    if (!validationResult(req).isEmpty()) {
      return legacyNotFound(res, { message: '图片不存在' });
    }

    const filename = path.basename(req.params.filename);
    const filePath = path.resolve(UPLOAD_DIR, filename);
    const uploadRoot = path.resolve(UPLOAD_DIR);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    if (!filePath.startsWith(uploadRoot + path.sep)) {
      return legacyNotFound(res, { message: '图片不存在' });
    }

    return res.sendFile(filePath, (error) => {
      if (error && !res.headersSent) {
        legacyNotFound(res, { message: '图片不存在' });
      }
    });
  } catch (error) {
    logger.error(`读取帮助中心图片错误: ${error.message}`);
    return legacyFail(res);
  }
});

/**
 * GET /api/user/help/articles
 * 获取帮助文章列表。
 */
router.get('/articles', authenticateUser, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('category').optional().isString(),
  query('keyword').optional().isString()
], async (req, res) => {
  try {
    if (!validationResult(req).isEmpty()) {
      return legacyValidationError(res);
    }

    const { page, limit } = parsePagination(req.query);
    const data = await blogService.listPublishedArticles(req.app.locals.db, {
      ...req.query,
      page,
      limit
    });

    return legacySuccess(res, data);
  } catch (error) {
    logger.error(`获取帮助文章列表错误: ${error.message}`);
    return legacyFail(res);
  }
});

/**
 * GET /api/user/help/categories
 * 获取帮助文章分类。
 */
router.get('/categories', authenticateUser, async (req, res) => {
  try {
    const data = await blogService.listPublishedCategories(req.app.locals.db);
    return legacySuccess(res, data);
  } catch (error) {
    logger.error(`获取帮助文章分类错误: ${error.message}`);
    return legacyFail(res);
  }
});

/**
 * GET /api/user/help/articles/:id
 * 获取帮助文章详情。
 */
router.get('/articles/:id', authenticateUser, [
  param('id').isInt({ min: 1 })
], async (req, res) => {
  try {
    if (!validationResult(req).isEmpty()) {
      return legacyValidationError(res);
    }

    const article = await blogService.getPublishedArticle(req.app.locals.db, parseInt(req.params.id, 10));
    if (!article) {
      return legacyNotFound(res, { message: '文章不存在' });
    }

    return legacySuccess(res, article);
  } catch (error) {
    logger.error(`获取帮助文章详情错误: ${error.message}`);
    return legacyFail(res);
  }
});

module.exports = router;
