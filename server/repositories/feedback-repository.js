/**
 * 留言板仓储
 * 负责 feedback_messages 与 feedback_votes 的数据访问，承接 service 层下沉的 SQL。
 */

/**
 * 创建用户留言。
 * 职责：写入当前用户提交的改进建议。
 * 关键参数：payload.userId 为留言用户，payload.content 为已清洗内容。
 * 核心分支语义：新留言默认不精选展示，等待管理员挑选。
 *
 * @param {Object} db - 数据库实例
 * @param {{userId:number, content:string}} payload - 留言数据
 * @returns {Promise<Object>} 新留言记录
 */
async function createMessage(db, payload) {
  const result = await db.prepare(`
    INSERT INTO feedback_messages (user_id, content, featured, created_at, updated_at)
    VALUES (?, ?, 0, EXTRACT(EPOCH FROM NOW()), EXTRACT(EPOCH FROM NOW()))
  `).run(payload.userId, payload.content);

  return findMessageById(db, result.lastInsertRowid);
}

/**
 * 按 ID 查询留言。
 * 职责：为精选、投票、删除等操作提供存在性判断。
 * 关键参数：messageId 为留言 ID。
 * 核心分支语义：不存在时返回 undefined，由 service 统一转换为业务错误。
 *
 * @param {Object} db - 数据库实例
 * @param {number} messageId - 留言 ID
 * @returns {Promise<Object|undefined>} 留言记录
 */
async function findMessageById(db, messageId) {
  return db.prepare('SELECT * FROM feedback_messages WHERE id = ?').get(messageId);
}

/**
 * 查询用户端精选留言列表。
 * 职责：返回管理员精选留言、投票数和当前用户是否已投票。
 * 关键参数：userId 为当前登录用户，用于计算 has_voted。
 * 核心分支语义：仅返回 featured=1 的留言，按投票数和创建时间排序。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 当前用户 ID
 * @returns {Promise<Array>} 精选留言列表
 */
async function listFeaturedMessages(db, userId) {
  return db.prepare(`
    SELECT
      fm.id,
      fm.content,
      fm.created_at,
      COALESCE(COUNT(fv.id), 0) as vote_count,
      CASE WHEN uv.id IS NULL THEN 0 ELSE 1 END as has_voted
    FROM feedback_messages fm
    LEFT JOIN feedback_votes fv ON fv.message_id = fm.id
    LEFT JOIN feedback_votes uv ON uv.message_id = fm.id AND uv.user_id = ?
    WHERE fm.featured = 1
    GROUP BY fm.id, fm.content, fm.created_at, uv.id
    ORDER BY vote_count DESC, fm.created_at DESC
    LIMIT 50
  `).all(userId);
}

/**
 * 查询当前用户对某条留言的投票记录。
 * 职责：支持单用户单留言只能投一票的业务判断。
 * 关键参数：messageId 和 userId 组成唯一投票身份。
 * 核心分支语义：已投票返回记录，未投票返回 undefined。
 *
 * @param {Object} db - 数据库实例
 * @param {number} messageId - 留言 ID
 * @param {number} userId - 用户 ID
 * @returns {Promise<Object|undefined>} 投票记录
 */
async function findVote(db, messageId, userId) {
  return db.prepare(`
    SELECT *
    FROM feedback_votes
    WHERE message_id = ? AND user_id = ?
  `).get(messageId, userId);
}

/**
 * 创建投票记录。
 * 职责：写入一条留言投票。
 * 关键参数：payload.messageId 为被投留言，payload.userId 为投票用户。
 * 核心分支语义：数据库唯一约束兜底防止并发重复投票。
 *
 * @param {Object} db - 数据库实例
 * @param {{messageId:number, userId:number}} payload - 投票数据
 * @returns {Promise<Object>} 新投票记录
 */
async function createVote(db, payload) {
  return db.prepare(`
    INSERT INTO feedback_votes (message_id, user_id, created_at)
    VALUES (?, ?, EXTRACT(EPOCH FROM NOW()))
  `).run(payload.messageId, payload.userId);
}

/**
 * 统计管理端留言总数。
 * 职责：为分页和统计卡片提供总量。
 * 关键参数：无。
 * 核心分支语义：只统计主留言表，不受投票记录影响。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<number>} 留言总数
 */
async function countMessages(db) {
  const result = await db.prepare('SELECT COUNT(*) as count FROM feedback_messages').get();
  return Number(result.count || 0);
}

