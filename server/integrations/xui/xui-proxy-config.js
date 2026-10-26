/**
 * 统一构建 3X-UI Axios 请求使用的代理配置。
 */

/**
 * 根据代理开关与连接参数生成 Axios 代理配置。
 * @param {Object} [proxy={}] - 包含 enabled、protocol、host、port、username、password 的代理配置。
 * @returns {false|Object} 代理关闭时返回 false，启用且有效时返回 Axios 代理配置。
 * @throws {Error} 启用代理但连接参数无效或认证信息不完整时抛出错误。
 */
function buildXuiProxyConfig(proxy = {}) {
  if (!proxy.enabled) {
    return false;
  }

  const protocol = String(proxy.protocol || '').trim().replace(/:$/, '');
  const host = String(proxy.host || '').trim();
  const port = Number(proxy.port);

  if (!host) {
    throw new Error('3X-UI 代理主机不能为空');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('3X-UI 代理端口无效');
  }
  if (!['http', 'https'].includes(protocol)) {
    throw new Error('3X-UI 代理协议仅支持 http 或 https');
  }

  const axiosProxy = { protocol, host, port };
  const username = String(proxy.username || '');
  const password = String(proxy.password || '');
  if ((username && !password) || (!username && password)) {
    throw new Error('3X-UI 代理用户名和密码必须同时配置');
  }
  if (username || password) {
    axiosProxy.auth = { username, password };
  }

  return axiosProxy;
}

module.exports = { buildXuiProxyConfig };
