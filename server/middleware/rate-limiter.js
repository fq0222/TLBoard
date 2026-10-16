const rateLimit = require('express-rate-limit');
const config = require('../config');
const getIpRateLimitKey = require('../utils/ip-rate-limit-key');

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
    message = { code: 1003, message: '您已连续输入3次错误密码，请15分钟后重试', data: null }
  } = options;

  return rateLimit({
    windowMs,
    max,
    message,
    keyGenerator: (req) => {
      const ip = getIpRateLimitKey(req.ip || req.socket.remoteAddress);
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
 * 创建基于 IP 的频率限制器：IPv4 按单地址、原生 IPv6 按 /64 共用额度。
 * 职责：保护邮件发送类接口，防止攻击者批量触发外发邮件。
 *
 * @param {Object} options - 限流配置
 * @returns {Function} Express 中间件
 */
function createIpLimiter(options = {}) {
  const {
    windowMs = 15 * 60 * 1000,
    max = 3,
    message = { code: 429, message: '请求过于频繁，请稍后再试', data: null },
    skipSuccessfulRequests = false
  } = options;

  return rateLimit({
    windowMs,
    max,
    message,
    keyGenerator: (req) => getIpRateLimitKey(req.ip || req.socket.remoteAddress),
    headers: true,
    skipSuccessfulRequests,
    handler: (req, res) => {
      res.status(429).json(message);
    }
  });
}

const userLoginLimiter = createAuthLimiter();

// 密码复验共用单个计数器：必须在 authenticateUser 后使用，仅信任 JWT 中的用户 ID。
// 注册选项和撤销交替请求仍累计失败；成功不占额度，也不清空当前窗口的既有失败。
const passkeyPasswordVerificationLimiter = rateLimit({
  windowMs: config.security.rateLimitWindow,
  max: config.security.rateLimitMax,
  keyGenerator: req => String(req.user.id),
  skipSuccessfulRequests: true,
  headers: true,
  message: { code: 1003, message: '密码复验尝试过于频繁，请稍后再试', data: null }
});

// 匿名挑战按 IPv4 地址 / IPv6 /64 独立限制签发量：每分钟最多 20 次，成功响应也计数，避免无限创建数据库记录。
// 验证仍沿用独立的失败窗口；成功登录不会清空或消耗挑战签发额度。
const passkeyLoginOptionsLimiter = createIpLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: { code: 1003, message: 'Passkey 登录尝试过于频繁，请稍后再试', data: null }
});
const passkeyLoginVerifyLimiter = createIpLimiter({
  windowMs: config.security.rateLimitWindow,
  max: config.security.rateLimitMax,
  message: { code: 1003, message: 'Passkey 登录尝试过于频繁，请稍后再试', data: null },
  skipSuccessfulRequests: true
});

const userRegisterLimiter = createAuthLimiter({
  message: { code: 1003, message: '您已连续尝试3次，请15分钟后重试', data: null }
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

// 订阅无效 token 限制：单 IP 每 15 分钟最多 3 次失败，成功订阅响应不计入。
const subscriptionInvalidTokenLimiter = createIpLimiter({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: { code: 429, message: '订阅链接尝试过于频繁，请15分钟后再试', data: null },
  skipSuccessfulRequests: true
});

module.exports = {
  createAuthLimiter,
  createIpLimiter,
  userLoginLimiter,
  passkeyPasswordVerificationLimiter,
  passkeyLoginOptionsLimiter,
  passkeyLoginVerifyLimiter,
  userRegisterLimiter,
  passwordResetEmailLimiter,
  passwordResetSubmitLimiter,
  subscriptionInvalidTokenLimiter
};
