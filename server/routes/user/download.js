/**
 * 用户端下载路由。
 * 负责下载接口的鉴权、参数校验与 controller 映射，
 * 具体下载链接生成、资源校验和文件流编排均下沉到 controller / service。
 */

const express = require('express');
const { param } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth-user');
const downloadController = require('../../controllers/user/download-controller');

const router = express.Router();

router.post('/link', authenticateUser, downloadController.getDownloadLink);

router.get('/:token', [
  param('token').isLength({ min: 32, max: 32 }).withMessage('下载链接无效')
], downloadController.downloadFile);

module.exports = router;
