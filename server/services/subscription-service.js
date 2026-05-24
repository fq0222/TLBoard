/**
 * 订阅服务模块
 * 处理订阅内容的获取和解析
 */

const https = require('https');
const http = require('http');
const { createLogger } = require('../utils/logger');

const logger = createLogger('SUBSCRIPTION-SERVICE');
const SUBSCRIPTION_FETCH_TIMEOUT = 15000;

/**
 * 从 3X-UI 获取原始订阅内容
 * @param {string} subUrl - 订阅地址
 * @param {string} subId - 订阅 token
 * @returns {Promise<string>} 原始订阅内容
 */
async function fetchOriginalSubscription(subUrl, subId) {
  return new Promise((resolve, reject) => {
    const fullUrl = `${subUrl}${subId}`;
    const client = fullUrl.startsWith('https') ? https : http;

    const request = client.get(fullUrl, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`获取原始订阅失败，HTTP 状态码: ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });

    request.setTimeout(SUBSCRIPTION_FETCH_TIMEOUT, () => {
      request.destroy(new Error(`获取原始订阅超时: ${SUBSCRIPTION_FETCH_TIMEOUT}ms`));
    });

    request.on('error', reject);
  });
}

/**
 * 解析订阅内容为节点链接数组
 * @param {string} content - 订阅内容（Base64 编码）
 * @returns {string[]} 节点链接数组
 */
function parseSubscriptionContent(content) {
  try {
    const decoded = Buffer.from(content, 'base64').toString('utf-8');
    return decoded.split('\n').filter(line => line.trim());
  } catch (error) {
    logger.error(`解析订阅内容失败: ${error.message}`);
    return [];
  }
}

/**
 * 从链接数组中挑选单个符合协议的节点链接
 * @param {string[]} links - 已解析的节点链接数组
 * @param {string} [expectedProtocol] - 期望协议，如 vmess / vless / trojan / ss
 * @returns {string|null} 匹配到的首个有效链接，未匹配到时返回 null
 */
function pickSingleNodeLink(links, expectedProtocol) {
  if (!Array.isArray(links) || links.length === 0) {
    return null;
  }

  const validLinks = links
    .filter(link => typeof link === 'string')
    .map(link => link.trim())
    .filter(Boolean);

  if (validLinks.length === 0) {
    return null;
  }

  if (!expectedProtocol) {
    return validLinks[0];
  }

  const normalizedProtocol = String(expectedProtocol)
    .trim()
    .toLowerCase()
    .replace(/:\/+$/, '');

  return validLinks.find(link => {
    const protocolMatch = link.match(/^([a-z0-9+.-]+):\/\//i);
    if (!protocolMatch) {
      return false;
    }

    return protocolMatch[1].toLowerCase() === normalizedProtocol;
  }) || null;
}

module.exports = {
  fetchOriginalSubscription,
  parseSubscriptionContent,
  pickSingleNodeLink
};
