/**
 * 用户端公告路由
 * 处理公告列表查询。
 */

const express = require('express');
const { query } = require('express-validator');
const announcementsController = require('../../controllers/user/announcements-controller');

const router = express.Router();

/**
 * GET /api/user/announcements
 * 获取公告列表。
 */
router.get('/', [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('页码必须是大于 0 的整数'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('每页条数必须是 1-100 之间的整数')
], announcementsController.getAnnouncements);

module.exports = router;
