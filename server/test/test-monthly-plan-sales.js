const assert = require('assert');
const { test } = require('node:test');

const {
  PLAN_TYPES,
  normalizePlanType,
  isLifetimePlan,
  isTimedPlan,
  validatePlanDuration,
  buildTimedRenewResetPreview
} = require('../services/shared/plan-type');

test('plan type helpers normalize old records to lifetime', () => {
  assert.equal(normalizePlanType(null), PLAN_TYPES.LIFETIME);
  assert.equal(normalizePlanType(''), PLAN_TYPES.LIFETIME);
  assert.equal(normalizePlanType('timed'), PLAN_TYPES.TIMED);
  assert.equal(isLifetimePlan({ plan_type: null }), true);
  assert.equal(isTimedPlan({ plan_type: 'timed' }), true);
});

test('plan duration validation protects lifetime and timed semantics', () => {
  assert.deepEqual(validatePlanDuration({ plan_type: 'lifetime', duration_days: 0 }), {
    valid: true
  });
  assert.deepEqual(validatePlanDuration({ plan_type: 'lifetime', duration_days: 30 }), {
    valid: false,
    message: '不限时套餐的有效天数必须为 0'
  });
  assert.deepEqual(validatePlanDuration({ plan_type: 'timed', duration_days: 30 }), {
    valid: true
  });
  assert.deepEqual(validatePlanDuration({ plan_type: 'timed', duration_days: 0 }), {
    valid: false,
    message: '限时套餐的有效天数必须大于 0'
  });
  assert.deepEqual(validatePlanDuration({ plan_type: 'timed', duration_days: 'abc' }), {
    valid: false,
    message: '限时套餐的有效天数必须大于 0'
  });
  assert.deepEqual(validatePlanDuration({ plan_type: 'lifetime', duration_days: 'abc' }), {
    valid: false,
    message: '不限时套餐的有效天数必须为 0'
  });
});

test('timed renew preview reports remaining traffic and time', () => {
  const preview = buildTimedRenewResetPreview(
    {
      traffic_used: 3 * 1024,
      traffic_limit: 10 * 1024,
      expire_at: 1700003600
    },
    {
      traffic_limit: 20 * 1024,
      duration_days: 30
    },
    1700000000
  );

  assert.equal(preview.requires_confirm, true);
  assert.equal(preview.remaining_traffic, 7 * 1024);
  assert.equal(preview.remaining_seconds, 3600);
  assert.equal(preview.reset_traffic_limit, 20 * 1024);
  assert.equal(preview.reset_expire_at, 1702592000);
});

test('admin plan service formats plan type and show on home', async () => {
  const plansService = require('../services/admin/plans-service');
  const db = {
    prepare(sql) {
      return {
        all() {
          assert.match(sql, /SELECT \*/);
          return [{
            id: 1,
            name: '月卡',
            description: '',
            price: 990,
            duration_days: 30,
            traffic_limit: 1024,
            plan_type: 'timed',
            show_on_home: 1,
            sort_order: 0,
            enabled: 1,
            sales_limit: -1,
            sales_count: 0,
            updated_at: 1700000000,
            created_at: 1700000000
          }];
        }
      };
    }
  };

  const result = await plansService.listPlans(db);
  assert.equal(result.list[0].plan_type, 'timed');
  assert.equal(result.list[0].plan_type_text, '限时套餐');
  assert.equal(result.list[0].show_on_home, 1);
});

test('admin plan service rejects lifetime plans with duration days', async () => {
  const plansService = require('../services/admin/plans-service');
  await assert.rejects(
    () => plansService.createPlan({}, {
      name: '不限时套餐',
      price: 1000,
      duration_days: 30,
      traffic_limit: 1024,
      plan_type: 'lifetime',
      show_on_home: 0
    }),
    /不限时套餐的有效天数必须为 0/
  );
});

test('admin plan service stores string false show on home as 0 on create', async () => {
  const plansService = require('../services/admin/plans-service');
  let insertValues = [];
  const db = {
    prepare(sql) {
      if (/INSERT INTO plans/.test(sql)) {
        return {
          run(...values) {
            insertValues = values;
            return { lastInsertRowid: 2 };
          }
        };
      }

      return {
        get() {
          return {
            id: 2,
            name: '月卡',
            description: '',
            price: 990,
            duration_days: 30,
            traffic_limit: 1024,
            plan_type: 'timed',
            show_on_home: insertValues[6],
            sort_order: 0,
            enabled: 1,
            sales_limit: -1,
            sales_count: 0,
            updated_at: 1700000000,
            created_at: 1700000000
          };
        }
      };
    }
  };

  const result = await plansService.createPlan(db, {
    name: '月卡',
    price: 990,
    duration_days: 30,
    traffic_limit: 1024,
    plan_type: 'timed',
    show_on_home: 'false'
  });

  assert.equal(insertValues[6], 0);
  assert.equal(result.show_on_home, 0);
});

