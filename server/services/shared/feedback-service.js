/**
 * 留言板共享服务
 * 负责留言提交、精选展示、投票限制和管理端删除等核心业务规则。
 */

const feedbackRepository = require('../../repositories/feedback-repository');

const DAILY_MESSAGE_LIMIT = 3;

/**
 * 构造旧接口兼容业务错误。
 * 职责：让控制器可以用现有 respondLegacyError 逻辑输出错误。
 * 关键参数：statusCode/code/message 对应 HTTP 状态和旧业务码。
 * 核心分支语义：始终携带 expose 标记，允许前端看到业务提示。
 *
 * @param {number} statusCode - HTTP 状态码
 * @param {number} code - 旧业务码
 * @param {string} message - 错误提示
 * @returns {Error} 业务错误
 */
function createLegacyServiceError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.expose = true;
  return error;
}

/**
 * 清洗并校验留言内容。
 * 职责：统一执行 1-150 字限制，避免前端绕过。
 * 关键参数：content 为用户输入原文。
 * 核心分支语义：空内容或超过 150 字时抛出业务错误。
 *
 * @param {string} content - 用户留言内容
 * @returns {string} 清洗后的内容
 */
function normalizeContent(content) {
  const normalized = String(content || '').trim();

  if (!normalized) {
    throw createLegacyServiceError(400, 1001, '留言内容不能为空');
  }

  if (normalized.length > 150) {
    throw createLegacyServiceError(400, 1001, '留言内容不能超过150字');
  }

  return normalized;
}

/**
 * 获取当前自然日开始时间戳。
 * 职责：为每日提交次数限制提供查询下界。
 * 关键参数：nowMs 为毫秒级当前时间，默认使用系统时间。
 * 核心分支语义：按服务器本地自然日计算，当天 00:00:00 之后的留言计入限额。
 *
 * @param {number} [nowMs] - 毫秒级时间戳
 * @returns {number} 秒级当天开始时间戳
 */
function getLocalDayStartTimestamp(nowMs = Date.now()) {
  const now = new Date(nowMs);
  now.setHours(0, 0, 0, 0);
  return Math.floor(now.getTime() / 1000);
}

/**
 * 确认留言存在。
 * 职责：将空记录转换为旧接口业务错误。
 * 关键参数：message 为仓储查询结果。
 * 核心分支语义：不存在时抛出“留言不存在”。
 *
 * @param {Object|undefined|null} message - 留言记录
 * @returns {Object} 已确认存在的留言
 */
function ensureMessageExists(message) {
  if (!message) {
    throw createLegacyServiceError(404, 404, '留言不存在');
  }

  return message;
}

/**
 * 提交留言。
 * 职责：校验长度并创建一条默认未精选的留言。
 * 关键参数：userId 为当前用户，content 为用户输入。
 * 核心分支语义：只保留 trim 后内容，不自动精选。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {string} content - 留言内容
 * @returns {Promise<Object>} 新留言
 */
async function createMessage(db, userId, content) {
  const normalizedContent = normalizeContent(content);
  const todayCount = await feedbackRepository.countUserMessagesSince(
    db,
    userId,
    getLocalDayStartTimestamp()
  );

  if (todayCount >= DAILY_MESSAGE_LIMIT) {
    throw createLegacyServiceError(429, 1003, '每个用户每天只能提交3条留言');
  }

  return feedbackRepository.createMessage(db, {
    userId,
    content: normalizedContent
  });
}

/**
 * 获取用户端精选留言。
 * 职责：返回管理员挑选的留言以及当前用户投票状态。
 * 关键参数：userId 用于计算 has_voted。
 * 核心分支语义：将数据库 0/1 和聚合数字转换为前端友好的布尔/数字。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 当前用户 ID
 * @returns {Promise<{list:Array}>} 精选留言列表
 */
async function listFeaturedMessages(db, userId) {
  const rows = await feedbackRepository.listFeaturedMessages(db, userId);
  return {
    list: rows.map(row => ({
      ...row,
      vote_count: Number(row.vote_count || 0),
      has_voted: !!row.has_voted
    }))
  };
}

