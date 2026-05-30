const vmqService = require('../../integrations/vmq/vmq-service');
const orderService = require('../shared/order-service');
const orderRepository = require('../../repositories/order-repository');

/**
 * 用户端支付服务。
 * 负责 VMQ 回调参数校验、验签、金额检查、订单完成编排与同步回跳地址生成，
 * 保持现有 `/api/user/payment/*` 接口语义与返回格式不变。
 */

/**
 * 统一解析 VMQ 回调参数，兼容 GET 查询参数与表单 POST。
 *
 * @param {Object} req - Express 请求对象
 * @returns {Object} 合并后的回调参数
 */
function getNotifyParams(req) {
  return {
    ...req.query,
    ...req.body
  };
}

/**
 * 处理 VMQ 支付回调。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} params - VMQ 回调参数
 * @returns {Promise<{responseText:string,logLevel:string,logMessage:string}>} 处理结果
 */
async function handleNotify(db, params) {
  const payId = params.payId;
  const vmqOrderId = params.orderId || null;

  if (!payId || !params.sign) {
    return {
      responseText: 'error_sign',
      logLevel: 'warn',
      logMessage: 'VMQ notify missing payId or sign'
    };
  }

  if (!vmqService.verifyNotifySign(params)) {
    return {
      responseText: 'error_sign',
      logLevel: 'warn',
      logMessage: `VMQ notify sign invalid: payId=${payId}`
    };
  }

  const order = await orderRepository.findNotifyOrderByOutTradeNo(db, payId);
  if (!order) {
    return {
      responseText: 'success',
      logLevel: 'warn',
      logMessage: `VMQ notify order not found: payId=${payId}`
    };
  }

  const expectedAmount = (Number(order.amount) / 100).toFixed(2);
  const orderAmount = Number(Number(params.price).toFixed(2));
  const reallyPaidAmount = Number(Number(params.reallyPrice).toFixed(2));

  if (reallyPaidAmount < orderAmount) {
    return {
      responseText: 'error_amount',
      logLevel: 'warn',
      logMessage: `VMQ notify amount mismatch: payId=${payId}, expected=${expectedAmount}, orderAmount=${orderAmount}, reallyPaid=${reallyPaidAmount}`
    };
  }

  await orderService.completePaidOrder(db, payId, vmqOrderId || order.trade_no);
  return {
    responseText: 'success',
    logLevel: 'info',
    logMessage: `VMQ notify handled: payId=${payId}`
  };
}

/**
 * 生成支付完成后的同步跳转地址。
 *
 * @param {Object} query - 请求查询参数
 * @returns {string} 前端支付结果页地址
 */
function buildReturnRedirectUrl(query) {
  const orderId = query.payId || query.order_id || '';
  const queryString = orderId ? `?order_id=${encodeURIComponent(orderId)}` : '';
  return `/payment/callback${queryString}`;
}

module.exports = {
  getNotifyParams,
  handleNotify,
  buildReturnRedirectUrl
};
