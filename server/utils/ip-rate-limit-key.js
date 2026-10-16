/**
 * 公网接口共享的 IP 限流键生成器。
 * 职责：IPv6 按 /64 归并，防止同一网段轮换地址绕过额度；IPv4 保持单地址配额。
 */
const ipaddr = require('ipaddr.js');

/**
 * 从可信代理配置解析出的 ip 生成稳定键，不自行读取或信任转发请求头。
 * 核心分支：IPv4-mapped IPv6 先还原 IPv4；原生 IPv6 清空低 64 位；无效/缺失地址保留安全兜底。
 * @param {string} ip - Express req.ip 或 socket.remoteAddress
 * @returns {string} IPv4 地址、IPv6 /64 网络地址或原始兜底键
 */
function getIpRateLimitKey(ip) {
  const value = String(ip || 'unknown');
  try {
    const address = ipaddr.process(value);
    if (address.kind() === 'ipv4') return address.toString();
    const bytes = address.toByteArray();
    bytes.fill(0, 8);
    return `${ipaddr.fromByteArray(bytes).toNormalizedString()}/64`;
  } catch (error) {
    return value;
  }
}

module.exports = getIpRateLimitKey;
