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
