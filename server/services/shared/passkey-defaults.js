/**
 * 受版本管理的 WebAuthn 固定安全配置；本地 config.js 复用此值，部署校验拒绝旧 TTL 或任意覆盖。
 * challengeTtlSeconds 同时约束浏览器选项和数据库挑战过期时间，maxPasskeys 为单用户绑定上限。
 */
module.exports = Object.freeze({ challengeTtlSeconds: 120, maxPasskeys: 2 });