test('admin plan service stores string 0 show on home as 0 on update', async () => {
  const plansService = require('../services/admin/plans-service');
  let updateValues = [];
  const existingPlan = {
    id: 3,
    name: '月卡',
    description: '',
    price: 990,
    duration_days: 30,
    traffic_limit: 1024,
    plan_type: 'timed',
    show_on_home: 1,
    sort_order: 0,
    enabled: 1,
    sales_limit: -1,
    sales_count: 0,
    updated_at: 1700000000,
    created_at: 1700000000
  };
  const db = {
    prepare(sql) {
      if (/UPDATE plans SET/.test(sql)) {
        assert.match(sql, /show_on_home = \?/);
        return {
          run(...values) {
            updateValues = values;
          }
        };
      }

      return {
        get() {
          return {
            ...existingPlan,
            show_on_home: updateValues.length > 0 ? updateValues[0] : existingPlan.show_on_home
          };
        }
      };
    }
  };

  const result = await plansService.updatePlan(db, 3, {
    show_on_home: '0'
  });

  assert.equal(updateValues[0], 0);
  assert.equal(result.show_on_home, 0);
});

test('admin plan service infers timed plan on create when plan type is missing and duration days is positive', async () => {
  const plansService = require('../services/admin/plans-service');
  let insertValues = [];
  const db = {
    prepare(sql) {
      if (/INSERT INTO plans/.test(sql)) {
        return {
          run(...values) {
            insertValues = values;
            return { lastInsertRowid: 4 };
          }
        };
      }

      return {
        get() {
          return {
            id: 4,
            name: '月卡',
            description: '',
            price: 990,
            duration_days: 30,
            traffic_limit: 1024,
            plan_type: insertValues[5],
            show_on_home: 1,
            sort_order: 0,
            enabled: 1,
            sales_limit: -1,
            sales_count: 0,
            updated_at: 1700000000,
            created_at: 1700000000
          };
        }
      };
    }
  };

  const result = await plansService.createPlan(db, {
    name: '月卡',
    price: 990,
    duration_days: 30,
    traffic_limit: 1024
  });

  assert.equal(insertValues[5], 'timed');
  assert.equal(result.plan_type, 'timed');
});

test('admin plan service infers lifetime plan on create when plan type is missing and duration days is zero', async () => {
  const plansService = require('../services/admin/plans-service');
  let insertValues = [];
  const db = {
    prepare(sql) {
      if (/INSERT INTO plans/.test(sql)) {
        return {
          run(...values) {
            insertValues = values;
            return { lastInsertRowid: 5 };
          }
        };
      }

      return {
        get() {
          return {
            id: 5,
            name: '不限时套餐',
            description: '',
            price: 1000,
            duration_days: 0,
            traffic_limit: 1024,
            plan_type: insertValues[5],
            show_on_home: 1,
            sort_order: 0,
            enabled: 1,
            sales_limit: -1,
            sales_count: 0,
            updated_at: 1700000000,
            created_at: 1700000000
          };
        }
      };
    }
  };

  const result = await plansService.createPlan(db, {
    name: '不限时套餐',
    price: 1000,
    duration_days: 0,
    traffic_limit: 1024
  });

  assert.equal(insertValues[5], 'lifetime');
  assert.equal(result.plan_type, 'lifetime');
});

test('user home plans query filters show_on_home', async () => {
  const planRepository = require('../repositories/plan-repository');
  let capturedSql = '';
  const db = {
    prepare(sql) {
      capturedSql = sql;
      return {
        all() {
          return [];
        }
      };
    }
  };

  await planRepository.findEnabledPlans(db);
  assert.match(capturedSql, /show_on_home = 1/);
});

