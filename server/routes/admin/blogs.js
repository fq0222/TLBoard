const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { body, param, query, validationResult } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const { createLogger } = require('../../utils/logger');
const blogService = require('../../services/blog-service');

const router = express.Router();
const logger = createLogger('ADMIN-BLOGS');
const UPLOAD_DIR = path.join(__dirname, '../../uploads/blog-images');
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error('只允许上传 JPG、PNG、GIF 或 WebP 图片'));
    }
    cb(null, true);
  }
}).single('file');

function sendValidationError(res) {
  return res.status(400).json({ code: 1001, message: '参数校验失败', data: null });
}

function sendBusinessError(res, message) {
  return res.status(400).json({ code: 1001, message, data: null });
}

const articleValidators = [
  body('title').notEmpty().withMessage('标题不能为空').isLength({ max: 200 }).withMessage('标题不能超过200个字符'),
  body('summary').notEmpty().withMessage('简介不能为空').isLength({ max: 500 }).withMessage('简介不能超过500个字符'),
  body('category').optional({ nullable: true }).isLength({ max: 100 }).withMessage('分类不能超过100个字符'),
  body('content').notEmpty().withMessage('内容不能为空'),
  body('status').optional().isIn(['draft', 'published']).withMessage('状态不合法')
];

router.get('/', authenticateAdmin, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isIn(['draft', 'published']),
  query('category').optional().isString(),
  query('keyword').optional().isString()
], async (req, res) => {
  try {
    if (!validationResult(req).isEmpty()) return sendValidationError(res);
    const data = await blogService.listAdminArticles(req.app.locals.db, req.query);
    res.json({ code: 0, message: 'ok', data });
  } catch (error) {
    logger.error(`获取博客列表错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

router.get('/categories', authenticateAdmin, async (req, res) => {
  try {
    const data = await blogService.listAdminCategories(req.app.locals.db);
    res.json({ code: 0, message: 'ok', data });
  } catch (error) {
    logger.error(`获取博客分类错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

router.post('/', authenticateAdmin, articleValidators, async (req, res) => {
  try {
    if (!validationResult(req).isEmpty()) return sendValidationError(res);
    const article = await blogService.createArticle(req.app.locals.db, req.body);
    logger.info(`新增博客文章成功: ${article.title} (ID: ${article.id})`);
    res.json({ code: 0, message: 'ok', data: article });
  } catch (error) {
    logger.warn(`新增博客文章失败: ${error.message}`);
    sendBusinessError(res, error.message);
  }
});

router.post('/upload-image', authenticateAdmin, (req, res) => {
  upload(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? '图片大小不能超过5MB' : err.message;
      return sendBusinessError(res, message);
    }

    if (!req.file) {
      return sendBusinessError(res, '请选择要上传的图片');
    }

    const url = `${blogService.BLOG_IMAGE_PREFIX}${req.file.filename}`;
    logger.info(`上传博客图片成功: ${req.file.filename}`);
    res.json({
      code: 0,
      message: 'ok',
      data: {
        filename: req.file.filename,
        url,
        markdown: `![图片说明](${url})`
      }
    });
  });
});

router.get('/:id', authenticateAdmin, [
  param('id').isInt({ min: 1 })
], async (req, res) => {
  try {
    if (!validationResult(req).isEmpty()) return sendValidationError(res);
    const article = await blogService.getAdminArticle(req.app.locals.db, parseInt(req.params.id, 10));
    if (!article) return sendBusinessError(res, '文章不存在');
    res.json({ code: 0, message: 'ok', data: article });
  } catch (error) {
    logger.error(`获取博客详情错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

router.put('/:id', authenticateAdmin, [
  param('id').isInt({ min: 1 }),
  ...articleValidators
], async (req, res) => {
  try {
    if (!validationResult(req).isEmpty()) return sendValidationError(res);
    const article = await blogService.updateArticle(req.app.locals.db, parseInt(req.params.id, 10), req.body);
    if (!article) return sendBusinessError(res, '文章不存在');
    logger.info(`更新博客文章成功: ${article.title} (ID: ${article.id})`);
    res.json({ code: 0, message: 'ok', data: article });
  } catch (error) {
    logger.warn(`更新博客文章失败: ${error.message}`);
    sendBusinessError(res, error.message);
  }
});

router.delete('/:id', authenticateAdmin, [
  param('id').isInt({ min: 1 })
], async (req, res) => {
  try {
    if (!validationResult(req).isEmpty()) return sendValidationError(res);
    const article = await blogService.deleteArticle(req.app.locals.db, parseInt(req.params.id, 10), {
      uploadDir: UPLOAD_DIR,
      logger
    });
    if (!article) return sendBusinessError(res, '文章不存在');
    logger.info(`删除博客文章成功: ${article.title} (ID: ${article.id})`);
    res.json({ code: 0, message: 'ok', data: { message: '文章已删除' } });
  } catch (error) {
    logger.error(`删除博客文章错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

module.exports = router;
