/**
 * 创建管理端 Express 应用
 * 负责装配管理端中间件、限流、健康检查和路由注册，保持现有启动语义不变
 * @param {Object} params 创建参数
 * @param {Object} params.db 数据库实例
 * @param {Object} params.logger 日志实例
 * @returns {import('express').Express}
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const registerAdminRoutes = require('./register-admin-routes');
const telegramInternalRoutes = require('../routes/internal/telegram');

function createAdminApp({ db, logger }) {
  const app = express();

  app.locals.db = db;
  app.set('trust proxy', true);

  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  }));
  app.use(morgan('short', { stream: { write: (msg) => logger.info(`[ADMIN] ${msg.trim()}`) } }));
  app.use(express.json({
    limit: config.security.maxRequestBodySize,
    verify(req, res, buf) {
      req.rawBody = buf.toString('utf8');
    }
  }));
  app.use(express.urlencoded({ extended: true, limit: config.security.maxRequestBodySize }));
  app.use((req, res, next) => {
    if (req.rawBody === undefined) {
      req.rawBody = '';
    }
    next();
  });

  const adminLimiter = rateLimit({
    windowMs: config.security.rateLimitWindow,
    max: config.security.rateLimitMax,
    message: { code: 429, message: '请求过于频繁，请稍后再试', data: null }
  });
  app.use('/api/admin/login', adminLimiter);

  app.get('/health', (req, res) => {
    res.json({ code: 0, message: 'ok', data: { status: 'healthy', port: config.admin.port, timestamp: Date.now() } });
  });

  app.use(telegramInternalRoutes);
  registerAdminRoutes(app, logger);

  return app;
}

module.exports = createAdminApp;
