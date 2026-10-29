const assert = require('assert');
const paymentService = require('../services/user/payment-service');
const vmqService = require('../integrations/vmq/vmq-service');
const orderService = require('../services/shared/order-service');

function createFakeDb(order) {
  return {
    prepare(sql) {
      return {
        get(outTradeNo) {
          if (sql.includes('FROM orders') && outTradeNo === order?.out_trade_no) {
            return {
              amount: order.amount,
              trade_no: order.trade_no,
              status: order.status
            };
          }
          return undefined;
        }
      };
    }
  };
}

async function testMissingSignShouldFail() {
  const result = await paymentService.handleNotify(createFakeDb(null), {
    payId: 'ORD-1'
  });

  assert.strictEqual(result.responseText, 'error_sign');
}

async function testInvalidSignShouldFail() {
  const originalVerifyNotifySign = vmqService.verifyNotifySign;
  vmqService.verifyNotifySign = () => false;

  try {
    const result = await paymentService.handleNotify(createFakeDb(null), {
      payId: 'ORD-1',
      sign: 'bad-sign'
    });

    assert.strictEqual(result.responseText, 'error_sign');
  } finally {
    vmqService.verifyNotifySign = originalVerifyNotifySign;
  }
}

async function testMissingOrderShouldReturnSuccess() {
  const originalVerifyNotifySign = vmqService.verifyNotifySign;
  vmqService.verifyNotifySign = () => true;

  try {
    const result = await paymentService.handleNotify(createFakeDb(null), {
      payId: 'ORD-404',
      sign: 'ok',
      price: '10.00',
      reallyPrice: '10.00'
    });

    assert.strictEqual(result.responseText, 'success');
  } finally {
    vmqService.verifyNotifySign = originalVerifyNotifySign;
  }
}

async function testLowerPaidAmountShouldFail() {
  const originalVerifyNotifySign = vmqService.verifyNotifySign;
  vmqService.verifyNotifySign = () => true;

  try {
    const result = await paymentService.handleNotify(createFakeDb({
      out_trade_no: 'ORD-2',
      amount: 1000,
      trade_no: 'VMQ-2',
      status: 'pending'
    }), {
      payId: 'ORD-2',
      sign: 'ok',
      price: '10.00',
      reallyPrice: '9.99'
    });

    assert.strictEqual(result.responseText, 'error_amount');
  } finally {
    vmqService.verifyNotifySign = originalVerifyNotifySign;
  }
}

async function testValidNotifyShouldCompleteOrder() {
  const originalVerifyNotifySign = vmqService.verifyNotifySign;
  const originalCompletePaidOrder = orderService.completePaidOrder;
  let completedOrder = null;

  vmqService.verifyNotifySign = () => true;
  orderService.completePaidOrder = async (db, outTradeNo, tradeNo) => {
    completedOrder = { outTradeNo, tradeNo };
    return { handled: true, alreadyPaid: false };
  };

  try {
    const result = await paymentService.handleNotify(createFakeDb({
      out_trade_no: 'ORD-3',
      amount: 1000,
      trade_no: 'VMQ-3',
      status: 'pending'
    }), {
      payId: 'ORD-3',
      orderId: 'VMQ-NEW',
      sign: 'ok',
      price: '10.00',
      reallyPrice: '10.01'
    });

    assert.strictEqual(result.responseText, 'success');
    assert.strictEqual(result.logLevel, 'info');
    assert.match(result.logMessage, /VMQ notify handled/);
    assert.deepStrictEqual(completedOrder, {
      outTradeNo: 'ORD-3',
      tradeNo: 'VMQ-NEW'
    });
  } finally {
    vmqService.verifyNotifySign = originalVerifyNotifySign;
    orderService.completePaidOrder = originalCompletePaidOrder;
  }
}

/**
 * 回调对已支付重复通知和未完成业务状态都返回 success，只有 handled=true 记录成功处理。
 * completion 覆盖已支付、订单失效及套餐丢失；未完成原因应进入 warn 日志以便定位。
 */
async function testNotifyLoggingReflectsCompletionResult() {
  const originalVerifyNotifySign = vmqService.verifyNotifySign;
  const originalCompletePaidOrder = orderService.completePaidOrder;
  vmqService.verifyNotifySign = () => true;
  try {
    for (const completion of [
      { handled: false, reason: 'order_not_pending', order: { status: 'paid' } },
      { handled: false, reason: 'order_not_pending', order: { status: 'expired' } },
      { handled: false, reason: 'plan_not_found' },
      { handled: true, alreadyPaid: true }
    ]) {
      orderService.completePaidOrder = async () => completion;
      const result = await paymentService.handleNotify(createFakeDb({
        out_trade_no: 'ORD-4', amount: 1000, trade_no: 'VMQ-4', status: 'pending'
      }), { payId: 'ORD-4', sign: 'ok', price: '10.00', reallyPrice: '10.00' });
      assert.strictEqual(result.responseText, 'success');
      assert.strictEqual(result.logLevel, completion.handled ? 'info' : 'warn');
      if (completion.handled) {
        assert.match(result.logMessage, /VMQ notify handled/);
      } else {
        assert.ok(result.logMessage.includes(completion.reason));
        assert.doesNotMatch(result.logMessage, /VMQ notify handled/);
      }
    }
  } finally {
    vmqService.verifyNotifySign = originalVerifyNotifySign;
    orderService.completePaidOrder = originalCompletePaidOrder;
  }
}

async function testReturnRedirectUrlShouldKeepOrderId() {
  const redirectUrl = paymentService.buildReturnRedirectUrl({
    payId: 'ORD-5'
  });

  assert.strictEqual(redirectUrl, '/payment/callback?order_id=ORD-5');
}

async function run() {
  await testMissingSignShouldFail();
  await testInvalidSignShouldFail();
  await testMissingOrderShouldReturnSuccess();
  await testLowerPaidAmountShouldFail();
  await testValidNotifyShouldCompleteOrder();
  await testNotifyLoggingReflectsCompletionResult();
  await testReturnRedirectUrlShouldKeepOrderId();
  console.log('user payment service tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

