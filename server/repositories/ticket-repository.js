/**
 * 工单仓储
 * 负责 tickets、ticket_replies、ticket_reads 的数据访问，承接 service 层下沉的 SQL。
 */

/**
 * 构建管理端工单列表的筛选条件。
 *
 * @param {Object} filters - 列表筛选参数
 * @param {string|null} filters.status - 工单状态筛选
 * @param {string|null} filters.keyword - 标题或邮箱关键字
 * @returns {{where: string, params: Array}} SQL 条件片段与对应参数
 */
function buildAdminTicketFilters({ status, keyword } = {}) {
  let where = '1=1';
  const params = [];

  if (status) {
    where += ' AND t.status = ?';
    params.push(status);
  }

  if (keyword) {
    where += ' AND (t.title LIKE ? OR u.email LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  return { where, params };
}

/**
 * 按工单 ID 查询工单基础信息。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单 ID
 * @returns {Promise<Object|null>} 工单记录，不存在时返回 null
 */
async function findTicketById(db, ticketId) {
  return db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
}

/**
 * 查询工单详情基础信息，不包含回复内容。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单 ID
 * @returns {Promise<Object|null>} 工单详情基础信息
 */
async function findTicketDetailById(db, ticketId) {
  return db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
}

/**
 * 查询工单关联的用户摘要信息。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @returns {Promise<Object|null>} 用户摘要
 */
async function findTicketUserById(db, userId) {
  return db.prepare('SELECT id, email FROM users WHERE id = ?').get(userId);
}

/**
 * 按时间正序查询工单回复列表，并拼出旧接口所需的 reply_name 字段。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单 ID
 * @returns {Promise<Array>} 回复列表
 */
async function findRepliesByTicketId(db, ticketId) {
  return db.prepare(`
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
}

/**
 * 查询单条回复详情，并补齐旧接口依赖的 reply_name 字段。
 *
 * @param {Object} db - 数据库实例
 * @param {number} replyId - 回复 ID
 * @returns {Promise<Object|null>} 回复详情
 */
async function findReplyById(db, replyId) {
  return db.prepare(`
    SELECT
      tr.*,
      CASE
        WHEN tr.user_id IS NOT NULL THEN u.email
        WHEN tr.admin_id IS NOT NULL THEN a.username
      END as reply_name
    FROM ticket_replies tr
    LEFT JOIN users u ON tr.user_id = u.id
    LEFT JOIN admins a ON tr.admin_id = a.id
    WHERE tr.id = ?
  `).get(replyId);
}

/**
 * 创建用户工单，并返回完整工单记录。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {string} title - 工单标题
 * @param {string} description - 工单描述
 * @returns {Promise<Object>} 新建工单
 */
async function createTicket(db, userId, title, description) {
  const result = await db.prepare(`
    INSERT INTO tickets (user_id, title, description, status, created_at, updated_at)
    VALUES (?, ?, ?, 'open', EXTRACT(EPOCH FROM NOW()), EXTRACT(EPOCH FROM NOW()))
  `).run(userId, title, description);

  return findTicketById(db, result.lastInsertRowid);
}

/**
 * 统计指定用户的工单总数。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @returns {Promise<number>} 工单总数
 */
async function countUserTickets(db, userId) {
  const result = await db.prepare(
    'SELECT COUNT(*) as count FROM tickets WHERE user_id = ?'
  ).get(userId);

  return result.count;
}

/**
 * 分页查询用户工单列表，保留旧接口使用的未读标记字段。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {number} limit - 每页条数
 * @param {number} offset - 分页偏移
 * @returns {Promise<Array>} 工单列表
 */
async function listUserTickets(db, userId, limit, offset) {
  return db.prepare(`
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
}

/**
 * 创建工单回复，并返回插入后的回复记录。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单 ID
 * @param {number|null} userId - 回复用户 ID，管理员回复时为 null
 * @param {number|null} adminId - 回复管理员 ID，用户回复时为 null
 * @param {string} content - 回复内容
 * @returns {Promise<Object>} 新建回复
 */
async function createReply(db, ticketId, userId, adminId, content) {
  const result = await db.prepare(`
    INSERT INTO ticket_replies (ticket_id, user_id, admin_id, content, created_at)
    VALUES (?, ?, ?, ?, EXTRACT(EPOCH FROM NOW()))
  `).run(ticketId, userId, adminId, content);

  return findReplyById(db, result.lastInsertRowid);
}

/**
 * 记录管理员回复后的工单状态流转。
 * 管理员回复时必须将状态更新为 pending，并同步回复时间与更新时间。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单 ID
 * @returns {Promise<void>}
 */
async function markAdminReplyAdded(db, ticketId) {
  await db.prepare(`
    UPDATE tickets
    SET status = 'pending',
        reply_count = reply_count + 1,
        last_reply_at = EXTRACT(EPOCH FROM NOW()),
        updated_at = EXTRACT(EPOCH FROM NOW())
    WHERE id = ?
  `).run(ticketId);
}

/**
 * 记录用户回复后的工单更新时间。
 * 用户回复时保留现有状态，仅更新回复数、最后回复时间和更新时间。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单 ID
 * @returns {Promise<void>}
 */
async function markUserReplyAdded(db, ticketId) {
  await db.prepare(`
    UPDATE tickets
    SET reply_count = reply_count + 1,
        last_reply_at = EXTRACT(EPOCH FROM NOW()),
        updated_at = EXTRACT(EPOCH FROM NOW())
    WHERE id = ?
  `).run(ticketId);
}

/**
 * 将工单关闭，并更新关闭时间与更新时间。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单 ID
 * @returns {Promise<void>}
 */
async function closeTicketById(db, ticketId) {
  await db.prepare(`
    UPDATE tickets
    SET status = 'closed',
        closed_at = EXTRACT(EPOCH FROM NOW()),
        updated_at = EXTRACT(EPOCH FROM NOW())
    WHERE id = ?
  `).run(ticketId);
}

/**
 * 删除工单的所有回复记录。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单 ID
 * @returns {Promise<void>}
 */
async function deleteRepliesByTicketId(db, ticketId) {
  await db.prepare('DELETE FROM ticket_replies WHERE ticket_id = ?').run(ticketId);
}

/**
 * 删除工单的已读记录。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单 ID
 * @returns {Promise<void>}
 */
async function deleteReadsByTicketId(db, ticketId) {
  await db.prepare('DELETE FROM ticket_reads WHERE ticket_id = ?').run(ticketId);
}

/**
 * 删除工单主记录。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单 ID
 * @returns {Promise<void>}
 */
async function deleteTicketById(db, ticketId) {
  await db.prepare('DELETE FROM tickets WHERE id = ?').run(ticketId);
}

/**
 * 新增或更新用户对工单的最后已读时间。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单 ID
 * @param {number} userId - 用户 ID
 * @returns {Promise<void>}
 */
async function upsertTicketReadTime(db, ticketId, userId) {
  await db.prepare(`
    INSERT INTO ticket_reads (ticket_id, user_id, last_read_at)
    VALUES (?, ?, EXTRACT(EPOCH FROM NOW()))
    ON CONFLICT (ticket_id, user_id)
    DO UPDATE SET last_read_at = EXTRACT(EPOCH FROM NOW())
  `).run(ticketId, userId);
}

/**
 * 同步 tickets 表上的最后已读时间，保持旧字段语义不变。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单 ID
 * @returns {Promise<void>}
 */
async function updateTicketLastReadTime(db, ticketId) {
  await db.prepare(`
    UPDATE tickets
    SET last_read_at = EXTRACT(EPOCH FROM NOW())
    WHERE id = ?
  `).run(ticketId);
}

/**
 * 在同一事务中标记工单已读，并同步 tickets 聚合字段。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单 ID
 * @param {number} userId - 用户 ID
 * @returns {Promise<void>}
 */
async function markTicketAsRead(db, ticketId, userId, readThroughTime) {
  if (readThroughTime === null || readThroughTime === undefined) {
    return;
  }

  const markRead = db.transaction(async (txDb, currentTicketId, currentUserId, currentReadThroughTime) => {
    await txDb.prepare(`
      INSERT INTO ticket_reads (ticket_id, user_id, last_read_at)
      VALUES (?, ?, ?)
      ON CONFLICT (ticket_id, user_id)
      DO UPDATE SET last_read_at = GREATEST(ticket_reads.last_read_at, EXCLUDED.last_read_at)
    `).run(currentTicketId, currentUserId, currentReadThroughTime);

    await txDb.prepare(`
      UPDATE tickets
      SET last_read_at = CASE
        WHEN last_read_at IS NULL THEN ?
        ELSE GREATEST(last_read_at, ?)
      END
      WHERE id = ?
    `).run(currentReadThroughTime, currentReadThroughTime, currentTicketId);
  });

  await markRead(ticketId, userId, readThroughTime);
}

/**
 * 在回复事务里锁定工单行并再次校验状态，避免关闭与回复并发时绕过“已关闭不可回复”的约束。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单 ID
 * @returns {Promise<void>}
 */
async function ensureTicketReplyableInTransaction(db, ticketId) {
  const ticket = await db.prepare(`
    SELECT status
    FROM tickets
    WHERE id = ?
    FOR UPDATE
  `).get(ticketId);

  if (!ticket || ticket.status === 'closed') {
    const error = new Error('工单已关闭，无法回复');
    error.statusCode = 400;
    error.code = 1001;
    error.expose = true;
    throw error;
  }
}

/**
 * 在同一事务中写入回复并同步工单状态、回复计数和时间字段。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单 ID
 * @param {number|null} userId - 用户 ID
 * @param {number|null} adminId - 管理员 ID
 * @param {string} content - 回复内容
 * @returns {Promise<Object>} 新建回复详情
 */
async function addReplyAndSyncTicket(db, ticketId, userId, adminId, content) {
  const addReply = db.transaction(async (txDb, currentTicketId, currentUserId, currentAdminId, currentContent) => {
    await ensureTicketReplyableInTransaction(txDb, currentTicketId);
    const reply = await createReply(txDb, currentTicketId, currentUserId, currentAdminId, currentContent);

    if (currentAdminId) {
      await markAdminReplyAdded(txDb, currentTicketId);
    } else {
      await markUserReplyAdded(txDb, currentTicketId);
    }

    return reply;
  });

  return addReply(ticketId, userId, adminId, content);
}

/**
 * 在同一事务中删除工单主记录及其关联回复、已读记录。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单 ID
 * @returns {Promise<void>}
 */
async function deleteTicketCascade(db, ticketId) {
  const deleteTicket = db.transaction(async (txDb, currentTicketId) => {
    await deleteRepliesByTicketId(txDb, currentTicketId);
    await deleteReadsByTicketId(txDb, currentTicketId);
    await deleteTicketById(txDb, currentTicketId);
  });

  await deleteTicket(ticketId);
}

/**
 * 统计用户未读工单数量。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @returns {Promise<number>} 未读数量
 */
async function countUnreadTickets(db, userId) {
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
 * 统计需要管理员处理的工单数量。
 * 核心分支语义：未关闭且尚无回复的新工单需要处理；未关闭且最后一条回复来自用户的工单也需要处理。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<number>} 需要管理员处理的工单数量
 */
async function countActionRequiredTickets(db) {
  const result = await db.prepare(`
    SELECT COUNT(*) as count
    FROM tickets t
    LEFT JOIN LATERAL (
      SELECT tr.id, tr.user_id, tr.created_at
      FROM ticket_replies tr
      WHERE tr.ticket_id = t.id
      ORDER BY tr.created_at DESC, tr.id DESC
      LIMIT 1
    ) latest_reply ON true
    WHERE t.status <> 'closed'
      AND (
        (
          latest_reply.id IS NULL
          AND (t.admin_last_read_at IS NULL OR t.created_at > t.admin_last_read_at)
        )
        OR (
          latest_reply.user_id IS NOT NULL
          AND (t.admin_last_read_at IS NULL OR latest_reply.created_at > t.admin_last_read_at)
        )
      )
  `).get();

  return result.count;
}

/**
 * 将管理员对工单的查看进度标记到当前最新用户消息。
 * 核心分支语义：新工单没有回复时标记创建时间；最后一条回复来自用户时标记该回复时间；最后一条来自管理员时无需更新。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单 ID
 * @returns {Promise<void>}
 */
async function markTicketAsAdminRead(db, ticketId) {
  const readTarget = await db.prepare(`
    SELECT
      CASE
        WHEN latest_reply.id IS NULL THEN t.created_at
        WHEN latest_reply.user_id IS NOT NULL THEN latest_reply.created_at
        ELSE NULL
      END as read_through_at
    FROM tickets t
    LEFT JOIN LATERAL (
      SELECT tr.id, tr.user_id, tr.created_at
      FROM ticket_replies tr
      WHERE tr.ticket_id = t.id
      ORDER BY tr.created_at DESC, tr.id DESC
      LIMIT 1
    ) latest_reply ON true
    WHERE t.id = ?
  `).get(ticketId);

  if (!readTarget || readTarget.read_through_at === null || readTarget.read_through_at === undefined) {
    return;
  }

  await db.prepare(`
    UPDATE tickets
    SET admin_last_read_at = CASE
      WHEN admin_last_read_at IS NULL THEN ?
      ELSE GREATEST(admin_last_read_at, ?)
    END
    WHERE id = ?
  `).run(readTarget.read_through_at, readTarget.read_through_at, ticketId);
}

/**
 * 统计指定状态的工单数量。
 *
 * @param {Object} db - 数据库实例
 * @param {string} status - 工单状态
 * @returns {Promise<number>} 工单数量
 */
async function countTicketsByStatus(db, status) {
  const result = await db.prepare(
    'SELECT COUNT(*) as count FROM tickets WHERE status = ?'
  ).get(status);

  return result.count;
}

/**
 * 统计指定时间戳之后创建的工单数量。
 *
 * @param {Object} db - 数据库实例
 * @param {number} timestamp - Unix 时间戳（秒）
 * @returns {Promise<number>} 工单数量
 */
async function countTicketsCreatedAfter(db, timestamp) {
  const result = await db.prepare(
    'SELECT COUNT(*) as count FROM tickets WHERE created_at >= ?'
  ).get(timestamp);

  return result.count;
}

/**
 * 统计管理端筛选条件下的工单总数。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} filters - 筛选参数
 * @returns {Promise<number>} 工单总数
 */
async function countAdminTickets(db, filters = {}) {
  const { where, params } = buildAdminTicketFilters(filters);
  const result = await db.prepare(`
    SELECT COUNT(*) as count
    FROM tickets t
    LEFT JOIN users u ON t.user_id = u.id
    WHERE ${where}
  `).get(...params);

  return result.count;
}

/**
 * 分页查询管理端工单列表。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} filters - 列表筛选参数
 * @param {number} limit - 每页条数
 * @param {number} offset - 分页偏移
 * @returns {Promise<Array>} 工单列表
 */
async function listAdminTickets(db, filters = {}, limit, offset) {
  const { where, params } = buildAdminTicketFilters(filters);

  return db.prepare(`
    SELECT
      t.*,
      u.email as user_email,
      CASE
        WHEN t.status <> 'closed'
          AND (
            (
              latest_reply.id IS NULL
              AND (t.admin_last_read_at IS NULL OR t.created_at > t.admin_last_read_at)
            )
            OR (
              latest_reply.user_id IS NOT NULL
              AND (t.admin_last_read_at IS NULL OR latest_reply.created_at > t.admin_last_read_at)
            )
          )
        THEN 1
        ELSE 0
      END as is_action_required
    FROM tickets t
    LEFT JOIN users u ON t.user_id = u.id
    LEFT JOIN LATERAL (
      SELECT tr.id, tr.user_id, tr.created_at
      FROM ticket_replies tr
      WHERE tr.ticket_id = t.id
      ORDER BY tr.created_at DESC, tr.id DESC
      LIMIT 1
    ) latest_reply ON true
    WHERE ${where}
    ORDER BY t.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
}

module.exports = {
  findTicketById,
  findTicketDetailById,
  findTicketUserById,
  findRepliesByTicketId,
  findReplyById,
  createTicket,
  countUserTickets,
  listUserTickets,
  createReply,
  markAdminReplyAdded,
  markUserReplyAdded,
  closeTicketById,
  deleteRepliesByTicketId,
  deleteReadsByTicketId,
  deleteTicketById,
  upsertTicketReadTime,
  updateTicketLastReadTime,
  markTicketAsRead,
  ensureTicketReplyableInTransaction,
  addReplyAndSyncTicket,
  deleteTicketCascade,
  countUnreadTickets,
  countActionRequiredTickets,
  markTicketAsAdminRead,
  countTicketsByStatus,
  countTicketsCreatedAfter,
  countAdminTickets,
  listAdminTickets
};
