/**
 * 注册管理端路由
 * 负责统一挂载管理端 API 路由与兜底错误处理，保持现有接口语义不变
 * @param {import('express').Express} app Express 应用实例
 * @param {Object} logger 日志实例
 */

const adminAuthRoutes = require('../routes/admin/auth');
const adminAdminsRoutes = require('../routes/admin/admins');
const adminServersRoutes = require('../routes/admin/servers');
const adminPlansRoutes = require('../routes/admin/plans');
const adminUsersRoutes = require('../routes/admin/users');
const adminOrdersRoutes = require('../routes/admin/orders');
const adminAnnouncementsRoutes = require('../routes/admin/announcements');
const adminCfIpsRoutes = require('../routes/admin/cf-ips');
const adminDashboardRoutes = require('../routes/admin/dashboard');
const adminTicketsRoutes = require('../routes/admin/tickets');
const adminEmailRoutes = require('../routes/admin/email');
const adminResourcesRoutes = require('../routes/admin/resources');
const adminBlogsRoutes = require('../routes/admin/blogs');
const adminSystemSettingsRoutes = require('../routes/admin/system-settings');
const adminReferralsRoutes = require('../routes/admin/referrals');
const adminTelegramRoutes = require('../routes/admin/telegram');

function registerAdminRoutes(app, logger) {
  const adminPrefix = '/api/admin';

  app.use(adminPrefix, adminAuthRoutes);
  app.use(`${adminPrefix}/admins`, adminAdminsRoutes);
  app.use(`${adminPrefix}/servers`, adminServersRoutes);
  app.use(`${adminPrefix}/plans`, adminPlansRoutes);
  app.use(`${adminPrefix}/users`, adminUsersRoutes);
  app.use(`${adminPrefix}/orders`, adminOrdersRoutes);
  app.use(`${adminPrefix}/announcements`, adminAnnouncementsRoutes);
  app.use(`${adminPrefix}/cf-ips`, adminCfIpsRoutes);
  app.use(`${adminPrefix}/dashboard`, adminDashboardRoutes);
  app.use(`${adminPrefix}/tickets`, adminTicketsRoutes);
  app.use(`${adminPrefix}/email`, adminEmailRoutes);
  app.use(`${adminPrefix}/resources`, adminResourcesRoutes);
  app.use(`${adminPrefix}/blogs`, adminBlogsRoutes);
  app.use(`${adminPrefix}/system-settings`, adminSystemSettingsRoutes);
  app.use(`${adminPrefix}/referrals`, adminReferralsRoutes);
  app.use(`${adminPrefix}/telegram`, adminTelegramRoutes);

  app.use((req, res) => {
    res.status(404).json({ code: 404, message: '接口不存在', data: null });
  });

  app.use((err, req, res, next) => {
    logger.error(`[ADMIN] 服务器错误: ${err.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  });
}

module.exports = registerAdminRoutes;
