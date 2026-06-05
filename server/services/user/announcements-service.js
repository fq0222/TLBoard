const announcementRepository = require('../../repositories/announcement-repository');
const popupRepository = require('../../repositories/user-announcement-popup-repository');

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

/**
 * 获取当前用户首页弹窗公告信息。
 * 核心分支：
 * 1. 没有启用公告或最新公告配置为 0 次时，不返回可弹窗公告。
 * 2. 有可弹窗公告时，按“用户 + 公告”读取关闭计数并计算是否继续弹出。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 当前登录用户 ID
 * @returns {Promise<Object>} 弹窗公告、已关闭次数和是否应弹出
 */
async function getLatestAnnouncementPopup(db, userId) {
  const announcement = await announcementRepository.findLatestEnabledAnnouncement(db);

  if (!announcement || Number(announcement.popup_show_limit) <= 0) {
    return {
      announcement: null,
      shown_count: 0,
      should_popup: false
    };
  }

  const stat = await popupRepository.findByUserAndAnnouncement(db, userId, announcement.id);
  const shownCount = Number(stat?.shown_count || 0);
  const popupShowLimit = Number(announcement.popup_show_limit || 0);

  return {
    announcement,
    shown_count: shownCount,
    should_popup: shownCount < popupShowLimit
  };
}

/**
 * 记录用户关闭首页公告弹窗。
 * 只校验公告存在且仍启用，不重复判断 should_popup，避免关闭上报因边界状态阻塞用户流程。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 当前登录用户 ID
 * @param {number} announcementId - 公告 ID
 * @returns {Promise<Object>} 记录结果
 */
async function reportAnnouncementPopupClose(db, userId, announcementId) {
  const announcement = await announcementRepository.findAnnouncementById(db, announcementId);

  if (!announcement || Number(announcement.enabled) !== 1) {
    const error = new Error('公告不存在或未启用');
    error.statusCode = 404;
    throw error;
  }

  await popupRepository.incrementShownCount(db, {
    userId,
    announcementId,
    shownAt: Math.floor(Date.now() / 1000)
  });

  return {
    message: '公告弹窗关闭已记录'
  };
}

module.exports = {
  listAnnouncements,
  getLatestAnnouncementPopup,
  reportAnnouncementPopupClose
};
