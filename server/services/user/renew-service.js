const crypto = require('crypto');
const vmqService = require('../../integrations/vmq/vmq-service');
const orderRepository = require('../../repositories/order-repository');
const { evaluateRenewEligibility, DISABLE_REASONS } = require('../shared/renew-policy');

/**
 * 用户端续费服务。
 * 负责续费资格校验、续费订单创建、VMQ 下单与旧响应结构兼容数据编排，
 * 保留支付成功后的权益激活逻辑在共享 order-service 中处理。
 */

/**
 * 构造兼容旧接口错误结构的业务异常。
 *
 * @param {string} message - 错误消息
 * @param {Object} [options] - 扩展错误配置
 * @returns {Error} 兼容旧接口的业务异常
 */
function createLegacyBusinessError(message, options = {}) {
  const error = new Error(message);
  error.isLegacyBusinessError = true;
  error.statusCode = options.statusCode || 400;
  error.code = options.code || 1001;
  error.data = options.data === undefined ? null : options.data;
  return error;
}

/**
 * 获取当前秒级时间戳，保持与现有订单时间字段语义一致。
 *
 * @returns {number} 秒级 Unix 时间戳
 */
function getNowTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * 创建续费订单并向 VMQ 发起下单。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 当前用户 ID
 * @param {{plan_id:number|string,pay_type?:number|string}} payload - 续费参数
 * @returns {Promise<Object>} 兼容旧接口的续费下单结果
 */
async function createRenewOrder(db, userId, payload) {
  const { plan_id: planId } = payload;
  const payType = Number(payload.pay_type || 2);
  const user = await orderRepository.findUserById(db, userId);

  if (!user) {
    throw createLegacyBusinessError('用户不存在', { code: 2004 });
  }

  if (!user.plan_id) {
    throw createLegacyBusinessError('请先购买套餐后再续费', { code: 2004 });
  }

  const plan = await orderRepository.findEnabledPlanById(db, planId);
  if (!plan) {
    throw createLegacyBusinessError('套餐不存在或未启用');
  }

  const renewEligibility = evaluateRenewEligibility(user, plan);
  if (!renewEligibility.allowed) {
    throw createLegacyBusinessError(renewEligibility.message, {
      code: renewEligibility.code
    });
  }

  if (renewEligibility.skipSalesLimit && user.disable_reason === DISABLE_REASONS.TRAFFIC_LIMIT) {
    // 保持旧语义：仅作为业务判断结果，不额外改写数据流。
  }

  const outTradeNo = `REN${Date.now()}${crypto.randomBytes(3).toString('hex')}`;
  let orderId;
  const createdAt = getNowTimestamp();
  const transaction = db.transaction(async (transactionDb) => {
    const orderResult = await orderRepository.createPendingRenewOrder(transactionDb, {
      userId,
      email: user.email,
      planId,
      amount: plan.price,
      outTradeNo,
      createdAt
    });

    orderId = Number(orderResult.lastInsertRowid);
  });

  await transaction();

  const amount = (Number(plan.price) / 100).toFixed(2);
  const vmqResult = await vmqService.createOrder({
    payId: outTradeNo,
    param: String(userId),
    type: payType,
    price: amount,
    isHtml: 0
  });

  if (Number(vmqResult.code) !== 1 || !vmqResult.data) {
    await orderRepository.markOrderExpiredByOutTradeNo(db, outTradeNo);
    throw createLegacyBusinessError(vmqResult.msg || 'VMQ创建订单失败', {
      code: 5002
    });
  }

  if (Number(vmqResult.data.isAuto) === 1) {
    await orderRepository.markOrderExpiredByOutTradeNo(db, outTradeNo);

    try {
      await vmqService.closeOrder(vmqResult.data.orderId);
    } catch (error) {
      // 保持旧逻辑：关闭失败不覆盖当前业务错误。
    }

    throw createLegacyBusinessError(
      '当前支付通道需要用户手动输入金额，存在少付风险，请更换VMQ监控通道配置后再试',
      { code: 5003 }
    );
  }

  const realAmount = Math.round(Number(vmqResult.data.reallyPrice) * 100);
  await orderRepository.updateOrderPaymentInfo(db, {
    outTradeNo,
    tradeNo: vmqResult.data.orderId,
    paymentUrl: vmqResult.data.payUrl,
    amount: realAmount
  });

  return {
    order_id: orderId,
    out_trade_no: outTradeNo,
    vmq_order_id: vmqResult.data.orderId,
    pay_type: vmqResult.data.payType,
    really_price: String(vmqResult.data.reallyPrice),
    payment_url: vmqResult.data.payUrl,
    expire_in: Number(vmqResult.data.timeOut || 5) * 60
  };
}

module.exports = {
  createRenewOrder
};
