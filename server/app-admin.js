/**
 * 管理端Express应用
 * 运行在30001端口，面向管理员提供API服务
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { body, query, validationResult } = require('express-validator');
const config = require('./config');
const databaseManager = require('./db/init');
const { createLogger } = require('./utils/logger');

// 导入路由模块
const authRoutes = require('./routes/admin/auth');
const adminsRoutes = require('./routes/admin/admins');
const serversRoutes = require('./routes/admin/servers');
const plansRoutes = require('./routes/admin/plans');
const usersRoutes = require('./routes/admin/users');
const ordersRoutes = require('./routes/admin/orders');
const announcementsRoutes = require('./routes/admin/announcements');
const cfIpsRoutes = require('./routes/admin/cf-ips');
const dashboardRoutes = require('./routes/admin/dashboard');
const emailRoutes = require('./routes/admin/email');

const logger = createLogger('ADMIN-APP');

// 创建Express应用
const app = express();

// 异步初始化数据库
let db;
async function initApp() {
  try {
    db = await databaseManager.init();
    app.locals.db = db;
    logger.info('数据库初始化成功');
  } catch (error) {
    logger.error(`数据库初始化失败: ${error.message}`);
    process.exit(1);
  }
}

// 启动应用
initApp();

// ============ 中间件配置 ============

// 安全头中间件
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// CORS配置（管理端更严格）
app.use(cors({
  origin: process.env.ADMIN_CORS_ORIGIN || 'http://localhost:3001',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// 请求日志中间件
app.use(morgan('combined', {
  stream: {
    write: (message) => logger.info(message.trim())
  }
}));

// 解析JSON请求体
app.use(express.json({ limit: config.security.maxRequestBodySize }));

// 解析URL编码请求体
app.use(express.urlencoded({ extended: true, limit: config.security.maxRequestBodySize }));

// 速率限制（管理端更严格）
const limiter = rateLimit({
  windowMs: config.security.rateLimitWindow,
  max: config.security.rateLimitMax,
  message: {
    code: 429,
    message: '请求过于频繁，请稍后再试',
    data: null
  },
  handler: (req, res) => {
    logger.warn(`速率限制触发: ${req.ip} - ${req.method} ${req.originalUrl}`);
    res.status(429).json({
      code: 429,
      message: '请求过于频繁，请稍后再试',
      data: null
    });
  }
});

// 应用速率限制到登录接口
app.use('/api/admin/login', limiter);

// ============ 路由配置 ============

// 健康检查接口
app.get('/health', (req, res) => {
  res.json({
    code: 0,
    message: 'ok',
    data: {
      status: 'healthy',
      timestamp: Date.now(),
      uptime: process.uptime()
    }
  });
});

// API路由前缀
const apiPrefix = '/api/admin';

// 认证相关路由
app.use(`${apiPrefix}`, authRoutes);

// 管理员管理路由
app.use(`${apiPrefix}/admins`, adminsRoutes);

// 3X-UI服务器管理路由
app.use(`${apiPrefix}/servers`, serversRoutes);

// 套餐管理路由
app.use(`${apiPrefix}/plans`, plansRoutes);

// 用户管理路由
app.use(`${apiPrefix}/users`, usersRoutes);

// 订单管理路由
app.use(`${apiPrefix}/orders`, ordersRoutes);

// 公告管理路由
app.use(`${apiPrefix}/announcements`, announcementsRoutes);

// Cloudflare优选IP池管理路由
app.use(`${apiPrefix}/cf-ips`, cfIpsRoutes);

// 仪表盘统计路由
app.use(`${apiPrefix}/dashboard`, dashboardRoutes);

// 邮件管理路由
app.use(`${apiPrefix}/email`, emailRoutes);

// ============ 错误处理 ============

// 404处理
app.use((req, res) => {
  logger.warn(`404 Not Found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    code: 404,
    message: '接口不存在',
    data: null
  });
});

// 全局错误处理
app.use((err, req, res, next) => {
  logger.error(`服务器错误: ${err.message}`);
  logger.error(err.stack);
  
  res.status(500).json({
    code: 500,
    message: '服务器内部错误',
    data: null
  });
});

// ============ 启动服务器 ============

const PORT = config.admin.port;

app.listen(PORT, () => {
  logger.info(`管理端服务器启动成功，端口: ${PORT}`);
  logger.info(`API地址: http://localhost:${PORT}/api/admin`);
  logger.info(`健康检查: http://localhost:${PORT}/health`);
});

// 优雅关闭
process.on('SIGINT', () => {
  logger.info('收到SIGINT信号，正在关闭服务器...');
  databaseManager.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('收到SIGTERM信号，正在关闭服务器...');
  databaseManager.close();
  process.exit(0);
});

module.exports = app;