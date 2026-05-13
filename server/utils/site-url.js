/**
 * 站点 URL 工具函数
 * 用于生成订阅链接等需要完整 URL 的场景
 */

const config = require('../config');

/**
 * 获取站点基础 URL
 * 优先使用配置文件中的协议和域名
 * 如果未配置，则从请求中推断
 * 
 * @param {Object} req - Express 请求对象（可选）
 * @returns {string} 站点基础 URL，如 https://example.com
 */
function getSiteBaseUrl(req) {
  // 优先使用配置
  const protocol = config.site.protocol || 'http';
  let host = config.site.host || '';

  // 如果配置中没有 host，则从请求中获取
  if (!host && req) {
    host = req.get('host') || '';
  }

  // 如果仍然没有 host，返回空字符串
  if (!host) {
    return '';
  }

  return `${protocol}://${host}`;
}

/**
 * 生成订阅链接
 * @param {Object} req - Express 请求对象
 * @param {string} subId - 订阅 ID
 * @returns {Object} 包含 subscription_url 和 clash_url 的对象
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
