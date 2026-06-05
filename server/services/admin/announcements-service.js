const announcementRepository = require('../../repositories/announcement-repository');

/**
 * 管理端公告服务
 * 负责公告分页、存在性校验、无更新字段拦截，以及旧接口兼容所需的业务编排。
 */

/**
 * 构造兼容旧接口的业务异常。
 *
 * @param {string} message - 错误消息
 * @param {Object} [options] - 错误扩展参数
 * @param {number} [options.statusCode] - HTTP 状态码
 * @param {number} [options.code] - 旧接口业务码
 * @param {*} [options.data] - 旧接口 data 字段
 * @returns {Error} 业务异常对象
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
 * 校验公告是否存在。
 *
 * @param {Object|null} announcement - 公告记录
 * @returns {Object} 已校验的公告记录
 */
function ensureAnnouncementExists(announcement) {
  if (!announcement) {
    throw createLegacyBusinessError('公告不存在');
  }

  return announcement;
}

/**
 * 获取管理端公告分页列表。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} pagination - 分页参数
 * @param {number} pagination.page - 当前页码
 * @param {number} pagination.limit - 每页条数
 * @param {number} pagination.offset - 偏移量
 * @returns {Promise<Object>} 兼容旧接口的分页结果
 */
async function listAnnouncements(db, pagination) {
  const { page, limit, offset } = pagination;
  const total = await announcementRepository.countAnnouncements(db);
  const list = await announcementRepository.listAnnouncements(db, { limit, offset });

  return {
    total,
    page,
    limit,
    list
  };
}

/**
 * 创建公告，并返回与旧接口一致的结果结构。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 创建参数
 * @param {string} payload.title - 公告标题
 * @param {string|null} payload.content - 公告内容
 * @param {boolean} payload.pinned - 是否置顶
 * @param {boolean} payload.enabled - 是否启用
 * @returns {Promise<Object>} 新建公告
 */
async function createAnnouncement(db, payload) {
  const result = await announcementRepository.createAnnouncement(db, {
    title: payload.title,
    content: payload.content,
    pinned: payload.pinned ? 1 : 0,
    enabled: payload.enabled ? 1 : 0,
    popup_show_limit: payload.popup_show_limit === undefined ? 0 : Number(payload.popup_show_limit),
    node_show: payload.node_show ? 1 : 0
  });

  return announcementRepository.findAnnouncementById(db, result.lastInsertRowid);
}

/**
 * 更新公告，仅允许更新显式传入的字段。
 *
 * @param {Object} db - 数据库实例
 * @param {number} announcementId - 公告 ID
 * @param {Object} payload - 更新参数
 * @returns {Promise<Object>} 更新后的公告
 */
async function updateAnnouncement(db, announcementId, payload) {
  ensureAnnouncementExists(await announcementRepository.findAnnouncementById(db, announcementId));

  const updates = [];
  const values = [];

  if (payload.title !== undefined) {
    updates.push('title = ?');
    values.push(payload.title);
  }

  if (payload.content !== undefined) {
    updates.push('content = ?');
    values.push(payload.content);
  }

  if (payload.pinned !== undefined) {
    updates.push('pinned = ?');
    values.push(payload.pinned ? 1 : 0);
  }

  if (payload.enabled !== undefined) {
    updates.push('enabled = ?');
    values.push(payload.enabled ? 1 : 0);
  }

  if (payload.popup_show_limit !== undefined) {
    updates.push('popup_show_limit = ?');
    values.push(Number(payload.popup_show_limit));
  }

  if (payload.node_show !== undefined) {
    updates.push('node_show = ?');
    values.push(payload.node_show ? 1 : 0);
  }

  if (updates.length === 0) {
    throw createLegacyBusinessError('没有要更新的字段');
  }

  updates.push('updated_at = ?');
  values.push(Math.floor(Date.now() / 1000));

  await announcementRepository.updateAnnouncementFields(db, announcementId, updates, values);
  return announcementRepository.findAnnouncementById(db, announcementId);
}

/**
 * 删除公告，并返回旧接口兼容结果。
 *
 * @param {Object} db - 数据库实例
 * @param {number} announcementId - 公告 ID
 * @returns {Promise<Object>} 删除结果
 */
async function deleteAnnouncement(db, announcementId) {
  ensureAnnouncementExists(await announcementRepository.findAnnouncementById(db, announcementId));
  await announcementRepository.deleteAnnouncement(db, announcementId);

  return {
    message: '公告已删除'
  };
}

module.exports = {
  listAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  createLegacyBusinessError
};
