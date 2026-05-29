/**
 * 用户端工单路由
 * 负责声明用户端工单接口的鉴权中间件、参数校验规则与控制器映射。
 */

const express = require('express');
const { body, param, query } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth-user');
const ticketsController = require('../../controllers/user/tickets-controller');

const router = express.Router();

/**
 * GET /api/user/tickets/unread-count
 * 获取未读工单数量
 */
router.get('/unread-count', authenticateUser, ticketsController.getUnreadCount);

/**
 * GET /api/user/tickets
 * 获取工单列表
 */
router.get('/', authenticateUser, [
  query('page').optional().isInt({ min: 1 }).withMessage('页码必须是大于 0 的整数'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('每页条数必须是 1-100 之间的整数')
], ticketsController.listTickets);

/**
 * POST /api/user/tickets
 * 创建工单
 */
router.post('/', authenticateUser, [
  body('title').notEmpty().withMessage('工单标题不能为空')
    .isLength({ max: 50 }).withMessage('工单标题不能超过50字'),
  body('description').notEmpty().withMessage('工单描述不能为空')
    .isLength({ max: 500 }).withMessage('工单描述不能超过500字')
], ticketsController.createTicket);

/**
 * GET /api/user/tickets/:id
 * 获取工单详情
 */
router.get('/:id', authenticateUser, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于 0 的整数')
], ticketsController.getTicketDetail);

/**
 * POST /api/user/tickets/:id/replies
 * 回复工单
 */
router.post('/:id/replies', authenticateUser, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于 0 的整数'),
  body('content').notEmpty().withMessage('回复内容不能为空')
    .isLength({ max: 500 }).withMessage('回复内容不能超过500字')
], ticketsController.addReply);

/**
 * PUT /api/user/tickets/:id/close
 * 关闭工单
 */
router.put('/:id/close', authenticateUser, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于 0 的整数')
], ticketsController.closeTicket);

module.exports = router;
