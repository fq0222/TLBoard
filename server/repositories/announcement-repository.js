/**
 * 公告仓储。
 * 负责 announcements 表的用户侧列表、管理端列表、弹窗候选公告查询，以及公告增删改查。
 */

/**
 * 统计用户端可见公告总数。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<number>} 已启用公告总数
 */
async function countEnabledAnnouncements(db) {
  const row = await db.prepare('SELECT COUNT(*) AS count FROM announcements WHERE enabled = 1 AND COALESCE(node_show, 0) = 0').get();
  return row.count;
}

/**
 * 分页查询用户端可见公告列表。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} options - 分页参数
 * @param {number} options.limit - 每页条数
 * @param {number} options.offset - 偏移量
 * @returns {Promise<Array<Object>>} 已启用公告列表
 */
async function findEnabledAnnouncements(db, options) {
  const { limit, offset } = options;

  return db.prepare(`
    SELECT id, title, content, pinned, popup_show_limit, created_at, updated_at
    FROM announcements
    WHERE enabled = 1 AND COALESCE(node_show, 0) = 0
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
    SELECT id, title, content, pinned, enabled, popup_show_limit, node_show, created_at, updated_at
    FROM announcements
    ORDER BY pinned DESC, created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

/**
 * 按 ID 查询公告。
 *
 * @param {Object} db - 数据库实例
 * @param {number} announcementId - 公告 ID
 * @returns {Promise<Object|null>} 公告记录
 */
async function findAnnouncementById(db, announcementId) {
  return db.prepare(`
    SELECT id, title, content, pinned, enabled, popup_show_limit, node_show, created_at, updated_at
    FROM announcements
    WHERE id = ?
  `).get(announcementId);
}

/**
 * 查询最新一条已启用且允许弹窗的公告，作为首页弹窗候选公告。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Object|null>} 最新可弹窗公告
 */
async function findLatestEnabledAnnouncement(db) {
  return db.prepare(`
    SELECT id, title, content, pinned, enabled, popup_show_limit, node_show, created_at, updated_at
    FROM announcements
    WHERE enabled = 1 AND popup_show_limit > 0 AND COALESCE(node_show, 0) = 0
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get();
}

/**
 * 创建公告。
 * 核心分支：popup_show_limit 未传入时写入 0，表示该公告默认不弹窗。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 公告数据
 * @param {string} payload.title - 公告标题
 * @param {string|null} payload.content - 公告内容
 * @param {number} payload.pinned - 是否置顶，0/1
 * @param {number} payload.enabled - 是否启用，0/1
 * @param {number} [payload.popup_show_limit] - 每个用户最多弹窗次数
 * @returns {Promise<Object>} 数据库写入结果
 */
async function createAnnouncement(db, payload) {
  const { title, content, pinned, enabled, popup_show_limit, node_show } = payload;
  const popupShowLimit = popup_show_limit ?? 0;
  const nodeShow = node_show ?? 0;

  return db.prepare(`
    INSERT INTO announcements (title, content, pinned, enabled, popup_show_limit, node_show)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(title, content, pinned, enabled, popupShowLimit, nodeShow);
}

/**
 * 按动态字段更新公告，由上层决定补充哪些字段。
 *
 * @param {Object} db - 数据库实例
 * @param {number} announcementId - 公告 ID
 * @param {Array<string>} updates - SQL 更新表达式
 * @param {Array<*>} values - SQL 绑定值
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
  findLatestEnabledAnnouncement,
  createAnnouncement,
  updateAnnouncementFields,
  deleteAnnouncement
};
