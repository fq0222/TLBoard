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
