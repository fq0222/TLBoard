/**
 * 管理端仪表盘路由
 * 获取系统统计数据。
 */

const express = require('express');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const { legacySuccess, legacyFail } = require('../../shared/response/api-response');
const { getUnixTimestamp, getStartOfToday } = require('../../shared/utils/time');
const { createLogger } = require('../../utils/logger');

const router = express.Router();
const logger = createLogger('ADMIN-DASHBOARD');

/**
 * GET /api/admin/dashboard/stats
 * 获取系统统计数据。
 */
router.get('/stats', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const todayTimestamp = getUnixTimestamp(getStartOfToday());

    const [
      userCount,
      planCount,
      orderCount,
      serverCount,
      emailTodayCount,
      dailyLimitRow,
      campaignDailyLimitRow
    ] = await Promise.all([
      db.prepare('SELECT COUNT(*) as count FROM users').get(),
      db.prepare('SELECT COUNT(*) as count FROM plans').get(),
      db.prepare('SELECT COUNT(*) as count FROM orders').get(),
      db.prepare('SELECT COUNT(*) as count FROM xui_servers').get(),
      db.prepare('SELECT COUNT(*) as count FROM email_logs WHERE created_at >= ?').get(todayTimestamp),
      db.prepare("SELECT value FROM system_settings WHERE key = 'brevo_daily_limit'").get(),
      db.prepare("SELECT value FROM system_settings WHERE key = 'brevo_campaign_daily_limit'").get()
    ]);

    const stats = {
      userCount: userCount.count || 0,
      planCount: planCount.count || 0,
      orderCount: orderCount.count || 0,
      serverCount: serverCount.count || 0,
      emailTodayCount: emailTodayCount.count || 0,
      emailDailyLimit: dailyLimitRow ? parseInt(dailyLimitRow.value, 10) : 200,
      campaignDailyLimit: campaignDailyLimitRow ? parseInt(campaignDailyLimitRow.value, 10) : 100
    };

    logger.info(`获取统计数据成功: ${JSON.stringify(stats)}`);

    return legacySuccess(res, stats);
  } catch (error) {
    logger.error(`获取统计数据错误: ${error.message}`);
    return legacyFail(res);
  }
});

module.exports = router;
