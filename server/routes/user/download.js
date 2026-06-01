/**
 * 用户端下载路由。
 * 负责下载资源列表、按资源 ID 生成下载链接，以及 token 文件下载的鉴权与参数校验。
 */

const express = require('express');
const { param } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth-user');
const downloadController = require('../../controllers/user/download-controller');

const router = express.Router();

router.get('/resources', authenticateUser, downloadController.getDownloadResources);

router.post(
  '/link/:resourceId',
  authenticateUser,
  [param('resourceId').isInt({ min: 1 }).withMessage('下载资源ID无效')],
  downloadController.getDownloadLink
);

router.get('/:token', [
  param('token').isLength({ min: 32, max: 32 }).withMessage('下载链接无效')
], downloadController.downloadFile);

module.exports = router;
