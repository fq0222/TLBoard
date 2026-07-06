const assert = require('assert');
const axios = require('axios');
const config = require('../config');
const vmqService = require('../integrations/vmq/vmq-service');
const userRepository = require('../repositories/user-repository');
const orderRepository = require('../repositories/order-repository');
const authService = require('../services/user/auth-service');
const orderService = require('../services/shared/order-service');
const renewService = require('../services/user/renew-service');

/**
 * 验证注册购买在 VMQ 监控端离线时提前中止，不开启数据库事务。
 */
async function testRegisterRejectsOfflineMonitor() {
  const originalFindUser = userRepository.findUserRegisterSnapshotByEmail;
  const originalFindPlan = userRepository.findEnabledPlanById;
  const originalIsMonitorOnline = vmqService.isMonitorOnline;
  let transactionCalled = false;
  const db = {
    transaction() {
      transactionCalled = true;
      throw new Error('不应开启事务');
    }
  };

  try {
    userRepository.findUserRegisterSnapshotByEmail = async () => null;
    userRepository.findEnabledPlanById = async () => ({
      id: 1,
      sales_limit: -1,
      sales_count: 0
    });
    vmqService.isMonitorOnline = async () => false;

    await assert.rejects(
      authService.registerAndPay(db, {
        email: 'offline@example.com',
        password: 'password123',
        plan_id: 1
      }),
      (error) => {
        assert.strictEqual(error.statusCode, 503);
        assert.strictEqual(error.code, 5004);
        assert.strictEqual(error.message, '暂时无法支付，请联系客服');
        return true;
      }
    );
    assert.strictEqual(transactionCalled, false);
  } finally {
    userRepository.findUserRegisterSnapshotByEmail = originalFindUser;
    userRepository.findEnabledPlanById = originalFindPlan;
    vmqService.isMonitorOnline = originalIsMonitorOnline;
  }
}

/**
 * 验证非余额续费在 VMQ 监控端离线时提前中止，不创建待支付订单。
 */
async function testRenewRejectsOfflineMonitor() {
  const originals = {
    findUserById: orderRepository.findUserById,
    findEnabledPlanById: orderRepository.findEnabledPlanById,
    findPlanById: orderRepository.findPlanById,
    isMonitorOnline: vmqService.isMonitorOnline
  };
  let transactionCalled = false;
  const db = {
    transaction() {
      transactionCalled = true;
      throw new Error('离线时不应开启续费事务');
    }
  };

  try {
    orderRepository.findUserById = async () => ({
      id: 8,
      email: 'renew@example.com',
      plan_id: 1,
      enabled: 1,
      disable_reason: null
    });
    orderRepository.findEnabledPlanById = async () => ({
      id: 2,
      price: 1500,
      plan_type: 'lifetime',
      sales_limit: -1,
      sales_count: 0
    });
    orderRepository.findPlanById = async () => ({ id: 1, plan_type: 'lifetime' });
    vmqService.isMonitorOnline = async () => false;

    await assert.rejects(
      renewService.createRenewOrder(db, 8, { plan_id: 2, pay_type: 2 }),
      (error) => {
        assert.strictEqual(error.statusCode, 503);
        assert.strictEqual(error.code, 5004);
        assert.strictEqual(error.message, '暂时无法支付，请联系客服');
        return true;
      }
    );
    assert.strictEqual(transactionCalled, false);
  } finally {
    orderRepository.findUserById = originals.findUserById;
    orderRepository.findEnabledPlanById = originals.findEnabledPlanById;
    orderRepository.findPlanById = originals.findPlanById;
    vmqService.isMonitorOnline = originals.isMonitorOnline;
  }
}

/**
 * 验证余额续费不依赖 VMQ 监控状态，并正常完成余额扣款与订单支付。
 */
async function testBalanceRenewBypassesMonitor() {
  const originals = {
    findUserById: orderRepository.findUserById,
    findEnabledPlanById: orderRepository.findEnabledPlanById,
    findPlanById: orderRepository.findPlanById,
    createPendingRenewOrder: orderRepository.createPendingRenewOrder,
    decrementUserBalance: orderRepository.decrementUserBalance,
    completePaidOrder: orderService.completePaidOrder,
    isMonitorOnline: vmqService.isMonitorOnline
  };
  let completed = false;
  const db = {
    transaction(callback) {
      return async () => callback({});
    }
  };

  try {
    orderRepository.findUserById = async () => ({
      id: 8,
      email: 'balance@example.com',
      plan_id: 1,
      enabled: 1,
      disable_reason: null,
      balance: 2000
    });
    orderRepository.findEnabledPlanById = async () => ({
      id: 2,
      price: 1500,
      plan_type: 'lifetime',
      sales_limit: -1,
      sales_count: 0
    });
    orderRepository.findPlanById = async () => ({ id: 1, plan_type: 'lifetime' });
    orderRepository.createPendingRenewOrder = async () => ({ lastInsertRowid: 66 });
    orderRepository.decrementUserBalance = async () => ({ changes: 1 });
    orderService.completePaidOrder = async () => {
      completed = true;
      return { handled: true };
    };
    vmqService.isMonitorOnline = async () => {
      throw new Error('余额支付不应检查 VMQ');
    };

    const result = await renewService.createRenewOrder(db, 8, {
      plan_id: 2,
      pay_type: 9
    });

    assert.strictEqual(result.payment_method, 'balance');
    assert.strictEqual(result.paid, true);
    assert.strictEqual(completed, true);
  } finally {
    orderRepository.findUserById = originals.findUserById;
    orderRepository.findEnabledPlanById = originals.findEnabledPlanById;
    orderRepository.findPlanById = originals.findPlanById;
    orderRepository.createPendingRenewOrder = originals.createPendingRenewOrder;
    orderRepository.decrementUserBalance = originals.decrementUserBalance;
    orderService.completePaidOrder = originals.completePaidOrder;
    vmqService.isMonitorOnline = originals.isMonitorOnline;
  }
}

/**
 * 验证 VMQ 监控端在线状态的严格判定规则及异常降级行为。
 */
async function run() {
  const originalGet = axios.get;
  const originalApiUrl = config.payment.vmqApiUrl;

  try {
    config.payment.vmqApiUrl = 'http://vmq.test';

    const cases = [
      [{ code: 1, data: { state: '1' } }, true],
      [{ code: '1', data: { state: '1' } }, true],
      [{ code: 0, data: { state: '1' } }, false],
      [{ code: 1, data: { state: '0' } }, false],
      [{ code: 1, data: { state: '-1' } }, false],
      [{ code: 1, data: { state: 1 } }, false],
      [{ code: 1 }, false]
    ];

    for (const [data, expected] of cases) {
      axios.get = async () => ({ status: 200, data });
      assert.strictEqual(await vmqService.isMonitorOnline(), expected);
    }

    axios.get = async () => {
      throw new Error('network error');
    };
    assert.strictEqual(await vmqService.isMonitorOnline(), false);

    await testRegisterRejectsOfflineMonitor();
    await testBalanceRenewBypassesMonitor();
    await testRenewRejectsOfflineMonitor();

    console.log('vmq monitor status tests passed');
  } finally {
    axios.get = originalGet;
    config.payment.vmqApiUrl = originalApiUrl;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
