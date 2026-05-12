/**
 * 管理端仪表盘路由
 * 获取系统统计数据
 */

const express = require('express');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const { createLogger } = require('../../utils/logger');

const router = express.Router();
const logger = createLogger('ADMIN-DASHBOARD');

/**
 * GET /api/admin/dashboard/stats
 * 获取系统统计数据
 */
router.get('/stats', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;

    // 获取今天的开始时间戳
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = Math.floor(today.getTime() / 1000);

    // 并行查询各项统计数据
    const [userCount, planCount, orderCount, serverCount, emailTodayCount, dailyLimitRow, campaignDailyLimitRow] = await Promise.all([
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
      emailDailyLimit: dailyLimitRow ? parseInt(dailyLimitRow.value) : 200,
      campaignDailyLimit: campaignDailyLimitRow ? parseInt(campaignDailyLimitRow.value) : 100
    };

    logger.info(`获取统计数据成功: ${JSON.stringify(stats)}`);

    res.json({
      code: 0,
      message: 'ok',
      data: stats
    });
  } catch (error) {
    logger.error(`获取统计数据错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

module.exports = router;
