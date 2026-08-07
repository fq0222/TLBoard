/**
 * 管理端博客路由。
 * 负责博客接口的鉴权、参数校验、上传挂载与 controller 映射。
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { body, param, query } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const blogsController = require('../../controllers/admin/blogs-controller');

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '../../uploads/blog-images');
const VIDEO_UPLOAD_DIR = path.join(__dirname, '../../uploads/blog-videos');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

if (!fs.existsSync(VIDEO_UPLOAD_DIR)) {
  fs.mkdirSync(VIDEO_UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});

const videoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, VIDEO_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});

const articleValidators = [
  body('title').notEmpty().withMessage('标题不能为空').isLength({ max: 200 }).withMessage('标题不能超过200个字符'),
  body('summary').notEmpty().withMessage('简介不能为空').isLength({ max: 500 }).withMessage('简介不能超过500个字符'),
  body('category').optional({ nullable: true }).isLength({ max: 100 }).withMessage('分类不能超过100个字符'),
  body('content').notEmpty().withMessage('内容不能为空'),
  body('status').optional().isIn(['draft', 'published']).withMessage('状态不合法'),
  body('pinned').optional().isBoolean().withMessage('pinned 必须是布尔值')
];

function attachBlogDeleteOptions(req, _res, next) {
  req.blogDeleteOptions = {
    uploadDir: UPLOAD_DIR,
    videoUploadDir: VIDEO_UPLOAD_DIR
  };
  next();
}

router.get('/', authenticateAdmin, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isIn(['draft', 'published']),
  query('category').optional().isString(),
  query('keyword').optional().isString()
], blogsController.listArticles);

router.get('/categories', authenticateAdmin, blogsController.listCategories);

router.post('/', authenticateAdmin, articleValidators, blogsController.createArticle);

router.post('/upload-image', authenticateAdmin, blogsController.createImageUploadHandler({ storage }));
router.post('/upload-video', authenticateAdmin, blogsController.createVideoUploadHandler({ storage: videoStorage }));

router.get('/:id', authenticateAdmin, [
  param('id').isInt({ min: 1 })
], blogsController.getArticle);

router.put('/:id', authenticateAdmin, [
  param('id').isInt({ min: 1 }),
  ...articleValidators
], blogsController.updateArticle);

router.delete('/:id', authenticateAdmin, [
  param('id').isInt({ min: 1 })
], attachBlogDeleteOptions, blogsController.deleteArticle);

module.exports = router;
