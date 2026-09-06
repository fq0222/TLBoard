/**
 * 管理端工单路由
 * 负责声明管理端工单接口的鉴权中间件、参数校验规则与控制器映射。
 */

const express = require('express');
const { body, param, query } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const ticketsController = require('../../controllers/admin/tickets-controller');

const router = express.Router();

/**
 * GET /api/admin/tickets/stats
 * 获取工单统计
 */
router.get('/stats', authenticateAdmin, ticketsController.getStats);

/**
 * GET /api/admin/tickets/action-required-count
 * 获取需要管理员处理的工单数量
 */
router.get('/action-required-count', authenticateAdmin, ticketsController.getActionRequiredCount);

/**
 * GET /api/admin/tickets
 * 获取工单列表（支持搜索和筛选）
 */
router.get('/', authenticateAdmin, [
  query('page').optional().isInt({ min: 1 }).withMessage('页码必须是大于 0 的整数'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('每页条数必须是 1-100 之间的整数'),
  query('status').optional().isIn(['open', 'pending', 'closed']).withMessage('状态值无效'),
  query('keyword').optional().isString()
], ticketsController.listTickets);

/**
 * GET /api/admin/tickets/:id
 * 获取工单详情
 */
router.get('/:id', authenticateAdmin, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于 0 的整数')
], ticketsController.getTicketDetail);

/**
 * POST /api/admin/tickets/:id/replies
 * 回复工单
 */
router.post('/:id/replies', authenticateAdmin, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于 0 的整数'),
  body('content').notEmpty().withMessage('回复内容不能为空')
    .isLength({ max: 500 }).withMessage('回复内容不能超过500字')
], ticketsController.addReply);

/**
 * PUT /api/admin/tickets/:id/close
 * 关闭工单
 */
router.put('/:id/close', authenticateAdmin, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于 0 的整数')
], ticketsController.closeTicket);

/**
 * DELETE /api/admin/tickets/:id
 * 删除工单
 */
router.delete('/:id', authenticateAdmin, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于 0 的整数')
], ticketsController.deleteTicket);

module.exports = router;
