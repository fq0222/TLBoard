/**
 * 管理端订单号筛选测试。
 * 职责：通过真实服务和仓储验证包含搜索、组合筛选和参数校验，无需数据库或登录。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { validationResult } = require('express-validator');
const ordersService = require('../services/admin/orders-service');
const ordersRouter = require('../routes/admin/orders');

test('订单号包含搜索同时用于总数和分页，并与已有条件组合', async () => {
  const calls = [];
  const db = {
    /** 记录真实仓储发出的 SQL，查询结果使用不依赖数据库的空列表。 */
    prepare(sql) {
      return {
        /** 记录统计查询及绑定参数；金额汇总继续仅按日期筛选。 */
        async get(...params) {
          calls.push({ sql, params });
          return { total: 0, total_amount: 0, ord_count: 0, ren_count: 0 };
        },
        /** 记录分页查询及绑定参数，返回空列表以隔离外部数据库。 */
        async all(...params) {
          calls.push({ sql, params });
          return [];
        }
      };
    }
  };
  await ordersService.listOrders(db, {
    page: 2, limit: 15, order_no: 'REN202610', email: 'user@example.com',
    status: 'paid', start_date: '2026-09-01', end_date: '2026-09-30'
  });

  assert.equal(calls.length, 3);
  for (const call of calls.slice(0, 2)) {
    assert.match(call.sql, /o\.out_trade_no LIKE \?/);
    assert.match(call.sql, /o\.email LIKE \?/);
    assert.match(call.sql, /o\.status = \?/);
    assert.match(call.sql, /o\.created_at >= \?/);
    assert.match(call.sql, /o\.created_at < \?/);
    assert.ok(!call.sql.includes('REN202610'), '搜索值必须绑定参数而非拼接 SQL');
    assert.ok(call.params.includes('%REN202610%'));
    assert.ok(call.params.includes('%user@example.com%'));
  }
  assert.deepEqual(calls[1].params, [...calls[0].params, 15, 15]);
  assert.ok(!calls[2].sql.includes('o.out_trade_no LIKE ?'), '金额汇总保持仅按日期筛选');
  assert.deepEqual(calls[2].params, [1788192000, 1790784000]);
});

for (const orderNo of [undefined, '']) {
  test(`未提供有效订单号时不增加订单号条件：${String(orderNo)}`, async () => {
    const calls = [];
    const db = {
      /** 捕获没有订单号时的统计和分页 SQL。 */
      prepare(sql) {
        return {
          /** 记录统计查询并返回默认值。 */
          async get(...params) { calls.push({ sql, params }); return { total: 0 }; },
          /** 记录分页查询并返回空列表。 */
          async all(...params) { calls.push({ sql, params }); return []; }
        };
      }
    };
    await ordersService.listOrders(db, { order_no: orderNo });
    assert.ok(calls.every(call => !call.sql.includes('o.out_trade_no LIKE ?')));
    assert.deepEqual(calls[0].params, []);
    assert.deepEqual(calls[1].params, [10, 0]);
  });
}

for (const [value, valid] of [[undefined, true], ['', true], ['ORD202610', true], [['ORD1', 'REN2'], false], [{ value: 'ORD1' }, false]]) {
  test(`订单号仅允许可选字符串：${JSON.stringify(value)}`, async () => {
    const req = { query: value === undefined ? {} : { order_no: value } };
    const route = ordersRouter.stack.find(layer => layer.route?.path === '/').route;
    for (const layer of route.stack) {
      if (typeof layer.handle.run === 'function') await layer.handle.run(req);
    }
    assert.equal(validationResult(req).isEmpty(), valid);
  });
}