test('renew plan list filters by current user plan type', async () => {
  const renewService = require('../services/user/renew-service');
  const db = {
    prepare(sql) {
      if (sql.includes('FROM users WHERE id')) {
        return {
          get() {
            return { id: 9, email: 'timed@example.com', plan_id: 2 };
          }
        };
      }
      if (sql.includes('FROM plans WHERE id')) {
        return {
          get() {
            return { id: 2, plan_type: 'timed', duration_days: 30 };
          }
        };
      }
      if (sql.includes('plan_type = ?')) {
        return {
          all(planType) {
            assert.equal(planType, 'timed');
            return [{
              id: 3,
              name: '月卡',
              description: '',
              price: 990,
              duration_days: 30,
              traffic_limit: 1024,
              plan_type: 'timed',
              show_on_home: 1,
              sort_order: 0,
              sales_limit: -1,
              sales_count: 0
            }];
          }
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  const plans = await renewService.listRenewPlans(db, 9);
  assert.equal(plans[0].plan_type, 'timed');
});

test('renew lifetime plan query includes legacy empty plan types', async () => {
  const planRepository = require('../repositories/plan-repository');
  let capturedSql = '';
  const db = {
    prepare(sql) {
      capturedSql = sql;
      return {
        all() {
          return [];
        }
      };
    }
  };

  await planRepository.findEnabledPlansByType(db, 'lifetime');
  assert.match(capturedSql, /plan_type = 'lifetime'/);
  assert.match(capturedSql, /plan_type IS NULL/);
  assert.match(capturedSql, /plan_type = ''/);
});

test('renew plan list includes same type plans hidden from home', async () => {
  const renewService = require('../services/user/renew-service');
  const db = {
    prepare(sql) {
      if (sql.includes('FROM users WHERE id')) {
        return {
          get() {
            return { id: 10, email: 'hidden@example.com', plan_id: 6 };
          }
        };
      }
      if (sql.includes('FROM plans WHERE id')) {
        return {
          get() {
            return { id: 6, plan_type: 'timed', duration_days: 30 };
          }
        };
      }
      if (sql.includes('plan_type = ?')) {
        assert.doesNotMatch(sql, /show_on_home = 1/);
        return {
          all(planType) {
            assert.equal(planType, 'timed');
            return [{
              id: 7,
              name: '隐藏月卡',
              description: '',
              price: 1290,
              duration_days: 30,
              traffic_limit: 2048,
              plan_type: 'timed',
              show_on_home: 0,
              sort_order: 0,
              sales_limit: -1,
              sales_count: 0
            }];
          }
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  const plans = await renewService.listRenewPlans(db, 10);
  assert.equal(plans[0].plan_type, 'timed');
  assert.equal(plans[0].show_on_home, 0);
});

test('renew service rejects changing between lifetime and timed plans', async () => {
  const renewService = require('../services/user/renew-service');
  const db = {
    prepare(sql) {
      if (sql.includes('FROM users WHERE id')) {
        return { get: () => ({ id: 1, email: 'a@example.com', plan_id: 1, enabled: 1 }) };
      }
      if (sql.includes('SELECT * FROM plans WHERE id = ? AND enabled = 1')) {
        return { get: () => ({ id: 2, plan_type: 'timed', duration_days: 30, sales_limit: -1, sales_count: 0 }) };
      }
      if (sql.includes('SELECT * FROM plans WHERE id = ?')) {
        return { get: () => ({ id: 1, plan_type: 'lifetime', duration_days: 0 }) };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  await assert.rejects(
    () => renewService.createRenewOrder(db, 1, { plan_id: 2, pay_type: 9 }),
    /不能跨套餐类型续费/
  );
});

test('timed active renew requires reset confirmation', async () => {
  const renewService = require('../services/user/renew-service');
  const now = Math.floor(Date.now() / 1000);
  const db = {
    prepare(sql) {
      if (sql.includes('FROM users WHERE id')) {
        return {
          get: () => ({
            id: 2,
            email: 'timed@example.com',
            plan_id: 3,
            enabled: 1,
            traffic_used: 1024,
            traffic_limit: 4096,
            expire_at: now + 86400,
            balance: 0
          })
        };
      }
      if (sql.includes('SELECT * FROM plans WHERE id = ? AND enabled = 1')) {
        return {
          get: () => ({
            id: 3,
            price: 990,
            traffic_limit: 4096,
            duration_days: 30,
            plan_type: 'timed',
            sales_limit: -1,
            sales_count: 0
          })
        };
      }
      if (sql.includes('SELECT * FROM plans WHERE id = ?')) {
        return {
          get: () => ({
            id: 3,
            plan_type: 'timed',
            duration_days: 30
          })
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  await assert.rejects(
    () => renewService.createRenewOrder(db, 2, { plan_id: 3, pay_type: 9 }),
    (error) => {
      assert.equal(error.code, 4091);
      assert.equal(error.data.requires_confirm, true);
      return /续费会重置当前剩余流量和时间/.test(error.message);
    }
  );
});

test('timed active renew accepts string true reset confirmation', async () => {
  const renewService = require('../services/user/renew-service');
  const now = Math.floor(Date.now() / 1000);
  const db = {
    prepare(sql) {
      if (sql.includes('FROM users WHERE id')) {
        return {
          get: () => ({
            id: 4,
            email: 'string-confirm@example.com',
            plan_id: 3,
            enabled: 1,
            traffic_used: 1024,
            traffic_limit: 4096,
            expire_at: now + 86400,
            balance: 0
          })
        };
      }
      if (sql.includes('SELECT * FROM plans WHERE id = ? AND enabled = 1')) {
        return {
          get: () => ({
            id: 3,
            price: 990,
            traffic_limit: 4096,
            duration_days: 30,
            plan_type: 'timed',
            sales_limit: -1,
            sales_count: 0
          })
        };
      }
      if (sql.includes('SELECT * FROM plans WHERE id = ?')) {
        return {
          get: () => ({
            id: 3,
            plan_type: 'timed',
            duration_days: 30
          })
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  await assert.rejects(
    () => renewService.createRenewOrder(db, 4, { plan_id: 3, pay_type: 9, confirm_reset: 'true' }),
    (error) => {
      assert.equal(error.code, 4001);
      return /余额不足/.test(error.message);
    }
  );
});

test('admin disabled timed renew rejects before reset confirmation preview', async () => {
  const renewService = require('../services/user/renew-service');
  const now = Math.floor(Date.now() / 1000);
  const db = {
    prepare(sql) {
      if (sql.includes('FROM users WHERE id')) {
        return {
          get: () => ({
            id: 5,
            email: 'admin-disabled@example.com',
            plan_id: 3,
            enabled: 0,
            disable_reason: 'admin',
            traffic_used: 1024,
            traffic_limit: 4096,
            expire_at: now + 86400,
            balance: 0
          })
        };
      }
      if (sql.includes('SELECT * FROM plans WHERE id = ? AND enabled = 1')) {
        return {
          get: () => ({
            id: 3,
            price: 990,
            traffic_limit: 4096,
            duration_days: 30,
            plan_type: 'timed',
            sales_limit: -1,
            sales_count: 0
          })
        };
      }
      if (sql.includes('SELECT * FROM plans WHERE id = ?')) {
        return {
          get: () => ({
            id: 3,
            plan_type: 'timed',
            duration_days: 30
          })
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  await assert.rejects(
    () => renewService.createRenewOrder(db, 5, { plan_id: 3, pay_type: 9 }),
    (error) => {
      assert.equal(error.code, 2003);
      assert.equal(error.message, '账号已被禁用，请联系管理员');
      assert.notEqual(error.code, 4091);
      return true;
    }
  );
});

test('expired disabled timed renew can reach reset confirmation gate', async () => {
  const renewService = require('../services/user/renew-service');
  const now = Math.floor(Date.now() / 1000);
  const db = {
    prepare(sql) {
      if (sql.includes('FROM users WHERE id')) {
        return {
          get: () => ({
            id: 6,
            email: 'expired-disabled@example.com',
            plan_id: 3,
            enabled: 0,
            disable_reason: 'expired',
            traffic_used: 1024,
            traffic_limit: 4096,
            expire_at: now + 86400,
            balance: 0
          })
        };
      }
      if (sql.includes('SELECT * FROM plans WHERE id = ? AND enabled = 1')) {
        return {
          get: () => ({
            id: 3,
            price: 990,
            traffic_limit: 4096,
            duration_days: 30,
            plan_type: 'timed',
            sales_limit: -1,
            sales_count: 0
          })
        };
      }
      if (sql.includes('SELECT * FROM plans WHERE id = ?')) {
        return {
          get: () => ({
            id: 3,
            plan_type: 'timed',
            duration_days: 30
          })
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  await assert.rejects(
    () => renewService.createRenewOrder(db, 6, { plan_id: 3, pay_type: 9 }),
    (error) => {
      assert.equal(error.code, 4091);
      assert.notEqual(error.message, '账号已被禁用，请联系管理员');
      assert.notEqual(error.message, '账号当前状态异常，请联系管理员');
      return true;
    }
  );
});

test('traffic limit disabled renew keeps old allowance and is not abnormal', async () => {
  const renewService = require('../services/user/renew-service');
  const now = Math.floor(Date.now() / 1000);
  const db = {
    prepare(sql) {
      if (sql.includes('FROM users WHERE id')) {
        return {
          get: () => ({
            id: 7,
            email: 'traffic-disabled@example.com',
            plan_id: 3,
            enabled: 0,
            disable_reason: 'traffic_limit',
            traffic_used_at: now,
            traffic_used: 4096,
            traffic_limit: 4096,
            expire_at: now + 86400,
            balance: 0
          })
        };
      }
      if (sql.includes('SELECT * FROM plans WHERE id = ? AND enabled = 1')) {
        return {
          get: () => ({
            id: 3,
            price: 990,
            traffic_limit: 4096,
            duration_days: 30,
            plan_type: 'timed',
            sales_limit: 1,
            sales_count: 1
          })
        };
      }
      if (sql.includes('SELECT * FROM plans WHERE id = ?')) {
        return {
          get: () => ({
            id: 3,
            plan_type: 'timed',
            duration_days: 30
          })
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  await assert.rejects(
    () => renewService.createRenewOrder(db, 7, { plan_id: 3, pay_type: 9 }),
    (error) => {
      assert.equal(error.code, 4001);
      assert.notEqual(error.message, '账号已被禁用，请联系管理员');
      assert.notEqual(error.message, '账号当前状态异常，请联系管理员');
      assert.notEqual(error.message, '该套餐已售罄');
      return /余额不足/.test(error.message);
    }
  );
});

test('paid lifetime renew keeps existing traffic accumulation contract', async () => {
  const { calculatePaidOrderEntitlement } = require('../services/shared/order-service');
  const now = 1700000000;
  const result = calculatePaidOrderEntitlement({
    out_trade_no: 'REN123',
    current_traffic_limit: 1024,
    current_expire_at: 0
  }, {
    id: 1,
    plan_type: 'lifetime',
    duration_days: 0,
    traffic_limit: 2048
  }, now);

  assert.equal(result.trafficLimit, 3072);
  assert.equal(result.expireAt, 0);
  assert.equal(result.resetTrafficUsed, false);
});

test('paid timed renew resets traffic and starts expiry from payment time', async () => {
  const { calculatePaidOrderEntitlement } = require('../services/shared/order-service');
  const now = 1700000000;
  const result = calculatePaidOrderEntitlement({
    out_trade_no: 'REN456',
    current_traffic_limit: 8192,
    current_expire_at: now + 86400
  }, {
    id: 2,
    plan_type: 'timed',
    duration_days: 30,
    traffic_limit: 4096
  }, now);

  assert.equal(result.trafficLimit, 4096);
  assert.equal(result.expireAt, 1702592000);
  assert.equal(result.resetTrafficUsed, true);
});

test('paid lifetime renew enqueue payload uses final accumulated traffic limit', async () => {
  const orderRepository = require('../repositories/order-repository');
  const xuiSyncTaskService = require('../integrations/xui/xui-sync-task-service');
  const orderService = require('../services/shared/order-service');
  const transactionDb = { name: 'transaction-db' };
  let enqueuedPayload = null;

  const originalRepository = {
    findPaidOrderContextByOutTradeNo: orderRepository.findPaidOrderContextByOutTradeNo,
    findPlanById: orderRepository.findPlanById,
    markOrderPaid: orderRepository.markOrderPaid,
    updateUserAfterPaidOrder: orderRepository.updateUserAfterPaidOrder,
    incrementPlanSalesCount: orderRepository.incrementPlanSalesCount,
    decrementPlanSalesCount: orderRepository.decrementPlanSalesCount
  };
  const originalXuiSyncTaskService = {
    enqueueTask: xuiSyncTaskService.enqueueTask,
    processTask: xuiSyncTaskService.processTask
  };

  orderRepository.findPaidOrderContextByOutTradeNo = async () => ({
    id: 50,
    out_trade_no: 'REN-LIFETIME',
    status: 'pending',
    user_id: 20,
    email: 'renew@example.com',
    subscription_token: 'sub-token',
    plan_id: 3,
    current_plan_id: 3,
    current_traffic_limit: 1024,
    current_expire_at: 0,
    current_enabled: 1,
    current_disable_reason: null,
    current_payment_count: 1,
    trade_no: 'OLD-TRADE'
  });
  orderRepository.findPlanById = async () => ({
    id: 3,
    plan_type: 'lifetime',
    duration_days: 0,
    traffic_limit: 2048
  });
  orderRepository.markOrderPaid = async () => {};
  orderRepository.updateUserAfterPaidOrder = async () => {};
  orderRepository.incrementPlanSalesCount = async () => {};
  orderRepository.decrementPlanSalesCount = async () => {};
  xuiSyncTaskService.enqueueTask = async (db, task) => {
    enqueuedPayload = task.payload;
    return 88;
  };
  xuiSyncTaskService.processTask = () => Promise.resolve();

  const db = {
    transaction(callback) {
      return async () => callback(transactionDb);
    }
  };

  try {
    await orderService.completePaidOrder(db, 'REN-LIFETIME', 'TRADE-1');
    assert.equal(enqueuedPayload.user.total_traffic_limit, 3072);
    assert.equal(enqueuedPayload.plan.total_traffic_limit, 3072);
    assert.equal(enqueuedPayload.plan.traffic_limit, 3072);
  } finally {
    Object.assign(orderRepository, originalRepository);
    Object.assign(xuiSyncTaskService, originalXuiSyncTaskService);
  }
});

test('paid expired timed renew enqueues enable status sync', async () => {
  const orderRepository = require('../repositories/order-repository');
  const xuiSyncTaskService = require('../integrations/xui/xui-sync-task-service');
  const trafficManager = require('../services/shared/traffic-manager');
  const orderService = require('../services/shared/order-service');
  const transactionDb = { name: 'transaction-db' };
  const statusSyncCalls = [];

  const originalRepository = {
    findPaidOrderContextByOutTradeNo: orderRepository.findPaidOrderContextByOutTradeNo,
    findPlanById: orderRepository.findPlanById,
    markOrderPaid: orderRepository.markOrderPaid,
    updateUserAfterPaidOrder: orderRepository.updateUserAfterPaidOrder,
    incrementPlanSalesCount: orderRepository.incrementPlanSalesCount,
    decrementPlanSalesCount: orderRepository.decrementPlanSalesCount
  };
  const originalXuiSyncTaskService = {
    enqueueTask: xuiSyncTaskService.enqueueTask,
    processTask: xuiSyncTaskService.processTask
  };
  const originalTrafficManager = {
    enqueueUserStatusSync: trafficManager.enqueueUserStatusSync
  };

  orderRepository.findPaidOrderContextByOutTradeNo = async () => ({
    id: 51,
    out_trade_no: 'REN-EXPIRED',
    status: 'pending',
    user_id: 21,
    email: 'expired-renew@example.com',
    subscription_token: 'sub-token',
    plan_id: 4,
    current_plan_id: 4,
    current_traffic_limit: 4096,
    current_expire_at: 1699990000,
    current_enabled: 0,
    current_disable_reason: 'expired',
    current_payment_count: 1,
    trade_no: 'OLD-TRADE'
  });
  orderRepository.findPlanById = async () => ({
    id: 4,
    plan_type: 'timed',
    duration_days: 30,
    traffic_limit: 4096
  });
  orderRepository.markOrderPaid = async () => {};
  orderRepository.updateUserAfterPaidOrder = async () => {};
  orderRepository.incrementPlanSalesCount = async () => {};
  orderRepository.decrementPlanSalesCount = async () => {};
  trafficManager.enqueueUserStatusSync = async (db, userId, disable) => {
    statusSyncCalls.push({ userId, disable });
    return { success: true };
  };
  xuiSyncTaskService.enqueueTask = async () => 89;
  xuiSyncTaskService.processTask = () => Promise.resolve();

  const db = {
    transaction(callback) {
      return async () => callback(transactionDb);
    }
  };

  try {
    await orderService.completePaidOrder(db, 'REN-EXPIRED', 'TRADE-2');
    assert.deepEqual(statusSyncCalls[0], { userId: 21, disable: false });
  } finally {
    Object.assign(orderRepository, originalRepository);
    Object.assign(xuiSyncTaskService, originalXuiSyncTaskService);
    Object.assign(trafficManager, originalTrafficManager);
  }
});

test('repository paid user update can reset traffic used with valid params', async () => {
  const orderRepository = require('../repositories/order-repository');
  let capturedSql = '';
  let capturedValues = [];
  const db = {
    prepare(sql) {
      capturedSql = sql;
      return {
        run(...values) {
          capturedValues = values;
        }
      };
    }
  };

  await orderRepository.updateUserAfterPaidOrder(db, {
    userId: 9,
    planId: 2,
    trafficLimit: 4096,
    expireAt: 1702592000,
    resetTrafficUsed: true,
    updatedAt: 1700000000
  });

  assert.match(capturedSql, /traffic_used = 0/);
  assert.deepEqual(capturedValues, [2, 4096, 1702592000, 1700000000, 9]);
});

test('repository expired disable update avoids top-level plans join', async () => {
  const trafficRepository = require('../repositories/traffic-repository');
  let capturedSql = '';
  let capturedValues = [];
  const db = {
    prepare(sql) {
      capturedSql = sql;
      return {
        run(...values) {
          capturedValues = values;
          return { changes: 1 };
        }
      };
    }
  };

  const disabled = await trafficRepository.disableUserByExpired(db, 11, 'expired', 1700000000);

  assert.equal(disabled, true);
  const updateHeader = capturedSql.slice(0, capturedSql.indexOf('WHERE users.id'));
  assert.doesNotMatch(updateHeader, /FROM\s+plans\b/i);
  assert.match(capturedSql, /EXISTS \(/);
  assert.match(capturedSql, /users\.enabled = 1/);
  assert.match(capturedSql, /users\.expire_at <= \?/);
  assert.match(capturedSql, /COALESCE\(p\.plan_type, 'lifetime'\) = 'timed'/);
  assert.deepEqual(capturedValues, ['expired', 11, 1700000000]);
});

test('traffic manager disables expired timed users locally and queues sync', async () => {
  const trafficManager = require('../services/shared/traffic-manager');
  const now = 1700000000;
  const updated = [];
  const queuedTasks = [];
  const db = {
    prepare(sql) {
      if (sql.includes('pg_try_advisory_lock')) {
        return { get: () => ({ locked: true }) };
      }
      if (sql.includes('pg_advisory_unlock')) {
        return { get: () => ({ unlocked: true }) };
      }
      if (sql.includes('FROM users u') && sql.includes('expire_at <= ?')) {
        return {
          all(receivedNow) {
            assert.equal(receivedNow, now);
            return [{ id: 7, email: 'expired@example.com', expire_at: now - 1 }];
          }
        };
      }
      if (sql.includes('UPDATE users') && sql.includes('SET enabled = 0')) {
        return {
          run(disableReason, userId, receivedNow) {
            updated.push({ disableReason, userId, now: receivedNow });
            return { changes: 1 };
          }
        };
      }
      if (sql.includes('SELECT email FROM users')) {
        return { get: () => ({ email: 'expired@example.com' }) };
      }
      if (sql.includes('FROM xui_servers')) {
        return { all: () => [] };
      }
      if (sql.includes('INSERT INTO xui_sync_tasks')) {
        return {
          run(userId, taskType, payloadText) {
            queuedTasks.push({ userId, taskType, payload: JSON.parse(payloadText) });
            return { lastInsertRowid: 99 };
          }
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  const result = await trafficManager.checkAndDisableExpiredUsers(db, now);
  assert.equal(result.disabledCount, 1);
  assert.deepEqual(updated[0], { disableReason: 'expired', userId: 7, now });
  assert.deepEqual(queuedTasks[0], {
    userId: 7,
    taskType: 'disable_sync',
    payload: { disable: true }
  });
});

test('traffic manager skips expired disable sync when conditional update misses', async () => {
  const trafficManager = require('../services/shared/traffic-manager');
  const now = 1700000000;
  const queuedTasks = [];
  const db = {
    prepare(sql) {
      if (sql.includes('pg_try_advisory_lock')) {
        return { get: () => ({ locked: true }) };
      }
      if (sql.includes('pg_advisory_unlock')) {
        return { get: () => ({ unlocked: true }) };
      }
      if (sql.includes('FROM users u') && sql.includes('expire_at <= ?')) {
        return {
          all() {
            return [{ id: 9, email: 'renewed-before-disable@example.com', expire_at: now - 1 }];
          }
        };
      }
      if (sql.includes('UPDATE users')) {
        return {
          run() {
            return { changes: 0 };
          }
        };
      }
      if (sql.includes('INSERT INTO xui_sync_tasks')) {
        return {
          run(userId, taskType, payloadText) {
            queuedTasks.push({ userId, taskType, payload: JSON.parse(payloadText) });
            return { lastInsertRowid: 101 };
          }
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  const result = await trafficManager.checkAndDisableExpiredUsers(db, now);
  assert.equal(result.disabledCount, 0);
  assert.deepEqual(queuedTasks, []);
});

test('traffic manager still checks expired users when server traffic is unavailable', async () => {
  const trafficManager = require('../services/shared/traffic-manager');
  const updated = [];
  const queuedTasks = [];
  let serverQueryCount = 0;
  let expiredQueryCount = 0;
  const db = {
    prepare(sql) {
      if (sql.includes('pg_try_advisory_lock')) {
        return { get: () => ({ locked: true }) };
      }
      if (sql.includes('pg_advisory_unlock')) {
        return { get: () => ({ unlocked: true }) };
      }
      if (sql.includes('FROM xui_servers')) {
        return {
          all() {
            serverQueryCount += 1;
            return [];
          }
        };
      }
      if (sql.includes('FROM users u') && sql.includes('expire_at <= ?')) {
        return {
          all() {
            expiredQueryCount += 1;
            return [{ id: 8, email: 'expired-no-traffic@example.com', expire_at: 1700000000 }];
          }
        };
      }
      if (sql.includes('UPDATE users') && sql.includes('SET enabled = 0')) {
        return {
          run(disableReason, userId, receivedNow) {
            updated.push({ disableReason, userId, now: receivedNow });
            return { changes: 1 };
          }
        };
      }
      if (sql.includes('SELECT email FROM users')) {
        return { get: () => ({ email: 'expired-no-traffic@example.com' }) };
      }
      if (sql.includes('INSERT INTO xui_sync_tasks')) {
        return {
          run(userId, taskType, payloadText) {
            queuedTasks.push({ userId, taskType, payload: JSON.parse(payloadText) });
            return { lastInsertRowid: 100 };
          }
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  await trafficManager.syncTrafficAndHandleDisable(db);

  assert.equal(serverQueryCount >= 1, true);
  assert.equal(expiredQueryCount, 1);
  assert.equal(updated[0].disableReason, 'expired');
  assert.equal(updated[0].userId, 8);
  assert.equal(typeof updated[0].now, 'number');
  assert.deepEqual(queuedTasks[0], {
    userId: 8,
    taskType: 'disable_sync',
    payload: { disable: true }
  });
});

test('xui sync worker skips stale disable task when user is already enabled', async () => {
  const syncHandler = require('../jobs/handlers/sync-xui-tasks');
  const xuiSyncTaskService = require('../integrations/xui/xui-sync-task-service');
  const trafficManager = require('../services/shared/traffic-manager');
  let statusSyncCount = 0;

  const originalXuiSyncTaskService = {
    processDueTasks: xuiSyncTaskService.processDueTasks
  };
  const originalTrafficManager = {
    syncDisableStatusToXui: trafficManager.syncDisableStatusToXui
  };

  xuiSyncTaskService.processDueTasks = async (db, handler) => {
    const result = await handler({
      id: 201,
      user_id: 30,
      task_type: xuiSyncTaskService.TASK_TYPES.DISABLE_SYNC,
      payload_data: { disable: true }
    });

    assert.equal(result.success, true);
    assert.match(result.message, /已启用/);
    return { processed: 1, success: 1, failed: 0, finalFailed: 0 };
  };
  trafficManager.syncDisableStatusToXui = async () => {
    statusSyncCount += 1;
    return true;
  };

  const db = {
    prepare(sql) {
      if (sql.includes('FROM users')) {
        return {
          get(userId) {
            assert.equal(userId, 30);
            return {
              id: 30,
              email: 'already-enabled@example.com',
              enabled: 1,
              traffic_limit: 4096,
              expire_at: 1700000000
            };
          }
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  try {
    await syncHandler.runXuiSyncTasks(db);
    assert.equal(statusSyncCount, 0);
  } finally {
    Object.assign(xuiSyncTaskService, originalXuiSyncTaskService);
    Object.assign(trafficManager, originalTrafficManager);
  }
});

test('subscription user query includes plan type for expiry checks', async () => {
  const subscriptionRepository = require('../repositories/subscription-repository');
  let capturedSql = '';
  const db = {
    prepare(sql) {
      capturedSql = sql;
      return {
        get() {
          return undefined;
        }
      };
    }
  };

  await subscriptionRepository.findSubscriptionUserById(db, 1);
  assert.match(capturedSql, /p\.plan_type/);

  await subscriptionRepository.findSubscriptionContentByToken(db, 'token');
  assert.match(capturedSql, /LEFT JOIN plans p ON u\.plan_id = p\.id/);
  assert.match(capturedSql, /p\.plan_type/);
});

test('subscription info rejects expired timed plan before listing nodes', async () => {
  const subscriptionService = require('../services/user/subscription-service');
  const now = Math.floor(Date.now() / 1000);
  let cfQueryCount = 0;
  const db = {
    prepare(sql) {
      if (sql.includes('FROM users u') && sql.includes('LEFT JOIN plans')) {
        return {
          get() {
            return {
              id: 31,
              email: 'expired-subscription@example.com',
              enabled: 1,
              plan_type: 'timed',
              expire_at: now - 1,
              traffic_used: 0,
              traffic_limit: 4096
            };
          }
        };
      }
      if (sql.includes('FROM user_cf_ips')) {
        return {
          all() {
            cfQueryCount += 1;
            return [];
          }
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  await assert.rejects(
    () => subscriptionService.getSubscriptionInfo(db, 31),
    /套餐已到期/
  );
  assert.equal(cfQueryCount, 0);
});

test('subscription content rejects expired timed plan token', async () => {
  const subscriptionService = require('../services/user/subscription-service');
  const now = Math.floor(Date.now() / 1000);
  const db = {
    prepare(sql) {
      if (sql.includes('FROM user_subscriptions')) {
        return {
          get(token) {
            assert.equal(token, 'expired-token');
            return {
              sub_id: 'expired-token',
              email: 'expired-token@example.com',
              enabled: 1,
              plan_type: 'timed',
              expire_at: now - 1,
              traffic_used: 0,
              traffic_limit: 4096,
              nodes_data: '[]'
            };
          }
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  await assert.rejects(
    () => subscriptionService.getSubscriptionContent(db, 'expired-token', {}),
    /套餐已到期/
  );
});

test('subscription content rejects timed plan token with zero expire at', async () => {
  const subscriptionService = require('../services/user/subscription-service');
  const db = {
    prepare(sql) {
      if (sql.includes('FROM user_subscriptions')) {
        return {
          get() {
            return {
              sub_id: 'zero-expire-token',
              email: 'zero-expire@example.com',
              enabled: 1,
              plan_type: 'timed',
              expire_at: 0,
              traffic_used: 0,
              traffic_limit: 4096,
              nodes_data: '[]'
            };
          }
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  await assert.rejects(
    () => subscriptionService.getSubscriptionContent(db, 'zero-expire-token', {}),
    /套餐已到期/
  );
});

test('subscription info keeps admin disabled message before timed expiry message', async () => {
  const subscriptionService = require('../services/user/subscription-service');
  const now = Math.floor(Date.now() / 1000);
  const db = {
    prepare(sql) {
      if (sql.includes('FROM users u') && sql.includes('LEFT JOIN plans')) {
        return {
          get() {
            return {
              id: 32,
              email: 'admin-expired@example.com',
              enabled: 0,
              disable_reason: 'admin',
              plan_type: 'timed',
              expire_at: now - 1,
              traffic_used: 0,
              traffic_limit: 4096
            };
          }
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  await assert.rejects(
    () => subscriptionService.getSubscriptionInfo(db, 32),
    /账号已被禁用，请联系管理员/
  );
});

test('subscription content keeps lifetime plan token valid with expire at zero', async () => {
  const subscriptionService = require('../services/user/subscription-service');
  const db = {
    prepare(sql) {
      if (sql.includes('FROM user_subscriptions')) {
        return {
          get(token) {
            assert.equal(token, 'lifetime-token');
            return {
              sub_id: 'lifetime-token',
              email: 'lifetime-token@example.com',
              enabled: 1,
              plan_type: 'lifetime',
              expire_at: 0,
              traffic_used: 0,
              traffic_limit: 4096,
              nodes_data: '[]'
            };
          }
        };
      }
      if (sql.includes('FROM announcements')) {
        return {
          all() {
            return [];
          }
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  const result = await subscriptionService.getSubscriptionContent(db, 'lifetime-token', {});
  assert.equal(result.email, 'lifetime-token@example.com');
  assert.equal(result.headers['Subscription-Userinfo'], 'upload=0; download=0; total=4096; expire=0');
});

test('xui sync worker uses payload user id for non-stale status sync', async () => {
  const syncHandler = require('../jobs/handlers/sync-xui-tasks');
  const xuiSyncTaskService = require('../integrations/xui/xui-sync-task-service');
  const trafficManager = require('../services/shared/traffic-manager');
  const calls = [];

  const originalXuiSyncTaskService = {
    processDueTasks: xuiSyncTaskService.processDueTasks
  };
  const originalTrafficManager = {
    syncDisableStatusToXui: trafficManager.syncDisableStatusToXui
  };

  xuiSyncTaskService.processDueTasks = async (db, handler) => {
    const result = await handler({
      id: 203,
      user_id: null,
      task_type: xuiSyncTaskService.TASK_TYPES.DISABLE_SYNC,
      payload_data: { user: { id: 42 }, disable: true }
    });

    assert.equal(result.success, true);
    return { processed: 1, success: 1, failed: 0, finalFailed: 0 };
  };
  trafficManager.syncDisableStatusToXui = async (db, userId, disable) => {
    calls.push({ userId, disable });
    return true;
  };

  const db = {
    prepare(sql) {
      if (sql.includes('FROM users')) {
        return {
          get(userId) {
            assert.equal(userId, 42);
            return {
              id: 42,
              email: 'payload-user@example.com',
              enabled: 0,
              traffic_limit: 4096,
              expire_at: 1700000000
            };
          }
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  try {
    await syncHandler.runXuiSyncTasks(db);
    assert.deepEqual(calls[0], { userId: 42, disable: true });
  } finally {
    Object.assign(xuiSyncTaskService, originalXuiSyncTaskService);
    Object.assign(trafficManager, originalTrafficManager);
  }
});

test('xui sync worker skips stale enable task when user is still disabled', async () => {
  const syncHandler = require('../jobs/handlers/sync-xui-tasks');
  const xuiSyncTaskService = require('../integrations/xui/xui-sync-task-service');
  const trafficManager = require('../services/shared/traffic-manager');
  let statusSyncCount = 0;

  const originalXuiSyncTaskService = {
    processDueTasks: xuiSyncTaskService.processDueTasks
  };
  const originalTrafficManager = {
    syncDisableStatusToXui: trafficManager.syncDisableStatusToXui
  };

  xuiSyncTaskService.processDueTasks = async (db, handler) => {
    const result = await handler({
      id: 202,
      user_id: 31,
      task_type: xuiSyncTaskService.TASK_TYPES.ENABLE_SYNC,
      payload_data: { disable: false }
    });

    assert.equal(result.success, true);
    assert.match(result.message, /已禁用/);
    return { processed: 1, success: 1, failed: 0, finalFailed: 0 };
  };
  trafficManager.syncDisableStatusToXui = async () => {
    statusSyncCount += 1;
    return true;
  };

  const db = {
    prepare(sql) {
      if (sql.includes('FROM users')) {
        return {
          get(userId) {
            assert.equal(userId, 31);
            return {
              id: 31,
              email: 'still-disabled@example.com',
              enabled: 0,
              traffic_limit: 4096,
              expire_at: 1700000000
            };
          }
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  try {
    await syncHandler.runXuiSyncTasks(db);
    assert.equal(statusSyncCount, 0);
  } finally {
    Object.assign(xuiSyncTaskService, originalXuiSyncTaskService);
    Object.assign(trafficManager, originalTrafficManager);
  }
});
