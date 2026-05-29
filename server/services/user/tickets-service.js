/**
 * 用户端工单服务
 * 负责编排用户侧 tickets 的权限、分页、已读同步和状态校验。
 */
const ticketService = require('../ticket-service');

/**
 * 构造旧接口兼容的业务错误。
 *
 * @param {number} statusCode - HTTP 状态码
 * @param {number} code - 旧接口业务码
 * @param {string} message - 旧接口错误消息
 * @returns {Error} 携带兼容响应元信息的异常对象
 */
function createLegacyServiceError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.expose = true;
  return error;
}

/**
 * 校验工单是否存在。
 *
 * @param {Object|null} ticket - 工单记录
 * @returns {Object} 已校验的工单记录
 */
function ensureTicketExists(ticket) {
  if (!ticket) {
    throw createLegacyServiceError(400, 1001, '工单不存在');
  }

  return ticket;
}

/**
 * 校验工单归属是否属于当前用户。
 *
 * @param {Object} ticket - 工单记录
 * @param {number} userId - 当前用户 ID
 * @returns {Object} 已校验的工单记录
 */
function ensureTicketOwner(ticket, userId) {
  if (ticket.user_id !== userId) {
    throw createLegacyServiceError(403, 1004, '无权限访问');
  }

  return ticket;
}

/**
 * 获取用户未读工单数量。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @returns {Promise<{count: number}>} 未读数量结果
 */
async function getUnreadCount(db, userId) {
  const count = await ticketService.getUnreadCount(db, userId);
  return { count };
}

/**
 * 获取用户工单分页列表。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {{page: number, limit: number}} pagination - 分页参数
 * @returns {Promise<Object>} 兼容旧接口的分页结果
 */
async function listTickets(db, userId, pagination) {
  const { page, limit } = pagination;
  const result = await ticketService.getUserTickets(db, userId, page, limit);

  return {
    total: result.total,
    page,
    limit,
    list: result.list
  };
}

/**
 * 创建用户工单。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {{title: string, description: string}} payload - 工单内容
 * @returns {Promise<Object>} 新建工单
 */
async function createTicket(db, userId, payload) {
  return ticketService.createTicket(db, userId, payload.title, payload.description);
}

/**
 * 获取用户可访问的工单详情，并在返回前同步已读时间。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {number} ticketId - 工单 ID
 * @returns {Promise<Object>} 工单详情
 */
async function getTicketDetail(db, userId, ticketId) {
  const ticket = ensureTicketOwner(
    ensureTicketExists(await ticketService.getTicketDetail(db, ticketId)),
    userId
  );

  await ticketService.updateReadTime(db, ticketId, userId, ticket.last_reply_at);

  return ticket;
}

/**
 * 用户回复自己的工单。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {number} ticketId - 工单 ID
 * @param {string} content - 回复内容
 * @returns {Promise<Object>} 新建回复
 */
async function addReply(db, userId, ticketId, content) {
  const ticket = ensureTicketOwner(
    ensureTicketExists(await ticketService.getTicketById(db, ticketId)),
    userId
  );

  if (ticket.status === 'closed') {
    throw createLegacyServiceError(400, 1001, '工单已关闭，无法回复');
  }

  return ticketService.addReply(db, ticketId, userId, null, content);
}

/**
 * 用户关闭自己的工单。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {number} ticketId - 工单 ID
 * @returns {Promise<{message: string}>} 关闭结果
 */
async function closeTicket(db, userId, ticketId) {
  const ticket = ensureTicketOwner(
    ensureTicketExists(await ticketService.getTicketById(db, ticketId)),
    userId
  );

  if (ticket.status === 'closed') {
    throw createLegacyServiceError(400, 1001, '工单已关闭');
  }

  await ticketService.closeTicket(db, ticketId);

  return { message: '工单已关闭' };
}

module.exports = {
  getUnreadCount,
  listTickets,
  createTicket,
  getTicketDetail,
  addReply,
  closeTicket
};
