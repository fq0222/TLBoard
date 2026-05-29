/**
 * 管理端工单服务
 * 负责编排管理端 tickets 的列表、详情、回复、关闭和删除业务。
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
 * 校验工单是否仍可回复或关闭。
 *
 * @param {Object} ticket - 工单记录
 * @returns {void}
 */
function ensureTicketIsOpen(ticket) {
  if (ticket.status === 'closed') {
    throw createLegacyServiceError(400, 1001, '工单已关闭');
  }
}

/**
 * 获取工单统计数据。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Object>} 工单统计
 */
async function getStats(db) {
  return ticketService.getTicketStats(db);
}

/**
 * 获取管理端工单分页列表。
 *
 * @param {Object} db - 数据库实例
 * @param {{page: number, limit: number, status: string|null, keyword: string|null}} query - 查询参数
 * @returns {Promise<Object>} 兼容旧接口的分页结果
 */
async function listTickets(db, query) {
  const { page, limit } = query;
  const result = await ticketService.getAdminTickets(db, query);

  return {
    total: result.total,
    page,
    limit,
    list: result.list
  };
}

/**
 * 获取工单详情。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单 ID
 * @returns {Promise<Object>} 工单详情
 */
async function getTicketDetail(db, ticketId) {
  const ticket = await ticketService.getTicketDetail(db, ticketId);
  return ensureTicketExists(ticket);
}

/**
 * 管理员回复工单。
 * 管理员回复会保持旧语义，将工单状态流转为 pending。
 *
 * @param {Object} db - 数据库实例
 * @param {number} adminId - 管理员 ID
 * @param {number} ticketId - 工单 ID
 * @param {string} content - 回复内容
 * @returns {Promise<Object>} 新建回复
 */
async function addReply(db, adminId, ticketId, content) {
  const ticket = ensureTicketExists(await ticketService.getTicketById(db, ticketId));

  if (ticket.status === 'closed') {
    throw createLegacyServiceError(400, 1001, '工单已关闭，无法回复');
  }

  return ticketService.addReply(db, ticketId, null, adminId, content);
}

/**
 * 管理员关闭工单。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单 ID
 * @returns {Promise<{message: string}>} 关闭结果
 */
async function closeTicket(db, ticketId) {
  const ticket = ensureTicketExists(await ticketService.getTicketById(db, ticketId));
  ensureTicketIsOpen(ticket);

  await ticketService.closeTicket(db, ticketId);

  return { message: '工单已关闭' };
}

/**
 * 管理员删除工单。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单 ID
 * @returns {Promise<{message: string}>} 删除结果
 */
async function deleteTicket(db, ticketId) {
  ensureTicketExists(await ticketService.getTicketById(db, ticketId));

  await ticketService.deleteTicket(db, ticketId);

  return { message: '工单已删除' };
}

module.exports = {
  getStats,
  listTickets,
  getTicketDetail,
  addReply,
  closeTicket,
  deleteTicket
};
