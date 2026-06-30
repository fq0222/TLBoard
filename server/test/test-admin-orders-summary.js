/**
 * 管理端订单汇总测试。
 * 职责：验证订单列表接口返回全局统计汇总，避免前端错误使用当前分页数据。
 * 关键场景：总金额为所有订单金额之和，ORD/REN 数量按订单号前缀统计。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const ordersService = require('../services/admin/orders-service');
const orderRepository = require('../repositories/order-repository');

test('admin orders service returns global summary with list data', async () => {
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
  orderRepository.summarizeAdminOrders = async () => ({
    total_amount: 3500,
    ord_count: 1,
    ren_count: 1
  });

  try {
    const result = await ordersService.listOrders({}, {
      page: 1,
      limit: 15,
      email: 'user@example.com'
    });

    assert.equal(result.total, 2);
    assert.deepEqual(result.summary, {
      total_amount: '35.00',
      ord_count: 1,
      ren_count: 1
    });
  } finally {
    orderRepository.countAdminOrders = originalCountAdminOrders;
    orderRepository.listAdminOrders = originalListAdminOrders;
    orderRepository.summarizeAdminOrders = originalSummarizeAdminOrders;
  }
});
