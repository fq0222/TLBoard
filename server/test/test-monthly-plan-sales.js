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
