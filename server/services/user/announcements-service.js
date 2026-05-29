const announcementRepository = require('../../repositories/announcement-repository');

/**
 * 用户端公告服务
 * 负责组装用户端公告分页列表数据。
 */

/**
 * 获取用户端公告分页列表。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} pagination - 分页参数
 * @param {number} pagination.page - 当前页码
 * @param {number} pagination.limit - 每页条数
 * @param {number} pagination.offset - 偏移量
 * @returns {Promise<Object>} 公告分页结果
 */
async function listAnnouncements(db, pagination) {
  const { page, limit, offset } = pagination;
  const total = await announcementRepository.countEnabledAnnouncements(db);
  const announcements = await announcementRepository.findEnabledAnnouncements(db, {
    limit,
    offset
  });

  return {
    total,
    page,
    limit,
    list: announcements
  };
}

module.exports = {
  listAnnouncements
};
