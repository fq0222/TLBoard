/**
 * 统一启动入口
 * 同时启动用户端(30000)和管理端(30001)Express应用
 * 共享同一个数据库实例
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const databaseManager = require('./db/init');
const { startAllJobs, stopAllJobs } = require('./jobs');
const { createLogger } = require('./utils/logger');

const logger = createLogger('APP');

// 保存服务器实例引用
let userServer = null;
let adminServer = null;
let db = null;

// ============ 用户端路由 ============
const userAuthRoutes = require('./routes/user/auth');
const userPlansRoutes = require('./routes/user/plans');
const userOrdersRoutes = require('./routes/user/orders');
const userSubscriptionRoutes = require('./routes/user/subscription');
const userAnnouncementsRoutes = require('./routes/user/announcements');
const userCfOptimizeRoutes = require('./routes/user/cf-optimize');
const userPaymentRoutes = require('./routes/user/payment');
const userRenewRoutes = require('./routes/user/renew');
const userTicketsRoutes = require('./routes/user/tickets');
const userEmailRoutes = require('./routes/user/email');

// ============ 管理端路由 ============
const adminAuthRoutes = require('./routes/admin/auth');
const adminAdminsRoutes = require('./routes/admin/admins');
const adminServersRoutes = require('./routes/admin/servers');
const adminPlansRoutes = require('./routes/admin/plans');
const adminUsersRoutes = require('./routes/admin/users');
const adminOrdersRoutes = require('./routes/admin/orders');
const adminAnnouncementsRoutes = require('./routes/admin/announcements');
const adminCfIpsRoutes = require('./routes/admin/cf-ips');
const adminDashboardRoutes = require('./routes/admin/dashboard');
const adminTicketsRoutes = require('./routes/admin/tickets');
const adminEmailRoutes = require('./routes/admin/email');

async function startApp() {
  // 初始化数据库
  try {
    db = await databaseManager.init();
    logger.info('数据库初始化成功');
  } catch (error) {
    logger.error(`数据库初始化失败: ${error.message}`);
    process.exit(1);
  }

  // 启动定时任务
  startAllJobs(db);

  // ============ 用户端应用 ============
  const userApp = express();
  userApp.locals.db = db;

  userApp.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  userApp.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
  userApp.use(morgan('short', { stream: { write: (msg) => logger.info(`[USER] ${msg.trim()}`) } }));
  userApp.use(express.json({ limit: config.security.maxRequestBodySize }));
  userApp.use(express.urlencoded({ extended: true, limit: config.security.maxRequestBodySize }));

  userApp.get('/health', (req, res) => {
    res.json({ code: 0, message: 'ok', data: { status: 'healthy', port: config.user.port, timestamp: Date.now() } });
  });

  const userPrefix = '/api/user';
  userApp.use(userPrefix, userAuthRoutes);
  userApp.use(`${userPrefix}/plans`, userPlansRoutes);
  userApp.use(`${userPrefix}/orders`, userOrdersRoutes);
  userApp.use(`${userPrefix}/subscription`, userSubscriptionRoutes);
  userApp.use(`${userPrefix}/announcements`, userAnnouncementsRoutes);
  userApp.use(`${userPrefix}/cf-ips`, userCfOptimizeRoutes);
  userApp.use(`${userPrefix}/payment`, userPaymentRoutes);
  userApp.use(`${userPrefix}/renew`, userRenewRoutes);
  userApp.use(`${userPrefix}/tickets`, userTicketsRoutes);
userApp.use(`${userPrefix}/email`, userEmailRoutes);

  userApp.use((req, res) => {
    res.status(404).json({ code: 404, message: '接口不存在', data: null });
  });
  userApp.use((err, req, res, next) => {
    logger.error(`[USER] 服务器错误: ${err.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  });

  // ============ 管理端应用 ============
  const adminApp = express();
  adminApp.locals.db = db;

  adminApp.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  adminApp.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'], credentials: true }));
  adminApp.use(morgan('short', { stream: { write: (msg) => logger.info(`[ADMIN] ${msg.trim()}`) } }));
  adminApp.use(express.json({ limit: config.security.maxRequestBodySize }));
  adminApp.use(express.urlencoded({ extended: true, limit: config.security.maxRequestBodySize }));

  const adminLimiter = rateLimit({
    windowMs: config.security.rateLimitWindow,
    max: config.security.rateLimitMax,
    message: { code: 429, message: '请求过于频繁，请稍后再试', data: null }
  });
  adminApp.use('/api/admin/login', adminLimiter);

  adminApp.get('/health', (req, res) => {
    res.json({ code: 0, message: 'ok', data: { status: 'healthy', port: config.admin.port, timestamp: Date.now() } });
  });

  const adminPrefix = '/api/admin';
  adminApp.use(adminPrefix, adminAuthRoutes);
  adminApp.use(`${adminPrefix}/admins`, adminAdminsRoutes);
  adminApp.use(`${adminPrefix}/servers`, adminServersRoutes);
  adminApp.use(`${adminPrefix}/plans`, adminPlansRoutes);
  adminApp.use(`${adminPrefix}/users`, adminUsersRoutes);
  adminApp.use(`${adminPrefix}/orders`, adminOrdersRoutes);
  adminApp.use(`${adminPrefix}/announcements`, adminAnnouncementsRoutes);
  adminApp.use(`${adminPrefix}/cf-ips`, adminCfIpsRoutes);
  adminApp.use(`${adminPrefix}/dashboard`, adminDashboardRoutes);
  adminApp.use(`${adminPrefix}/tickets`, adminTicketsRoutes);
adminApp.use(`${adminPrefix}/email`, adminEmailRoutes);

  adminApp.use((req, res) => {
    res.status(404).json({ code: 404, message: '接口不存在', data: null });
  });
  adminApp.use((err, req, res, next) => {
    logger.error(`[ADMIN] 服务器错误: ${err.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  });

  // ============ 启动服务器 ============
  userServer = userApp.listen(config.user.port, () => {
    logger.info(`用户端服务器启动成功，端口: ${config.user.port}`);
  });

  adminServer = adminApp.listen(config.admin.port, () => {
    logger.info(`管理端服务器启动成功，端口: ${config.admin.port}`);
  });
}

/**
 * 优雅关闭服务器
 * 1. 停止接受新连接
 * 2. 等待现有请求完成
 * 3. 关闭数据库连接
 * 4. 退出进程
 */
