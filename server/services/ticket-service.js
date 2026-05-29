/**
 * 工单服务兼容层
 * 保留历史导出接口，内部改为复用 repository，避免旧 service 继续承载大而全职责。
 */

const ticketRepository = require('../repositories/ticket-repository');

/**
 * 查询工单基础记录，供上下文 service 复用权限和状态校验。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单 ID
 * @returns {Promise<Object|null>} 工单基础记录
 */
async function getTicketById(db, ticketId) {
  return ticketRepository.findTicketById(db, ticketId);
}

/**
 * 组装旧接口需要的工单详情结构。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单 ID
 * @returns {Promise<Object|null>} 含用户与回复的工单详情
 */
async function getTicketDetail(db, ticketId) {
  const ticket = await getTicketById(db, ticketId);

  if (!ticket) {
    return null;
  }

  const [user, replies] = await Promise.all([
    ticketRepository.findTicketUserById(db, ticket.user_id),
    ticketRepository.findRepliesByTicketId(db, ticketId)
  ]);

  return { ...ticket, user, replies };
}

/**
 * 创建工单。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {string} title - 工单标题
 * @param {string} description - 工单描述
 * @returns {Promise<Object>} 新建工单
 */
async function createTicket(db, userId, title, description) {
  return ticketRepository.createTicket(db, userId, title, description);
}

/**
 * 查询用户工单分页列表。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {number} page - 页码
 * @param {number} limit - 每页条数
 * @returns {Promise<{total: number, list: Array}>} 分页结果
 */
async function getUserTickets(db, userId, page = 1, limit = 10) {
  const offset = (page - 1) * limit;
  const [total, list] = await Promise.all([
    ticketRepository.countUserTickets(db, userId),
    ticketRepository.listUserTickets(db, userId, limit, offset)
  ]);

  return { total, list };
}

/**
 * 新增工单回复，并按回复方更新工单状态。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单 ID
 * @param {number|null} userId - 用户 ID
 * @param {number|null} adminId - 管理员 ID
 * @param {string} content - 回复内容
 * @returns {Promise<Object>} 新建回复
 */
async function addReply(db, ticketId, userId, adminId, content) {
  return ticketRepository.addReplyAndSyncTicket(db, ticketId, userId, adminId, content);
}

/**
 * 关闭工单。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单 ID
 * @returns {Promise<boolean>} 是否成功
 */
async function closeTicket(db, ticketId) {
  await ticketRepository.closeTicketById(db, ticketId);
  return true;
}

/**
 * 删除工单及其关联数据。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单 ID
 * @returns {Promise<boolean>} 是否成功
 */
async function deleteTicket(db, ticketId) {
  await ticketRepository.deleteTicketCascade(db, ticketId);
  return true;
}

/**
 * 更新用户已读时间。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单 ID
 * @param {number} userId - 用户 ID
 * @returns {Promise<void>}
 */
async function updateReadTime(db, ticketId, userId, readThroughTime) {
  await ticketRepository.markTicketAsRead(db, ticketId, userId, readThroughTime);
}

/**
 * 获取用户未读工单数量。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @returns {Promise<number>} 未读数量
 */
async function getUnreadCount(db, userId) {
  return ticketRepository.countUnreadTickets(db, userId);
}

/**
 * 获取工单统计。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Object>} 统计结果
 */
async function getTicketStats(db) {
  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const [openCount, pendingCount, todayCount] = await Promise.all([
    ticketRepository.countTicketsByStatus(db, 'open'),
    ticketRepository.countTicketsByStatus(db, 'pending'),
    ticketRepository.countTicketsCreatedAfter(db, todayStart)
  ]);

  return {
    open_count: openCount,
    pending_count: pendingCount,
    today_count: todayCount
  };
}

/**
 * 获取管理端工单分页列表。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} params - 查询参数
 * @returns {Promise<{total: number, list: Array}>} 分页结果
 */
async function getAdminTickets(db, params = {}) {
  const { page = 1, limit = 10, status = null, keyword = null } = params;
  const offset = (page - 1) * limit;
  const filters = { status, keyword };
  const [total, list] = await Promise.all([
    ticketRepository.countAdminTickets(db, filters),
    ticketRepository.listAdminTickets(db, filters, limit, offset)
  ]);

  return { total, list };
}

module.exports = {
  getTicketById,
  createTicket,
  getUserTickets,
  getTicketDetail,
  addReply,
  closeTicket,
  deleteTicket,
  updateReadTime,
  getUnreadCount,
  getTicketStats,
  getAdminTickets
};
