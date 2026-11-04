/**
 * 创建用户端 Express 应用
 * 负责装配用户端中间件、健康检查和路由注册，保持现有启动语义不变
 * @param {Object} params 创建参数
 * @param {Object} params.db 数据库实例
 * @param {Object} params.logger 日志实例
 * @param {Object} [params.routeBlocker] 双端共享的未注册路由封禁器，可注入独立测试状态
 * @returns {import('express').Express}
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const config = require('../config');
const registerUserRoutes = require('./register-user-routes');
const { shouldSkipSuccessfulRangeDownloadLog } = require('../middleware/download-log-filter');
const { unregisteredRouteBlocker } = require('../middleware/unregistered-route-blocker');

function createUserApp({ db, logger, routeBlocker = unregisteredRouteBlocker }) {
  const app = express();

  app.locals.db = db;
  app.set('trust proxy', 2);

  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  // 先拦截所有封禁请求，避免 CORS 预检或请求体解析提前结束响应。
  app.use(routeBlocker.createGuardMiddleware());
  app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
  app.use(morgan('short', {
    skip: shouldSkipSuccessfulRangeDownloadLog,
    stream: { write: (msg) => logger.info(`[USER] ${msg.trim()}`) }
  }));
  app.use(express.json({ limit: config.security.maxRequestBodySize }));
  app.use(express.urlencoded({ extended: true, limit: config.security.maxRequestBodySize }));

  app.get('/health', (req, res) => {
    res.json({ code: 0, message: 'ok', data: { status: 'healthy', port: config.user.port, timestamp: Date.now() } });
  });

  registerUserRoutes(app, logger, routeBlocker);

  return app;
}

module.exports = createUserApp;
