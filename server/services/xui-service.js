/**
 * 3X-UI API 服务封装
 * 使用 3xui-api-client 库与 3X-UI 面板通信
 */

const ThreeXUI = require('3xui-api-client');
const config = require('../config');
const { createLogger } = require('../utils/logger');

const logger = createLogger('XUI-SERVICE');

// 禁用环境变量代理，避免连接问题
delete process.env.http_proxy;
delete process.env.https_proxy;
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;

/**
 * 3X-UI 服务类
 * 封装与 3X-UI 面板的所有交互
 */
class XuiService {
  /**
   * 创建 XuiService 实例
   * @param {string} apiUrl - 面板地址
   * @param {string} username - API 用户名
   * @param {string} password - API 密码
   */
  constructor(apiUrl, username, password) {
    this.apiUrl = apiUrl;
    this.username = username;
    this.password = password;
    this.client = null;
  }

  /**
   * 初始化客户端连接
   */
  async init() {
    try {
      this.client = new ThreeXUI(
        this.apiUrl,
        this.username,
        this.password,
        {
          maxRequestsPerMinute: 60,
          maxLoginAttemptsPerHour: 10,
          isDevelopment: process.env.NODE_ENV !== 'production',
          timeout: config.xui.timeout || 20000
        }
      );
      logger.info(`初始化 3X-UI 客户端: ${this.apiUrl}`);
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
   * 获取所有 inbounds（节点）
   * @returns {Promise<Object>} inbounds 列表
   */
  async getInbounds() {
    try {
      if (!this.client) {
        await this.init();
      }

      const response = await this.client.getInbounds();
      
      if (response.success) {
        logger.info(`获取 inbounds 成功，共 ${response.obj ? response.obj.length : 0} 个`);
        return {
          success: true,
          data: response.obj || []
        };
      } else {
        logger.warn(`获取 inbounds 失败: ${response.msg}`);
        return {
          success: false,
          message: response.msg,
          data: []
        };
      }
    } catch (error) {
      logger.error(`获取 inbounds 错误: ${error.message}`);
      return {
        success: false,
        message: error.message,
        data: []
      };
    }
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
        enable: options.enable !== false,
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
        enable: options.enabled !== undefined ? options.enabled : clientInfo.enable,
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
  async resetClientTraffic(inboundId, email) {
    try {
      if (!this.client) {
        await this.init();
      }

      const result = await this.client.resetClientTraffic(inboundId, email);
      
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
