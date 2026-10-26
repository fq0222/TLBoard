/**
 * 原始订阅服务：通过独立 Axios 客户端获取文本，并负责解析与协议筛选。
 */
const axios = require('axios');
const config = require('../../config');
const { buildXuiProxyConfig } = require('../../integrations/xui/xui-proxy-config');
const { createLogger } = require('../../utils/logger');
const xuiActivityTracker = require('../../utils/xui-activity-tracker');

const logger = createLogger('SUBSCRIPTION-SERVICE');
const SUBSCRIPTION_FETCH_TIMEOUT = 15000;

class SubscriptionService {
  /**
   * 创建订阅服务，绑定公开方法以兼容既有 CommonJS 解构调用。
   * @param {Object} [options={}] - 可注入依赖与默认连接设置。
   * @param {Object} [options.httpClient] - 独立 HTTP 客户端，省略时创建 Axios 实例。
   * @param {Object} [options.proxy] - 代理配置，省略时使用 config.xui.proxy；关闭时强制直连。
   * @param {number} [options.timeout=15000] - 有限正数默认超时，非法值回退到 15 秒。
   */
  constructor(options = {}) {
    this.timeout = Number.isFinite(options.timeout) && options.timeout > 0
      ? options.timeout
      : SUBSCRIPTION_FETCH_TIMEOUT;
    this.httpClient = options.httpClient || this.createHttpClient(
      options.proxy === undefined ? config.xui?.proxy : options.proxy
    );
    this.fetchOriginalSubscription = this.fetchOriginalSubscription.bind(this);
    this.parseSubscriptionContent = this.parseSubscriptionContent.bind(this);
    this.pickSingleNodeLink = this.pickSingleNodeLink.bind(this);
    this.getProtocolAliases = this.getProtocolAliases.bind(this);
  }

  /**
   * 创建不携带面板 Authorization 的订阅专用 Axios 实例。
   * @param {Object} [proxy={}] - 统一代理配置；关闭时显式设置 false，避免环境代理介入。
   * @returns {Object} 文本 HTTP 客户端，代理失败不回退，最终状态由业务方法检查。
   */
  createHttpClient(proxy = {}) {
    return axios.create({
      timeout: this.timeout,
      proxy: buildXuiProxyConfig(proxy),
      maxRedirects: 5,
      responseType: 'stream',
      validateStatus: () => true,
      headers: {
        Accept: 'text/plain, */*',
        Authorization: false,
        'User-Agent': 'subscription-manager-subscription/1.0.0'
      }
    });
  }

  /**
   * 获取原始订阅，后台请求先等待前台空闲，任意完成分支均释放活动计数。
   * @param {string} subUrl - 订阅基础地址，保留既有与 subId 直接拼接的行为。
   * @param {string} subId - 节点订阅 token。
   * @param {Object} [options={}] - 单次请求选项。
   * @param {number} [options.timeout] - 有限正数时覆盖实例超时，其他值沿用默认值。
   * @returns {Promise<string>} 原始文本；非 200 拒绝，Axios 超时映射为稳定业务错误。
   */
  async fetchOriginalSubscription(subUrl, subId, options = {}) {
    const source = xuiActivityTracker.getCurrentSource();
    if (source === 'background') {
      await xuiActivityTracker.waitForForegroundIdle();
    }
    const timeout = Number.isFinite(options.timeout) && options.timeout > 0
      ? options.timeout
      : this.timeout;
    xuiActivityTracker.beginRequest(source);
    try {
      const response = await this.httpClient.get(`${subUrl}${subId}`, {
        timeout,
        responseType: 'stream',
        // 先接收最终响应头再读正文，避免错误状态被悬挂正文或读取超时掩盖。
        transformResponse: [data => data],
        headers: { Authorization: false }
      });
      if (response.status !== 200) {
        response.data?.destroy?.();
        throw new Error(`获取原始订阅失败，HTTP 状态码: ${response.status}`);
      }
      return await this.readResponseContent(response, timeout);
    } catch (error) {
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        const timeoutError = new Error(`获取原始订阅超时: ${timeout}ms`);
        timeoutError.code = 'SUBSCRIPTION_FETCH_TIMEOUT';
        throw timeoutError;
      }
      if (error.response && error.response.status !== 200) {
        throw new Error(`获取原始订阅失败，HTTP 状态码: ${error.response.status}`);
      }
      throw error;
    } finally {
      xuiActivityTracker.endRequest(source);
    }
  }

  /**
   * 读取 Axios 响应流，并用实际 socket 超时事件区分读取超时和主动断流。
   * @param {Object} response - Axios 响应；注入客户端直接返回文本时保持兼容。
   * @param {number} timeout - 当前有效超时，单位毫秒，用于稳定错误文案。
   * @returns {Promise<string>} 完整 UTF-8 正文；超时优先分类，确认提前断流时使用原业务文案。
   */
  async readResponseContent(response, timeout) {
    const body = response.data;
    if (!body || typeof body[Symbol.asyncIterator] !== 'function') {
      return body;
    }
    const socket = response.request?.socket;
    let timedOut = false;
    const markTimeout = () => { timedOut = true; };
    // 必须早于底层销毁连接的监听器标记来源，不能把所有 aborted 都当作超时。
    socket?.prependOnceListener('timeout', markTimeout);
    try {
      const chunks = [];
      for await (const chunk of body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks).toString('utf-8');
    } catch (error) {
      if (timedOut) {
        const timeoutError = new Error(`获取原始订阅超时: ${timeout}ms`);
        timeoutError.code = 'SUBSCRIPTION_FETCH_TIMEOUT';
        throw timeoutError;
      }
      const incomingResponse = response.request?.res || body;
      if (incomingResponse.aborted && !incomingResponse.complete) {
        throw new Error('获取原始订阅失败：响应在完成前中断');
      }
      throw error;
    } finally {
      socket?.removeListener('timeout', markTimeout);
    }
  }

  /**
   * 规范化协议名，兼容 3X-UI inbound 协议与订阅链接协议名称不一致的场景。
   * @param {string} protocol - 原始协议名
   * @returns {string[]} 可接受的协议名列表，首个元素为规范名
   */
  getProtocolAliases(protocol) {
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
   * 解析订阅内容为节点链接数组
   * @param {string} content - 订阅内容（Base64 编码）
   * @returns {string[]} 节点链接数组
   */
  parseSubscriptionContent(content) {
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
  pickSingleNodeLink(links, expectedProtocol) {
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

    const protocolAliases = new Set(this.getProtocolAliases(expectedProtocol));

    return validLinks.find(link => {
      const protocolMatch = link.match(/^([a-z0-9+.-]+):\/\//i);
      if (!protocolMatch) {
        return false;
      }

      return protocolAliases.has(protocolMatch[1].toLowerCase());
    }) || null;
  }
}

module.exports = new SubscriptionService();
module.exports.SubscriptionService = SubscriptionService;
