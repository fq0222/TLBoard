/**
 * 管理端留言板路由
 * 负责声明留言列表、统计、精选展示和删除接口。
 */

const express = require('express');
const { body, param, query } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const feedbackController = require('../../controllers/admin/feedback-controller');

const router = express.Router();

/**
 * GET /api/admin/feedback/stats
 * 获取留言板统计。
 */
router.get('/stats', authenticateAdmin, feedbackController.getStats);

/**
 * GET /api/admin/feedback
 * 分页获取所有留言。
 */
router.get('/', authenticateAdmin, [
  query('page').optional().isInt({ min: 1 }).withMessage('页码必须是大于0的整数'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('每页条数必须是1-100之间的整数')
], feedbackController.listMessages);

/**
 * PUT /api/admin/feedback/:id/featured
 * 设置留言是否精选展示。
 */
router.put('/:id/featured', authenticateAdmin, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数'),
  body('featured').isBoolean().withMessage('featured必须是布尔值')
], feedbackController.updateFeatured);

/**
 * DELETE /api/admin/feedback/:id
 * 删除留言并清理投票。
 */
router.delete('/:id', authenticateAdmin, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数')
], feedbackController.deleteMessage);

module.exports = router;
