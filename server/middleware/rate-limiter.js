const rateLimit = require('express-rate-limit');
const config = require('../config');

/**
 * 创建基于IP+邮箱的速率限制器
 * @param {Object} options - 配置选项
 * @returns {Function} Express中间件
 */
function createAuthLimiter(options = {}) {
  const {
    windowMs = config.security.rateLimitWindow,
    max = config.security.rateLimitMax,
    message = { code: 429, message: '登录尝试次数过多，请稍后再试', data: null }
  } = options;

  return rateLimit({
    windowMs,
    max,
    message,
    // 自定义keyGenerator：基于IP+邮箱组合
    keyGenerator: (req) => {
      const ip = req.ip || req.socket.remoteAddress;
      const email = req.body?.email || 'unknown';
      return `${ip}:${email}`;
    },
    // 设置Retry-After头
    headers: true,
    // 标准化响应格式
    handler: (req, res) => {
      res.status(429).json(options.message || { code: 429, message: '请求过于频繁', data: null });
    },
    // 跳过成功请求（只在失败响应时计数）
    skip: (req, res) => {
      return res.statusCode < 400;
    }
  });
}

// 用户端登录速率限制器
const userLoginLimiter = createAuthLimiter();

// 用户端注册速率限制器
const userRegisterLimiter = createAuthLimiter({
  message: { code: 429, message: '注册尝试次数过多，请稍后再试', data: null }
});

module.exports = {
  createAuthLimiter,
  userLoginLimiter,
  userRegisterLimiter
};
