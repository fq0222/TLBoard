/**
 * 工单服务封装
 * 处理工单相关业务逻辑
 */

const { createLogger } = require('../utils/logger');

const logger = createLogger('TICKET-SERVICE');

/**
 * 创建工单
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户ID
 * @param {string} title - 工单标题
 * @param {string} description - 工单描述
 * @returns {Promise<Object>} 创建的工单
 */
async function createTicket(db, userId, title, description) {
  const result = await db.prepare(`
    INSERT INTO tickets (user_id, title, description, status, created_at, updated_at)
    VALUES (?, ?, ?, 'open', EXTRACT(EPOCH FROM NOW()), EXTRACT(EPOCH FROM NOW()))
  `).run(userId, title, description);

  const ticket = await db.prepare('SELECT * FROM tickets WHERE id = ?').get(result.lastInsertRowid);
  return ticket;
}

/**
 * 获取用户工单列表
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户ID
 * @param {number} page - 页码
 * @param {number} limit - 每页条数
 * @returns {Promise<Object>} 工单列表和总数
 */
async function getUserTickets(db, userId, page = 1, limit = 10) {
  const offset = (page - 1) * limit;

  const total = (await db.prepare(
    'SELECT COUNT(*) as count FROM tickets WHERE user_id = ?'
  ).get(userId)).count;

  const tickets = await db.prepare(`
    SELECT *,
      CASE 
        WHEN last_reply_at IS NULL THEN 0
        WHEN last_read_at IS NULL AND last_reply_at IS NOT NULL THEN 1
        WHEN last_reply_at > last_read_at THEN 1
        ELSE 0
      END as is_unread
    FROM tickets 
    WHERE user_id = ? 
    ORDER BY created_at DESC 
    LIMIT ? OFFSET ?
  `).all(userId, limit, offset);

  return { total, list: tickets };
}

/**
 * 获取工单详情（含回复）
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单ID
 * @returns {Promise<Object>} 工单详情
 */
async function getTicketDetail(db, ticketId) {
  const ticket = await db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
  
  if (!ticket) {
    return null;
  }

  const replies = await db.prepare(`
    SELECT 
      tr.*,
      CASE 
        WHEN tr.user_id IS NOT NULL THEN u.email
        WHEN tr.admin_id IS NOT NULL THEN a.username
      END as reply_name
    FROM ticket_replies tr
    LEFT JOIN users u ON tr.user_id = u.id
    LEFT JOIN admins a ON tr.admin_id = a.id
    WHERE tr.ticket_id = ?
    ORDER BY tr.created_at ASC
  `).all(ticketId);

  // 获取用户信息
  const user = await db.prepare('SELECT id, email FROM users WHERE id = ?').get(ticket.user_id);

  return { ...ticket, user, replies };
}

/**
 * 回复工单
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单ID
 * @param {number|null} userId - 用户ID（用户回复时）
 * @param {number|null} adminId - 管理员ID（管理员回复时）
 * @param {string} content - 回复内容
 * @returns {Promise<Object>} 创建的回复
 */
async function addReply(db, ticketId, userId, adminId, content) {
  const result = await db.prepare(`
    INSERT INTO ticket_replies (ticket_id, user_id, admin_id, content, created_at)
    VALUES (?, ?, ?, ?, EXTRACT(EPOCH FROM NOW()))
  `).run(ticketId, userId, adminId, content);

  // 更新工单状态和回复数
  if (adminId) {
    // 管理员回复，状态改为 pending
    await db.prepare(`
      UPDATE tickets 
      SET status = 'pending', reply_count = reply_count + 1, 
          last_reply_at = EXTRACT(EPOCH FROM NOW()), 
          updated_at = EXTRACT(EPOCH FROM NOW())
      WHERE id = ?
    `).run(ticketId);
  } else {
    // 用户回复，更新回复数
    await db.prepare(`
      UPDATE tickets 
      SET reply_count = reply_count + 1, 
          last_reply_at = EXTRACT(EPOCH FROM NOW()), 
          updated_at = EXTRACT(EPOCH FROM NOW())
      WHERE id = ?
    `).run(ticketId);
  }

  const reply = await db.prepare('SELECT * FROM ticket_replies WHERE id = ?').get(result.lastInsertRowid);
  return reply;
}

