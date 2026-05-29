const config = require('../../config');

/**
 * 站点 URL 工具函数
 * 负责统一生成站点基础地址和订阅链接，供后续路由与服务层复用。
 */

/**
 * 获取站点基础 URL
 * 优先使用配置文件中的协议和域名；未配置 host 时再回退到请求头。
 *
 * @param {Object} [req] - Express 请求对象，可选
 * @returns {string} 站点基础 URL，例如 https://example.com
 */
function getSiteBaseUrl(req) {
  const protocol = (config.site && config.site.protocol) || 'http';
  let host = (config.site && config.site.host) || '';

  if (!host && req && typeof req.get === 'function') {
    host = req.get('host') || '';
  }

  if (!host) {
    return '';
  }

  return `${protocol}://${host}`;
}

/**
 * 生成订阅链接集合
 * 保持与旧工具一致的字段结构，避免影响现有调用方。
 *
 * @param {Object} req - Express 请求对象
 * @param {string} subId - 订阅 ID
 * @returns {{subscription_url: string, clash_url: string, v2ray_url: string}} 订阅链接对象
 */
function generateSubscriptionUrls(req, subId) {
  const baseUrl = getSiteBaseUrl(req);

  if (!baseUrl) {
    return {
      subscription_url: '',
      clash_url: '',
      v2ray_url: ''
    };
  }

  return {
    subscription_url: `${baseUrl}/api/user/subscription/sub/${subId}`,
    clash_url: `${baseUrl}/api/user/subscription/sub/${subId}?clash=1`,
    v2ray_url: `${baseUrl}/api/user/subscription/sub/${subId}?v2ray=1`
  };
}

module.exports = {
  getSiteBaseUrl,
  generateSubscriptionUrls
};
