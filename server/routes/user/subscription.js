/**
 * 用户端订阅路由
 * 处理订阅链接获取和订阅内容
 */

const express = require('express');
const { param, query, validationResult } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth-user');
const { createLogger } = require('../../utils/logger');
const { syncAllServers } = require('../../services/xui-sync');
const { getStrategyFromRemark, processNodeLink, parseNodeLink } = require('../../services/subscription-strategy');
const https = require('https');
const http = require('http');

const router = express.Router();
const logger = createLogger('USER-SUB');

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

/**
 * 从 inbound 的 settings 和 stream_settings 中解析节点配置
 * @param {Object} node - 节点基本信息
 * @param {string|Object} settings - inbound settings
 * @param {string|Object} streamSettings - inbound stream_settings
 * @param {string} [userEmail] - 用户邮箱，用于查找特定用户的UUID
 * @returns {Object} 解析后的节点配置
 */
function parseNodeConfig(node, settings, streamSettings, userEmail) {
  let parsedSettings = {};
  let parsedStream = {};
  
  // 处理 settings（可能是 JSON 字符串或对象）
  try {
    if (typeof settings === 'string') {
      parsedSettings = JSON.parse(settings || '{}');
    } else {
      parsedSettings = settings || {};
    }
  } catch (e) {
    logger.warn(`解析 settings 失败: ${e.message}`);
  }
  
  // 处理 stream_settings（可能是 JSON 字符串或对象）
  try {
    if (typeof streamSettings === 'string') {
      parsedStream = JSON.parse(streamSettings || '{}');
    } else {
      parsedStream = streamSettings || {};
    }
  } catch (e) {
    logger.warn(`解析 stream_settings 失败: ${e.message}`);
  }
  
  // 获取 UUID（优先查找用户自己的UUID，否则返回第一个客户端的UUID）
  const clients = parsedSettings.clients || [];
  let uuid = '';
  
  if (userEmail && clients.length > 0) {
    // 根据用户邮箱查找对应的客户端
    const userClient = clients.find(c => c.email === userEmail);
    uuid = userClient ? userClient.id : clients[0].id;
  } else {
    uuid = clients.length > 0 ? clients[0].id : '';
  }
  
  // 获取传输协议
  const network = parsedStream.network || 'tcp';
  
  // 获取 WS 路径（兼容不同格式的字段名）
  let wsPath = '';
  if (network === 'ws') {
    const wsSettings = parsedStream.wsSettings || parsedStream['ws-settings'] || {};
    wsPath = wsSettings.path || '/';
  }
  
  // 获取 TLS 设置
  const security = parsedStream.security || 'none';
  
  return {
    uuid,
    network,
    wsPath,
    security
  };
}

/**
 * 生成完整的节点链接
 * @param {Object} params - 参数
 * @returns {string} 节点链接
 */
function generateNodeLink(params) {
  const { protocol, uuid, address, port, host, wsPath, security, remark } = params;
  
  if (protocol === 'vless') {
    // vless://uuid@address:port?encryption=none&security=none&type=ws&host=host&path=path#remark
    const queryParams = new URLSearchParams({
      encryption: 'none',
      security: security || 'none',
      type: 'ws',
      host: host || '',
      path: wsPath || '/'
    });
    return `vless://${uuid}@${address}:${port}?${queryParams.toString()}#${encodeURIComponent(remark)}`;
  } else if (protocol === 'vmess') {
    // vmess://base64(json)
    const config = {
      v: '2',
      ps: remark,
      add: address,
      port: port,
      id: uuid,
      aid: 0,
      net: 'ws',
      type: 'none',
      host: host || '',
      path: wsPath || '/',
      tls: security === 'tls' ? 'tls' : ''
    };
    return `vmess://${Buffer.from(JSON.stringify(config)).toString('base64')}`;
  } else if (protocol === 'trojan') {
    // trojan://uuid@address:port?security=tls&type=ws&host=host&path=path#remark
    const queryParams = new URLSearchParams({
      security: security || 'tls',
      type: 'ws',
      host: host || '',
      path: wsPath || '/'
    });
    return `trojan://${uuid}@${address}:${port}?${queryParams.toString()}#${encodeURIComponent(remark)}`;
  }
  
  return '';
}

