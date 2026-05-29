/**
 * 公告仓储
 * 负责 announcements 表的用户侧已启用列表，以及管理端列表、创建、更新、删除、存在性查询等数据访问。
 */

/**
 * 统计已启用公告总数。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<number>} 已启用公告总数
 */
async function countEnabledAnnouncements(db) {
  const row = await db.prepare('SELECT COUNT(*) AS count FROM announcements WHERE enabled = 1').get();
  return row.count;
}

/**
 * 分页查询已启用公告列表，供用户侧复用。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} options - 分页参数
 * @param {number} options.limit - 每页条数
 * @param {number} options.offset - 偏移量
 * @returns {Promise<Array<Object>>} 公告记录列表
 */
async function findEnabledAnnouncements(db, options) {
  const { limit, offset } = options;

  return db.prepare(`
    SELECT id, title, content, pinned, created_at, updated_at
    FROM announcements
    WHERE enabled = 1
    ORDER BY pinned DESC, created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

/**
 * 统计管理端公告总数。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<number>} 公告总数
 */
async function countAnnouncements(db) {
  const row = await db.prepare('SELECT COUNT(*) AS count FROM announcements').get();
  return row.count;
}

/**
 * 分页查询管理端公告列表。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} options - 分页参数
 * @param {number} options.limit - 每页条数
 * @param {number} options.offset - 偏移量
 * @returns {Promise<Array<Object>>} 管理端公告列表
 */
async function listAnnouncements(db, options) {
  const { limit, offset } = options;

  return db.prepare(`
    SELECT id, title, content, pinned, enabled, created_at, updated_at
    FROM announcements
    ORDER BY pinned DESC, created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

/**
 * 按 ID 查询公告，供管理端存在性校验与回查复用。
 *
 * @param {Object} db - 数据库实例
 * @param {number} announcementId - 公告 ID
 * @returns {Promise<Object|null>} 公告记录
 */
async function findAnnouncementById(db, announcementId) {
  return db.prepare(`
    SELECT id, title, content, pinned, enabled, created_at, updated_at
    FROM announcements
    WHERE id = ?
  `).get(announcementId);
}

/**
 * 创建公告记录。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 公告数据
 * @param {string} payload.title - 公告标题
 * @param {string|null} payload.content - 公告内容
 * @param {number} payload.pinned - 是否置顶（0/1）
 * @param {number} payload.enabled - 是否启用（0/1）
 * @returns {Promise<Object>} 数据库写入结果
 */
async function createAnnouncement(db, payload) {
  const { title, content, pinned, enabled } = payload;

  return db.prepare(`
    INSERT INTO announcements (title, content, pinned, enabled)
    VALUES (?, ?, ?, ?)
  `).run(title, content, pinned, enabled);
}

/**
 * 按动态字段更新公告，并由上层决定补充哪些字段。
 *
 * @param {Object} db - 数据库实例
 * @param {number} announcementId - 公告 ID
 * @param {Array<string>} updates - 更新表达式数组
 * @param {Array<*>} values - 更新值数组
 * @returns {Promise<Object>} 数据库写入结果
 */
async function updateAnnouncementFields(db, announcementId, updates, values) {
  return db.prepare(`
    UPDATE announcements
    SET ${updates.join(', ')}
    WHERE id = ?
  `).run(...values, announcementId);
}

/**
 * 删除公告。
 *
 * @param {Object} db - 数据库实例
 * @param {number} announcementId - 公告 ID
 * @returns {Promise<Object>} 数据库写入结果
 */
async function deleteAnnouncement(db, announcementId) {
  return db.prepare('DELETE FROM announcements WHERE id = ?').run(announcementId);
}

module.exports = {
  countEnabledAnnouncements,
  findEnabledAnnouncements,
  countAnnouncements,
  listAnnouncements,
  findAnnouncementById,
  createAnnouncement,
  updateAnnouncementFields,
  deleteAnnouncement
};
