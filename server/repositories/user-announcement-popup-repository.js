/**
 * 用户公告弹窗统计仓储。
 * 负责按“用户 + 公告”读取和累加首页公告弹窗关闭次数。
 */

/**
 * 查询某个用户对某条公告的弹窗关闭计数。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {number} announcementId - 公告 ID
 * @returns {Promise<Object|null>} 弹窗统计记录
 */
async function findByUserAndAnnouncement(db, userId, announcementId) {
  return db.prepare(`
    SELECT id, user_id, announcement_id, shown_count, last_shown_at, created_at, updated_at
    FROM user_announcement_popup_stats
    WHERE user_id = ? AND announcement_id = ?
  `).get(userId, announcementId);
}

/**
 * 记录一次弹窗关闭。
 * 核心分支：首次关闭时创建计数记录，后续关闭复用唯一键并原地累加 shown_count。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 关闭事件参数
 * @param {number} payload.userId - 用户 ID
 * @param {number} payload.announcementId - 公告 ID
 * @param {number} payload.shownAt - Unix 秒级时间戳
 * @returns {Promise<Object>} 数据库写入结果
 */
async function incrementShownCount(db, payload) {
  const { userId, announcementId, shownAt } = payload;

  return db.prepare(`
    INSERT INTO user_announcement_popup_stats (
      user_id, announcement_id, shown_count, last_shown_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_id, announcement_id) DO UPDATE SET
      shown_count = user_announcement_popup_stats.shown_count + 1,
      last_shown_at = EXCLUDED.last_shown_at,
      updated_at = EXCLUDED.updated_at
  `).run(userId, announcementId, 1, shownAt, shownAt);
}

module.exports = {
  findByUserAndAnnouncement,
  incrementShownCount
};
