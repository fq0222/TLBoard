/**
 * 3X-UI v3.10.2 独立 API 客户端。
 * 独立维护该版本的请求基础设施与接口映射，避免旧版本适配器变更产生连带影响。
 */

const axios = require('axios');
const xuiActivityTracker = require('../../utils/xui-activity-tracker');

/**
 * 构建 Axios 代理配置。
 * @param {Object} [proxy={}] - 代理开关及连接参数。
 * @returns {false|Object} 关闭代理时返回 false，否则返回经过校验的代理配置。
 */
function buildProxyConfig(proxy = {}) {
  if (!proxy.enabled) return false;

  const protocol = String(proxy.protocol || '').trim().replace(/:$/, '');
  const host = String(proxy.host || '').trim();
  const port = Number(proxy.port);
  if (!host) throw new Error('3X-UI 代理主机不能为空');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('3X-UI 代理端口无效');
  if (!['http', 'https'].includes(protocol)) throw new Error('3X-UI 代理协议仅支持 http 或 https');

  const result = { protocol, host, port };
  const username = String(proxy.username || '');
  const password = String(proxy.password || '');
  if ((username && !password) || (!username && password)) {
    throw new Error('3X-UI 代理用户名和密码必须同时配置');
  }
  if (username || password) result.auth = { username, password };
  return result;
}

/**
 * 归一化客户端启用状态。
 * @param {*} value - 当前项目传入的布尔、数字或字符串状态。
 * @returns {boolean} clients API 使用的布尔值；空值保持项目当前的默认启用语义。
 */
function normalizeClientEnabled(value) {
  if (value === null || value === undefined || value === '') return true;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  return normalized !== '0' && normalized !== 'false';
}

