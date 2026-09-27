/**
 * 管理端订单汇总测试。
 * 职责：验证订单列表接口返回当前时间范围的统计汇总，避免前端错误使用当前分页数据。
 * 关键场景：总金额和 ORD/REN 数量复用列表的起止日期，但不受分页影响。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const ordersService = require('../services/admin/orders-service');
const orderRepository = require('../repositories/order-repository');

test('admin orders service summarizes all orders inside the selected date range', async () => {
  const originalCountAdminOrders = orderRepository.countAdminOrders;
  const originalListAdminOrders = orderRepository.listAdminOrders;
  const originalSummarizeAdminOrders = orderRepository.summarizeAdminOrders;

  orderRepository.countAdminOrders = async () => ({ total: 2 });
  orderRepository.listAdminOrders = async () => ([
    {
      id: 2,
      out_trade_no: 'REN20240630001',
      email: 'user@example.com',
      user_id: 7,
      plan_name: '续费套餐',
      amount: 2500,
      status: 'paid',
      paid_at: 1719734400,
      created_at: 1719734300
    },
    {
      id: 1,
      out_trade_no: 'ORD20240630001',
      email: 'user@example.com',
      user_id: 7,
      plan_name: '新购套餐',
      amount: 1000,
      status: 'pending',
      paid_at: null,
      created_at: 1719734200
    }
  ]);
  let summaryFilters;
  orderRepository.summarizeAdminOrders = async (db, filters) => {
    summaryFilters = filters;
    return {
      total_amount: 3500,
      ord_count: 1,
      ren_count: 1
    };
  };

  try {
    const result = await ordersService.listOrders({}, {
      page: 1,
      limit: 15,
      email: 'user@example.com',
      start_date: '2026-09-01',
      end_date: '2026-09-30'
    });

    assert.equal(result.total, 2);
    assert.deepEqual(result.summary, {
      total_amount: '35.00',
      ord_count: 1,
      ren_count: 1
    });
    assert.deepEqual(summaryFilters, {
      startDate: '2026-09-01',
      endDate: '2026-09-30'
    });
  } finally {
    orderRepository.countAdminOrders = originalCountAdminOrders;
    orderRepository.listAdminOrders = originalListAdminOrders;
    orderRepository.summarizeAdminOrders = originalSummarizeAdminOrders;
  }
});

test('admin order repository applies the date range to summary SQL', async () => {
  let capturedSql;
  let capturedParams;
  const db = {
    prepare(sql) {
      capturedSql = sql;
      return {
        async get(...params) {
          capturedParams = params;
          return { total_amount: 0, ord_count: 0, ren_count: 0 };
        }
      };
    }
  };

  await orderRepository.summarizeAdminOrders(db, {
    startDate: '2026-09-01',
    endDate: '2026-09-30'
  });

  assert.match(capturedSql, /FROM orders o\s+WHERE 1=1/);
  assert.match(capturedSql, /o\.created_at >= \?/);
  assert.match(capturedSql, /o\.created_at < \?/);
  assert.deepEqual(capturedParams, [1788192000, 1790784000]);
});
