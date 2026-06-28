/**
 * 订阅服务模块
 * 处理订阅内容的获取和解析
 */

const https = require('https');
const http = require('http');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('SUBSCRIPTION-SERVICE');
const SUBSCRIPTION_FETCH_TIMEOUT = 15000;

/**
 * 规范化协议名，兼容 3X-UI inbound 协议与订阅链接协议名称不一致的场景。
 * @param {string} protocol - 原始协议名
 * @returns {string[]} 可接受的协议名列表，首个元素为规范名
 */
function getProtocolAliases(protocol) {
  const normalizedProtocol = String(protocol || '')
    .trim()
    .toLowerCase()
    .replace(/:\/+$/, '');

  if (!normalizedProtocol) {
    return [];
  }

  if (normalizedProtocol === 'hysteria' || normalizedProtocol === 'hy2') {
    return ['hysteria2', 'hysteria', 'hy2'];
  }

  return [normalizedProtocol];
}

/**
 * 从 3X-UI 获取原始订阅内容
 * @param {string} subUrl - 订阅地址
 * @param {string} subId - 订阅 token
 * @param {Object} [options={}] - 单次请求选项
 * @param {number} [options.timeout=15000] - 有限正数时覆盖默认超时；超时会销毁请求并拒绝
 * @returns {Promise<string>} 原始订阅内容
 */
async function fetchOriginalSubscription(subUrl, subId, options = {}) {
  return new Promise((resolve, reject) => {
    const fullUrl = `${subUrl}${subId}`;
    const client = fullUrl.startsWith('https') ? https : http;
    const timeout = Number.isFinite(options.timeout) && options.timeout > 0
      ? options.timeout
      : SUBSCRIPTION_FETCH_TIMEOUT;
    let request;
    let response;
    let settled = false;

    /**
     * 清理本次请求注册的事件，避免完成后残留监听器。
     *
     * @returns {void}
     */
    function cleanup() {
      request?.removeListener('error', handleRequestError);
      request?.removeListener('timeout', handleRequestTimeout);
      if (response) {
        response.removeListener('data', handleResponseData);
        response.removeListener('end', handleResponseEnd);
        response.removeListener('aborted', handleResponseAborted);
        response.removeListener('error', handleResponseError);
      }
    }

    /**
     * 统一完成 Promise；重复事件到达时直接忽略。
     *
     * @param {Error|null} error - 失败原因，空值表示成功。
     * @param {string} [value] - 成功时的响应正文。
     * @returns {void}
     */
    function settle(error, value) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (error) {
        reject(error);
        return;
      }
      resolve(value);
    }

    let data = '';

    /**
     * 累加响应正文片段。
     *
     * @param {Buffer|string} chunk - 本次收到的正文片段。
     * @returns {void}
     */
    function handleResponseData(chunk) {
      data += chunk;
    }

    /** @returns {void} 正常结束时返回完整正文。 */
    function handleResponseEnd() {
      settle(null, data);
    }

    /** @returns {void} 响应提前中断时拒绝请求。 */
    function handleResponseAborted() {
      settle(new Error('获取原始订阅失败：响应在完成前中断'));
    }

    /**
     * 响应流错误时拒绝请求。
     *
     * @param {Error} error - 响应流错误。
     * @returns {void}
     */
    function handleResponseError(error) {
      settle(error);
    }

    /**
     * 底层请求错误时拒绝请求。
     *
     * @param {Error} error - 请求错误。
     * @returns {void}
     */
    function handleRequestError(error) {
      settle(error);
    }

    /** @returns {void} 请求超时时销毁底层连接并携带明确的毫秒数。 */
    function handleRequestTimeout() {
      request.destroy(new Error(`获取原始订阅超时: ${timeout}ms`));
    }

    request = client.get(fullUrl, (res) => {
      response = res;
      if (res.statusCode !== 200) {
        res.resume();
        settle(new Error(`获取原始订阅失败，HTTP 状态码: ${res.statusCode}`));
        return;
      }

      res.on('data', handleResponseData);
      res.on('end', handleResponseEnd);
      res.on('aborted', handleResponseAborted);
      res.on('error', handleResponseError);
    });

    request.setTimeout(timeout, handleRequestTimeout);

    request.on('error', handleRequestError);
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

  const protocolAliases = new Set(getProtocolAliases(expectedProtocol));

  return validLinks.find(link => {
    const protocolMatch = link.match(/^([a-z0-9+.-]+):\/\//i);
    if (!protocolMatch) {
      return false;
    }

    return protocolAliases.has(protocolMatch[1].toLowerCase());
  }) || null;
}

module.exports = {
  fetchOriginalSubscription,
  parseSubscriptionContent,
  pickSingleNodeLink,
  getProtocolAliases
};
