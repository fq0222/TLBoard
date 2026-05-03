/**
 * 用户端订单路由
 * 处理订单查询和支付状态轮询
 */

const express = require('express');
const { query, param, validationResult } = require('express-validator');
const { authenticateUser, optionalAuth } = require('../../middleware/auth-user');
const vmqService = require('../../services/vmq-service');
const { completePaidOrder } = require('../../services/order-service');

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
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const status = req.query.status;
    const offset = (page - 1) * limit;
    const db = req.app.locals.db;

    let whereClause = 'WHERE o.user_id = ?';
    const params = [userId];

    if (status) {
      whereClause += ' AND o.status = ?';
      params.push(status);
    }

    const countQuery = `SELECT COUNT(*) as total FROM orders o ${whereClause}`;
    const total = (await db.prepare(countQuery).get(...params)).total;

    const listQuery = `
      SELECT
        o.id, o.out_trade_no, p.name as plan_name,
        o.amount, o.status, o.paid_at, o.created_at
      FROM orders o
      LEFT JOIN plans p ON o.plan_id = p.id
      ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const orders = await db.prepare(listQuery).all(...params, limit, offset);
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
 * GET /api/user/orders/status/:id
 * 公共轮询订单支付状态
 * 未登录时仅允许通过商户订单号查询
 */
router.get('/status/:id', optionalAuth, [
  param('id')
    .notEmpty()
    .withMessage('订单ID不能为空')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('公共轮询订单状态参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const orderIdentifier = req.params.id;
    const db = req.app.locals.db;
    const isNumericId = /^\d+$/.test(orderIdentifier);

    if (isNumericId && !req.user) {
      logger.warn(`未登录用户尝试按数字订单ID查询状态: ${orderIdentifier}`);
      return res.status(401).json({
        code: 1002,
        message: '未登录 / Token 无效',
        data: null
      });
    }

    const order = isNumericId
      ? await db.prepare(`
        SELECT id, user_id, out_trade_no, trade_no, status, payment_url
        FROM orders
        WHERE id = ? AND user_id = ?
      `).get(Number(orderIdentifier), req.user.id)
      : await db.prepare(`
        SELECT id, user_id, out_trade_no, trade_no, status, payment_url
        FROM orders
        WHERE out_trade_no = ?
      `).get(orderIdentifier);

    if (!order) {
      logger.warn(`订单状态查询失败: 订单不存在 - ${orderIdentifier}`);
      return res.status(400).json({
        code: 2004,
        message: '订单不存在',
        data: null
      });
    }

    const status = await syncOrderStatusIfNeeded(db, order);

    logger.info(`订单状态查询成功: ${orderIdentifier} - ${status}`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        order_id: order.id,
        out_trade_no: order.out_trade_no,
        vmq_order_id: order.trade_no,
        status,
        payment_url: order.payment_url
      }
    });
  } catch (error) {
    logger.error(`订单状态查询错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * GET /api/user/orders/:id/status
 * 登录用户轮询订单支付状态
 */
router.get('/:id/status', authenticateUser, [
  param('id')
    .notEmpty()
    .withMessage('订单ID不能为空')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('轮询订单状态参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const orderIdentifier = req.params.id;
    const db = req.app.locals.db;
    const isNumericId = /^\d+$/.test(orderIdentifier);
    const order = isNumericId
      ? await db.prepare(`
        SELECT id, user_id, out_trade_no, trade_no, status, payment_url
        FROM orders
        WHERE id = ? AND user_id = ?
      `).get(Number(orderIdentifier), req.user.id)
      : await db.prepare(`
        SELECT id, user_id, out_trade_no, trade_no, status, payment_url
        FROM orders
        WHERE out_trade_no = ? AND user_id = ?
      `).get(orderIdentifier, req.user.id);

    if (!order) {
      logger.warn(`轮询订单状态失败: 订单不存在 - ${orderIdentifier}`);
      return res.status(400).json({
        code: 2004,
        message: '订单不存在',
        data: null
      });
    }

    const status = await syncOrderStatusIfNeeded(db, order);

    logger.info(`轮询订单状态成功: ${orderIdentifier} - ${status}`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        order_id: order.id,
        out_trade_no: order.out_trade_no,
        vmq_order_id: order.trade_no,
        status,
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
 * 同步 VMQ 订单状态到本地订单
 * @param {Object} db - 数据库实例
 * @param {Object} order - 订单信息
 * @returns {Promise<string>} 最新订单状态
 */
async function syncOrderStatusIfNeeded(db, order) {
  if (order.status !== 'pending' || !order.trade_no) {
    return order.status;
  }

  try {
    const vmqResult = await vmqService.checkOrder(order.trade_no);
    if (Number(vmqResult.code) === 1) {
      await completePaidOrder(db, order.out_trade_no, order.trade_no);
      return 'paid';
    }

    const vmqOrder = await vmqService.getOrder(order.trade_no);
    if (Number(vmqOrder.code) === 1 && vmqOrder.data && Number(vmqOrder.data.state) === -1) {
      await db.prepare(`
        UPDATE orders SET status = 'expired'
        WHERE id = ? AND status = 'pending'
      `).run(order.id);
      return 'expired';
    }
  } catch (error) {
    logger.warn(`VMQ订单状态查询失败: ${order.trade_no} - ${error.message}`);
  }

  return order.status;
}

/**
 * 获取状态文本
 * @param {string} status - 状态值
 * @returns {string} 状态文本
 */
function getStatusText(status) {
  const statusMap = {
    pending: '待支付',
    paid: '已支付',
    expired: '已过期'
  };
  return statusMap[status] || status;
}

module.exports = router;
