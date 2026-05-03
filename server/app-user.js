/**
 * 用户端Express应用
 * 运行在30000端口，面向用户提供API服务
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { body, query, validationResult } = require('express-validator');
const config = require('./config');
const databaseManager = require('./db/init');
const { createLogger } = require('./utils/logger');

// 导入路由模块
const authRoutes = require('./routes/user/auth');
const plansRoutes = require('./routes/user/plans');
const ordersRoutes = require('./routes/user/orders');
const subscriptionRoutes = require('./routes/user/subscription');
const announcementsRoutes = require('./routes/user/announcements');
const cfOptimizeRoutes = require('./routes/user/cf-optimize');
const paymentRoutes = require('./routes/user/payment');

const logger = createLogger('USER-APP');

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
  contentSecurityPolicy: false, // 开发环境禁用CSP
  crossOriginEmbedderPolicy: false
}));

// CORS配置
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
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
const apiPrefix = '/api/user';

// 认证相关路由
app.use(`${apiPrefix}`, authRoutes);

// 套餐相关路由
app.use(`${apiPrefix}/plans`, plansRoutes);

// 订单相关路由
app.use(`${apiPrefix}/orders`, ordersRoutes);

// 订阅相关路由
app.use(`${apiPrefix}/subscription`, subscriptionRoutes);

// 公告相关路由
app.use(`${apiPrefix}/announcements`, announcementsRoutes);

// Cloudflare IP优选相关路由
app.use(`${apiPrefix}/cf-ips`, cfOptimizeRoutes);

// 支付回调路由
app.use(`${apiPrefix}/payment`, paymentRoutes);

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

const PORT = config.user.port;

app.listen(PORT, () => {
  logger.info(`用户端服务器启动成功，端口: ${PORT}`);
  logger.info(`API地址: http://localhost:${PORT}/api/user`);
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