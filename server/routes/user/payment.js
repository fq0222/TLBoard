/**
 * 支付回调路由
 * 处理易支付异步回调
 */

const express = require('express');
const crypto = require('crypto');
const config = require('../../config');

const router = express.Router();

// 日志工具
const logger = {
  info: (msg) => console.log(`[PAYMENT] [INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[PAYMENT] [ERROR] ${new Date().toISOString()} - ${msg}`),
  warn: (msg) => console.warn(`[PAYMENT] [WARN] ${new Date().toISOString()} - ${msg}`)
};

/**
 * POST /api/user/payment/notify
 * 易支付异步回调接口
 */
router.post('/notify', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const {
      pid,
      trade_no,
      out_trade_no,
      type,
      name,
      money,
      trade_status,
      sign,
      sign_type
    } = req.body;

    logger.info(`收到支付回调: out_trade_no=${out_trade_no}, status=${trade_status}`);

    // 验证签名
    if (!verifySign(req.body, config.payment.key)) {
      logger.warn(`支付回调签名验证失败: out_trade_no=${out_trade_no}`);
      return res.send('sign_error');
    }

    // 检查交易状态
    if (trade_status !== 'TRADE_SUCCESS') {
      logger.info(`支付回调状态非成功: out_trade_no=${out_trade_no}, status=${trade_status}`);
      return res.send('success');
    }

    const db = req.app.locals.db;

    // 查询订单
    const order = await db.prepare(`
      SELECT o.*, u.id as user_id, u.email
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.out_trade_no = ?
    `).get(out_trade_no);

    if (!order) {
      logger.warn(`支付回调订单不存在: out_trade_no=${out_trade_no}`);
      return res.send('success');
    }

    // 检查订单状态，防止重复回调
    if (order.status === 'paid') {
      logger.info(`支付回调订单已处理: out_trade_no=${out_trade_no}`);
      return res.send('success');
    }

    // 查询套餐信息
    const plan = await db.prepare('SELECT * FROM plans WHERE id = ?').get(order.plan_id);
    
    if (!plan) {
      logger.error(`支付回调套餐不存在: plan_id=${order.plan_id}`);
      return res.send('success');
    }

    // 开始事务
    const transaction = db.transaction(async () => {
      const now = Math.floor(Date.now() / 1000);
      
      // 更新订单状态
      await db.prepare(`
        UPDATE orders SET 
          status = 'paid',
          trade_no = ?,
          paid_at = ?
        WHERE out_trade_no = ?
      `).run(trade_no, now, out_trade_no);

      // 计算到期时间
      const expireAt = now + (plan.duration_days * 24 * 60 * 60);

      // 更新用户信息
      await db.prepare(`
        UPDATE users SET 
          enabled = 1,
          plan_id = ?,
          traffic_limit = ?,
          expire_at = ?,
          updated_at = ?
        WHERE id = ?
      `).run(plan.id, plan.traffic_limit, expireAt, now, order.user_id);

      // 同步到3X-UI服务器（模拟）
      syncToXuiServers(order.user_id, order.email, plan);
    });

    // 执行事务
    transaction();

    logger.info(`支付回调处理成功: out_trade_no=${out_trade_no}`);

    res.send('success');
  } catch (error) {
    logger.error(`支付回调处理错误: ${error.message}`);
    res.send('success');
  }
});

/**
 * 验证签名
 * @param {Object} params - 请求参数
 * @param {string} key - 密钥
 * @returns {boolean} 签名是否有效
 */
function verifySign(params, key) {
  try {
    // 过滤签名参数
    const filteredParams = {};
    for (const [k, v] of Object.entries(params)) {
      if (k !== 'sign' && k !== 'sign_type' && v !== '') {
        filteredParams[k] = v;
      }
    }

    // 按参数名排序
    const sortedKeys = Object.keys(filteredParams).sort();
    const signStr = sortedKeys.map(k => `${k}=${filteredParams[k]}`).join('&');
    
    // 计算签名
    const calculatedSign = crypto.createHash('md5').update(signStr + key).digest('hex');
    
    return calculatedSign === params.sign;
  } catch (error) {
    logger.error(`签名验证错误: ${error.message}`);
    return false;
  }
}

/**
 * 同步到3X-UI服务器
 * @param {number} userId - 用户ID
 * @param {string} email - 用户邮箱
 * @param {Object} plan - 套餐信息
 */
function syncToXuiServers(userId, email, plan) {
  // 模拟同步操作
  logger.info(`同步用户到3X-UI服务器: ${email}`);
}

module.exports = router;