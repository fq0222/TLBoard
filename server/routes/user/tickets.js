/**
 * 用户端工单路由
 * 处理工单的创建、查看、回复和关闭
 */

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth-user');
const ticketService = require('../../services/ticket-service');
const { createLogger } = require('../../utils/logger');

const router = express.Router();
const logger = createLogger('USER-TICKETS');

/**
 * GET /api/user/tickets/unread-count
 * 获取未读工单数量
 */
router.get('/unread-count', authenticateUser, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const userId = req.user.id;

    const count = await ticketService.getUnreadCount(db, userId);

    res.json({
      code: 0,
      message: 'ok',
      data: { count }
    });
  } catch (error) {
    logger.error(`获取未读工单数量错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

/**
 * GET /api/user/tickets
 * 获取工单列表
 */
router.get('/', authenticateUser, [
  query('page').optional().isInt({ min: 1 }).withMessage('页码必须是大于0的整数'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('每页条数必须是1-100之间的整数')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ code: 1001, message: '参数校验失败', data: null });
    }

    const db = req.app.locals.db;
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const result = await ticketService.getUserTickets(db, userId, page, limit);

    res.json({
      code: 0,
      message: 'ok',
      data: { total: result.total, page, limit, list: result.list }
    });
  } catch (error) {
    logger.error(`获取工单列表错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

/**
 * POST /api/user/tickets
 * 创建工单
 */
router.post('/', authenticateUser, [
  body('title').notEmpty().withMessage('工单标题不能为空')
    .isLength({ max: 50 }).withMessage('工单标题不能超过50字'),
  body('description').notEmpty().withMessage('工单描述不能为空')
    .isLength({ max: 500 }).withMessage('工单描述不能超过500字')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ code: 1001, message: '参数校验失败', data: null });
    }

    const db = req.app.locals.db;
    const userId = req.user.id;
    const { title, description } = req.body;

    const ticket = await ticketService.createTicket(db, userId, title, description);

    logger.info(`用户 ${req.user.email} 创建工单成功: ${ticket.id}`);

    res.json({
      code: 0,
      message: 'ok',
      data: ticket
    });
  } catch (error) {
    logger.error(`创建工单错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

/**
 * GET /api/user/tickets/:id
 * 获取工单详情
 */
router.get('/:id', authenticateUser, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ code: 1001, message: '参数校验失败', data: null });
    }

    const db = req.app.locals.db;
    const userId = req.user.id;
    const ticketId = parseInt(req.params.id);

    const ticket = await ticketService.getTicketDetail(db, ticketId);

    if (!ticket) {
      return res.status(400).json({ code: 1001, message: '工单不存在', data: null });
    }

    // 验证工单所有权
    if (ticket.user_id !== userId) {
      return res.status(403).json({ code: 1004, message: '无权限访问', data: null });
    }

    // 更新已读时间
    await ticketService.updateReadTime(db, ticketId, userId);

    res.json({
      code: 0,
      message: 'ok',
      data: ticket
    });
  } catch (error) {
    logger.error(`获取工单详情错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

/**
 * POST /api/user/tickets/:id/replies
 * 回复工单
 */
router.post('/:id/replies', authenticateUser, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数'),
  body('content').notEmpty().withMessage('回复内容不能为空')
    .isLength({ max: 500 }).withMessage('回复内容不能超过500字')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ code: 1001, message: '参数校验失败', data: null });
    }

    const db = req.app.locals.db;
    const userId = req.user.id;
    const ticketId = parseInt(req.params.id);
    const { content } = req.body;

    // 验证工单存在且属于当前用户
    const ticket = await db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    if (!ticket) {
      return res.status(400).json({ code: 1001, message: '工单不存在', data: null });
    }
    if (ticket.user_id !== userId) {
      return res.status(403).json({ code: 1004, message: '无权限访问', data: null });
    }
    if (ticket.status === 'closed') {
      return res.status(400).json({ code: 1001, message: '工单已关闭，无法回复', data: null });
    }

    const reply = await ticketService.addReply(db, ticketId, userId, null, content);

    logger.info(`用户 ${req.user.email} 回复工单 ${ticketId} 成功`);

    res.json({
      code: 0,
      message: 'ok',
      data: reply
    });
  } catch (error) {
    logger.error(`回复工单错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

/**
 * PUT /api/user/tickets/:id/close
 * 关闭工单
 */
router.put('/:id/close', authenticateUser, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ code: 1001, message: '参数校验失败', data: null });
    }

    const db = req.app.locals.db;
    const userId = req.user.id;
    const ticketId = parseInt(req.params.id);

    // 验证工单存在且属于当前用户
    const ticket = await db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    if (!ticket) {
      return res.status(400).json({ code: 1001, message: '工单不存在', data: null });
    }
    if (ticket.user_id !== userId) {
      return res.status(403).json({ code: 1004, message: '无权限访问', data: null });
    }
    if (ticket.status === 'closed') {
      return res.status(400).json({ code: 1001, message: '工单已关闭', data: null });
    }

    await ticketService.closeTicket(db, ticketId);

    logger.info(`用户 ${req.user.email} 关闭工单 ${ticketId} 成功`);

    res.json({
      code: 0,
      message: 'ok',
      data: { message: '工单已关闭' }
    });
  } catch (error) {
    logger.error(`关闭工单错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

module.exports = router;