/**
 * POST /api/user/subscription/generate
 * 生成订阅链接（同步节点信息、处理策略、聚合节点后返回）
 */
router.post('/generate', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const db = req.app.locals.db;

    // 查询用户信息
    const user = await db.prepare(`
      SELECT 
        u.id, u.email, u.subscription_token, u.sub_id,
        u.traffic_used, u.traffic_limit, u.expire_at, u.enabled,
        p.name as plan_name
      FROM users u
      LEFT JOIN plans p ON u.plan_id = p.id
      WHERE u.id = ?
    `).get(userId);
    
    if (!user) {
      logger.error(`用户不存在: ${userId}`);
      return res.status(400).json({
        code: 2004,
        message: '用户不存在',
        data: null
      });
    }

    // 检查账号是否启用
    if (!user.enabled) {
      logger.warn(`用户账号已禁用: ${user.email}`);
      return res.status(400).json({
        code: 2003,
        message: '账号已被禁用',
        data: null
      });
    }

    // 检查是否已完成 CF 优选
    const cfIps = await db.prepare(`
      SELECT cp.ip
      FROM user_cf_ips uci
      JOIN cf_ip_pool cp ON uci.ip_pool_id = cp.id
      WHERE uci.user_id = ? AND cp.enabled = 1
    `).all(userId);
    
    if (cfIps.length === 0) {
      return res.status(400).json({
        code: 3001,
        message: '请先完成 IP 优选',
        data: null
      });
    }

    // 同步所有服务器的节点信息
    logger.info(`用户 ${user.email} 生成订阅链接，开始同步节点信息`);
    const syncResult = await syncAllServers(db);
    logger.info(`节点同步完成: ${syncResult.syncedCount}/${syncResult.totalCount} 台服务器`);

    // 获取用户的 CF 优选 IP（取第一个）
    const cfIp = cfIps[0].ip;

    // 获取所有在线服务器
    const servers = await db.prepare(`
      SELECT id, name, api_url, host, client_port, sub_url
      FROM xui_servers
      WHERE status = 1
    `).all();

    // 聚合所有节点
    const allNodes = [];

    for (const server of servers) {
      try {
        // 获取用户在该服务器的节点配置
        const nodeConfigs = await db.prepare(`
          SELECT unc.uuid, unc.sub_id, xn.remark, xn.protocol, xn.inbound_id
          FROM user_node_configs unc
          JOIN xui_nodes xn ON unc.node_id = xn.id
          WHERE unc.user_id = ? AND xn.server_id = ?
        `).all(userId, server.id);

        if (nodeConfigs.length === 0) {
          logger.warn(`服务器 ${server.name} 没有用户 ${user.email} 的节点配置`);
          continue;
        }

        // 检查服务器是否有订阅地址
        if (!server.sub_url) {
          logger.warn(`服务器 ${server.name} 没有设置订阅地址`);
          continue;
        }

        // 获取第一个节点的 sub_id（用于获取原始订阅）
        const firstConfig = nodeConfigs[0];

        // 从 3X-UI 获取原始订阅
        let originalLinks = [];
        try {
          const originalContent = await fetchOriginalSubscription(server.sub_url, firstConfig.sub_id);
          originalLinks = parseSubscriptionContent(originalContent);
          logger.info(`从服务器 ${server.name} 获取到 ${originalLinks.length} 个原始节点`);
        } catch (error) {
          logger.error(`从服务器 ${server.name} 获取原始订阅失败: ${error.message}`);
          continue;
        }

        // 处理每个节点
        for (let i = 0; i < nodeConfigs.length; i++) {
          const config = nodeConfigs[i];
          
          // 尝试从原始链接中找到匹配的节点
          // 优先通过 UUID 匹配，如果找不到则按顺序取
          let originalLink = originalLinks.find(link => link.includes(config.uuid));
          if (!originalLink && i < originalLinks.length) {
            originalLink = originalLinks[i];
          }

          if (!originalLink) {
            logger.warn(`找不到节点 ${config.remark} 的原始链接`);
            continue;
          }

          // 判断策略
          const strategy = getStrategyFromRemark(config.remark);

          // 处理节点链接
          let processedLink;
          if (strategy === 'cf') {
            processedLink = processNodeLink(originalLink, 'cf', {
              cfIp: cfIp,
              clientPort: server.client_port,
              host: server.host
            });
          } else {
            processedLink = processNodeLink(originalLink, 'direct');
          }

          allNodes.push({
            server_name: server.name,
            node_name: config.remark,
            protocol: config.protocol,
            strategy: strategy,
            link: processedLink,
            original_link: originalLink
          });
        }
      } catch (error) {
        logger.error(`处理服务器 ${server.name} 错误: ${error.message}`);
      }
    }

    // 存储到 user_subscriptions 表
    const now = Math.floor(Date.now() / 1000);
    await db.prepare(`
      INSERT INTO user_subscriptions (user_id, sub_id, nodes_data, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (sub_id) DO UPDATE SET
        nodes_data = ?,
        updated_at = ?
    `).run(userId, user.sub_id, JSON.stringify(allNodes), now, JSON.stringify(allNodes), now);

    logger.info(`用户 ${user.email} 生成订阅链接成功，共 ${allNodes.length} 个节点`);

    // 返回订阅链接
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const subscriptionUrl = `${baseUrl}/api/user/sub/${user.sub_id}`;

    res.json({
      code: 0,
      message: 'ok',
      data: {
        subscription_url: subscriptionUrl,
        clash_url: `${subscriptionUrl}?clash=1`,
        v2ray_url: `${subscriptionUrl}?v2ray=1`
      }
    });
  } catch (error) {
    logger.error(`生成订阅链接错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * GET /api/user/subscription
 * 获取订阅链接及节点信息
 */
router.get('/', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const db = req.app.locals.db;

    // 查询用户信息
    const user = await db.prepare(`
      SELECT 
        u.id, u.email, u.subscription_token, u.sub_id,
        u.traffic_used, u.traffic_limit, u.expire_at, u.enabled,
        p.name as plan_name
      FROM users u
      LEFT JOIN plans p ON u.plan_id = p.id
      WHERE u.id = ?
    `).get(userId);
    
    if (!user) {
      logger.error(`用户不存在: ${userId}`);
      return res.status(400).json({
        code: 2004,
        message: '用户不存在',
        data: null
      });
    }

    // 检查账号是否启用
    if (!user.enabled) {
      logger.warn(`用户账号已禁用: ${user.email}`);
      return res.status(400).json({
        code: 2003,
        message: '账号已被禁用',
        data: null
      });
    }

    // 查询用户选择的CF优选IP
    const cfIps = await db.prepare(`
      SELECT cp.ip
      FROM user_cf_ips uci
      JOIN cf_ip_pool cp ON uci.ip_pool_id = cp.id
      WHERE uci.user_id = ? AND cp.enabled = 1
    `).all(userId);

    // 查询所有在线服务器（包含 host 和 client_port）
    const servers = await db.prepare(`
      SELECT id, name, api_url, host, client_port, status
      FROM xui_servers
      WHERE status = 1
    `).all();

    // 构建节点列表
    const nodes = [];
    
    for (const server of servers) {
      // 查询服务器节点（包含 settings 和 stream_settings）
      const serverNodes = await db.prepare(`
        SELECT inbound_id, remark, port, protocol, settings, stream_settings
        FROM xui_nodes
        WHERE server_id = ?
      `).all(server.id);

      for (const node of serverNodes) {
        // 解析节点配置
        const config = parseNodeConfig(node, node.settings, node.stream_settings, user.email);
        
        // 使用服务器的 host 和 client_port
        const nodeHost = server.host || '';
        const nodePort = server.client_port || node.port;
        
        // 如果有CF优选IP，为每个 IP 生成一个节点
        if (cfIps.length > 0) {
          cfIps.forEach((cfIp, index) => {
            const ipRemark = cfIps.length > 1 ? `${node.remark}-${server.name}-${index + 1}` : `${node.remark}-${server.name}`;
            nodes.push({
              server_name: server.name,
              protocol: node.protocol,
              uuid: config.uuid,
              address: cfIp.ip,
              port: nodePort,
              host: nodeHost,
              wsPath: config.wsPath,
              security: config.security,
              remark: ipRemark
            });
          });
        } else {
          // 使用默认IP
          const defaultIp = server.api_url.match(/\/\/([^:]+)/);
          nodes.push({
            server_name: server.name,
            protocol: node.protocol,
            uuid: config.uuid,
            address: defaultIp ? defaultIp[1] : '0.0.0.0',
            port: nodePort,
            host: nodeHost,
            wsPath: config.wsPath,
            security: config.security,
            remark: `${node.remark}-${server.name}`
          });
        }
      }
    }

    // 计算流量百分比
    const trafficPercent = user.traffic_limit > 0 
      ? Math.round((user.traffic_used / user.traffic_limit) * 100 * 100) / 100 
      : 0;

    // 格式化流量显示
    const formatTraffic = (bytes) => {
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
    };

    // 格式化时间显示
    const formatTime = (timestamp) => {
      if (!timestamp || timestamp === 0 || timestamp === '0') return '无限期';
      return new Date(timestamp * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    };

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const subscriptionUrl = `${baseUrl}/api/user/subscription/sub/${user.sub_id}`;

    // 检查用户是否已完成 CF 优选
    const cfOptimized = cfIps.length > 0;

    logger.info(`获取订阅信息成功: ${user.email}`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        subscription_url: cfOptimized ? subscriptionUrl : '',
        clash_url: cfOptimized ? `${subscriptionUrl}?clash=1` : '',
        v2ray_url: cfOptimized ? `${subscriptionUrl}?v2ray=1` : '',
        cf_optimized: cfOptimized,
        expire_at: user.expire_at,
        expire_text: formatTime(user.expire_at),
        traffic_used: user.traffic_used,
        traffic_limit: user.traffic_limit,
        traffic_used_text: formatTraffic(user.traffic_used),
        traffic_limit_text: formatTraffic(user.traffic_limit),
        traffic_percent: trafficPercent,
        nodes
      }
    });
  } catch (error) {
    logger.error(`获取订阅信息错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * GET /api/user/sub/:token
 * 通过token直接获取订阅内容（从缓存中获取）
 */
router.get('/sub/:token', [
  param('token')
    .notEmpty()
    .withMessage('订阅token不能为空'),
  query('clash')
    .optional()
    .isIn(['0', '1'])
    .withMessage('clash参数必须是0或1'),
  query('v2ray')
    .optional()
    .isIn(['0', '1'])
    .withMessage('v2ray参数必须是0或1')
], async (req, res) => {
  try {
    // 验证请求参数
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('获取订阅内容参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const { token } = req.params;
    const { clash, v2ray } = req.query;
    const db = req.app.locals.db;

    // 从 user_subscriptions 表获取缓存的节点信息
    const subscription = await db.prepare(`
      SELECT us.*, u.email, u.traffic_used, u.traffic_limit, u.expire_at, u.enabled
      FROM user_subscriptions us
      JOIN users u ON us.user_id = u.id
      WHERE us.sub_id = ?
    `).get(token);
    
    if (!subscription) {
      logger.warn(`订阅链接无效: ${token}`);
      return res.status(400).json({
        code: 2004,
        message: '订阅链接无效或尚未生成',
        data: null
      });
    }

    // 检查账号是否启用
    if (!subscription.enabled) {
      logger.warn(`用户账号已禁用: ${subscription.email}`);
      return res.status(400).json({
        code: 2003,
        message: '账号已被禁用',
        data: null
      });
    }

    // 解析缓存的节点数据
    const nodes = JSON.parse(subscription.nodes_data);

    // 根据请求格式返回订阅内容
    if (clash === '1') {
      // 返回Clash格式
      const clashConfig = generateClashConfig(nodes, subscription);
      res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
      res.send(clashConfig);
    } else if (v2ray === '1') {
      // 返回V2Ray base64格式
      const v2rayConfig = generateV2RayConfig(nodes, subscription);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(Buffer.from(v2rayConfig).toString('base64'));
    } else {
      // 返回默认格式（V2Ray base64）
      const v2rayConfig = generateV2RayConfig(nodes, subscription);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Subscription-Userinfo', `upload=0; download=${subscription.traffic_used}; total=${subscription.traffic_limit}; expire=${subscription.expire_at}`);
      res.send(Buffer.from(v2rayConfig).toString('base64'));
    }

    logger.info(`获取订阅内容成功: ${subscription.email}`);
  } catch (error) {
    logger.error(`获取订阅内容错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * 生成Clash配置
 * @param {Array} nodes - 节点列表（包含 link 字段）
 * @param {Object} user - 用户信息
 * @returns {string} Clash配置YAML
 */
function generateClashConfig(nodes, user) {
  const proxies = nodes.map(node => {
    const { link, node_name } = node;
    
    // 解析节点链接
    const parsed = parseNodeLink(link);
    if (!parsed) return '';
    
    const { protocol, uuid, address, port, params } = parsed;
    const host = params.host || '';
    const wsPath = params.path || '/';
    const security = params.security || 'none';
    
    // 处理IPv6地址，去除方括号
    const serverAddress = address.startsWith('[') && address.endsWith(']') 
      ? address.slice(1, -1) 
      : address;
    
    if (protocol === 'vless') {
      return `  - name: ${node_name}
    type: vless
    server: ${serverAddress}
    port: ${port}
    uuid: ${uuid}
    udp: true
    tls: ${security === 'tls' || security === 'reality'}
    network: ws
    ws-opts:
      path: ${wsPath}
      headers:
        Host: ${host || serverAddress}`;
    } else if (protocol === 'vmess') {
      return `  - name: ${node_name}
    type: vmess
    server: ${serverAddress}
    port: ${port}
    uuid: ${uuid}
    alterId: 0
    cipher: auto
    tls: ${security === 'tls'}
    network: ws
    ws-opts:
      path: ${wsPath}
      headers:
        Host: ${host || serverAddress}`;
    } else if (protocol === 'trojan') {
      return `  - name: ${node_name}
    type: trojan
    server: ${serverAddress}
    port: ${port}
    password: ${uuid}
    tls: true
    network: ws
    ws-opts:
      path: ${wsPath}
      headers:
        Host: ${host || serverAddress}
    sni: ${host || serverAddress}`;
    }
    return '';
  }).filter(Boolean).join('\n');

  return `proxies:
${proxies}

proxy-groups:
  - name: Proxy
    type: select
    proxies:
${nodes.map(node => `      - ${node.node_name}`).join('\n')}

rules:
  - MATCH,Proxy`;
}

/**
 * 生成V2Ray订阅内容
 * @param {Array} nodes - 节点列表（包含 link 字段）
 * @param {Object} user - 用户信息
 * @returns {string} V2Ray订阅内容（每行一个节点链接）
 */
function generateV2RayConfig(nodes, user) {
  return nodes.map(node => node.link).filter(Boolean).join('\n');
}

module.exports = router;