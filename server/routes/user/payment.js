/**
 * 支付回调路由
 * 处理 VMQ 的异步通知和同步跳转
 */

const express = require('express');
const vmqService = require('../../services/vmq-service');
const { completePaidOrder } = require('../../services/order-service');
const { createLogger } = require('../../utils/logger');

const router = express.Router();
const logger = createLogger('PAYMENT');

/**
 * 处理 VMQ 支付通知
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 */
async function handleVmqNotify(req, res) {
  try {
    // VMQ 可能通过 GET 或表单 POST 回调，这里统一合并参数读取
    const params = { ...req.query, ...req.body };
    const payId = params.payId;
    const vmqOrderId = params.orderId || null;

    logger.info(`VMQ notify received: payId=${payId}, type=${params.type}, price=${params.price}, reallyPrice=${params.reallyPrice}`);

    if (!payId || !params.sign) {
      logger.warn('VMQ notify missing payId or sign');
      return res.send('error_sign');
    }

    if (!vmqService.verifyNotifySign(params)) {
      logger.warn(`VMQ notify sign invalid: payId=${payId}`);
      return res.send('error_sign');
    }

    const db = req.app.locals.db;
    const order = await db.prepare('SELECT amount, trade_no, status FROM orders WHERE out_trade_no = ?').get(payId);
    if (!order) {
      logger.warn(`VMQ notify order not found: payId=${payId}`);
      return res.send('success');
    }

    // 同时校验订单金额和实际支付金额，防止用户手动少付后被错误放行
    const expectedAmount = (Number(order.amount) / 100).toFixed(2);
    const orderAmount = Number(params.price).toFixed(2);
    const reallyPaidAmount = Number(params.reallyPrice).toFixed(2);
    if (expectedAmount !== orderAmount || expectedAmount !== reallyPaidAmount) {
      logger.warn(`VMQ notify amount mismatch: payId=${payId}, expected=${expectedAmount}, orderAmount=${orderAmount}, reallyPaid=${reallyPaidAmount}`);
      return res.send('error_amount');
    }

    await completePaidOrder(db, payId, vmqOrderId || order.trade_no);
    logger.info(`VMQ notify handled: payId=${payId}`);
    return res.send('success');
  } catch (error) {
    logger.error(`VMQ notify error: ${error.message}`);
    return res.send('success');
  }
}

router.get('/notify', handleVmqNotify);
router.post('/notify', express.urlencoded({ extended: true }), handleVmqNotify);

/**
 * 支付完成后的同步跳转
 * 将 VMQ 回传的订单号转发给前端支付结果页
 */
router.get('/return', async (req, res) => {
  const orderId = req.query.payId || req.query.order_id || '';
  const query = orderId ? `?order_id=${encodeURIComponent(orderId)}` : '';
  res.redirect(`/payment/callback${query}`);
});

module.exports = router;
