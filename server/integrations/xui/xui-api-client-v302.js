/**
 * 3X-UI 3.0.2 API 客户端。
 * 负责通过 API Token 鉴权访问当前项目已适配的 3X-UI 面板接口。
 */

const axios = require('axios');
const xuiActivityTracker = require('../../utils/xui-activity-tracker');

class XuiApiClientV302 {
  /**
   * 创建 3.0.2 版本客户端。
   * @param {string} baseURL - 3X-UI 面板地址，不包含尾部斜杠。
   * @param {string} apiToken - 3X-UI API Token。
   * @param {Object} options - 客户端配置。
   * @param {number} [options.timeout=30000] - 请求超时时间，单位毫秒。
   */
  constructor(baseURL, apiToken, options = {}) {
    if (!baseURL) {
      throw new Error('baseURL is required');
    }
    if (!apiToken) {
      throw new Error('apiToken is required');
    }

    this.version = '3.0.2';
    this.baseURL = baseURL.replace(/\/$/, '');
    this.apiToken = apiToken;
    this.basePath = '/panel/api/inbounds';
    this.serverBasePath = '/panel/api/server';
    this.api = axios.create({
      baseURL: this.baseURL,
      timeout: options.timeout || 30000,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 300,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'User-Agent': 'subscription-manager-xui-client/1.0.0'
      }
    });

    this.api.interceptors.request.use((config) => {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${this.apiToken}`;
      config.headers['X-Requested-With'] = 'XMLHttpRequest';
      return config;
    });

    this.api.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.code === 'ECONNABORTED') {
          throw new Error('Request timeout - server took too long to respond');
        }
        if (error.code === 'ENOTFOUND') {
          throw new Error(`Cannot connect to server: ${this.baseURL}`);
        }
        if (error.response) {
          const body = typeof error.response.data === 'string'
            ? error.response.data
            : JSON.stringify(error.response.data || {});
          throw new Error(`3X-UI API request failed with status ${error.response.status}: ${body}`);
        }
        throw error;
      }
    );
  }

  /**
   * API Token 模式下无需额外登录，这里保持旧接口兼容。
   * @returns {Promise<Object>} 兼容旧调用方的登录结果。
   */
  async login() {
    return { success: true, msg: 'Authenticated via API token' };
  }

  /**
   * 发送通用 JSON 请求。
   * @param {string} method - HTTP 方法。
   * @param {string} path - 请求路径。
   * @param {Object} [data] - 请求体。
   * @param {Object} [options={}] - 单次请求选项。
   * @param {number} [options.timeout] - Axios 单次请求超时；省略时沿用客户端默认值。
   * @returns {Promise<Object>} 接口响应数据。
   */
  async request(method, path, data, options = {}) {
    xuiActivityTracker.beginRequest();
    try {
      const response = await this.api.request({
        method,
        url: path,
        ...(data !== undefined ? { data } : {}),
        ...(options.timeout !== undefined ? { timeout: options.timeout } : {})
      });
      return response.data;
    } finally {
      xuiActivityTracker.endRequest();
    }
  }

  /**
   * 下载二进制资源，例如面板数据库。
   * @param {string} path - 下载路径。
   * @returns {Promise<Buffer>} 下载结果。
   */
  async download(path) {
    xuiActivityTracker.beginRequest();
    try {
      const response = await this.api.request({
        method: 'get',
        url: path,
        responseType: 'arraybuffer'
      });
      return response.data;
    } finally {
      xuiActivityTracker.endRequest();
    }
  }

  /**
   * 获取全部 inbound，并允许调用方覆盖本次请求超时。
   *
   * @param {Object} [options={}] - 单次请求选项，失败时由 Axios 异常链路处理。
   * @returns {Promise<Object>} 面板原始响应。
   */
  getInbounds(options = {}) {
    return this.request('get', `${this.basePath}/list`, undefined, options);
  }

  getInbound(id) {
    return this.request('get', `${this.basePath}/get/${id}`);
  }

  addInbound(inboundConfig) {
    return this.request('post', `${this.basePath}/add`, inboundConfig);
  }

  deleteInbound(id) {
    return this.request('post', `${this.basePath}/del/${id}`);
  }

  updateInbound(id, inboundConfig) {
    return this.request('post', `${this.basePath}/update/${id}`, inboundConfig);
  }

  addClient(clientConfig) {
    return this.request('post', `${this.basePath}/addClient`, clientConfig);
  }

  deleteClient(inboundId, clientId) {
    return this.request('post', `${this.basePath}/${inboundId}/delClient/${clientId}`);
  }

  deleteClientByEmail(inboundId, email) {
    return this.request('post', `${this.basePath}/${inboundId}/delClientByEmail/${email}`);
  }

  updateClient(clientId, clientConfig) {
    return this.request('post', `${this.basePath}/updateClient/${clientId}`, clientConfig);
  }

  getClientTrafficsByEmail(email) {
    return this.request('get', `${this.basePath}/getClientTraffics/${email}`);
  }

  getClientTrafficsById(id) {
    return this.request('get', `${this.basePath}/getClientTrafficsById/${id}`);
  }

  getClientIps(email) {
    return this.request('post', `${this.basePath}/clientIps/${email}`);
  }

  clearClientIps(email) {
    return this.request('post', `${this.basePath}/clearClientIps/${email}`);
  }

  resetClientTraffic(inboundId, email) {
    return this.request('post', `${this.basePath}/${inboundId}/resetClientTraffic/${email}`);
  }

  resetAllTraffics() {
    return this.request('post', `${this.basePath}/resetAllTraffics`);
  }

  resetAllClientTraffics(inboundId) {
    return this.request('post', `${this.basePath}/resetAllClientTraffics/${inboundId}`);
  }

  deleteDepletedClients(inboundId = -1) {
    return this.request('post', `${this.basePath}/delDepletedClients/${inboundId}`);
  }

  getOnlineClients() {
    return this.request('post', `${this.basePath}/onlines`);
  }

  getLastOnline() {
    return this.request('post', `${this.basePath}/lastOnline`);
  }

  updateClientTraffic(email, data) {
    return this.request('post', `${this.basePath}/updateClientTraffic/${email}`, data);
  }

  importInbound(data) {
    return this.request('post', `${this.basePath}/import`, data);
  }

  createBackup() {
    return this.request('get', `${this.basePath}/createbackup`);
  }

  getDb() {
    return this.download(`${this.serverBasePath}/getDb`);
  }

  /**
   * 获取 3X-UI 面板的 server/status 信息。
   * @returns {Promise<Object>} 服务器状态响应。
   */
  getServerStatus() {
    return this.request('get', `${this.serverBasePath}/status`);
  }
}

module.exports = XuiApiClientV302;