/**
 * 统计用户在指定时间之后提交的留言数量。
 * 职责：为每日 3 条留言限制提供服务端计数。
 * 关键参数：sinceTimestamp 为秒级时间戳，通常是当天 00:00:00。
 * 核心分支语义：只统计当前用户主留言表记录，管理员精选或删除后的状态不额外参与。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {number} sinceTimestamp - 秒级查询下界
 * @returns {Promise<number>} 用户在该时间之后的留言数量
 */
async function countUserMessagesSince(db, userId, sinceTimestamp) {
  const result = await db.prepare(`
    SELECT COUNT(*) as count
    FROM feedback_messages
    WHERE user_id = ? AND created_at >= ?
  `).get(userId, sinceTimestamp);

  return Number(result.count || 0);
}

/**
 * 分页查询管理端留言列表。
 * 职责：返回用户邮箱、精选状态和投票数。
 * 关键参数：limit 和 offset 控制分页。
 * 核心分支语义：管理员查看所有留言，不过滤精选状态。
 *
 * @param {Object} db - 数据库实例
 * @param {number} limit - 每页数量
 * @param {number} offset - 偏移量
 * @returns {Promise<Array>} 留言列表
 */
async function listAdminMessages(db, limit, offset) {
  return db.prepare(`
    SELECT
      fm.id,
      fm.user_id,
      u.email as user_email,
      fm.content,
      fm.featured,
      fm.created_at,
      fm.updated_at,
      COALESCE(COUNT(fv.id), 0) as vote_count
    FROM feedback_messages fm
    LEFT JOIN users u ON u.id = fm.user_id
    LEFT JOIN feedback_votes fv ON fv.message_id = fm.id
    GROUP BY fm.id, u.email
    ORDER BY fm.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

/**
 * 更新留言精选展示状态。
 * 职责：管理员控制某条留言是否展示到用户端。
 * 关键参数：featured 为布尔值，会落库为 0/1。
 * 核心分支语义：只更新存在的留言，调用方先做存在性判断。
 *
 * @param {Object} db - 数据库实例
 * @param {number} messageId - 留言 ID
 * @param {boolean} featured - 是否精选展示
 * @returns {Promise<void>}
 */
async function updateFeatured(db, messageId, featured) {
  await db.prepare(`
    UPDATE feedback_messages
    SET featured = ?, updated_at = EXTRACT(EPOCH FROM NOW())
    WHERE id = ?
  `).run(featured ? 1 : 0, messageId);
}

/**
 * 删除留言相关投票。
 * 职责：删除主留言前清理关联投票。
 * 关键参数：messageId 为待删除留言。
 * 核心分支语义：可在事务内调用，保证和主留言删除同进退。
 *
 * @param {Object} db - 数据库实例
 * @param {number} messageId - 留言 ID
 * @returns {Promise<void>}
 */
async function deleteVotesByMessageId(db, messageId) {
  await db.prepare('DELETE FROM feedback_votes WHERE message_id = ?').run(messageId);
}

/**
 * 删除留言主记录。
 * 职责：删除 feedback_messages 中的主留言。
 * 关键参数：messageId 为待删除留言。
 * 核心分支语义：调用方负责先清理投票并校验留言存在。
 *
 * @param {Object} db - 数据库实例
 * @param {number} messageId - 留言 ID
 * @returns {Promise<void>}
 */
async function deleteMessageById(db, messageId) {
  await db.prepare('DELETE FROM feedback_messages WHERE id = ?').run(messageId);
}

/**
 * 统计精选留言总数。
 * 职责：为管理端统计卡片提供精选数量。
 * 关键参数：无。
 * 核心分支语义：只统计 featured=1 的留言。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<number>} 精选留言数
 */
async function countFeaturedMessages(db) {
  const result = await db.prepare('SELECT COUNT(*) as count FROM feedback_messages WHERE featured = 1').get();
  return Number(result.count || 0);
}

/**
 * 统计投票总数。
 * 职责：为管理端概览提供全部投票数量。
 * 关键参数：无。
 * 核心分支语义：统计所有投票记录，不区分留言是否精选。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<number>} 投票总数
 */
async function countVotes(db) {
  const result = await db.prepare('SELECT COUNT(*) as count FROM feedback_votes').get();
  return Number(result.count || 0);
}

module.exports = {
  createMessage,
  findMessageById,
  listFeaturedMessages,
  findVote,
  createVote,
  countMessages,
  countUserMessagesSince,
  listAdminMessages,
  updateFeatured,
  deleteVotesByMessageId,
  deleteMessageById,
  countFeaturedMessages,
  countVotes
};