/**
 * 给精选留言投票。
 * 职责：限制同一用户对同一条留言只能投一票。
 * 关键参数：userId 为投票用户，messageId 为被投留言。
 * 核心分支语义：未精选留言不能被投票；重复投票返回幂等结果，不再次写入。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {number} messageId - 留言 ID
 * @returns {Promise<{voted:boolean, already_voted:boolean}>} 投票结果
 */
async function voteMessage(db, userId, messageId) {
  const message = ensureMessageExists(await feedbackRepository.findMessageById(db, messageId));

  if (!message.featured) {
    throw createLegacyServiceError(400, 1001, '该留言暂未开放投票');
  }

  const existingVote = await feedbackRepository.findVote(db, messageId, userId);
  if (existingVote) {
    return { voted: true, already_voted: true };
  }

  try {
    await feedbackRepository.createVote(db, { messageId, userId });
  } catch (error) {
    if (error.code === '23505') {
      return { voted: true, already_voted: true };
    }
    throw error;
  }

  return { voted: true, already_voted: false };
}

/**
 * 管理端分页查看留言。
 * 职责：返回所有留言、用户邮箱、精选状态和投票数。
 * 关键参数：page/limit 控制分页。
 * 核心分支语义：只做分页，不过滤留言，便于管理员完整查看。
 *
 * @param {Object} db - 数据库实例
 * @param {{page:number, limit:number}} pagination - 分页参数
 * @returns {Promise<Object>} 分页结果
 */
async function listAdminMessages(db, pagination) {
  const total = await feedbackRepository.countMessages(db);
  const list = await feedbackRepository.listAdminMessages(
    db,
    pagination.limit,
    (pagination.page - 1) * pagination.limit
  );

  return {
    total,
    page: pagination.page,
    limit: pagination.limit,
    list: list.map(row => ({
      ...row,
      featured: !!row.featured,
      vote_count: Number(row.vote_count || 0)
    }))
  };
}

/**
 * 更新精选展示状态。
 * 职责：管理员控制留言是否展示到用户端。
 * 关键参数：featured 为目标展示状态。
 * 核心分支语义：留言不存在时报错；存在则更新 0/1 状态。
 *
 * @param {Object} db - 数据库实例
 * @param {number} messageId - 留言 ID
 * @param {boolean} featured - 是否精选
 * @returns {Promise<{message:string, featured:boolean}>} 更新结果
 */
async function updateFeatured(db, messageId, featured) {
  ensureMessageExists(await feedbackRepository.findMessageById(db, messageId));
  await feedbackRepository.updateFeatured(db, messageId, featured);

  return {
    message: featured ? '留言已展示到用户端' : '留言已取消展示',
    featured: !!featured
  };
}

/**
 * 删除留言。
 * 职责：管理员删除留言并同步清理投票。
 * 关键参数：messageId 为待删除留言。
 * 核心分支语义：先校验存在，再在同一事务中删除投票和主记录。
 *
 * @param {Object} db - 数据库实例
 * @param {number} messageId - 留言 ID
 * @returns {Promise<{message:string}>} 删除结果
 */
async function deleteMessage(db, messageId) {
  ensureMessageExists(await feedbackRepository.findMessageById(db, messageId));

  const deleteInTransaction = db.transaction(async (txDb, currentMessageId) => {
    await feedbackRepository.deleteVotesByMessageId(txDb, currentMessageId);
    await feedbackRepository.deleteMessageById(txDb, currentMessageId);
  });

  await deleteInTransaction(messageId);

  return { message: '留言已删除' };
}

/**
 * 获取管理端统计。
 * 职责：返回留言、精选和投票概览。
 * 关键参数：无。
 * 核心分支语义：三个统计独立查询，避免复杂 SQL 降低可读性。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<{total:number, featured:number, votes:number}>} 统计数据
 */
async function getStats(db) {
  const [total, featured, votes] = await Promise.all([
    feedbackRepository.countMessages(db),
    feedbackRepository.countFeaturedMessages(db),
    feedbackRepository.countVotes(db)
  ]);

  return { total, featured, votes };
}

module.exports = {
  createMessage,
  listFeaturedMessages,
  voteMessage,
  listAdminMessages,
  updateFeatured,
  deleteMessage,
  getStats,
  normalizeContent,
  getLocalDayStartTimestamp
};
