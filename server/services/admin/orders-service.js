const { parsePagination } = require('../../shared/utils/pagination');
const orderRepository = require('../../repositories/order-repository');

/**
 * 管理端订单服务。
 * 负责订单列表筛选、分页与旧响应结构兼容数据编排，
 * 保持管理端现有查询语义不变。
 */

function getStatusText(status) {
  const statusMap = {
    pending: '待支付',
    paid: '已支付',
    expired: '已过期'
  };
  return statusMap[status] || status;
}

/**
 * 查询管理端订单分页列表并保留旧接口字段结构。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} query - 路由查询参数
 * @returns {Promise<Object>} 订单分页结果
 */
async function listOrders(db, query) {
  const { page, limit, offset } = parsePagination(query, {
    defaultPage: 1,
    defaultLimit: 10,
    maxLimit: 100
  });
  const filters = {
    status: query.status,
    email: query.email,
    startDate: query.start_date,
    endDate: query.end_date
  };
  const totalRow = await orderRepository.countAdminOrders(db, filters);
  const orders = await orderRepository.listAdminOrders(db, {
    filters,
    limit,
    offset
  });

  return {
    total: Number(totalRow.total) || 0,
    page,
    limit,
    list: orders.map((order) => ({
      id: order.id,
      out_trade_no: order.out_trade_no,
      email: order.email,
      user_id: order.user_id,
      plan_name: order.plan_name,
      amount: order.amount,
      amount_text: (Number(order.amount) / 100).toFixed(2),
      status: order.status,
      status_text: getStatusText(order.status),
      paid_at: order.paid_at,
      created_at: order.created_at
    }))
  };
}

module.exports = {
  listOrders
};
