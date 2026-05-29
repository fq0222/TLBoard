const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { body, param, query } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const resourcesController = require('../../controllers/admin/resources-controller');

const router = express.Router();

// 上传目录
const UPLOAD_DIR = path.join(__dirname, '../../uploads/resources');

// 确保上传目录存在
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/**
 * 资源上传存储配置。
 * 保持旧实现中的上传目录与文件命名语义不变。
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueName = crypto.randomUUID();
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueName}${ext}`);
  }
});

const uploadResource = resourcesController.createUploadHandler({ storage });

router.get('/config', authenticateAdmin, resourcesController.getConfig);

router.put(
  '/config',
  authenticateAdmin,
  [
    body('max_file_size')
      .isInt({ min: 1, max: 1024 })
      .withMessage('最大文件大小必须是1-1024之间的整数'),
    body('download_speed_limit')
      .isInt({ min: 0 })
      .withMessage('下载速度限制必须是大于等于0的整数')
  ],
  resourcesController.saveConfig
);

router.get(
  '/',
  authenticateAdmin,
  [
    query('page').optional().isInt({ min: 1 }).withMessage('页码必须是大于0的整数'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('每页条数必须是1-100之间的整数')
  ],
  resourcesController.listResources
);

router.post('/upload', authenticateAdmin, uploadResource);

router.put(
  '/distributions/batch-expire',
  authenticateAdmin,
  [
    body('ids').isArray({ min: 1 }).withMessage('ID列表不能为空'),
    body('expire_minutes')
      .isInt({ min: 1 })
      .withMessage('过期时间必须是大于0的整数')
  ],
  resourcesController.batchExpireDistributions
);

router.delete(
  '/distributions/:id',
  authenticateAdmin,
  [param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数')],
  resourcesController.deleteDistribution
);

router.put(
  '/:id',
  authenticateAdmin,
  [
    param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数'),
    body('name').optional().notEmpty().withMessage('资源名称不能为空'),
    body('enabled').optional().isBoolean().withMessage('enabled必须是布尔值')
  ],
  resourcesController.updateResource
);

router.delete(
  '/:id',
  authenticateAdmin,
  [param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数')],
  resourcesController.deleteResource
);

router.post(
  '/:id/refresh-token',
  authenticateAdmin,
  [param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数')],
  resourcesController.refreshToken
);

router.put(
  '/:id/expire',
  authenticateAdmin,
  [
    param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数'),
    body('expire_at')
      .custom((value) => value === undefined || value === null || value === '' || Number.isInteger(Number(value)))
      .withMessage('过期时间必须是时间戳')
  ],
  resourcesController.updateExpireAt
);

router.post(
  '/:id/distribute',
  authenticateAdmin,
  [
    param('id').isInt({ min: 1 }).withMessage('资源ID必须是大于0的整数'),
    body('user_ids').isArray({ min: 1 }).withMessage('用户ID列表不能为空'),
    body('expire_minutes')
      .optional({ values: 'falsy' })
      .isInt({ min: 1 })
      .withMessage('过期时间必须是大于0的整数')
  ],
  resourcesController.distributeResource
);

router.get(
  '/:id/distributions',
  authenticateAdmin,
  [param('id').isInt({ min: 1 }).withMessage('资源ID必须是大于0的整数')],
  resourcesController.listDistributions
);

module.exports = router;
