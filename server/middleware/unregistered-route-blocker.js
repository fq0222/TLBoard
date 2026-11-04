/**
 * 单进程共享的未注册路由封禁器：按归一化 IP 累计扫描尝试并临时拒绝访问。
 * 只在兜底处理器主动记录时计数，守卫不改变正常请求的尝试次数。
 */
const config = require('../config');
const getIpRateLimitKey = require('../utils/ip-rate-limit-key');

/** 按来源顺序选择有限正整数；非法值跳过，末尾由调用方提供可靠的内置默认值。 */
function resolvePositiveInteger(...values) {
  for (const value of values) {
    if (typeof value !== 'number' && typeof value !== 'string') continue;
    const number = Number(value);
    if (Number.isFinite(number) && Number.isInteger(number) && number > 0) return number;
  }
}

class UnregisteredRouteBlocker {
  /**
   * @param {Object} options - 可注入 now、windowMs、maxAttempts、blockMs 和 cleanupIntervalMs。
   * cleanupIntervalMs 为 0 时禁用自动清理；其他场景定时清理且不阻止进程退出。
   */
  constructor(options = {}) {
    this.now = options.now ?? Date.now;
    // 显式测试注入优先；部署配置依次使用环境变量、配置字段和内置默认值，兼容旧 config.js。
    this.windowMs = resolvePositiveInteger(options.windowMs, process.env.UNREGISTERED_ROUTE_WINDOW_MS, config.security?.unregisteredRouteWindowMs, 600000);
    this.maxAttempts = resolvePositiveInteger(options.maxAttempts, process.env.UNREGISTERED_ROUTE_MAX_ATTEMPTS, config.security?.unregisteredRouteMaxAttempts, 2);
    this.blockMs = resolvePositiveInteger(options.blockMs, process.env.UNREGISTERED_ROUTE_BLOCK_MS, config.security?.unregisteredRouteBlockMs, 1800000);
    this.records = new Map();
    const cleanupIntervalMs = options.cleanupIntervalMs ?? 60 * 1000;
    this.cleanupTimer = null;
    if (cleanupIntervalMs > 0) {
      this.cleanupTimer = setInterval(() => this.cleanupExpired(), cleanupIntervalMs);
      this.cleanupTimer.unref();
    }
  }

  /** 创建前置守卫：有效封禁返回统一 429 JSON，边界到期立即放行。 */
  createGuardMiddleware() {
    return (req, res, next) => {
      const ipKey = getIpRateLimitKey(req.ip || req.socket?.remoteAddress);
      const record = this.records.get(ipKey);
      const now = this.now();
      if (record && record.blockedUntil !== null) {
        if (now < record.blockedUntil) {
          res.setHeader('Retry-After', Math.ceil((record.blockedUntil - now) / 1000));
          return res.status(429).json({ code: 429, message: '请求过于频繁，请稍后再试', data: null });
        }
        this.records.delete(ipKey);
      }
      return next();
    };
  }

  /**
   * 记录一次兜底路由命中；仅推进状态，不写响应，触发封禁的请求仍可返回 404。
   * @param {Object} req - 使用 Express req.ip，缺失时回退到 socket.remoteAddress。
   * @returns {{blocked: boolean, blockedUntil: number|null, ipKey: string, blockDurationMs: number}} 供兜底安全日志复用实际配置时长。
   */
  recordNotFound(req) {
    const ipKey = getIpRateLimitKey(req.ip || req.socket?.remoteAddress);
    const now = this.now();
    let record = this.records.get(ipKey);
    if (record && record.blockedUntil !== null && now < record.blockedUntil) {
      return { blocked: true, blockedUntil: record.blockedUntil, ipKey, blockDurationMs: this.blockMs };
    }
    // 封禁到期和尝试窗口到期均重建状态，避免旧计数导致立即再次封禁。
    if (!record || record.blockedUntil !== null || now >= record.windowStartedAt + this.windowMs) {
      record = { attempts: 0, windowStartedAt: now, blockedUntil: null };
      this.records.set(ipKey, record);
    }
    record.attempts += 1;
    if (record.attempts >= this.maxAttempts) {
      record.blockedUntil = now + this.blockMs;
    }
    return { blocked: record.blockedUntil !== null, blockedUntil: record.blockedUntil, ipKey, blockDurationMs: this.blockMs };
  }

  /** 清理到期状态；有效封禁不受原尝试窗口到期影响。 */
  cleanupExpired() {
    const now = this.now();
    for (const [ipKey, record] of this.records) {
      const deadline = record.blockedUntil ?? record.windowStartedAt + this.windowMs;
      if (now >= deadline) this.records.delete(ipKey);
    }
  }

  /** 停止自动清理，可重复调用；供测试及应用退出时释放定时器。 */
  close() {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

// 两个 Express 应用复用同一实例，确保用户端与管理端共享封禁状态。
const unregisteredRouteBlocker = new UnregisteredRouteBlocker();

module.exports = { UnregisteredRouteBlocker, unregisteredRouteBlocker };
