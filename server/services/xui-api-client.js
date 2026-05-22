/**
 * 本地 3X-UI API 客户端
 * 适配 3X-UI v3 API Token 认证方式。
 */

const axios = require('axios');

class XuiApiClient {
  constructor(baseURL, apiToken, options = {}) {
    if (!baseURL) {
      throw new Error('baseURL is required');
    }
    if (!apiToken) {
      throw new Error('apiToken is required');
    }

    this.baseURL = baseURL.replace(/\/$/, '');
    this.apiToken = apiToken;
    this.basePath = '/panel/api/inbounds';
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

  async login() {
    return { success: true, msg: 'Authenticated via API token' };
  }

  async request(method, path, data) {
    const response = await this.api.request({
      method,
      url: path,
      ...(data !== undefined ? { data } : {})
    });
    return response.data;
  }

  getInbounds() {
    return this.request('get', `${this.basePath}/list`);
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
}

module.exports = XuiApiClient;