/**
 * 关闭工单
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单ID
 * @returns {Promise<boolean>} 是否成功
 */
async function closeTicket(db, ticketId) {
  await db.prepare(`
    UPDATE tickets 
    SET status = 'closed', closed_at = EXTRACT(EPOCH FROM NOW()), updated_at = EXTRACT(EPOCH FROM NOW())
    WHERE id = ?
  `).run(ticketId);
  return true;
}

/**
 * 删除工单
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单ID
 * @returns {Promise<boolean>} 是否成功
 */
async function deleteTicket(db, ticketId) {
  await db.prepare('DELETE FROM ticket_replies WHERE ticket_id = ?').run(ticketId);
  await db.prepare('DELETE FROM ticket_reads WHERE ticket_id = ?').run(ticketId);
  await db.prepare('DELETE FROM tickets WHERE id = ?').run(ticketId);
  return true;
}

/**
 * 更新用户已读时间
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单ID
 * @param {number} userId - 用户ID
 */
async function updateReadTime(db, ticketId, userId) {
  await db.prepare(`
    INSERT INTO ticket_reads (ticket_id, user_id, last_read_at)
    VALUES (?, ?, EXTRACT(EPOCH FROM NOW()))
    ON CONFLICT (ticket_id, user_id) 
    DO UPDATE SET last_read_at = EXTRACT(EPOCH FROM NOW())
  `).run(ticketId, userId);

  // 同步更新 tickets 表的 last_read_at
  await db.prepare(`
    UPDATE tickets SET last_read_at = EXTRACT(EPOCH FROM NOW()) WHERE id = ?
  `).run(ticketId);
}

/**
 * 获取未读工单数量
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户ID
 * @returns {Promise<number>} 未读数量
 */
async function getUnreadCount(db, userId) {
  const result = await db.prepare(`
    SELECT COUNT(*) as count FROM tickets t
    WHERE t.user_id = ? 
      AND t.status IN ('open', 'pending')
      AND t.last_reply_at IS NOT NULL
      AND (t.last_read_at IS NULL OR t.last_reply_at > t.last_read_at)
  `).get(userId);
  return result.count;
}

/**
 * 获取工单统计（管理端）
 * @param {Object} db - 数据库实例
 * @returns {Promise<Object>} 统计数据
 */
async function getTicketStats(db) {
  const openCount = (await db.prepare(
    "SELECT COUNT(*) as count FROM tickets WHERE status = 'open'"
  ).get()).count;

  const pendingCount = (await db.prepare(
    "SELECT COUNT(*) as count FROM tickets WHERE status = 'pending'"
  ).get()).count;

  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const todayCount = (await db.prepare(
    "SELECT COUNT(*) as count FROM tickets WHERE created_at >= ?"
  ).get(todayStart)).count;

  return { open_count: openCount, pending_count: pendingCount, today_count: todayCount };
}

/**
 * 获取管理端工单列表（支持搜索和筛选）
 * @param {Object} db - 数据库实例
 * @param {Object} params - 查询参数
 * @returns {Promise<Object>} 工单列表和总数
 */
async function getAdminTickets(db, params = {}) {
  const { page = 1, limit = 10, status, keyword } = params;
  const offset = (page - 1) * limit;

  let where = '1=1';
  const queryParams = [];

  if (status) {
    where += ' AND t.status = ?';
    queryParams.push(status);
  }

  if (keyword) {
    where += ' AND (t.title LIKE ? OR u.email LIKE ?)';
    queryParams.push(`%${keyword}%`, `%${keyword}%`);
  }

  const countResult = await db.prepare(`
    SELECT COUNT(*) as count 
    FROM tickets t 
    LEFT JOIN users u ON t.user_id = u.id
    WHERE ${where}
  `).get(...queryParams);
  const total = countResult.count;

  const tickets = await db.prepare(`
    SELECT t.*, u.email as user_email
    FROM tickets t
    LEFT JOIN users u ON t.user_id = u.id
    WHERE ${where}
    ORDER BY t.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...queryParams, limit, offset);

  return { total, list: tickets };
}

module.exports = {
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
