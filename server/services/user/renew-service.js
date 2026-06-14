const crypto = require('crypto');
const vmqService = require('../../integrations/vmq/vmq-service');
const orderRepository = require('../../repositories/order-repository');
const planRepository = require('../../repositories/plan-repository');
const orderService = require('../shared/order-service');
const { evaluateRenewEligibility, DISABLE_REASONS } = require('../shared/renew-policy');
const {
  PLAN_TYPES,
  normalizePlanType,
  isTimedPlan,
  buildTimedRenewResetPreview
} = require('../shared/plan-type');
const { formatTraffic } = require('../../shared/utils/format-traffic');

const BALANCE_PAY_TYPE = 9;

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
 * 判断是否使用余额支付。
 *
 * @param {number} payType - 前端提交的支付类型
 * @returns {boolean} 是否为余额支付
 */
function isBalancePayType(payType) {
  return Number(payType) === BALANCE_PAY_TYPE;
}

/**
 * 归一化续费重置确认值。
 *
 * @param {boolean|string|number|undefined} value - HTTP JSON 或表单提交的 confirm_reset 原始值
 * @returns {boolean} 仅布尔 true、字符串 true 和数字 1 视为已确认，其他分支均保持未确认语义
 */
function normalizeResetConfirmation(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

/**
 * 格式化续费套餐列表项。
 *
 * @param {Object} plan - plans 表套餐记录，包含价格、流量、类型和销售限制字段
 * @returns {Object} 面向用户端续费列表的展示结构，售罄分支按 sales_limit=-1 视为不限量
 */
function formatRenewPlan(plan) {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    price: plan.price,
    price_text: (Number(plan.price) / 100).toFixed(2),
    duration_days: plan.duration_days,
    traffic_limit: plan.traffic_limit,
    traffic_text: formatTraffic(plan.traffic_limit),
    plan_type: normalizePlanType(plan.plan_type),
    show_on_home: plan.show_on_home === undefined ? 1 : Number(plan.show_on_home),
    sort_order: plan.sort_order,
    sales_limit: plan.sales_limit,
    sales_count: plan.sales_count,
    is_soldout: plan.sales_limit !== -1 && Number(plan.sales_count) >= Number(plan.sales_limit)
  };
}

/**
 * 查询当前用户可续费套餐列表。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 当前用户 ID，用于定位当前套餐类型
 * @returns {Promise<Array<Object>>} 与当前套餐类型一致的已上架套餐列表
 */
async function listRenewPlans(db, userId) {
  const user = await orderRepository.findUserById(db, userId);
  if (!user || !user.plan_id) {
    throw createLegacyBusinessError('请先购买套餐后再续费', { code: 2004 });
  }

  const currentPlan = await orderRepository.findPlanById(db, user.plan_id);
  if (!currentPlan) {
    throw createLegacyBusinessError('当前套餐不存在，请联系管理员', { code: 2004 });
  }

  const currentPlanType = normalizePlanType(currentPlan.plan_type);
  const plans = await planRepository.findEnabledPlansByType(db, currentPlanType);

  return plans.map(formatRenewPlan);
}

/**
 * 创建续费订单并向 VMQ 发起下单。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 当前用户 ID
 * @param {{plan_id:number|string,pay_type?:number|string,confirm_reset?:boolean|string|number}} payload - 续费参数
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

  const currentPlan = await orderRepository.findPlanById(db, user.plan_id);
  if (!currentPlan) {
    throw createLegacyBusinessError('当前套餐不存在，请联系管理员', { code: 2004 });
  }

  const currentPlanType = normalizePlanType(currentPlan.plan_type);
  const targetPlanType = normalizePlanType(plan.plan_type);
  if (currentPlanType !== targetPlanType) {
    throw createLegacyBusinessError('不能跨套餐类型续费，请选择当前套餐类型下的套餐', {
      code: 1003
    });
  }

  const renewEligibility = evaluateRenewEligibility(user, plan);
  if (!renewEligibility.allowed) {
    throw createLegacyBusinessError(renewEligibility.message, {
      code: renewEligibility.code
    });
  }

  if (isTimedPlan(plan)) {
    const preview = buildTimedRenewResetPreview(user, plan);
    if (preview.requires_confirm && !normalizeResetConfirmation(payload.confirm_reset)) {
      throw createLegacyBusinessError('续费会重置当前剩余流量和时间，请确认后再续费', {
        statusCode: 409,
        code: 4091,
        data: {
          plan_type: PLAN_TYPES.TIMED,
          ...preview
        }
      });
    }
  }

  if (renewEligibility.skipSalesLimit && user.disable_reason === DISABLE_REASONS.TRAFFIC_LIMIT) {
    // 保持旧语义：仅作为业务判断结果，不额外改写数据流。
  }

  const outTradeNo = `REN${Date.now()}${crypto.randomBytes(3).toString('hex')}`;
  let orderId;
  const createdAt = getNowTimestamp();

  if (isBalancePayType(payType)) {
    const planPrice = Number(plan.price) || 0;
    const userBalance = Number(user.balance) || 0;
    if (userBalance < planPrice) {
      throw createLegacyBusinessError('余额不足，请更换支付方式', {
        code: 4001
      });
    }

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
      const balanceResult = await orderRepository.decrementUserBalance(transactionDb, {
        userId,
        amount: planPrice
      });

      if (!balanceResult || Number(balanceResult.changes) !== 1) {
        throw createLegacyBusinessError('余额不足，请更换支付方式', {
          code: 4001
        });
      }
    });

    await transaction();

    const tradeNo = `BALANCE-${outTradeNo}`;
    await orderService.completePaidOrder(db, outTradeNo, tradeNo);

    return {
      order_id: orderId,
      out_trade_no: outTradeNo,
      pay_type: BALANCE_PAY_TYPE,
      payment_method: 'balance',
      paid: true,
      really_price: (planPrice / 100).toFixed(2),
      payment_url: '',
      expire_in: 0
    };
  }

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
  listRenewPlans,
  createRenewOrder
};
