/**
 * 3X-UI 3.2.5+ API 客户端适配器。
 * 职责：
 * 1. 复用 3.0.2 已验证的 inbounds/server 接口实现。
 * 2. 将 3.2.5 及 3.3.1 已迁移到 /panel/api/clients 的客户端接口改写为新路由。
 * 3. 尽量兼容当前项目基于 3.0.2 的旧调用形态，减少服务层改造范围。
 */

const XuiApiClientV302 = require('./xui-api-client-v302');

/**
 * 归一化 3X-UI 客户端启用状态。
 * 职责：兼容旧 settings payload 中的布尔、数字和字符串启用值。
 * 关键参数：value 是 client.enable 的原始值。
 * 核心分支：空值默认启用；false/0/'0'/'false' 明确禁用。
 *
 * @param {*} value - 客户端启用状态原始值。
 * @returns {boolean} clients API 需要的布尔 enable。
 */
function normalizeClientEnabled(value) {
  if (value === null || value === undefined || value === '') {
    return true;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized !== '0' && normalized !== 'false';
}

class XuiApiClientV325 extends XuiApiClientV302 {
  /**
   * 创建 3.2.5+ 版本客户端。
   * @param {string} baseURL - 3X-UI 面板地址。
   * @param {string} apiToken - 3X-UI API Token。
   * @param {Object} options - 客户端配置。
   */
  constructor(baseURL, apiToken, options = {}) {
    super(baseURL, apiToken, options);
    this.version = '3.2.5';
    this.supportsClientApi = true;
    this.clientBasePath = '/panel/api/clients';
  }

  /**
   * 兼容旧版 add/updateClient 传入的 inbound settings 结构。
   * @param {Object|string} clientConfig - 旧版客户端请求体。
   * @returns {{ inboundId: number, client: Object }} 解析后的入站 ID 与客户端对象。
   */
  parseLegacyClientConfig(clientConfig) {
    if (!clientConfig || typeof clientConfig !== 'object') {
      throw new Error('clientConfig is required');
    }

    const inboundId = Number(clientConfig.id || 0);
    const settings = typeof clientConfig.settings === 'string'
      ? JSON.parse(clientConfig.settings || '{}')
      : (clientConfig.settings || {});
    const clients = Array.isArray(settings.clients) ? settings.clients : [];
    const client = clients[0];

    if (!client) {
      throw new Error('clientConfig.settings.clients[0] is required');
    }

    return {
      inboundId,
      client
    };
  }

  /**
   * 将旧版 settings.clients[0] 转换为 3.2.5+ clients API 可接受的结构。
   * @param {Object} client - 旧版单客户端配置。
   * @param {Object} [options] - 转换选项。
   * @param {number} [options.inboundId] - 需要附带的 inbound ID。
   * @param {boolean} [options.includeInboundIds=false] - 是否附带 inboundIds。
   * @returns {Object} 新版 clients API payload。
   */
  buildClientApiPayload(client, options = {}) {
    const payload = {
      email: client.email || '',
      enable: normalizeClientEnabled(client.enable),
      expiryTime: Number(client.expiryTime || 0),
      totalGB: Number(client.totalGB || 0),
      limitIp: Number(client.limitIp || 0),
      tgId: Number(client.tgId || 0),
      subId: client.subId || ''
    };

    if (client.id) {
      payload.id = client.id;
    }
    if (client.flow) {
      payload.flow = client.flow;
    }
    if (client.auth) {
      payload.auth = client.auth;
    }
    if (client.password) {
      payload.password = client.password;
    }
    if (client.security) {
      payload.security = client.security;
    }
    if (client.comment) {
      payload.comment = client.comment;
    }
    if (client.reset !== undefined) {
      payload.reset = Number(client.reset || 0);
    }
    if (client.group) {
      payload.group = client.group;
    }

    if (options.includeInboundIds && Number.isFinite(options.inboundId) && options.inboundId > 0) {
      payload.inboundIds = [options.inboundId];
    }

    return payload;
  }

  /**
   * 列出 3.2.5+ clients API 下的所有客户端。
   * @returns {Promise<Object>} 客户端列表响应。
   */
  listClients() {
    return this.request('get', `${this.clientBasePath}/list`);
  }

  /**
   * 根据邮箱读取客户端详情。
   * @param {string} email - 客户端邮箱。
   * @returns {Promise<Object>} 客户端详情响应。
   */
  getClientByEmail(email) {
    return this.request('get', `${this.clientBasePath}/get/${encodeURIComponent(email)}`);
  }

  /**
   * 通过邮箱、UUID、auth 等标识反查客户端邮箱。
   * @param {string} identifier - 客户端标识。
   * @returns {Promise<string>} 客户端邮箱。
   */
  async resolveClientEmail(identifier) {
    if (!identifier) {
      throw new Error('client identifier is required');
    }

    const listResult = await this.listClients();
    if (!listResult.success) {
      throw new Error(listResult.msg || 'failed to list clients');
    }

    const clients = Array.isArray(listResult.obj) ? listResult.obj : [];
    const matched = clients.find((item) => (
      item.email === identifier ||
      item.uuid === identifier ||
      item.id === identifier ||
      item.auth === identifier ||
      item.password === identifier
    ));

    if (!matched || !matched.email) {
      throw new Error(`client not found: ${identifier}`);
    }

    return matched.email;
  }

  addClient(clientConfig) {
    if (clientConfig && clientConfig.client && Array.isArray(clientConfig.inboundIds)) {
      const inboundIds = clientConfig.inboundIds
        .map(Number)
        .filter((id) => Number.isFinite(id) && id > 0);
      const payload = {
        client: this.buildClientApiPayload(clientConfig.client),
        inboundIds
      };
      return this.request('post', `${this.clientBasePath}/add`, payload);
    }

    const { inboundId, client } = this.parseLegacyClientConfig(clientConfig);
    const payload = {
      client: this.buildClientApiPayload(client),
      inboundIds: [inboundId]
    };
    return this.request('post', `${this.clientBasePath}/add`, payload);
  }

  /**
   * 将已存在的全量客户端关联到一组 inbound。
   * @param {string} email - 3X-UI 客户端邮箱标识。
   * @param {number[]} inboundIds - 需要关联的 inbound ID 列表。
   * @returns {Promise<Object>} 3X-UI attach 响应。
   */
  attachClient(email, inboundIds) {
    return this.request('post', `${this.clientBasePath}/${encodeURIComponent(email)}/attach`, {
      inboundIds: (inboundIds || [])
        .map(Number)
        .filter((id) => Number.isFinite(id) && id > 0)
    });
  }

  /**
   * 将已存在的全量客户端从一组 inbound 解除关联。
   * @param {string} email - 3X-UI 客户端邮箱标识。
   * @param {number[]} inboundIds - 需要解除关联的 inbound ID 列表。
   * @returns {Promise<Object>} 3X-UI detach 响应。
   */
  detachClient(email, inboundIds) {
    return this.request('post', `${this.clientBasePath}/${encodeURIComponent(email)}/detach`, {
      inboundIds: (inboundIds || [])
        .map(Number)
        .filter((id) => Number.isFinite(id) && id > 0)
    });
  }

  async deleteClient(_inboundId, clientId) {
    const email = await this.resolveClientEmail(clientId);
    return this.request('post', `${this.clientBasePath}/del/${encodeURIComponent(email)}`);
  }

  deleteClientByEmail(_inboundId, email) {
    return this.request('post', `${this.clientBasePath}/del/${encodeURIComponent(email)}`);
  }

  updateClient(_clientId, clientConfig) {
    if (clientConfig && typeof clientConfig === 'object' && !clientConfig.settings) {
      const email = clientConfig.email || _clientId;
      if (!email) {
        throw new Error('client email is required for 3.2.5+ updateClient');
      }
      const payload = this.buildClientApiPayload({
        ...clientConfig,
        email
      });
      return this.request('post', `${this.clientBasePath}/update/${encodeURIComponent(email)}`, payload);
    }

    const { client } = this.parseLegacyClientConfig(clientConfig);
    if (!client.email) {
      throw new Error('client email is required for 3.2.5+ updateClient');
    }
    const payload = this.buildClientApiPayload(client);
    return this.request('post', `${this.clientBasePath}/update/${encodeURIComponent(client.email)}`, payload);
  }

  getClientTrafficsByEmail(email) {
    return this.request('get', `${this.clientBasePath}/traffic/${encodeURIComponent(email)}`);
  }

  getClientIps(email) {
    return this.request('post', `${this.clientBasePath}/ips/${encodeURIComponent(email)}`);
  }

  clearClientIps(email) {
    return this.request('post', `${this.clientBasePath}/clearIps/${encodeURIComponent(email)}`);
  }

  /**
   * 重置单个客户端在所有关联 inbound 上的流量计数。
   * @param {string} email - 3X-UI 客户端邮箱标识。
   * @returns {Promise<Object>} 3X-UI resetTraffic 响应。
   */
  resetClientTraffic(email) {
    return this.request('post', `${this.clientBasePath}/resetTraffic/${encodeURIComponent(email)}`);
  }

  getOnlineClients() {
    return this.request('post', `${this.clientBasePath}/onlines`);
  }

  getLastOnline() {
    return this.request('post', `${this.clientBasePath}/lastOnline`);
  }

  updateClientTraffic(email, data) {
    return this.request('post', `${this.clientBasePath}/updateTraffic/${encodeURIComponent(email)}`, data);
  }
}

module.exports = XuiApiClientV325;
