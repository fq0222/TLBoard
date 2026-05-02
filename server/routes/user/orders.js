/**
 * 用户端订单路由
 * 处理订单查询和状态轮询
 */

const express = require('express');
const { query, param, validationResult } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth-user');

const router = express.Router();

// 日志工具
const logger = {
  info: (msg) => console.log(`[USER-ORDERS] [INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[USER-ORDERS] [ERROR] ${new Date().toISOString()} - ${msg}`),
  warn: (msg) => console.warn(`[USER-ORDERS] [WARN] ${new Date().toISOString()} - ${msg}`)
};

/**
 * GET /api/user/orders
 * 获取当前用户的订单列表
 */
router.get('/', authenticateUser, [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('页码必须是大于0的整数'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('每页条数必须是1-100之间的整数'),
  query('status')
    .optional()
    .isIn(['pending', 'paid', 'expired'])
    .withMessage('状态必须是pending、paid或expired')
], async (req, res) => {
  try {
    // 验证请求参数
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('获取订单列表参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status;
    const offset = (page - 1) * limit;
    const db = req.app.locals.db;

    // 构建查询条件
    let whereClause = 'WHERE o.user_id = ?';
    const params = [userId];
    
    if (status) {
      whereClause += ' AND o.status = ?';
      params.push(status);
    }

    // 查询总数
    const countQuery = `SELECT COUNT(*) as total FROM orders o ${whereClause}`;
    const total = (await db.prepare(countQuery).get(...params)).total;

    // 查询订单列表
    const query = `
      SELECT 
        o.id, o.out_trade_no, p.name as plan_name, 
        o.amount, o.status, o.paid_at, o.created_at
      FROM orders o
      LEFT JOIN plans p ON o.plan_id = p.id
      ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?
    `;
    
    const orders = await db.prepare(query).all(...params, limit, offset);

    // 格式化订单数据
    const formattedOrders = orders.map(order => ({
      id: order.id,
      out_trade_no: order.out_trade_no,
      plan_name: order.plan_name,
      amount: order.amount,
      amount_text: (order.amount / 100).toFixed(2),
      status: order.status,
      status_text: getStatusText(order.status),
      paid_at: order.paid_at,
      created_at: order.created_at
    }));

    logger.info(`获取订单列表成功，用户: ${req.user.email}，共 ${formattedOrders.length} 条记录`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        total,
        page,
        limit,
        list: formattedOrders
      }
    });
  } catch (error) {
    logger.error(`获取订单列表错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * GET /api/user/orders/:id/status
 * 轮询订单支付状态
 */
router.get('/:id/status', authenticateUser, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数')
], async (req, res) => {
  try {
    // 验证请求参数
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('轮询订单状态参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const orderId = parseInt(req.params.id);
    const userId = req.user.id;
    const db = req.app.locals.db;

    // 查询订单
    const order = await db.prepare(`
      SELECT id, status, payment_url 
      FROM orders 
      WHERE id = ? AND user_id = ?
    `).get(orderId, userId);
    
    if (!order) {
      logger.warn(`轮询订单状态失败: 订单不存在 - ${orderId}`);
      return res.status(400).json({
        code: 2004,
        message: '订单不存在',
        data: null
      });
    }

    logger.info(`轮询订单状态成功: ${orderId} - ${order.status}`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        order_id: order.id,
        status: order.status,
        payment_url: order.payment_url
      }
    });
  } catch (error) {
    logger.error(`轮询订单状态错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * 获取状态文本
 * @param {string} status - 状态值
 * @returns {string} 状态文本
 */
function getStatusText(status) {
  const statusMap = {
    'pending': '待支付',
    'paid': '已支付',
    'expired': '已过期'
  };
  return statusMap[status] || status;
}

module.exports = router;