/**
 * 用户端公告路由。
 * 公告列表和首页弹窗接口均仅允许登录用户访问。
 */

const express = require('express');
const { param, query } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth-user');
const announcementsController = require('../../controllers/user/announcements-controller');

const router = express.Router();

/**
 * GET /api/user/announcements
 * 获取公告分页列表。
 */
router.get('/', authenticateUser, [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('页码必须是大于 0 的整数'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('每页条数必须是 1-100 之间的整数')
], announcementsController.getAnnouncements);

/**
 * GET /api/user/announcements/popup/latest
 * 获取当前用户是否需要显示最新公告弹窗。
 */
router.get('/popup/latest', authenticateUser, announcementsController.getLatestPopupAnnouncement);

/**
 * POST /api/user/announcements/:id/popup-close
 * 用户主动关闭弹窗后记录一次关闭次数。
 */
router.post('/:id/popup-close', authenticateUser, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID 必须是大于 0 的整数')
], announcementsController.reportPopupClose);

module.exports = router;
