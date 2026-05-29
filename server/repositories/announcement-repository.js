/**
 * 公告仓储
 * 负责读取用户端公告列表查询所需的 announcements 表数据。
 */

/**
 * 统计已启用公告总数。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<number>} 公告总数
 */
async function countEnabledAnnouncements(db) {
  const row = await db.prepare('SELECT COUNT(*) as count FROM announcements WHERE enabled = 1').get();
  return row.count;
}

/**
 * 分页查询已启用公告列表。
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

module.exports = {
  countEnabledAnnouncements,
  findEnabledAnnouncements
};
