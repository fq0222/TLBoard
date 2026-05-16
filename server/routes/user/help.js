const express = require('express');
const path = require('path');
const { param, query, validationResult } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth-user');
const { createLogger } = require('../../utils/logger');
const blogService = require('../../services/blog-service');

const router = express.Router();
const logger = createLogger('USER-HELP');
const UPLOAD_DIR = path.join(__dirname, '../../uploads/blog-images');

function sendValidationError(res) {
  return res.status(400).json({ code: 1001, message: '参数校验失败', data: null });
}

router.get('/images/:filename', [
  param('filename').custom((value) => blogService.isSafeBlogImageFilename(value))
], (req, res) => {
  try {
    if (!validationResult(req).isEmpty()) {
      return res.status(404).json({ code: 404, message: '图片不存在', data: null });
    }

    const filename = path.basename(req.params.filename);
    const filePath = path.resolve(UPLOAD_DIR, filename);
    const uploadRoot = path.resolve(UPLOAD_DIR);

    if (!filePath.startsWith(uploadRoot + path.sep)) {
      return res.status(404).json({ code: 404, message: '图片不存在', data: null });
    }

    res.sendFile(filePath, (error) => {
      if (error && !res.headersSent) {
        res.status(404).json({ code: 404, message: '图片不存在', data: null });
      }
    });
  } catch (error) {
    logger.error(`读取帮助中心图片错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

router.get('/articles', authenticateUser, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('category').optional().isString(),
  query('keyword').optional().isString()
], async (req, res) => {
  try {
    if (!validationResult(req).isEmpty()) return sendValidationError(res);
    const data = await blogService.listPublishedArticles(req.app.locals.db, req.query);
    res.json({ code: 0, message: 'ok', data });
  } catch (error) {
    logger.error(`获取帮助文章列表错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

router.get('/categories', authenticateUser, async (req, res) => {
  try {
    const data = await blogService.listPublishedCategories(req.app.locals.db);
    res.json({ code: 0, message: 'ok', data });
  } catch (error) {
    logger.error(`获取帮助文章分类错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

router.get('/articles/:id', authenticateUser, [
  param('id').isInt({ min: 1 })
], async (req, res) => {
  try {
    if (!validationResult(req).isEmpty()) return sendValidationError(res);
    const article = await blogService.getPublishedArticle(req.app.locals.db, parseInt(req.params.id, 10));
    if (!article) {
      return res.status(404).json({ code: 404, message: '文章不存在', data: null });
    }
    res.json({ code: 0, message: 'ok', data: article });
  } catch (error) {
    logger.error(`获取帮助文章详情错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

module.exports = router;
