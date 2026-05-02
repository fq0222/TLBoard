/**
 * 管理端订单管理路由
 * 处理订单列表查询
 */

const express = require('express');
const { query, validationResult } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');

const router = express.Router();

// 日志工具
const logger = {
  info: (msg) => console.log(`[ADMIN-ORDERS] [INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[ADMIN-ORDERS] [ERROR] ${new Date().toISOString()} - ${msg}`),
  warn: (msg) => console.warn(`[ADMIN-ORDERS] [WARN] ${new Date().toISOString()} - ${msg}`)
};

/**
 * GET /api/admin/orders
 * 获取订单列表
 */
router.get('/', authenticateAdmin, [
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
    .withMessage('状态必须是pending、paid或expired'),
  query('email')
    .optional()
    .isString()
    .withMessage('邮箱必须是字符串'),
  query('start_date')
    .optional()
    .isString()
    .withMessage('开始日期必须是字符串'),
  query('end_date')
    .optional()
    .isString()
    .withMessage('结束日期必须是字符串')
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

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status;
    const email = req.query.email;
    const startDate = req.query.start_date;
    const endDate = req.query.end_date;
    const offset = (page - 1) * limit;
    const db = req.app.locals.db;

    // 构建查询条件
    let whereClause = 'WHERE 1=1';
    const params = [];
    
    if (status) {
      whereClause += ' AND o.status = ?';
      params.push(status);
    }
    
    if (email) {
      whereClause += ' AND o.email LIKE ?';
      params.push(`%${email}%`);
    }
    
    if (startDate) {
      whereClause += ' AND o.created_at >= ?';
      const startTimestamp = Math.floor(new Date(startDate).getTime() / 1000);
      params.push(startTimestamp);
    }
    
    if (endDate) {
      whereClause += ' AND o.created_at <= ?';
      const endTimestamp = Math.floor(new Date(endDate).getTime() / 1000) + 86400; // 加上一天
      params.push(endTimestamp);
    }

    // 查询总数
    const countQuery = `SELECT COUNT(*) as total FROM orders o ${whereClause}`;
    const total = (await db.prepare(countQuery).get(...params)).total;

    // 查询订单列表
    const query = `
      SELECT 
        o.id, o.out_trade_no, o.email, o.user_id,
        o.amount, o.status, o.paid_at, o.created_at,
        p.name as plan_name
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
      email: order.email,
      user_id: order.user_id,
      plan_name: order.plan_name,
      amount: order.amount,
      amount_text: (order.amount / 100).toFixed(2),
      status: order.status,
      status_text: getStatusText(order.status),
      paid_at: order.paid_at,
      created_at: order.created_at
    }));

    logger.info(`获取订单列表成功，共 ${formattedOrders.length} 条记录`);

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