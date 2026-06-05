/**
 * 管理端公告路由。
 * 负责声明管理员鉴权、请求参数校验规则，以及 controller 映射关系。
 */

const express = require('express');
const { body, param, query } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const announcementsController = require('../../controllers/admin/announcements-controller');

const router = express.Router();

/**
 * GET /api/admin/announcements
 * 获取公告分页列表。
 */
router.get('/', authenticateAdmin, [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('页码必须是大于 0 的整数'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('每页条数必须是 1-100 之间的整数')
], announcementsController.listAnnouncements);

/**
 * POST /api/admin/announcements
 * 创建公告。popup_show_limit 为 0 表示不弹窗，正整数表示每个用户最多弹出次数。
 */
router.post('/', authenticateAdmin, [
  body('title')
    .notEmpty()
    .withMessage('公告标题不能为空'),
  body('content')
    .optional()
    .isString()
    .withMessage('公告内容必须是字符串'),
  body('pinned')
    .optional()
    .isBoolean()
    .withMessage('pinned 必须是布尔值'),
  body('enabled')
    .optional()
    .isBoolean()
    .withMessage('enabled 必须是布尔值'),
  body('popup_show_limit')
    .optional()
    .isInt({ min: 0 })
    .withMessage('popup_show_limit 必须是大于等于 0 的整数')
], announcementsController.createAnnouncement);

/**
 * PUT /api/admin/announcements/:id
 * 修改公告。只更新请求中显式传入的字段。
 */
router.put('/:id', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID 必须是大于 0 的整数'),
  body('title')
    .optional()
    .notEmpty()
    .withMessage('公告标题不能为空'),
  body('content')
    .optional()
    .isString()
    .withMessage('公告内容必须是字符串'),
  body('pinned')
    .optional()
    .isBoolean()
    .withMessage('pinned 必须是布尔值'),
  body('enabled')
    .optional()
    .isBoolean()
    .withMessage('enabled 必须是布尔值'),
  body('popup_show_limit')
    .optional()
    .isInt({ min: 0 })
    .withMessage('popup_show_limit 必须是大于等于 0 的整数')
], announcementsController.updateAnnouncement);

/**
 * DELETE /api/admin/announcements/:id
 * 删除公告。
 */
router.delete('/:id', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID 必须是大于 0 的整数')
], announcementsController.deleteAnnouncement);

module.exports = router;
