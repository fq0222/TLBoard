/**
 * 3X-UI API 服务封装
 * 使用本地 API Token 客户端与 3X-UI 面板通信
 */

const {
  DEFAULT_XUI_API_VERSION,
  createXuiApiClient
} = require('./xui-api-client-factory');
const config = require('../../config');
const { createLogger } = require('../../utils/logger');
const xuiSyncRepository = require('../../repositories/xui-sync-repository');
const { isValidXuiAuth } = require('../../utils/xui-auth');

const logger = createLogger('XUI-SERVICE');

// 禁用环境变量代理，避免连接问题
delete process.env.http_proxy;
delete process.env.https_proxy;
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;

function isClientApiNotFoundMessage(message) {
  const normalized = String(message || '').trim().toLowerCase();
  return normalized.includes('record not found');
}

function isTransientXuiNetworkError(message) {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('client network socket disconnected')
    || normalized.includes('econnreset')
    || normalized.includes('socket hang up')
    || normalized.includes('tls connection');
}

/**
 * 3X-UI 服务类
 * 封装与 3X-UI 面板的所有交互
 */
class XuiService {
  // 静态缓存：存储已创建的实例
  static instanceCache = new Map();

  /**
   * 获取 XuiService 实例（带缓存，自动初始化）
   * @param {string} apiUrl - 面板地址
   * @param {string} apiToken - API Token
   * @returns {Promise<XuiService>} 已初始化的实例
   */
  static async getInstance(apiUrl, apiToken, options = {}) {
    const apiVersion = options.apiVersion || DEFAULT_XUI_API_VERSION;
    const key = `${apiUrl}:${apiToken}:${apiVersion}`;
    if (!this.instanceCache.has(key)) {
      const instance = new XuiService(apiUrl, apiToken, options);
      await instance.init();
      this.instanceCache.set(key, instance);
    }
    return this.instanceCache.get(key);
  }

  /**
   * 清除指定服务器的缓存
   * @param {string} apiUrl - 面板地址
   * @param {string} apiToken - API Token
   */
  static removeInstance(apiUrl, apiToken, apiVersion = DEFAULT_XUI_API_VERSION) {
    this.instanceCache.delete(`${apiUrl}:${apiToken}:${apiVersion}`);
  }

  /**
   * 清除所有缓存
   */
  static clearCache() {
    this.instanceCache.clear();
  }

  /**
   * 创建 XuiService 实例
   * @param {string} apiUrl - 面板地址
   * @param {string} apiToken - API Token
   */
  constructor(apiUrl, apiToken, options = {}) {
    this.apiUrl = apiUrl;
    this.apiToken = apiToken;
    this.apiVersion = options.apiVersion || DEFAULT_XUI_API_VERSION;
    this.client = null;
  }

