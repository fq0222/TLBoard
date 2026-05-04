/**
 * 用户端订阅路由
 * 处理订阅链接获取和订阅内容
 */

const express = require('express');
const { param, query, validationResult } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth-user');
const { createLogger } = require('../../utils/logger');

const router = express.Router();
const logger = createLogger('USER-SUB');

/**
 * 从 inbound 的 settings 和 stream_settings 中解析节点配置
 * @param {Object} node - 节点基本信息
 * @param {string|Object} settings - inbound settings
 * @param {string|Object} streamSettings - inbound stream_settings
 * @returns {Object} 解析后的节点配置
 */
function parseNodeConfig(node, settings, streamSettings) {
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
  
  // 获取 UUID（从第一个客户端）
  const clients = parsedSettings.clients || [];
  const uuid = clients.length > 0 ? clients[0].id : '';
  
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
        u.id, u.email, u.subscription_token,
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
        const config = parseNodeConfig(node, node.settings, node.stream_settings);
        
        // 使用服务器的 host 和 client_port
        const nodeHost = server.host || '';
        const nodePort = server.client_port || node.port;
        
        // 如果有CF优选IP，为每个 IP 生成一个节点
        if (cfIps.length > 0) {
          for (const cfIp of cfIps) {
            nodes.push({
              protocol: node.protocol,
              uuid: config.uuid,
              address: cfIp.ip,
              port: nodePort,
              host: nodeHost,
              wsPath: config.wsPath,
              security: config.security,
              remark: `${node.remark}-${server.name}`
            });
          }
        } else {
          // 使用默认IP
          const defaultIp = server.api_url.match(/\/\/([^:]+)/);
          nodes.push({
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
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    // 格式化时间显示
    const formatTime = (timestamp) => {
      if (!timestamp) return null;
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
 * 通过token直接获取订阅内容
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

    // 查询用户（通过 sub_id 查询）
    const user = await db.prepare(`
      SELECT 
        u.id, u.email, u.subscription_token,
        u.traffic_used, u.traffic_limit, u.expire_at, u.enabled
      FROM users u
      WHERE u.sub_id = ?
    `).get(token);
    
    if (!user) {
      logger.warn(`订阅链接无效: ${token}`);
      return res.status(400).json({
        code: 2004,
        message: '订阅链接无效',
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
    `).all(user.id);

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
        const config = parseNodeConfig(node, node.settings, node.stream_settings);
        
        // 使用服务器的 host 和 client_port
        const nodeHost = server.host || '';
        const nodePort = server.client_port || node.port;
        
        // 如果有CF优选IP，为每个 IP 生成一个节点
        if (cfIps.length > 0) {
          for (const cfIp of cfIps) {
            nodes.push({
              protocol: node.protocol,
              uuid: config.uuid,
              address: cfIp.ip,
              port: nodePort,
              host: nodeHost,
              wsPath: config.wsPath,
              security: config.security,
              remark: `${node.remark}-${server.name}`
            });
          }
        } else {
          // 使用默认IP
          const defaultIp = server.api_url.match(/\/\/([^:]+)/);
          nodes.push({
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

    // 根据请求格式返回订阅内容
    if (clash === '1') {
      // 返回Clash格式
      const clashConfig = generateClashConfig(nodes, user);
      res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
      res.send(clashConfig);
    } else if (v2ray === '1') {
      // 返回V2Ray base64格式
      const v2rayConfig = generateV2RayConfig(nodes, user);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(Buffer.from(v2rayConfig).toString('base64'));
    } else {
      // 返回默认格式（V2Ray base64）
      const v2rayConfig = generateV2RayConfig(nodes, user);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Subscription-Userinfo', `upload=0; download=${user.traffic_used}; total=${user.traffic_limit}; expire=${user.expire_at}`);
      res.send(Buffer.from(v2rayConfig).toString('base64'));
    }

    logger.info(`获取订阅内容成功: ${user.email}`);
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
 * @param {Array} nodes - 节点列表
 * @param {Object} user - 用户信息
 * @returns {string} Clash配置YAML
 */
function generateClashConfig(nodes, user) {
  const proxies = nodes.map(node => {
    const { protocol, uuid, address, port, host, wsPath, security, remark } = node;
    
    if (protocol === 'vless') {
      return `  - name: ${remark}
    type: vless
    server: ${address}
    port: ${port}
    uuid: ${uuid}
    udp: true
    tls: ${security === 'tls'}
    network: ws
    ws-opts:
      path: ${wsPath || '/'}
      headers:
        Host: ${host || address}`;
    } else if (protocol === 'vmess') {
      return `  - name: ${remark}
    type: vmess
    server: ${address}
    port: ${port}
    uuid: ${uuid}
    alterId: 0
    cipher: auto
    tls: ${security === 'tls'}
    network: ws
    ws-opts:
      path: ${wsPath || '/'}
      headers:
        Host: ${host || address}`;
    } else if (protocol === 'trojan') {
      return `  - name: ${remark}
    type: trojan
    server: ${address}
    port: ${port}
    password: ${uuid}
    tls: true
    network: ws
    ws-opts:
      path: ${wsPath || '/'}
      headers:
        Host: ${host || address}
    sni: ${host || address}`;
    }
    return '';
  }).filter(Boolean).join('\n');

  return `proxies:
${proxies}

proxy-groups:
  - name: Proxy
    type: select
    proxies:
${nodes.map(node => `      - ${node.remark}`).join('\n')}

rules:
  - MATCH,Proxy`;
}

/**
 * 生成V2Ray订阅内容
 * @param {Array} nodes - 节点列表
 * @param {Object} user - 用户信息
 * @returns {string} V2Ray订阅内容（每行一个节点链接）
 */
function generateV2RayConfig(nodes, user) {
  return nodes.map(node => generateNodeLink(node)).filter(Boolean).join('\n');
}

module.exports = router;