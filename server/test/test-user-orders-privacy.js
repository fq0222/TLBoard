/**
 * 用户订单状态隐私测试。
 * 职责：确保匿名轮询只暴露支付状态，同时保持登录用户查询自己的订单时返回既有字段。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const ordersService = require('../services/user/orders-service');
const orderRepository = require('../repositories/order-repository');

const PAID_ORDER = {
  id: 17,
  user_id: 8,
  out_trade_no: 'ORD-privacy-token',
  trade_no: 'VMQ-sensitive-id',
  status: 'paid',
  payment_url: 'https://pay.example.test/sensitive-link'
};

/**
 * 临时替换订单仓储查询，并在测试结束后恢复。
 * @param {Object} replacements - 需要替换的仓储方法
 * @returns {Function} 恢复原方法的函数
 */
function replaceOrderRepository(replacements) {
  const originals = {};
  Object.entries(replacements).forEach(([name, implementation]) => {
    originals[name] = orderRepository[name];
    orderRepository[name] = implementation;
  });

  return () => {
    Object.entries(originals).forEach(([name, implementation]) => {
      orderRepository[name] = implementation;
    });
  };
}

test('匿名订单状态轮询只返回 status', async () => {
  const restore = replaceOrderRepository({
    findPublicOrderByOutTradeNo: async () => ({ ...PAID_ORDER })
  });

  try {
    const result = await ordersService.getPublicOrderStatus(
      {},
      PAID_ORDER.out_trade_no,
      null
    );

    assert.deepEqual(result, { status: 'paid' });
  } finally {
    restore();
  }
});

test('登录用户通过公共轮询接口查询时保留既有订单字段', async () => {
  const restore = replaceOrderRepository({
    findPublicOrderByOutTradeNo: async () => ({ ...PAID_ORDER })
  });

  try {
    const result = await ordersService.getPublicOrderStatus(
      {},
      PAID_ORDER.out_trade_no,
      { id: PAID_ORDER.user_id }
    );

    assert.deepEqual(result, {
      order_id: PAID_ORDER.id,
      out_trade_no: PAID_ORDER.out_trade_no,
      vmq_order_id: PAID_ORDER.trade_no,
      status: 'paid',
      payment_url: PAID_ORDER.payment_url
    });
  } finally {
    restore();
  }
});

test('登录专用订单状态接口保留既有订单字段', async () => {
  const restore = replaceOrderRepository({
    findUserOrderByOutTradeNo: async () => ({ ...PAID_ORDER })
  });

  try {
    const result = await ordersService.getUserOrderStatus(
      {},
      PAID_ORDER.user_id,
      PAID_ORDER.out_trade_no
    );

    assert.deepEqual(result, {
      order_id: PAID_ORDER.id,
      out_trade_no: PAID_ORDER.out_trade_no,
      vmq_order_id: PAID_ORDER.trade_no,
      status: 'paid',
      payment_url: PAID_ORDER.payment_url
    });
  } finally {
    restore();
  }
});
