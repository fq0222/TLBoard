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
