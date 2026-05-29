/**
 * 管理端公告路由
 * 负责声明鉴权、参数校验规则，以及 controller 映射关系。
 */

const express = require('express');
const { body, param, query } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const announcementsController = require('../../controllers/admin/announcements-controller');

const router = express.Router();

/**
 * GET /api/admin/announcements
 * 获取公告列表。
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
 * 创建公告。
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
    .withMessage('pinned必须是布尔值'),
  body('enabled')
    .optional()
    .isBoolean()
    .withMessage('enabled必须是布尔值')
], announcementsController.createAnnouncement);

/**
 * PUT /api/admin/announcements/:id
 * 修改公告。
 */
router.put('/:id', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于 0 的整数'),
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
    .withMessage('pinned必须是布尔值'),
  body('enabled')
    .optional()
    .isBoolean()
    .withMessage('enabled必须是布尔值')
], announcementsController.updateAnnouncement);

/**
 * DELETE /api/admin/announcements/:id
 * 删除公告。
 */
router.delete('/:id', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于 0 的整数')
], announcementsController.deleteAnnouncement);

module.exports = router;
