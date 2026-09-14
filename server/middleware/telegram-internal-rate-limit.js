const { rateLimit } = require('express-rate-limit');
const ipaddr = require('ipaddr.js');

const AUTH_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const AUTH_FAILURE_MAX = 5;
const AUTH_SUCCESS_WINDOW_MS = 5 * 60 * 1000;
const AUTH_SUCCESS_MAX = 20;

/**
 * 将 IPv4、IPv6 及 IPv4 映射 IPv6 统一为稳定的限流键。
 * 无法解析的代理地址保留原值，避免异常输入导致鉴权流程中断。
 * @param {string} ip - Express 根据可信代理链解析出的客户端地址
 * @returns {string} 规范化后的 IP 地址
 */
function normalizeClientIp(ip) {
  const value = String(ip || 'unknown');
  try {
    return ipaddr.process(value).toNormalizedString();
  } catch (error) {
    return value;
  }
}

/**
 * 创建 Telegram 内部接口鉴权失败限流器。
 * 仅由鉴权失败分支调用，使用 Express 在可信代理配置下解析出的客户端 IP 作为键。
 * @returns {Function} Express 限流中间件
 */
function createTelegramAuthFailureLimiter() {
  return rateLimit({
    windowMs: AUTH_FAILURE_WINDOW_MS,
    max: AUTH_FAILURE_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => normalizeClientIp(req.ip || req.socket.remoteAddress),
    handler: (req, res) => res.status(429).json({
      code: 429,
      message: '内部接口鉴权失败次数过多，请15分钟后再试',
      data: null
    })
  });
}

/**
 * 创建 Telegram 内部接口鉴权成功限流器。
 * 以鉴权中间件确认的内部客户端标识为键，避免请求来源 IP 变化绕过配额。
 * @returns {Function} Express 限流中间件
 */
function createTelegramAuthenticatedClientLimiter() {
  return rateLimit({
    windowMs: AUTH_SUCCESS_WINDOW_MS,
    max: AUTH_SUCCESS_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.telegramInternalClient?.client || 'unknown-internal-client',
    handler: (req, res) => res.status(429).json({
      code: 429,
      message: '内部客户端请求过于频繁，请稍后再试',
      data: null
    })
  });
}

const telegramAuthFailureLimiter = createTelegramAuthFailureLimiter();
const telegramAuthenticatedClientLimiter = createTelegramAuthenticatedClientLimiter();

module.exports = {
  normalizeClientIp,
  createTelegramAuthFailureLimiter,
  createTelegramAuthenticatedClientLimiter,
  telegramAuthFailureLimiter,
  telegramAuthenticatedClientLimiter
};
