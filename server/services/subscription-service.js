/**
 * 订阅服务模块
 * 处理订阅内容的获取和解析
 */

const https = require('https');
const http = require('http');
const { createLogger } = require('../utils/logger');

const logger = createLogger('SUBSCRIPTION-SERVICE');

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
    
    client.get(fullUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
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

module.exports = {
  fetchOriginalSubscription,
  parseSubscriptionContent
};
