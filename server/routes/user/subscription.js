/**
 * 用户端订阅路由
 * 处理订阅链接获取和订阅内容
 */

const express = require('express');
const { param, query, validationResult } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth-user');

const router = express.Router();

// 日志工具
const logger = {
  info: (msg) => console.log(`[USER-SUB] [INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[USER-SUB] [ERROR] ${new Date().toISOString()} - ${msg}`),
  warn: (msg) => console.warn(`[USER-SUB] [WARN] ${new Date().toISOString()} - ${msg}`)
};

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
      SELECT cp.ip, cp.port, cp.location
      FROM user_cf_ips uci
      JOIN cf_ip_pool cp ON uci.ip_pool_id = cp.id
      WHERE uci.user_id = ? AND cp.enabled = 1
    `).all(userId);

    // 查询所有服务器节点
    const servers = await db.prepare(`
      SELECT id, name, api_url, status
      FROM xui_servers
      WHERE status = 1
    `).all();

    // 构建节点列表
    const nodes = [];
    
    for (const server of servers) {
      // 查询服务器节点
      const serverNodes = await db.prepare(`
        SELECT inbound_id, remark, port, protocol
        FROM xui_nodes
        WHERE server_id = ?
      `).all(server.id);

      for (const node of serverNodes) {
        // 如果有CF优选IP，使用优选IP替换默认IP
        if (cfIps.length > 0) {
          for (const cfIp of cfIps) {
            nodes.push({
              server_name: server.name,
              address: cfIp.ip,
              port: cfIp.port,
              protocol: node.protocol,
              remark: `${node.remark}-${cfIp.location}`
            });
          }
        } else {
          // 使用默认IP
          const defaultIp = server.api_url.match(/\/\/([^:]+)/);
          nodes.push({
            server_name: server.name,
            address: defaultIp ? defaultIp[1] : '0.0.0.0',
            port: node.port,
            protocol: node.protocol,
            remark: node.remark
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
      return new Date(timestamp * 1000).toISOString().replace('T', ' ').substr(0, 19);
    };

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const subscriptionUrl = `${baseUrl}/api/user/sub/${user.subscription_token}`;

    logger.info(`获取订阅信息成功: ${user.email}`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        subscription_url: subscriptionUrl,
        clash_url: `${subscriptionUrl}?clash=1`,
        v2ray_url: `${subscriptionUrl}?v2ray=1`,
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

    // 查询用户
    const user = await db.prepare(`
      SELECT 
        u.id, u.email, u.subscription_token,
        u.traffic_used, u.traffic_limit, u.expire_at, u.enabled
      FROM users u
      WHERE u.subscription_token = ?
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
      SELECT cp.ip, cp.port, cp.location
      FROM user_cf_ips uci
      JOIN cf_ip_pool cp ON uci.ip_pool_id = cp.id
      WHERE uci.user_id = ? AND cp.enabled = 1
    `).all(user.id);

    // 查询所有服务器节点
    const servers = await db.prepare(`
      SELECT id, name, api_url, status
      FROM xui_servers
      WHERE status = 1
    `).all();

    // 构建节点列表
    const nodes = [];
    
    for (const server of servers) {
      // 查询服务器节点
      const serverNodes = await db.prepare(`
        SELECT inbound_id, remark, port, protocol
        FROM xui_nodes
        WHERE server_id = ?
      `).all(server.id);

      for (const node of serverNodes) {
        // 如果有CF优选IP，使用优选IP替换默认IP
        if (cfIps.length > 0) {
          for (const cfIp of cfIps) {
            nodes.push({
              server_name: server.name,
              address: cfIp.ip,
              port: cfIp.port,
              protocol: node.protocol,
              remark: `${node.remark}-${cfIp.location}`
            });
          }
        } else {
          // 使用默认IP
          const defaultIp = server.api_url.match(/\/\/([^:]+)/);
          nodes.push({
            server_name: server.name,
            address: defaultIp ? defaultIp[1] : '0.0.0.0',
            port: node.port,
            protocol: node.protocol,
            remark: node.remark
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
    if (node.protocol === 'vmess') {
      return `  - name: ${node.remark}
    type: vmess
    server: ${node.address}
    port: ${node.port}
    uuid: ${user.subscription_token}
    alterId: 0
    cipher: auto
    tls: true`;
    } else if (node.protocol === 'trojan') {
      return `  - name: ${node.remark}
    type: trojan
    server: ${node.address}
    port: ${node.port}
    password: ${user.subscription_token}
    sni: ${node.address}`;
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
 * 生成V2Ray配置
 * @param {Array} nodes - 节点列表
 * @param {Object} user - 用户信息
 * @returns {string} V2Ray配置
 */
function generateV2RayConfig(nodes, user) {
  return nodes.map(node => {
    if (node.protocol === 'vmess') {
      const config = {
        v: '2',
        ps: node.remark,
        add: node.address,
        port: node.port,
        id: user.subscription_token,
        aid: 0,
        net: 'tcp',
        type: 'none',
        host: '',
        path: '',
        tls: 'tls'
      };
      return `vmess://${Buffer.from(JSON.stringify(config)).toString('base64')}`;
    } else if (node.protocol === 'trojan') {
      return `trojan://${user.subscription_token}@${node.address}:${node.port}?security=tls&type=tcp#${encodeURIComponent(node.remark)}`;
    }
    return '';
  }).filter(Boolean).join('\n');
}

module.exports = router;