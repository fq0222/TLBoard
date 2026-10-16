/**
 * Passkey 部署配置校验。
 * 职责：在用户端和管理端服务访问数据库前验证 RP/Origin、名称和固定安全参数，只读取可信配置而不接收请求头。
 */
const { isIP } = require('node:net');
const config = require('../../config');
const defaults = require('./passkey-defaults');

class PasskeyConfig {
  /**
   * 校验最终部署配置；生产必须使用无端口 HTTPS Origin，hostname 必须与 RP ID 精确一致。
   * 核心分支：缺失、类型错误或 URL/域名不合法统一返回兼容 controller 的 HTTP 503 业务错误。
   * 开发环境允许 localhost 和带端口的 HTTP Origin，以支持本地浏览器验证。
   */
  static assertAvailable() {
    const settings = config.webauthn;
    try {
      if (!settings || typeof settings.rpId !== 'string' || typeof settings.origin !== 'string') throw new Error();
      // 本地 config.js 被 Git 忽略；缺字段或错误类型必须明确失败，不能把上限比较变成 NaN。
      if (settings.maxPasskeys !== defaults.maxPasskeys || settings.challengeTtlSeconds !== defaults.challengeTtlSeconds ||
        typeof settings.rpName !== 'string' || !settings.rpName.trim()) throw new Error();
      const { rpId, origin } = settings;
      const labels = rpId.split('.');
      if (!rpId || rpId.length > 253 || isIP(rpId) || labels.some(label =>
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error();
      const url = new URL(origin);
      const production = process.env.NODE_ENV === 'production';
      if (url.hostname !== rpId || url.username || url.password || url.search || url.hash ||
        url.pathname !== '/' || !['https:', 'http:'].includes(url.protocol)) throw new Error();
      // 比较序列化后的 Origin 还会拒绝显式默认端口、尾斜杠及 URL 解析器宽松修正的输入。
      if (origin !== url.origin || (production && (url.protocol !== 'https:' || url.port || labels.length < 2))) {
        throw new Error();
      }
    } catch (error) {
      const unavailable = new Error('Passkey 服务暂不可用，请使用密码登录或联系管理员');
      unavailable.isLegacyBusinessError = true;
      unavailable.statusCode = 503;
      unavailable.code = 2110;
      unavailable.data = null;
      throw unavailable;
    }
  }
}

module.exports = PasskeyConfig;
