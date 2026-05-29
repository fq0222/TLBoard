/**
 * 管理端仪表盘仓储
 * 负责读取仪表盘统计页依赖的数据库数据。
 */

/**
 * 查询仪表盘统计页所需的原始统计数据。
 *
 * @param {Object} db - 数据库实例
 * @param {number} todayTimestamp - 今日零点的 Unix 秒级时间戳
 * @returns {Promise<Object>} 原始统计数据
 */
async function getDashboardStats(db, todayTimestamp) {
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

  return {
    userCount,
    planCount,
    orderCount,
    serverCount,
    emailTodayCount,
    dailyLimitRow,
    campaignDailyLimitRow
  };
}

module.exports = {
  getDashboardStats
};