class XuiApiClientV3102 {
  /**
   * 创建 v3.10.2 客户端。
   * @param {string} baseURL - 3X-UI 面板地址。
   * @param {string} apiToken - 3X-UI API Token。
   * @param {Object} [options={}] - 超时与代理配置。
   */
  constructor(baseURL, apiToken, options = {}) {
    if (!baseURL) throw new Error('baseURL is required');
    if (!apiToken) throw new Error('apiToken is required');

    this.version = '3.10.2';
    this.supportsClientApi = true;
    this.baseURL = baseURL.replace(/\/$/, '');
    this.apiToken = apiToken;
    this.basePath = '/panel/api/inbounds';
    this.clientBasePath = '/panel/api/clients';
    this.serverBasePath = '/panel/api/server';
    this.api = axios.create({
      baseURL: this.baseURL,
      timeout: options.timeout || 30000,
      proxy: buildProxyConfig(options.proxy),
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
        if (error.code === 'ECONNABORTED') throw new Error('Request timeout - server took too long to respond');
        if (error.code === 'ENOTFOUND') throw new Error(`Cannot connect to server: ${this.baseURL}`);
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

  /** API Token 无需登录；保留旧服务层签名。 */
  async login() {
    return { success: true, msg: 'Authenticated via API token' };
  }

  /**
   * 发送 JSON 请求，并协调前后台 3X-UI 活动。
   * @param {string} method - HTTP 方法。
   * @param {string} path - API 路径。
   * @param {Object} [data] - JSON 请求体。
   * @param {Object} [options={}] - 单次请求选项，支持 timeout。
   * @returns {Promise<Object>} 3X-UI 原始响应体。
   */
  async request(method, path, data, options = {}) {
    const source = xuiActivityTracker.getCurrentSource();
    if (source === 'background') await xuiActivityTracker.waitForForegroundIdle();
    xuiActivityTracker.beginRequest(source);
    try {
      const response = await this.api.request({
        method,
        url: path,
        ...(data !== undefined ? { data } : {}),
        ...(options.timeout !== undefined ? { timeout: options.timeout } : {})
      });
      return response.data;
    } finally {
      xuiActivityTracker.endRequest(source);
    }
  }

  /**
   * 发送表单请求。
   * @param {string} method - HTTP 方法。
   * @param {string} path - API 路径。
   * @param {Object} [data={}] - 表单字段。
   * @param {Object} [options={}] - 单次请求选项。
   * @returns {Promise<Object>} 3X-UI 原始响应体。
   */
  async requestForm(method, path, data = {}, options = {}) {
    const source = xuiActivityTracker.getCurrentSource();
    if (source === 'background') await xuiActivityTracker.waitForForegroundIdle();
    xuiActivityTracker.beginRequest(source);
    try {
      const formData = new URLSearchParams();
      Object.entries(data || {}).forEach(([key, value]) => {
        formData.append(key, value === undefined || value === null ? '' : String(value));
      });
      const response = await this.api.request({
        method,
        url: path,
        data: formData,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        ...(options.timeout !== undefined ? { timeout: options.timeout } : {})
      });
      return response.data;
    } finally {
      xuiActivityTracker.endRequest(source);
    }
  }

  /** 下载二进制资源；path 为 server 下载接口路径。 */
  async download(path) {
    const source = xuiActivityTracker.getCurrentSource();
    if (source === 'background') await xuiActivityTracker.waitForForegroundIdle();
    xuiActivityTracker.beginRequest(source);
    try {
      const response = await this.api.request({ method: 'get', url: path, responseType: 'arraybuffer' });
      return response.data;
    } finally {
      xuiActivityTracker.endRequest(source);
    }
  }

  /** 解析旧 settings.clients[0] 调用形态。 */
  parseLegacyClientConfig(clientConfig) {
    if (!clientConfig || typeof clientConfig !== 'object') throw new Error('clientConfig is required');
    const inboundId = Number(clientConfig.id || 0);
    const settings = typeof clientConfig.settings === 'string'
      ? JSON.parse(clientConfig.settings || '{}')
      : (clientConfig.settings || {});
    const client = Array.isArray(settings.clients) ? settings.clients[0] : undefined;
    if (!client) throw new Error('clientConfig.settings.clients[0] is required');
    return { inboundId, client };
  }

  /**
   * 构建当前项目既有字段的 clients API payload。
   * 核心分支：仅透传项目已经管理的字段，不增加 v3.10.2 扩展字段。
   */
  buildClientApiPayload(client) {
    const payload = {
      email: client.email || '',
      enable: normalizeClientEnabled(client.enable),
      expiryTime: Number(client.expiryTime || 0),
      totalGB: Number(client.totalGB || 0),
      limitIp: Number(client.limitIp || 0),
      tgId: Number(client.tgId || 0),
      subId: client.subId || ''
    };
    ['id', 'flow', 'auth', 'password', 'security', 'comment', 'group'].forEach((field) => {
      if (client[field]) payload[field] = client[field];
    });
    if (client.reset !== undefined) payload.reset = Number(client.reset || 0);
    return payload;
  }

  /** 获取全部 inbound；流量同步继续依赖该接口。 */
  getInbounds(options = {}) { return this.request('get', `${this.basePath}/list`, undefined, options); }
  /** 按 ID 获取 inbound。 */
  getInbound(id) { return this.request('get', `${this.basePath}/get/${id}`); }
  /** 新增 inbound；inboundConfig 为当前业务配置。 */
  addInbound(inboundConfig) { return this.request('post', `${this.basePath}/add`, inboundConfig); }
  /** 更新指定 inbound。 */
  updateInbound(id, inboundConfig) { return this.request('post', `${this.basePath}/update/${id}`, inboundConfig); }
  /** 删除指定 inbound。 */
  deleteInbound(id) { return this.request('post', `${this.basePath}/del/${id}`); }
  /** 列出 clients API 中的全部客户端。 */
  listClients() { return this.request('get', `${this.clientBasePath}/list`); }
  /** 按邮箱获取客户端，邮箱始终进行 URL 编码。 */
  getClientByEmail(email) { return this.request('get', `${this.clientBasePath}/get/${encodeURIComponent(email)}`); }

  /**
   * 从 clients 列表将 UUID、auth 等标识解析成邮箱。
   * @param {string} identifier - 邮箱或客户端身份标识。
   * @returns {Promise<string>} 匹配到的邮箱。
   */
  async resolveClientEmail(identifier) {
    if (!identifier) throw new Error('client identifier is required');
    const result = await this.listClients();
    if (!result.success) throw new Error(result.msg || 'failed to list clients');
    const clients = Array.isArray(result.obj) ? result.obj : [];
    const matched = clients.find((item) => (
      item.email === identifier || item.uuid === identifier || item.id === identifier ||
      item.auth === identifier || item.password === identifier
    ));
    if (!matched || !matched.email) throw new Error(`client not found: ${identifier}`);
    return matched.email;
  }

  /** 新增客户端；兼容旧 settings 与新 client/inboundIds 两种形态。 */
  addClient(clientConfig) {
    if (clientConfig && clientConfig.client && Array.isArray(clientConfig.inboundIds)) {
      return this.request('post', `${this.clientBasePath}/add`, {
        client: this.buildClientApiPayload(clientConfig.client),
        inboundIds: clientConfig.inboundIds.map(Number).filter((id) => Number.isFinite(id) && id > 0)
      });
    }
    const { inboundId, client } = this.parseLegacyClientConfig(clientConfig);
    return this.request('post', `${this.clientBasePath}/add`, {
      client: this.buildClientApiPayload(client),
      inboundIds: [inboundId]
    });
  }

  /** 将客户端关联到有效 inbound IDs。 */
  attachClient(email, inboundIds) {
    return this.request('post', `${this.clientBasePath}/${encodeURIComponent(email)}/attach`, {
      inboundIds: (inboundIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0)
    });
  }
  /** 将客户端从指定 inbound IDs 解除关联。 */
  detachClient(email, inboundIds) {
    return this.request('post', `${this.clientBasePath}/${encodeURIComponent(email)}/detach`, {
      inboundIds: (inboundIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0)
    });
  }
  /** 兼容以 UUID 删除的旧签名，先解析邮箱再删除。 */
  async deleteClient(_inboundId, clientId) {
    const email = await this.resolveClientEmail(clientId);
    return this.request('post', `${this.clientBasePath}/del/${encodeURIComponent(email)}`);
  }
  /** 按邮箱删除客户端；inboundId 参数仅为兼容旧签名。 */
  deleteClientByEmail(_inboundId, email) {
    return this.request('post', `${this.clientBasePath}/del/${encodeURIComponent(email)}`);
  }
  /** 更新客户端；兼容旧 settings 与当前直接客户端对象。 */
  updateClient(clientId, clientConfig) {
    if (clientConfig && typeof clientConfig === 'object' && !clientConfig.settings) {
      const email = clientConfig.email || clientId;
      if (!email) throw new Error('client email is required for 3.10.2 updateClient');
      return this.request('post', `${this.clientBasePath}/update/${encodeURIComponent(email)}`,
        this.buildClientApiPayload({ ...clientConfig, email }));
    }
    const { client } = this.parseLegacyClientConfig(clientConfig);
    if (!client.email) throw new Error('client email is required for 3.10.2 updateClient');
    return this.request('post', `${this.clientBasePath}/update/${encodeURIComponent(client.email)}`,
      this.buildClientApiPayload(client));
  }

  /** 按邮箱获取客户端流量。 */
  getClientTrafficsByEmail(email) { return this.request('get', `${this.clientBasePath}/traffic/${encodeURIComponent(email)}`); }
  /** 兼容按身份标识查流量的旧签名，先解析邮箱。 */
  async getClientTrafficsById(id) { return this.getClientTrafficsByEmail(await this.resolveClientEmail(id)); }
  /** 查询客户端 IP。 */
  getClientIps(email) { return this.request('post', `${this.clientBasePath}/ips/${encodeURIComponent(email)}`); }
  /** 清理客户端 IP。 */
  clearClientIps(email) { return this.request('post', `${this.clientBasePath}/clearIps/${encodeURIComponent(email)}`); }
  /** 重置客户端在全部关联 inbound 上的流量。 */
  resetClientTraffic(email) { return this.request('post', `${this.clientBasePath}/resetTraffic/${encodeURIComponent(email)}`); }
  /** 查询在线客户端。 */
  getOnlineClients() { return this.request('post', `${this.clientBasePath}/onlines`); }
  /** 查询客户端最后在线时间。 */
  getLastOnline() { return this.request('post', `${this.clientBasePath}/lastOnline`); }
  /** 修改指定客户端流量。 */
  updateClientTraffic(email, data) { return this.request('post', `${this.clientBasePath}/updateTraffic/${encodeURIComponent(email)}`, data); }
  /** 重置所有 inbound 流量。 */
  resetAllTraffics() { return this.request('post', `${this.basePath}/resetAllTraffics`); }
  /** 重置指定 inbound 的全部客户端流量。 */
  resetAllClientTraffics(inboundId) { return this.request('post', `${this.basePath}/resetAllClientTraffics/${inboundId}`); }
  /** 删除耗尽流量的客户端，默认作用于全部 inbound。 */
  deleteDepletedClients(inboundId = -1) { return this.request('post', `${this.basePath}/delDepletedClients/${inboundId}`); }
  /** 导入 inbound 配置。 */
  importInbound(data) { return this.request('post', `${this.basePath}/import`, data); }
  /** 触发面板创建备份。 */
  createBackup() { return this.request('get', `${this.basePath}/createbackup`); }
  /** 下载 SQLite 面板数据库。 */
  getDb() { return this.download(`${this.serverBasePath}/getDb`); }
  /** 下载跨存储引擎迁移备份。 */
  getMigration() { return this.download(`${this.serverBasePath}/getMigration`); }
  /** 获取面板服务器状态。 */
  getServerStatus() { return this.request('get', `${this.serverBasePath}/status`); }
  /** 获取完整 Xray 配置，并支持单次超时。 */
  getXrayConfig(options = {}) { return this.request('post', '/panel/api/xray/', undefined, options); }

  /**
   * 回写完整 Xray 配置。
   * 核心分支：第二参数可为出站测试 URL，也可直接为旧调用方式的请求选项。
   */
  updateXrayConfig(xraySetting, outboundTestUrlOrOptions = {}, options = {}) {
    const hasUrl = typeof outboundTestUrlOrOptions === 'string';
    const form = {
      xraySetting: typeof xraySetting === 'string' ? xraySetting : JSON.stringify(xraySetting)
    };
    if (hasUrl) form.outboundTestUrl = outboundTestUrlOrOptions;
    return this.requestForm('post', '/panel/api/xray/update', form,
      hasUrl ? options : outboundTestUrlOrOptions);
  }
}

module.exports = XuiApiClientV3102;
