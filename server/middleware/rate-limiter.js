const rateLimit = require('express-rate-limit');
const config = require('../config');

/**
 * 创建基于 IP + 邮箱组合的认证频率限制器。
 * 职责：保护登录、注册等认证接口，成功请求不计入失败尝试窗口。
 *
 * @param {Object} options - 限流配置
 * @returns {Function} Express 中间件
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
    keyGenerator: (req) => {
      const ip = req.ip || req.socket.remoteAddress;
      const email = req.body?.email || 'unknown';
      return `${ip}:${email}`;
    },
    headers: true,
    skipSuccessfulRequests: true,
    handler: (req, res) => {
      res.status(429).json(message);
    }
  });
}

/**
 * 创建基于单 IP 的频率限制器。
 * 职责：保护邮件发送类接口，防止攻击者批量触发外发邮件。
 *
 * @param {Object} options - 限流配置
 * @returns {Function} Express 中间件
 */
function createIpLimiter(options = {}) {
  const {
    windowMs = 15 * 60 * 1000,
    max = 3,
    message = { code: 429, message: '请求过于频繁，请稍后再试', data: null }
  } = options;

  return rateLimit({
    windowMs,
    max,
    message,
    keyGenerator: (req) => req.ip || req.socket.remoteAddress || 'unknown',
    headers: true,
    handler: (req, res) => {
      res.status(429).json(message);
    }
  });
}

const userLoginLimiter = createAuthLimiter();

const userRegisterLimiter = createAuthLimiter({
  message: { code: 429, message: '注册尝试次数过多，请稍后再试', data: null }
});

// 密码重置邮件发送限制：单 IP 每 15 分钟最多 3 次。
const passwordResetEmailLimiter = createIpLimiter({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: { code: 429, message: '请求过于频繁，请15分钟后再试', data: null }
});

// 密码重置提交限制：单 IP 每 15 分钟最多 5 次，防止 Token 爆破和重复撞库。
const passwordResetSubmitLimiter = createIpLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { code: 429, message: '密码重置尝试过于频繁，请15分钟后再试', data: null }
});

module.exports = {
  createAuthLimiter,
  createIpLimiter,
  userLoginLimiter,
  userRegisterLimiter,
  passwordResetEmailLimiter,
  passwordResetSubmitLimiter
};
