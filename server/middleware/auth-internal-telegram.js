const crypto = require('crypto');
const config = require('../config');
const { createLogger } = require('../utils/logger');

const logger = createLogger('AUTH-TELEGRAM-INTERNAL');
const DEFAULT_ALLOWED_SKEW_SECONDS = 300;

/**
 * 构造 Telegram 内部接口签名原文。
 *
 * @param {Object} payload - 签名参数
 * @param {string} payload.method - HTTP 方法
 * @param {string} payload.path - 请求路径，包含查询字符串
 * @param {string} payload.timestamp - 秒级时间戳
 * @param {string} payload.rawBody - 原始请求体
 * @returns {string} HMAC 输入原文
 */
function buildTelegramSignaturePayload({ method, path, timestamp, rawBody }) {
  return [
    String(method || '').toUpperCase(),
    String(path || ''),
    String(timestamp || ''),
    String(rawBody || '')
  ].join('\n');
}

/**
 * 读取请求原始内容，确保空请求体也有稳定签名。
 *
 * @param {Object} req - Express 请求对象
 * @returns {string} 原始请求体字符串
 */
function getRequestRawBody(req) {
  if (typeof req.rawBody === 'string') {
    return req.rawBody;
  }

  if (req.body === undefined || req.body === null) {
    return '';
  }

  return JSON.stringify(req.body);
}

/**
 * 使用固定时序比较 HMAC 签名，避免长度差异导致异常抛出。
 *
 * @param {string} actual - 请求签名
 * @param {string} expected - 服务端签名
 * @returns {boolean} 是否一致
 */
function isTelegramSignatureValid(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ''), 'utf8');
  const expectedBuffer = Buffer.from(String(expected || ''), 'utf8');

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

/**
 * 创建 Telegram 内部接口鉴权中间件，便于测试注入配置。
 *
 * @param {Object} options - 中间件配置
 * @param {boolean} options.enabled - 是否启用内部接口
 * @param {string} options.secret - HMAC 密钥
 * @param {number} [options.allowedSkewSeconds] - 允许的时间戳偏移秒数
 * @returns {Function} Express 中间件
 */
function createTelegramInternalAuthMiddleware(options = {}) {
  const {
    enabled = !!config.telegram?.internalApiEnabled,
    secret = config.telegram?.internalApiSecret || '',
    allowedSkewSeconds = config.telegram?.internalApiAllowedSkewSeconds || DEFAULT_ALLOWED_SKEW_SECONDS
  } = options;

  return async function authenticateInternalTelegram(req, res, next) {
    if (!enabled) {
      logger.warn('Telegram 内部接口未启用');
      return res.status(404).json({
        code: 404,
        message: '接口不存在',
        data: null
      });
    }

    const client = req.headers['x-internal-client'];
    const timestamp = req.headers['x-internal-timestamp'];
    const signature = req.headers['x-internal-signature'];

    if (!client || !timestamp || !signature) {
      logger.warn('Telegram 内部鉴权缺少必要请求头');
      return res.status(401).json({
        code: 1002,
        message: '内部接口鉴权失败',
        data: null
      });
    }

    if (client !== 'telegram-bot') {
      logger.warn(`Telegram 内部鉴权客户端非法: ${client}`);
      return res.status(401).json({
        code: 1002,
        message: '内部接口鉴权失败',
        data: null
      });
    }

    const timestampNumber = Number(timestamp);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(timestampNumber) || Math.abs(now - timestampNumber) > allowedSkewSeconds) {
      logger.warn(`Telegram 内部鉴权时间戳超出允许范围: ${timestamp}`);
      return res.status(401).json({
        code: 1002,
        message: '内部接口鉴权失败',
        data: null
      });
    }

    const rawBody = getRequestRawBody(req);
    const path = req.originalUrl || req.path || '';
    const payload = buildTelegramSignaturePayload({
      method: req.method,
      path,
      timestamp,
      rawBody
    });
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    if (!isTelegramSignatureValid(signature, expectedSignature)) {
      logger.warn(`Telegram 内部鉴权签名不匹配: path=${path}`);
      return res.status(401).json({
        code: 1002,
        message: '内部接口鉴权失败',
        data: null
      });
    }

    req.telegramInternalClient = {
      client,
      timestamp: timestampNumber
    };
    return next();
  };
}

const authenticateInternalTelegram = createTelegramInternalAuthMiddleware();

module.exports = {
  authenticateInternalTelegram,
  buildTelegramSignaturePayload,
  createTelegramInternalAuthMiddleware
};