async function gracefulShutdown(signal) {
  logger.info(`收到${signal}信号，正在优雅关闭服务器...`);
  
  // 停止所有定时任务
  stopAllJobs();
  
  // 设置超时强制退出（10秒）
  const forceExitTimeout = setTimeout(() => {
    logger.error('关闭超时，强制退出');
    process.exit(1);
  }, 10000);

  try {
    // 1. 关闭用户端服务器
    if (userServer) {
      await new Promise((resolve) => {
        userServer.close(() => {
          logger.info('用户端服务器已关闭');
          resolve();
        });
      });
    }

    // 2. 关闭管理端服务器
    if (adminServer) {
      await new Promise((resolve) => {
        adminServer.close(() => {
          logger.info('管理端服务器已关闭');
          resolve();
        });
      });
    }

    // 3. 关闭数据库连接池
    logger.info('正在关闭数据库连接...');
    await databaseManager.close();
    logger.info('数据库连接已关闭');

    // 清除超时定时器
    clearTimeout(forceExitTimeout);

    logger.info('服务器已安全关闭');
    process.exit(0);
  } catch (error) {
    logger.error(`关闭过程中发生错误: ${error.message}`);
    clearTimeout(forceExitTimeout);
    process.exit(1);
  }
}

// 启动应用
startApp();

// 监听退出信号
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// 监听未捕获的异常
process.on('uncaughtException', (error) => {
  logger.error(`未捕获的异常: ${error.message}`);
  logger.error(error.stack);
  gracefulShutdown('uncaughtException');
});

// 监听未处理的Promise拒绝
process.on('unhandledRejection', (reason, promise) => {
  logger.error(`未处理的Promise拒绝: ${reason}`);
  gracefulShutdown('unhandledRejection');
});