  /**
   * 初始化客户端连接
   */
  async init() {
    try {
      const { client, requestedVersion, resolvedVersion } = createXuiApiClient(
        this.apiUrl,
        this.apiToken,
        {
          timeout: config.xui.timeout || 20000,
          apiVersion: this.apiVersion
        }
      );
      this.client = client;
      this.apiVersion = resolvedVersion;
      logger.info(`初始化 3X-UI 客户端: ${this.apiUrl}`);
      if (requestedVersion !== resolvedVersion) {
        logger.warn(`未识别的 3X-UI API 版本 ${requestedVersion}，已回退到 ${resolvedVersion}`);
      } else {
        logger.info(`当前使用 3X-UI API 版本: ${resolvedVersion}`);
      }
      return true;
    } catch (error) {
      logger.error(`初始化 3X-UI 客户端失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 测试连接是否成功
   * @returns {Promise<boolean>} 连接是否成功
   */
  async testConnection() {
    try {
      if (!this.client) {
        await this.init();
      }

      // 尝试获取 inbounds 来测试连接
      const response = await this.client.getInbounds();
      
      if (response.success) {
        logger.info(`连接测试成功: ${this.apiUrl}`);
        return true;
      } else {
        logger.warn(`连接测试失败: ${response.msg}`);
        return false;
      }
    } catch (error) {
      logger.error(`连接测试错误: ${error.message}`);
      return false;
    }
  }

  /**
   * 解析服务器状态里的 Xray 状态
   * @param {Object} payload - 原始状态数据
   * @returns {string} Xray 状态，未命中时返回空字符串
   */
  extractXrayState(payload = {}) {
    const state =
      payload?.obj?.xray?.state ||
      payload?.obj?.xrayState ||
      payload?.obj?.xray?.status ||
      payload?.obj?.state?.xray ||
      payload?.xray?.state;

    if (typeof state !== 'string') {
      return '';
    }

    return state.trim();
  }

  /**
   * 获取服务器状态
   * @returns {Promise<Object>} 统一返回 { success, data, message }
   */
  async getServerStatus() {
    try {
      if (!this.client) {
        await this.init();
      }

      const response = await this.client.getServerStatus();
      const xrayState = this.extractXrayState(response);

      if (!response?.success) {
        const message = response?.msg || response?.message || '获取服务器状态失败';
        logger.warn(`获取服务器状态失败: ${message}`);
        return {
          success: false,
          data: {
            xrayState: 'unknown',
            raw: response || null
          },
          message
        };
      }

      logger.info(`获取服务器状态成功: xrayState=${xrayState}`);
      return {
        success: true,
        data: {
          xrayState,
          raw: response
        },
        message: response?.msg || ''
      };
    } catch (error) {
      logger.error(`获取服务器状态错误: ${error.message}`);
      return {
        success: false,
        data: {
          xrayState: 'unknown',
          raw: null
        },
        message: error.message
      };
    }
  }

  /**
   * 获取所有 inbounds（节点）
   * @param {Object} [options={}] - 单次请求选项；失败时记录日志并返回标准失败结果
   * @returns {Promise<Object>} 标准化的 inbounds 列表
   */
  async getInbounds(options = {}) {
    if (!this.client) {
      await this.init();
    }

    const maxAttempts = Number.isFinite(options.retries) && options.retries > 0
      ? Math.floor(options.retries) + 1
      : 2;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await this.client.getInbounds(options);

        if (response.success) {
          logger.info(`获取 inbounds 成功，共 ${response.obj ? response.obj.length : 0} 个`);
          return {
            success: true,
            data: response.obj || []
          };
        }

        logger.warn(`获取 inbounds 失败: ${response.msg}`);
        return {
          success: false,
          message: response.msg,
          data: []
        };
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts && isTransientXuiNetworkError(error.message)) {
          logger.warn(`获取 inbounds 遇到瞬时网络错误，准备重试: attempt=${attempt}/${maxAttempts}, error=${error.message}`);
          continue;
        }
        break;
      }
    }

    logger.error(`获取 inbounds 错误: ${lastError.message}`);
    return {
      success: false,
      message: lastError.message,
      data: []
    };
  }

  /**
   * 获取在线客户端
   * @returns {Promise<Object>} 在线客户端列表
   */
  async getOnlineClients() {
    try {
      if (!this.client) {
        await this.init();
      }

      const response = await this.client.getOnlineClients();
      
      if (response.success) {
        // getOnlineClients 返回邮箱字符串数组: ["email1", "email2"]
        const onlineEmails = response.obj || [];
        logger.info(`获取在线客户端成功，共 ${onlineEmails.length} 个`);
        return {
          success: true,
          data: onlineEmails,
          count: onlineEmails.length
        };
      } else {
        logger.warn(`获取在线客户端失败: ${response.msg}`);
        return {
          success: false,
          message: response.msg,
          data: [],
          count: 0
        };
      }
    } catch (error) {
      logger.error(`获取在线客户端错误: ${error.message}`);
      return {
        success: false,
        message: error.message,
        data: [],
        count: 0
      };
    }
  }

  /**
   * 根据邮箱获取客户端流量
   * @param {string} email - 客户端标识（邮箱）
   * @returns {Promise<Object>} 客户端流量信息
   */
  async getClientTrafficsByEmail(email) {
    try {
      if (!this.client) {
        await this.init();
      }

      const response = await this.client.getClientTrafficsByEmail(email);
      
      if (response.success) {
        logger.info(`获取客户端流量成功: ${email}`);
        return {
          success: true,
          data: response.obj
        };
      } else {
        logger.warn(`获取客户端流量失败: ${email} - ${response.msg}`);
        return {
          success: false,
          message: response.msg
        };
      }
    } catch (error) {
      logger.error(`获取客户端流量错误: ${email} - ${error.message}`);
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * 同步服务器状态
   * 获取节点数、用户数、在线数等信息
   * @returns {Promise<Object>} 同步结果
   */
  async syncServerStatus() {
    try {
      if (!this.client) {
        await this.init();
      }

      // 并行获取 inbounds 和在线客户端
      const [inboundsResult, onlineResult] = await Promise.all([
        this.getInbounds(),
        this.getOnlineClients()
      ]);

      if (!inboundsResult.success) {
        throw new Error(`获取 inbounds 失败: ${inboundsResult.message}`);
      }

      const inbounds = inboundsResult.data;
      const onlineClients = onlineResult.success ? onlineResult.data : [];

      // 统计用户数（从 inbound 的 clientStats 中获取）
      let totalUsers = 0;
      const nodes = [];

      for (const inbound of inbounds) {
        const clientStats = inbound.clientStats || [];
        totalUsers += clientStats.length;

        // 构建节点信息
        nodes.push({
          inbound_id: inbound.id,
          remark: inbound.remark,
          port: inbound.port,
          protocol: inbound.protocol,
          user_count: clientStats.length,
          online_count: 0, // 稍后计算
          settings: inbound.settings,
          stream_settings: inbound.streamSettings,  // 3X-UI 返回的是驼峰式
          total_up: inbound.up,
          total_down: inbound.down
        });
      }

      // 计算每个节点的在线用户数
      for (const inbound of inbounds) {
        const node = nodes.find(n => n.inbound_id === inbound.id);
        if (node) {
          const clientStats = inbound.clientStats || [];
          for (const client of clientStats) {
            if (onlineClients.includes(client.email)) {
              node.online_count++;
            }
          }
        }
      }

      // 计算总在线用户数（去重）
      const uniqueOnlineUsers = onlineClients.length;

      logger.info(`同步服务器状态成功: ${nodes.length} 个节点, ${totalUsers} 个用户, ${uniqueOnlineUsers} 个在线`);

      return {
        success: true,
        status: 1, // 在线
        node_count: nodes.length,
        user_count: totalUsers,
        online_count: uniqueOnlineUsers,
        nodes: nodes,
        online_clients: onlineClients
      };
    } catch (error) {
      logger.error(`同步服务器状态错误: ${error.message}`);
      return {
        success: false,
        status: 0, // 离线
        message: error.message,
        node_count: 0,
        user_count: 0,
        online_count: 0,
        nodes: [],
        online_clients: []
      };
    }
  }

  /**
   * 获取节点详情（包含用户信息）
   * @param {number} inboundId - inbound ID
   * @returns {Promise<Object>} 节点详情
   */
  async getInboundDetail(inboundId) {
    try {
      if (!this.client) {
        await this.init();
      }

      const response = await this.client.getInbound(inboundId);
      
      if (response.success) {
        const inbound = response.obj;
        
        // 从 settings 中解析客户端信息（getInbound 返回的 clientStats 可能为 null）
        let clients = [];
        try {
          const settings = JSON.parse(inbound.settings || '{}');
          clients = settings.clients || [];
        } catch (e) {
          logger.warn(`解析 settings 失败: ${e.message}`);
        }

        // 获取在线客户端（返回邮箱字符串数组）
        const onlineResult = await this.getOnlineClients();
        const onlineEmails = onlineResult.success ? onlineResult.data : [];

        // 获取每个用户的流量信息
        const users = [];
        for (const client of clients) {
          const isOnline = onlineEmails.includes(client.email);
          
          // 尝试获取用户流量
          let trafficUsed = 0;
          let trafficLimit = client.totalGB || 0;
          
          try {
            const trafficResult = await this.getClientTrafficsByEmail(client.email);
            if (trafficResult.success && trafficResult.data) {
              trafficUsed = (trafficResult.data.up || 0) + (trafficResult.data.down || 0);
              trafficLimit = trafficResult.data.total || trafficLimit;
            }
          } catch (e) {
            // 流量获取失败，使用默认值
          }
          
          users.push({
            email: client.email,
            enable: client.enable,
            expiry_time: client.expiryTime,
            expiry_text: client.expiryTime ? new Date(client.expiryTime).toISOString().replace('T', ' ').substr(0, 19) : '永不过期',
            traffic_used: trafficUsed,
            traffic_limit: trafficLimit,
            traffic_used_text: this.formatTraffic(trafficUsed),
            traffic_limit_text: trafficLimit > 0 ? this.formatTraffic(trafficLimit) : '无限制',
            is_online: isOnline
          });
        }

        logger.info(`获取节点详情成功: ${inboundId}, ${users.length} 个用户`);

        return {
          success: true,
          data: {
            inbound_id: inbound.id,
            remark: inbound.remark,
            port: inbound.port,
            protocol: inbound.protocol,
            enable: inbound.enable,
            total_up: inbound.up,
            total_down: inbound.down,
            users: users
          }
        };
      } else {
        logger.warn(`获取节点详情失败: ${inboundId} - ${response.msg}`);
        return {
          success: false,
          message: response.msg
        };
      }
    } catch (error) {
      logger.error(`获取节点详情错误: ${inboundId} - ${error.message}`);
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * 格式化流量显示
   * @param {number} bytes - 字节数
   * @returns {string} 格式化后的流量字符串
   */
  formatTraffic(bytes) {
    // 处理 null、undefined 或非数字情况
    if (bytes === null || bytes === undefined || bytes === '') return '0 B';
    
    // 转换为数字
    const numBytes = Number(bytes);
    
    // 检查是否为有效数字
    if (isNaN(numBytes)) return '0 B';
    
    // 处理0的情况
    if (numBytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(numBytes) / Math.log(k));
    return parseFloat((numBytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * 判断当前客户端是否使用 3.2.5 的 clients API。
   * @returns {boolean} 是否启用新版 clients API。
   */
  usesClientApi() {
    return Boolean(this.client && this.client.supportsClientApi);
  }

  /**
   * 将 3.2.5 clients/get/:email 的响应映射为当前项目的统一客户端结构。
   * @param {Object} client - 3X-UI 返回的客户端对象。
   * @returns {Object} 统一后的客户端信息。
   */
  mapClientApiRecord(client = {}) {
    return {
      uuid: client.uuid || client.id || '',
      password: client.password || '',
      email: client.email || '',
      enable: client.enable,
      expiryTime: client.expiryTime,
      totalGB: client.totalGB || 0,
      subId: client.subId || '',
      flow: client.flow || '',
      auth: client.auth || client.password || ''
    };
  }

  /**
   * 归一化服务器级 client 关联的 inbound ID 列表。
   * @param {number[]} inboundIds - 原始 inbound ID 列表。
   * @returns {number[]} 去重后的正整数 ID。
   */
  normalizeInboundIds(inboundIds) {
    return Array.from(new Set((inboundIds || [])
      .map(Number)
      .filter((id) => Number.isFinite(id) && id > 0)));
  }

  /**
   * 通过 canonical email 查询服务器级 3X-UI client。
   * @param {string} email - 本地用户邮箱，也是 3X-UI client email。
   * @returns {Promise<Object>} 查询结果，成功时包含 client 与 inboundIds。
   */
  async getServerClientByEmail(email) {
    try {
      if (!this.client) {
        await this.init();
      }

      if (!this.usesClientApi() || typeof this.client.getClientByEmail !== 'function') {
        return { success: false, message: 'clients API is not supported' };
      }

      const response = await this.client.getClientByEmail(email);
      if (!response.success) {
        return { success: false, message: response.msg || 'client not found' };
      }

      const obj = response.obj || {};
      const rawClient = obj.client || obj;
      return {
        success: true,
        client: this.mapClientApiRecord(rawClient),
        inboundIds: this.normalizeInboundIds(obj.inboundIds || rawClient.inboundIds || [])
      };
    } catch (error) {
      logger.error(`查询服务器级客户端错误: ${email} - ${error.message}`);
      return { success: false, message: error.message };
    }
  }

  /**
   * 创建或更新每服务器唯一的全量 client，并补齐 inbound 关联。
   * @param {Object} payload - upsert 参数。
   * @param {string} payload.email - canonical email。
   * @param {number[]} payload.inboundIds - 目标 inbound ID 列表。
   * @param {Object} payload.client - 全量 client 凭证与状态。
   * @returns {Promise<Object>} 同步结果。
   */
  async upsertServerClient(payload = {}) {
    try {
      if (!this.client) {
        await this.init();
      }

      if (!this.usesClientApi()) {
        return { success: false, message: 'clients API is not supported' };
      }

      const email = String(payload.email || payload.client?.email || '').trim();
      const inboundIds = this.normalizeInboundIds(payload.inboundIds);
      if (!email) {
        return { success: false, message: 'email is required' };
      }
      if (inboundIds.length === 0) {
        return { success: false, message: 'inboundIds is required' };
      }

      const desiredClient = {
        ...(payload.client || {}),
        email
      };
      const existing = await this.getServerClientByEmail(email);

      if (!existing.success) {
        const addResult = await this.client.addClient({ client: desiredClient, inboundIds });
        return addResult.success
          ? { success: true, action: 'add', message: addResult.msg }
          : { success: false, message: addResult.msg || addResult.message || '新增服务器级客户端失败' };
      }

      if (this.shouldUpdateClient(existing.client, desiredClient)) {
        const updateResult = await this.client.updateClient(email, desiredClient);
        if (!updateResult.success) {
          return { success: false, message: updateResult.msg || updateResult.message || '更新服务器级客户端失败' };
        }
      }

      const existingIds = new Set(this.normalizeInboundIds(existing.inboundIds));
      const missingIds = inboundIds.filter((id) => !existingIds.has(id));
      if (missingIds.length > 0 && typeof this.client.attachClient === 'function') {
        const attachResult = await this.client.attachClient(email, missingIds);
        if (!attachResult.success) {
          return { success: false, message: attachResult.msg || attachResult.message || '关联 inbound 失败' };
        }
      }

      return {
        success: true,
        action: this.shouldUpdateClient(existing.client, desiredClient) ? 'update' : 'attach'
      };
    } catch (error) {
      logger.error(`同步服务器级客户端错误: ${error.message}`);
      return { success: false, message: error.message };
    }
  }

  buildClientSettingsPayload(options = {}) {
    const {
      protocol = '',
      strategy = 'direct',
      credential = '',
      email = '',
      enable = true,
      expiryTime = 0,
      totalGB = 0,
      limitIp = 0,
      tgId = 0,
      subId = '',
      flow = ''
    } = options;

    const payload = {
      email,
      enable,
      expiryTime,
      totalGB,
      limitIp,
      tgId,
      subId
    };

    if (strategy === 'hy2' || protocol === 'hysteria' || protocol === 'hysteria2') {
      payload.auth = credential;
      return payload;
    }

    payload.id = credential;
    if (flow) {
      payload.flow = flow;
    }
    return payload;
  }

  /**
   * 添加客户端
   * @param {number} inboundId - inbound ID
   * @param {string} protocol - 协议类型
   * @param {Object} options - 客户端配置选项
   * @returns {Promise<Object>} 添加结果
   */
  async addClient(inboundId, protocol, options = {}) {
    try {
      if (!this.client) {
        await this.init();
      }

      // 构建客户端配置
      const clientObj = {
        id: options.id || this.generateUuid(),
        email: options.email || '',
        enable: this.normalizeClientEnabled(options.enable),
        expiryTime: options.expiryTime || 0,
        totalGB: options.totalGB || 0,
        limitIp: options.limitIp || 0,
        tgId: options.tgId || 0,
        subId: options.subId || ''
      };
      if (options.flow) {
        clientObj.flow = options.flow;
      }
      logger.info(`添加客户端配置: email=${options.email}, flow=${options.flow || '无'}, 最终flow=${clientObj.flow || '无'}`);
      const clientConfig = {
        id: inboundId,
        settings: JSON.stringify({
          clients: [clientObj]
        })
      };

      const result = await this.client.addClient(clientConfig);
      
      if (result.success) {
        logger.info(`添加客户端成功: ${options.email || 'auto'}`);
        return {
          success: true,
          message: result.msg
        };
      } else {
        logger.warn(`添加客户端失败: ${result.msg}`);
        return {
          success: false,
          message: result.msg
        };
      }
    } catch (error) {
      logger.error(`添加客户端错误: ${error.message}`);
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * 生成 UUID
   * @returns {string} UUID
   */
  generateUuid() {
    const crypto = require('crypto');
    return crypto.randomUUID();
  }

  /**
   * 删除客户端
   * @param {number} inboundId - inbound ID
   * @param {string} clientUuid - 客户端 UUID
   * @returns {Promise<Object>} 删除结果
   */
  async deleteClient(inboundId, clientUuid) {
    try {
      if (!this.client) {
        await this.init();
      }

      const result = await this.client.deleteClient(inboundId, clientUuid);
      
      if (result.success) {
        logger.info(`删除客户端成功: ${clientUuid}`);
        return {
          success: true,
          message: result.msg
        };
      } else {
        logger.warn(`删除客户端失败: ${result.msg}`);
        return {
          success: false,
          message: result.msg
        };
      }
    } catch (error) {
      logger.error(`删除客户端错误: ${error.message}`);
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * 根据邮箱删除客户端
   * @param {number} inboundId - inbound ID
   * @param {string} email - 客户端邮箱标识
   * @returns {Promise<Object>} 删除结果
   */
  async deleteClientByEmail(inboundId, email) {
    try {
      if (!this.client) {
        await this.init();
      }

      if (this.usesClientApi()) {
        const result = await this.client.deleteClientByEmail(inboundId, email);

        if (result.success) {
          logger.info(`删除客户端成功: ${email}`);
          return {
            success: true,
            message: result.msg
          };
        }

        logger.warn(`删除客户端失败: ${result.msg}`);
        return {
          success: false,
          message: result.msg
        };
      }

      // 先获取客户端信息以获取 UUID
      const clientInfo = await this.getClientByEmail(inboundId, email);
      
      if (!clientInfo.success) {
        return {
          success: false,
          message: `未找到用户: ${email}`
        };
      }

      const result = await this.client.deleteClient(inboundId, clientInfo.uuid);
      
      if (result.success) {
        logger.info(`删除客户端成功: ${email}`);
        return {
          success: true,
          message: result.msg
        };
      } else {
        logger.warn(`删除客户端失败: ${result.msg}`);
        return {
          success: false,
          message: result.msg
        };
      }
    } catch (error) {
      logger.error(`删除客户端错误: ${error.message}`);
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * 根据邮箱获取客户端信息
   * @param {number} inboundId - inbound ID
   * @param {string} email - 客户端邮箱标识
   * @returns {Promise<Object>} 客户端信息
   */
  async getClientByEmail(inboundId, email) {
    try {
      if (!this.client) {
        await this.init();
      }

      // 获取 inbound 详情
      const response = await this.client.getInbound(inboundId);
      
      if (!response.success) {
        return {
          success: false,
          message: '获取入站信息失败'
        };
      }

      // 从 settings 中解析客户端信息
      let clients = [];
      try {
        const settings = JSON.parse(response.obj.settings || '{}');
        clients = settings.clients || [];
      } catch (e) {
        logger.warn(`解析 settings 失败: ${e.message}`);
      }

      // 查找匹配的客户端
      const client = clients.find(c => c.email === email);
      
      if (!client) {
        return {
          success: false,
          message: `未找到用户: ${email}`
        };
      }

      return {
        success: true,
        uuid: client.id,
        email: client.email,
        enable: client.enable,
        expiryTime: client.expiryTime,
        totalGB: client.totalGB || 0,
        subId: client.subId || '',
        flow: client.flow || ''
      };
    } catch (error) {
      logger.error(`获取客户端信息错误: ${error.message}`);
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * 更新客户端信息
   * @param {number} inboundId - inbound ID
   * @param {string} email - 客户端邮箱标识
   * @param {Object} options - 更新选项
   * @param {number} options.expiryTime - 到期时间
   * @param {number} options.totalGB - 流量上限(GB)
   * @param {boolean} options.enabled - 是否启用
   * @returns {Promise<Object>} 更新结果
   */
  async getClientsByEmail(inboundId, email) {
    try {
      if (!this.client && typeof this.getInbound !== 'function') {
        await this.init();
      }

      if (this.usesClientApi() && typeof this.client.getClientByEmail === 'function') {
        const response = await this.client.getClientByEmail(email);

        if (!response.success) {
          if (isClientApiNotFoundMessage(response.msg)) {
            return {
              success: true,
              clients: []
            };
          }

          return {
            success: false,
            message: response.msg || '获取客户端信息失败',
            clients: []
          };
        }

        const inboundIds = Array.isArray(response.obj?.inboundIds) ? response.obj.inboundIds : [];
        if (inboundIds.length > 0 && !inboundIds.includes(Number(inboundId))) {
          return {
            success: true,
            clients: []
          };
        }

        const rawClient = response.obj?.client;
        if (!rawClient) {
          return {
            success: true,
            clients: []
          };
        }

        return {
          success: true,
          clients: [this.mapClientApiRecord(rawClient)]
        };
      }

      const response = typeof this.getInbound === 'function'
        ? await this.getInbound(inboundId)
        : await this.client.getInbound(inboundId);

      if (!response.success) {
        return {
          success: false,
          message: '获取入站信息失败',
          clients: []
        };
      }

      let clients = [];
      clients = this.extractClientsFromSettings(response.obj.settings);

      return {
        success: true,
        clients: clients
          .filter(item => item.email === email)
          .map(item => ({
            uuid: item.id,
            email: item.email,
            enable: item.enable,
            expiryTime: item.expiryTime,
            totalGB: item.totalGB || 0,
            subId: item.subId || '',
            flow: item.flow || '',
            auth: item.auth || item.password || ''
          }))
      };
    } catch (error) {
      logger.error(`获取客户端列表错误: ${error.message}`);
      return {
        success: false,
        message: error.message,
        clients: []
      };
    }
  }

  async getClientByEmail(inboundId, email) {
    try {
      const result = await this.getClientsByEmail(inboundId, email);

      if (!result.success) {
        return {
          success: false,
          message: result.message
        };
      }

      const client = result.clients[0];

      if (!client) {
        return {
          success: false,
          message: `未找到用户 ${email}`
        };
      }

      return {
        success: true,
        uuid: client.uuid,
        email: client.email,
        enable: client.enable,
        expiryTime: client.expiryTime,
        totalGB: client.totalGB || 0,
        subId: client.subId || '',
        flow: client.flow || '',
        auth: client.auth || client.password || ''
      };
    } catch (error) {
      logger.error(`获取客户端信息错误: ${error.message}`);
      return {
        success: false,
        message: error.message
      };
    }
  }

  buildUniqueClientLockKey(serverId, inboundId, email) {
    const crypto = require('crypto');
    const raw = `${serverId}:${inboundId}:${email}`;
    const hex = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 15);
    return parseInt(hex, 16);
  }

  async withUniqueClientLock(db, { serverId, inboundId, email }, handler) {
    if (this._forceLockBusy) {
      return { success: false, message: 'failed to acquire unique client lock' };
    }

    const lockKey = this.buildUniqueClientLockKey(serverId, inboundId, email);
    const locked = await xuiSyncRepository.tryAcquireUniqueClientLock(db, lockKey);
    if (!locked) {
      return { success: false, message: 'failed to acquire unique client lock' };
    }

    try {
      return await handler();
    } finally {
      await xuiSyncRepository.releaseUniqueClientLock(db, lockKey);
    }
  }

  async getNodeConfig(db, userId, serverId, inboundId) {
    return xuiSyncRepository.findUserNodeConfig(db, userId, serverId, inboundId);
  }

  async saveNodeConfig(db, userId, serverId, inboundId, uuid, auth, subId) {
    await xuiSyncRepository.saveUserNodeConfig(db, {
      userId,
      serverId,
      inboundId,
      uuid,
      auth,
      subId
    });
  }

  chooseClientToKeep(existingClients, nodeConfig) {
    if (nodeConfig && nodeConfig.uuid) {
      const matched = existingClients.find(item => item.uuid === nodeConfig.uuid);
      if (matched) return matched;
    }
    if (nodeConfig && nodeConfig.auth) {
      const matched = existingClients.find(item => item.auth === nodeConfig.auth);
      if (matched) return matched;
    }
    return existingClients[0] || null;
  }

  convertBytesToGB(bytes) {
    return Number(bytes || 0) / (1024 * 1024 * 1024);
  }

  normalizeClientSnapshot(client = {}) {
    return {
      uuid: client.uuid || client.id || '',
      password: client.password || '',
      enable: this.normalizeClientEnabled(client.enable),
      expiryTime: Number(client.expiryTime || 0),
      totalBytes: Number(client.totalGB || 0),
      subId: client.subId || '',
      flow: client.flow || '',
      auth: client.auth || ''
    };
  }

  normalizeClientEnabled(value) {
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
    if (normalized === '0' || normalized === 'false') {
      return false;
    }
    return true;
  }

  buildClientDiff(existingClient, desiredClient) {
    const current = this.normalizeClientSnapshot(existingClient);
    const desired = {
      uuid: desiredClient.uuid || desiredClient.id || '',
      password: desiredClient.password || '',
      enable: this.normalizeClientEnabled(desiredClient.enable),
      expiryTime: Number(desiredClient.expiryTime || 0),
      totalBytes: Number(desiredClient.totalGB || 0),
      subId: desiredClient.subId || '',
      flow: desiredClient.flow || '',
      auth: desiredClient.auth || ''
    };

    const diff = {};
    if (current.uuid !== desired.uuid) {
      diff.uuid = { current: current.uuid, desired: desired.uuid };
    }
    if (current.password !== desired.password) {
      diff.password = { current: current.password, desired: desired.password };
    }
    if (current.enable !== desired.enable) {
      diff.enable = { current: current.enable, desired: desired.enable };
    }
    if (current.expiryTime !== desired.expiryTime) {
      diff.expiryTime = { current: current.expiryTime, desired: desired.expiryTime };
    }
    if (current.totalBytes !== desired.totalBytes) {
      diff.totalBytes = { current: current.totalBytes, desired: desired.totalBytes };
    }
    if (current.subId !== desired.subId) {
      diff.subId = { current: current.subId, desired: desired.subId };
    }
    if (current.flow !== desired.flow) {
      diff.flow = { current: current.flow, desired: desired.flow };
    }
    if (current.auth !== desired.auth) {
      diff.auth = { current: current.auth, desired: desired.auth };
    }

    return diff;
  }

  shouldUpdateClient(existingClient, desiredClient) {
    return Object.keys(this.buildClientDiff(existingClient, desiredClient)).length > 0;
  }

  buildNodeConfigSnapshot(currentClient, desiredClient = {}) {
    return {
      uuid: currentClient?.uuid || desiredClient.id || '',
      auth: desiredClient.auth || currentClient?.auth || '',
      subId: desiredClient.subId || currentClient?.subId || ''
    };
  }

  extractClientsFromSettings(settings) {
    if (!settings) return [];

    if (typeof settings === 'string') {
      try {
        const parsed = JSON.parse(settings || '{}');
        return Array.isArray(parsed.clients) ? parsed.clients : [];
      } catch (error) {
        logger.warn(`解析 settings 失败: ${error.message}`);
        return [];
      }
    }

    if (typeof settings === 'object') {
      return Array.isArray(settings.clients) ? settings.clients : [];
    }

    return [];
  }

  /**
   * 从已获取的 inbound 客户端快照中提取目标 email 的客户端列表。
   *
   * @param {Array<Object>|undefined} clientsSnapshot - inbound.settings.clients 快照
   * @param {string} email - 节点 email 标识
   * @returns {{success:boolean,clients:Array<Object>}|null} 提取结果；null 表示未提供快照
   */
  getClientsByEmailFromSnapshot(clientsSnapshot, email) {
    if (!Array.isArray(clientsSnapshot)) {
      return null;
    }

    return {
      success: true,
      clients: clientsSnapshot
        .filter(item => item.email === email)
        .map(item => this.mapClientApiRecord(item))
    };
  }

  async upsertUniqueClient(db, context) {
    const {
      userId,
      serverId,
      inbound,
      email,
      existingClientsSnapshot,
      desiredClient
    } = context;

    return this.withUniqueClientLock(db, {
      serverId,
      inboundId: inbound.id,
      email
    }, async () => {
      const listResult = this.getClientsByEmailFromSnapshot(existingClientsSnapshot, email)
        || await this.getClientsByEmail(inbound.id, email);
      if (!listResult.success) {
        return { success: false, message: listResult.message || '获取客户端列表失败' };
      }

      if (desiredClient.strategy === 'hy2' && !isValidXuiAuth(desiredClient.auth)) {
        return { success: false, message: `非法 hy2 auth: ${desiredClient.auth || 'empty'}` };
      }

      const nodeConfig = await this.getNodeConfig(db, userId, serverId, inbound.id);
      const existingClients = listResult.clients;

      if (existingClients.length > 1) {
        const keepClient = this.chooseClientToKeep(existingClients, nodeConfig);
        const duplicates = existingClients.filter(item => item.uuid !== keepClient.uuid);

        for (const duplicate of duplicates) {
          const deleteResult = await this.deleteClient(inbound.id, duplicate.uuid);
          if (!deleteResult.success) {
            return { success: false, message: deleteResult.message || `删除重复客户端失败: ${duplicate.uuid}` };
          }
        }

        const verifyResult = await this.getClientsByEmail(inbound.id, email);
        if (!verifyResult.success) {
          return { success: false, message: verifyResult.message || '重复删除后二次查询失败' };
        }
        if (verifyResult.clients.length !== 1) {
          return { success: false, message: `duplicate email still exists for ${email}` };
        }

        const finalKeep = verifyResult.clients[0];
        const dedupDiff = this.buildClientDiff(finalKeep, desiredClient);
        if (Object.keys(dedupDiff).length === 0) {
          const snapshot = this.buildNodeConfigSnapshot(finalKeep, desiredClient);
          await this.saveNodeConfig(db, userId, serverId, inbound.id, snapshot.uuid, snapshot.auth, snapshot.subId);
          return { success: true, action: 'dedup-skip-update' };
        }

        const updateResult = await this.updateClientByContext(inbound.id, email, {
          protocol: desiredClient.protocol,
          strategy: desiredClient.strategy,
          auth: desiredClient.auth,
          enabled: desiredClient.enable,
          expiryTime: desiredClient.expiryTime,
          totalGB: this.convertBytesToGB(desiredClient.totalGB),
          subId: desiredClient.subId,
          flow: desiredClient.flow
        });

        if (!updateResult.success) {
          return { success: false, message: updateResult.message || '更新保留客户端失败' };
        }

        const snapshot = this.buildNodeConfigSnapshot(finalKeep, desiredClient);
        await this.saveNodeConfig(db, userId, serverId, inbound.id, snapshot.uuid, snapshot.auth, snapshot.subId);
        return { success: true, action: 'dedup-update' };
      }

      if (existingClients.length === 1) {
        const singleDiff = this.buildClientDiff(existingClients[0], desiredClient);
        if (Object.keys(singleDiff).length === 0) {
          const snapshot = this.buildNodeConfigSnapshot(existingClients[0], desiredClient);
          await this.saveNodeConfig(db, userId, serverId, inbound.id, snapshot.uuid, snapshot.auth, snapshot.subId);
          return { success: true, action: 'skip-update' };
        }

        const updateResult = await this.updateClientByContext(inbound.id, email, {
          protocol: desiredClient.protocol,
          strategy: desiredClient.strategy,
          auth: desiredClient.auth,
          enabled: desiredClient.enable,
          expiryTime: desiredClient.expiryTime,
          totalGB: this.convertBytesToGB(desiredClient.totalGB),
          subId: desiredClient.subId,
          flow: desiredClient.flow
        });

        if (!updateResult.success) {
          return { success: false, message: updateResult.message || '更新客户端失败' };
        }

        const snapshot = this.buildNodeConfigSnapshot(existingClients[0], desiredClient);
        await this.saveNodeConfig(db, userId, serverId, inbound.id, snapshot.uuid, snapshot.auth, snapshot.subId);
        return { success: true, action: 'update' };
      }

      const addResult = await this.addClientByContext(inbound.id, inbound.protocol, {
        email,
        id: desiredClient.id,
        auth: desiredClient.auth,
        enable: desiredClient.enable,
        expiryTime: desiredClient.expiryTime,
        totalGB: desiredClient.totalGB,
        limitIp: 0,
        tgId: 0,
        subId: desiredClient.subId,
        strategy: desiredClient.strategy,
        flow: desiredClient.flow
      });

      if (!addResult.success) {
        return { success: false, message: addResult.message || '新增客户端失败' };
      }

      await this.saveNodeConfig(
        db,
        userId,
        serverId,
        inbound.id,
        desiredClient.id || '',
        desiredClient.auth || '',
        desiredClient.subId || ''
      );

      return { success: true, action: 'add' };
    });
  }

  async updateClient(inboundId, email, options = {}) {
    try {
      if (!this.client) {
        await this.init();
      }

      // 先获取客户端信息
      const clientInfo = await this.getClientByEmail(inboundId, email);
      
      if (!clientInfo.success) {
        return {
          success: false,
          message: `未找到用户: ${email}`
        };
      }

      // 构建更新配置
      const updateClientObj = {
        id: clientInfo.uuid,
        email: email,
        enable: this.normalizeClientEnabled(options.enabled !== undefined ? options.enabled : clientInfo.enable),
        expiryTime: options.expiryTime !== undefined ? options.expiryTime : clientInfo.expiryTime,
        totalGB: options.totalGB !== undefined ? options.totalGB * 1073741824 : clientInfo.totalGB, // GB 转字节
        limitIp: 0,
        tgId: 0,
        subId: options.subId !== undefined ? options.subId : (clientInfo.subId || '')
      };
      if (options.flow !== undefined) {
        updateClientObj.flow = options.flow;
      } else if (clientInfo.flow) {
        updateClientObj.flow = clientInfo.flow;
      }
      logger.info(`更新客户端配置: email=${email}, options.flow=${options.flow}, clientInfo.flow=${clientInfo.flow}, 最终flow=${updateClientObj.flow || '无'}`);
      const updateConfig = {
        id: inboundId,
        settings: JSON.stringify({
          clients: [updateClientObj]
        })
      };

      const result = await this.client.updateClient(clientInfo.uuid, updateConfig);
      
      if (result.success) {
        logger.info(`更新客户端成功: ${email}`);
        return {
          success: true,
          message: result.msg
        };
      } else {
        logger.warn(`更新客户端失败: ${result.msg}`);
        return {
          success: false,
          message: result.msg
        };
      }
    } catch (error) {
      logger.error(`更新客户端错误: ${error.message}`);
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * 重置客户端流量
   * @param {number} inboundId - inbound ID
   * @param {string} email - 客户端标识
   * @returns {Promise<Object>} 重置结果
   */
  async addClientByContext(inboundId, protocol, options = {}) {
    try {
      if (!this.client) {
        await this.init();
      }

      const clientObj = this.buildClientSettingsPayload({
        protocol,
        strategy: options.strategy || 'direct',
        credential: options.auth || options.id || this.generateUuid(),
        email: options.email || '',
        enable: this.normalizeClientEnabled(options.enable),
        expiryTime: options.expiryTime || 0,
        totalGB: options.totalGB || 0,
        limitIp: options.limitIp || 0,
        tgId: options.tgId || 0,
        subId: options.subId || '',
        flow: options.flow || ''
      });

      logger.info(`构建客户端配置: protocol=${protocol}, strategy=${options.strategy || 'direct'}, email=${options.email}, hasAuth=${Boolean(options.auth)}, hasId=${Boolean(options.id)}`);

      const clientConfig = {
        id: inboundId,
        settings: JSON.stringify({
          clients: [clientObj]
        })
      };

      const result = await this.client.addClient(clientConfig);

      if (result.success) {
        return { success: true, message: result.msg };
      }

      logger.warn(`添加客户端失败: ${result.msg}`);
      return { success: false, message: result.msg };
    } catch (error) {
      logger.error(`添加客户端错误: ${error.message}`);
      return {
        success: false,
        message: error.message
      };
    }
  }

  async updateClientByContext(inboundId, email, options = {}) {
    try {
      if (!this.client) {
        await this.init();
      }

      const clientInfo = await this.getClientByEmail(inboundId, email);
      if (!clientInfo.success) {
        return {
          success: false,
          message: `未找到用户 ${email}`
        };
      }

      const strategy = options.strategy || 'direct';
      const protocol = options.protocol || '';
      const usesAuthCredential = strategy === 'hy2' || protocol === 'hysteria' || protocol === 'hysteria2';
      const credential = usesAuthCredential
        ? (options.auth || clientInfo.auth || '')
        : (clientInfo.uuid || '');

      const updateClientObj = this.buildClientSettingsPayload({
        protocol,
        strategy,
        credential,
        email,
        enable: this.normalizeClientEnabled(options.enabled !== undefined ? options.enabled : clientInfo.enable),
        expiryTime: options.expiryTime !== undefined ? options.expiryTime : clientInfo.expiryTime,
        totalGB: options.totalGB !== undefined ? options.totalGB * 1073741824 : clientInfo.totalGB,
        limitIp: 0,
        tgId: 0,
        subId: options.subId !== undefined ? options.subId : (clientInfo.subId || ''),
        flow: options.flow !== undefined ? options.flow : (clientInfo.flow || '')
      });

      logger.info(`构建客户端配置: protocol=${protocol}, strategy=${strategy}, email=${email}, hasAuth=${Boolean(options.auth || clientInfo.auth)}, hasId=${Boolean(clientInfo.uuid)}`);

      const updateConfig = {
        id: inboundId,
        settings: JSON.stringify({
          clients: [updateClientObj]
        })
      };

      if (!credential) {
        return {
          success: false,
          message: usesAuthCredential
            ? `未找到用户 ${email} 的认证凭证`
            : `未找到用户 ${email} 的客户端 ID`
        };
      }

      const clientIdentifier = clientInfo.uuid || clientInfo.auth;
      const result = await this.client.updateClient(clientIdentifier, updateConfig);

      if (result.success) {
        return { success: true, message: result.msg };
      }

      logger.warn(`更新客户端失败: ${result.msg}`);
      return { success: false, message: result.msg };
    } catch (error) {
      logger.error(`更新客户端错误: ${error.message}`);
      return {
        success: false,
        message: error.message
      };
    }
  }

  async resetClientTraffic(inboundId, email) {
    try {
      if (!this.client) {
        await this.init();
      }

      const result = this.usesClientApi()
        ? await this.client.resetClientTraffic(email)
        : await this.client.resetClientTraffic(inboundId, email);
      
      if (result.success) {
        logger.info(`重置客户端流量成功: ${email}`);
        return {
          success: true,
          message: result.msg
        };
      } else {
        logger.warn(`重置客户端流量失败: ${result.msg}`);
        return {
          success: false,
          message: result.msg
        };
      }
    } catch (error) {
      logger.error(`重置客户端流量错误: ${error.message}`);
      return {
        success: false,
        message: error.message
      };
    }
  }
}

module.exports = XuiService;
