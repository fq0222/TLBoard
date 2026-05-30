const vmqService = require('../vmq-service');
const { completePaidOrder } = require('../order-service');
const { parsePagination } = require('../../shared/utils/pagination');
const orderRepository = require('../../repositories/order-repository');

/**
 * 用户端订单服务。
 * 负责订单列表、订单状态轮询与 VMQ 状态同步编排，
 * 保留支付完成后的共享激活逻辑在 order-service 中处理。
 */

/**
 * 构造兼容旧接口错误结构的业务异常。
 *
 * @param {string} message - 错误消息
 * @param {Object} [options] - 扩展错误配置
 * @returns {Error} 兼容旧接口的业务异常
 */
function createLegacyBusinessError(message, options = {}) {
  const error = new Error(message);
  error.isLegacyBusinessError = true;
  error.statusCode = options.statusCode || 400;
  error.code = options.code || 1001;
  error.data = options.data === undefined ? null : options.data;
  return error;
}

/**
 * 将订单状态转换为兼容旧前端展示的中文文案。
 *
 * @param {string} status - 订单状态值
 * @returns {string} 状态文案
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
 * 查询用户订单分页列表并组装旧接口响应结构。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 当前用户 ID
 * @param {Object} query - 路由查询参数
 * @returns {Promise<Object>} 订单列表分页结果
 */
async function listOrders(db, userId, query) {
  const { page, limit, offset } = parsePagination(query, {
    defaultPage: 1,
    defaultLimit: 20,
    maxLimit: 100
  });
  const totalRow = await orderRepository.countUserOrders(db, userId, query.status);
  const orders = await orderRepository.listUserOrders(db, {
    userId,
    status: query.status,
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

/**
 * 查询公共订单状态，必要时触发 VMQ 状态同步。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} orderIdentifier - 订单 ID 或订单号
 * @param {Object|null} currentUser - 当前登录用户，未登录时为空
 * @returns {Promise<Object>} 兼容旧接口的订单状态结果
 */
async function getPublicOrderStatus(db, orderIdentifier, currentUser) {
  const isNumericId = /^\d+$/.test(orderIdentifier);

  if (isNumericId && !currentUser) {
    throw createLegacyBusinessError('未登录 / Token 无效', {
      statusCode: 401,
      code: 1002
    });
  }

  const order = isNumericId
    ? await orderRepository.findUserOrderById(db, Number(orderIdentifier), currentUser.id)
    : await orderRepository.findPublicOrderByOutTradeNo(db, orderIdentifier);

  if (!order) {
    throw createLegacyBusinessError('订单不存在', {
      code: 2004
    });
  }

  const status = await syncOrderStatusIfNeeded(db, order);
  return buildStatusResponse(order, status);
}

/**
 * 查询当前用户自己的订单状态，必要时触发 VMQ 状态同步。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 当前用户 ID
 * @param {string} orderIdentifier - 订单 ID 或订单号
 * @returns {Promise<Object>} 兼容旧接口的订单状态结果
 */
async function getUserOrderStatus(db, userId, orderIdentifier) {
  const isNumericId = /^\d+$/.test(orderIdentifier);
  const order = isNumericId
    ? await orderRepository.findUserOrderById(db, Number(orderIdentifier), userId)
    : await orderRepository.findUserOrderByOutTradeNo(db, orderIdentifier, userId);

  if (!order) {
    throw createLegacyBusinessError('订单不存在', {
      code: 2004
    });
  }

  const status = await syncOrderStatusIfNeeded(db, order);
  return buildStatusResponse(order, status);
}

/**
 * 构造旧接口约定的订单状态响应结构。
 *
 * @param {Object} order - 订单记录
 * @param {string} status - 当前订单状态
 * @returns {Object} 订单状态响应
 */
function buildStatusResponse(order, status) {
  return {
    order_id: order.id,
    out_trade_no: order.out_trade_no,
    vmq_order_id: order.trade_no,
    status,
    payment_url: order.payment_url
  };
}

/**
 * 对待支付订单执行 VMQ 状态轮询，并在支付成功或超时后同步本地状态。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} order - 订单记录
 * @returns {Promise<string>} 同步后的订单状态
 */
async function syncOrderStatusIfNeeded(db, order) {
  if (order.status !== 'pending' || !order.trade_no) {
    return order.status;
  }

  try {
    const vmqResult = await vmqService.checkOrder(order.trade_no);
    if (Number(vmqResult.code) === 1) {
      await completePaidOrder(db, order.out_trade_no, order.trade_no);
      return 'paid';
    }

    const vmqOrder = await vmqService.getOrder(order.trade_no);
    if (Number(vmqOrder.code) === 1 && vmqOrder.data && Number(vmqOrder.data.state) === -1) {
      await orderRepository.markPendingOrderExpiredById(db, order.id);
      return 'expired';
    }
  } catch (error) {
    return order.status;
  }

  return order.status;
}

module.exports = {
  listOrders,
  getPublicOrderStatus,
  getUserOrderStatus
};
