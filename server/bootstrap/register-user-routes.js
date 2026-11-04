/**
 * 注册用户端路由
 * 负责统一挂载用户端 API 路由与兜底错误处理，保持现有接口语义不变
 * @param {import('express').Express} app Express 应用实例
 * @param {Object} logger 日志实例
 * @param {Object} [routeBlocker] 未注册路由封禁器，仅最终兜底命中时记录
 */

const userAuthRoutes = require('../routes/user/auth');
const userPasskeyRoutes = require('../routes/user/passkeys');
const userPlansRoutes = require('../routes/user/plans');
const userOrdersRoutes = require('../routes/user/orders');
const userSubscriptionRoutes = require('../routes/user/subscription');
const userAnnouncementsRoutes = require('../routes/user/announcements');
const userCfOptimizeRoutes = require('../routes/user/cf-optimize');
const userPaymentRoutes = require('../routes/user/payment');
const userRenewRoutes = require('../routes/user/renew');
const userTicketsRoutes = require('../routes/user/tickets');
const userEmailRoutes = require('../routes/user/email');
const userDownloadRoutes = require('../routes/user/download');
const userSyncStatusRoutes = require('../routes/user/sync-status');
const userHelpRoutes = require('../routes/user/help');
const userReferralRoutes = require('../routes/user/referral');
const userPublicSettingsRoutes = require('../routes/user/public-settings');
const userFeedbackRoutes = require('../routes/user/feedback');
const userWalletRoutes = require('../routes/user/wallet');
const { unregisteredRouteBlocker } = require('../middleware/unregistered-route-blocker');

function registerUserRoutes(app, logger, routeBlocker = unregisteredRouteBlocker) {
  const userPrefix = '/api/user';

  app.use(userPrefix, userAuthRoutes);
  app.use(`${userPrefix}/auth`, userPasskeyRoutes);
  app.use(`${userPrefix}/plans`, userPlansRoutes);
  app.use(`${userPrefix}/orders`, userOrdersRoutes);
  app.use(`${userPrefix}/subscription`, userSubscriptionRoutes);
  app.use(`${userPrefix}/announcements`, userAnnouncementsRoutes);
  app.use(`${userPrefix}/cf-ips`, userCfOptimizeRoutes);
  app.use(`${userPrefix}/payment`, userPaymentRoutes);
  app.use(`${userPrefix}/renew`, userRenewRoutes);
  app.use(`${userPrefix}/tickets`, userTicketsRoutes);
  app.use(`${userPrefix}/email`, userEmailRoutes);
  app.use(`${userPrefix}/download`, userDownloadRoutes);
  app.use(`${userPrefix}/sync-status`, userSyncStatusRoutes);
  app.use(`${userPrefix}/help`, userHelpRoutes);
  app.use(`${userPrefix}/referral`, userReferralRoutes);
  app.use(`${userPrefix}/public-settings`, userPublicSettingsRoutes);
  app.use(`${userPrefix}/feedback`, userFeedbackRoutes);
  app.use(`${userPrefix}/wallet`, userWalletRoutes);

  app.use((req, res) => {
    const { blocked, ipKey, blockDurationMs } = routeBlocker.recordNotFound(req);
    // 守卫已拦截有效封禁，此处只在首次建立封禁时记录 IP 与时长，避免泄露 URL/token。
    if (blocked) {
      logger.warn(`[USER] 未注册路由访问触发封禁: IP ${ipKey}，封禁 ${blockDurationMs / 60000} 分钟`);
    }
    res.status(404).json({ code: 404, message: '接口不存在', data: null });
  });

  app.use((err, req, res, next) => {
    logger.error(`[USER] 服务器错误: ${err.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  });
}

module.exports = registerUserRoutes;
