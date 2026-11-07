/**
 * 首页套餐推广可见性回归测试。
 * 职责：验证仓储筛选、推广码校验和控制器参数透传，隔离真实数据库与 HTTP 服务。
 * 核心分支：仅启用推广码扩展首页可见性，其余输入保持普通首页和原响应结构。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const planRepository = require('../repositories/plan-repository');
const referralRepository = require('../repositories/referral-repository');
const plansService = require('../services/user/plans-service');
const plansController = require('../controllers/user/plans-controller');

// 普通首页必须只筛选普通开关；推广首页通过单次 OR 查询覆盖两类可见套餐。
for (const includeReferralHome of [false, true]) {
  test(`home plan repository visibility mode ${includeReferralHome} uses one query`, async () => {
    const queries = [];
    const db = {
      prepare(sql) {
        queries.push(sql.replace(/\s+/g, ' ').trim());
        return { all: async () => [] };
      }
    };

    await planRepository.findEnabledPlans(db, includeReferralHome);

    assert.equal(queries.length, 1);
    const [sql] = queries;
    assert.match(sql, /SELECT .*show_on_referral_home.* FROM plans/);
    assert.match(sql, /WHERE enabled = 1 AND /);
    assert.match(sql, /ORDER BY sort_order ASC, id ASC$/);
    if (includeReferralHome) {
      assert.match(sql, /AND \(show_on_home = 1 OR show_on_referral_home = 1\)/);
    } else {
      assert.match(sql, /AND show_on_home = 1 ORDER BY/);
      assert.doesNotMatch(sql.split('WHERE')[1], /show_on_referral_home/);
    }
  });
}

// 推广码仓储只返回启用记录；不存在和禁用码均不能使首页扩展可见性。
for (const scenario of [
  { name: 'enabled', input: '  VALID  ', normalized: 'VALID', record: { id: 1, code: 'VALID', enabled: 1 }, expected: true },
  { name: 'missing', input: 'UNKNOWN', normalized: 'UNKNOWN', record: undefined, expected: false },
  { name: 'disabled', input: 'DISABLED', normalized: 'DISABLED', record: undefined, expected: false },
  { name: '64 characters', input: 'a'.repeat(64), normalized: 'a'.repeat(64), record: { id: 2, enabled: 1 }, expected: true },
  { name: 'numeric input', input: 123, normalized: '123', record: { id: 3, enabled: 1 }, expected: true }
]) {
  test(`home plan service validates ${scenario.name} referral code before choosing visibility`, async (t) => {
    const db = {};
    const referralCalls = [];
    const planCalls = [];
    t.mock.method(referralRepository, 'findEnabledReferralCode', async (...args) => {
      referralCalls.push(args);
      return scenario.record;
    });
    t.mock.method(planRepository, 'findEnabledPlans', async (...args) => {
      planCalls.push(args);
      return [];
    });

    assert.deepEqual(await plansService.listAvailablePlans(db, scenario.input), []);
    assert.deepEqual(referralCalls, [[db, scenario.normalized]]);
    assert.deepEqual(planCalls, [[db, scenario.expected]]);
  });
}

// 缺失、空白和超长 ref 直接降级，不执行推广码数据库查询。
for (const scenario of [
  { name: 'missing', input: undefined },
  { name: 'null', input: null },
  { name: 'empty', input: '' },
  { name: 'whitespace', input: ' \t\n ' },
  { name: '65 characters', input: 'a'.repeat(65) }
]) {
  test(`home plan service skips referral lookup for ${scenario.name} input`, async (t) => {
    const db = {};
    const planCalls = [];
    const lookup = t.mock.method(referralRepository, 'findEnabledReferralCode', async () => undefined);
    t.mock.method(planRepository, 'findEnabledPlans', async (...args) => {
      planCalls.push(args);
      return [];
    });

    assert.deepEqual(await plansService.listAvailablePlans(db, scenario.input), []);
    assert.equal(lookup.mock.callCount(), 0);
    assert.deepEqual(planCalls, [[db, false]]);
  });
}

test('disabled referral code lookup remains restricted to enabled records', async () => {
  const db = {
    prepare(sql) {
      assert.match(sql, /WHERE rc\.code = \? AND rc\.enabled = 1/);
      return {
        get(code) {
          assert.equal(code, 'DISABLED');
          return undefined;
        }
      };
    }
  };

  assert.equal(await referralRepository.findEnabledReferralCode(db, 'DISABLED'), undefined);
});

test('home plan service formats referral flags while preserving order and current sales calculations', async (t) => {
  const plans = [
    { id: 8, name: '推广家宽', price: 990, duration_days: 30, traffic_limit: 0, plan_type: 'home_ip', show_on_home: 0, show_on_referral_home: '1', sort_order: 1, sales_limit: '2', sales_count: 99 },
    { id: 3, name: '普通流量', price: 1990, duration_days: 0, traffic_limit: 1024, plan_type: 'lifetime', show_on_home: 1, show_on_referral_home: '0', sort_order: 2, sales_limit: '-1', sales_count: 99 },
    { id: 9, name: '历史套餐', price: 2990, duration_days: 30, traffic_limit: 2048, plan_type: 'timed', sort_order: 3, sales_limit: '1', sales_count: 99 }
  ];
  t.mock.method(planRepository, 'findEnabledPlans', async () => plans);
  const db = {
    prepare(sql) {
      assert.match(sql, /FROM users/);
      return {
        all() {
          return sql.includes('GROUP BY home_plan_id')
            ? [{ plan_id: 8, count: '2' }]
            : [{ plan_id: 3, count: '5' }];
        }
      };
    }
  };

  const result = await plansService.listAvailablePlans(db);
  assert.deepEqual(result.map(plan => plan.id), [8, 3, 9]);
  assert.deepEqual(result.map(plan => plan.show_on_referral_home), [1, 0, 0]);
  assert.deepEqual(result.map(plan => plan.show_on_home), [0, 1, 1]);
  assert.deepEqual(result.map(plan => plan.sort_order), [1, 2, 3]);
  assert.deepEqual(result.map(plan => plan.sales_count), [2, 5, 0]);
  assert.deepEqual(result.map(plan => plan.is_soldout), [true, false, false]);
  assert.deepEqual(result.map(plan => plan.price_text), ['9.90', '19.90', '29.90']);
  assert.equal(result[0].traffic_text, '不限制流量');
});

// 控制器不得预处理 ref；保留缺失时 undefined 及旧版 { code, message, data: { plans } } 响应。
for (const query of [{ ref: '  VALID  ' }, {}]) {
  test(`home plan controller forwards current query ref ${String(query.ref)} unchanged`, async (t) => {
    const db = {};
    const plans = [{ id: 7, show_on_referral_home: 1 }];
    const calls = [];
    t.mock.method(plansService, 'listAvailablePlans', async (...args) => {
      calls.push(args);
      return plans;
    });
    let status;
    const res = {
      status(value) {
        status = value;
        return this;
      },
      json: body => body
    };

    const result = await plansController.getPlans({ app: { locals: { db } }, query }, res);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].length, 2);
    assert.strictEqual(calls[0][0], db);
    assert.strictEqual(calls[0][1], query.ref);
    assert.equal(status, 200);
    assert.deepEqual(result, { code: 0, message: 'ok', data: { plans } });
  });
}
