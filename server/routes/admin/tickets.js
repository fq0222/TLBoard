/**
 * 管理端工单路由
 * 处理工单查看、回复和关闭
 */

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const ticketService = require('../../services/ticket-service');
const { createLogger } = require('../../utils/logger');

const router = express.Router();
const logger = createLogger('ADMIN-TICKETS');

/**
 * GET /api/admin/tickets/stats
 * 获取工单统计
 */
router.get('/stats', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const stats = await ticketService.getTicketStats(db);

    res.json({
      code: 0,
      message: 'ok',
      data: stats
    });
  } catch (error) {
    logger.error(`获取工单统计错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

/**
 * GET /api/admin/tickets
 * 获取工单列表（支持搜索和筛选）
 */
router.get('/', authenticateAdmin, [
  query('page').optional().isInt({ min: 1 }).withMessage('页码必须是大于0的整数'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('每页条数必须是1-100之间的整数'),
  query('status').optional().isIn(['open', 'pending', 'closed']).withMessage('状态值无效'),
  query('keyword').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ code: 1001, message: '参数校验失败', data: null });
    }

    const db = req.app.locals.db;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status || null;
    const keyword = req.query.keyword || null;

    const result = await ticketService.getAdminTickets(db, { page, limit, status, keyword });

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
 * GET /api/admin/tickets/:id
 * 获取工单详情
 */
router.get('/:id', authenticateAdmin, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ code: 1001, message: '参数校验失败', data: null });
    }

    const db = req.app.locals.db;
    const ticketId = parseInt(req.params.id);

    const ticket = await ticketService.getTicketDetail(db, ticketId);

    if (!ticket) {
      return res.status(400).json({ code: 1001, message: '工单不存在', data: null });
    }

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
 * POST /api/admin/tickets/:id/replies
 * 回复工单
 */
router.post('/:id/replies', authenticateAdmin, [
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
    const adminId = req.admin.id;
    const ticketId = parseInt(req.params.id);
    const { content } = req.body;

    // 验证工单存在
    const ticket = await db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    if (!ticket) {
      return res.status(400).json({ code: 1001, message: '工单不存在', data: null });
    }
    if (ticket.status === 'closed') {
      return res.status(400).json({ code: 1001, message: '工单已关闭，无法回复', data: null });
    }

    const reply = await ticketService.addReply(db, ticketId, null, adminId, content);

    logger.info(`管理员 ${req.admin.username} 回复工单 ${ticketId} 成功`);

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
 * PUT /api/admin/tickets/:id/close
 * 关闭工单
 */
router.put('/:id/close', authenticateAdmin, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ code: 1001, message: '参数校验失败', data: null });
    }

    const db = req.app.locals.db;
    const ticketId = parseInt(req.params.id);

    // 验证工单存在
    const ticket = await db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    if (!ticket) {
      return res.status(400).json({ code: 1001, message: '工单不存在', data: null });
    }
    if (ticket.status === 'closed') {
      return res.status(400).json({ code: 1001, message: '工单已关闭', data: null });
    }

    await ticketService.closeTicket(db, ticketId);

    logger.info(`管理员 ${req.admin.username} 关闭工单 ${ticketId} 成功`);

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
