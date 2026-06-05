const assert = require('assert');
const announcementsService = require('../services/user/announcements-service');

/**
 * 创建公告弹窗服务测试用假数据库。
 * 只实现本测试会触发的 prepare().get() 和 prepare().run() 分支，避免依赖真实 PostgreSQL。
 *
 * @param {Object} state - 测试状态
 * @param {Object|null} state.latestAnnouncement - 最新启用公告
 * @param {Object|null} state.announcementById - 按 ID 查询到的公告
 * @param {Object|null} state.popupStat - 用户公告弹窗计数
 * @returns {Object} 假数据库实例
 */
function createFakeDb(state) {
  return {
    prepare(sql) {
      return {
        get(...args) {
          if (sql.includes('FROM announcements') && sql.includes('ORDER BY created_at DESC')) {
            return state.latestAnnouncement;
          }

          if (sql.includes('FROM user_announcement_popup_stats')) {
            return state.popupStat;
          }

          if (sql.includes('FROM announcements') && sql.includes('WHERE id = ?')) {
            const [announcementId] = args;
            return state.announcementById?.id === announcementId ? state.announcementById : null;
          }

          return null;
        },
        run(userId, announcementId) {
          state.incrementPayload = { userId, announcementId };
          return { changes: 1 };
        }
      };
    }
  };
}

async function run() {
  const noAnnouncement = await announcementsService.getLatestAnnouncementPopup(
    createFakeDb({ latestAnnouncement: null }),
    1
  );
  assert.strictEqual(noAnnouncement.should_popup, false);
  assert.strictEqual(noAnnouncement.announcement, null);

  const disabledByLimit = await announcementsService.getLatestAnnouncementPopup(
    createFakeDb({
      latestAnnouncement: { id: 10, title: '公告', enabled: 1, popup_show_limit: 0 },
      popupStat: null
    }),
    1
  );
  assert.strictEqual(disabledByLimit.should_popup, false);

  const shouldPopup = await announcementsService.getLatestAnnouncementPopup(
    createFakeDb({
      latestAnnouncement: { id: 11, title: '公告', enabled: 1, popup_show_limit: 2 },
      popupStat: { shown_count: 1 }
    }),
    1
  );
  assert.strictEqual(shouldPopup.shown_count, 1);
  assert.strictEqual(shouldPopup.should_popup, true);

  const reachedLimit = await announcementsService.getLatestAnnouncementPopup(
    createFakeDb({
      latestAnnouncement: { id: 12, title: '公告', enabled: 1, popup_show_limit: 2 },
      popupStat: { shown_count: 2 }
    }),
    1
  );
  assert.strictEqual(reachedLimit.should_popup, false);

  const closeState = {
    announcementById: { id: 13, title: '公告', enabled: 1, popup_show_limit: 3 }
  };
  const closeResult = await announcementsService.reportAnnouncementPopupClose(
    createFakeDb(closeState),
    5,
    13
  );
  assert.strictEqual(closeResult.message, '公告弹窗关闭已记录');
  assert.deepStrictEqual(closeState.incrementPayload, { userId: 5, announcementId: 13 });

  await assert.rejects(
    () => announcementsService.reportAnnouncementPopupClose(
      createFakeDb({ announcementById: { id: 14, enabled: 0 } }),
      5,
      14
    ),
    /公告不存在或未启用/
  );

  console.log('公告弹窗服务测试通过');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
