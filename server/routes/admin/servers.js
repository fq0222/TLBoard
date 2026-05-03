/**
 * 3X-UI服务器管理路由
 * 处理3X-UI服务器的增删改查和同步操作
 */

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const XuiService = require('../../services/xui-service');
const { createLogger } = require('../../utils/logger');

const router = express.Router();
const logger = createLogger('ADMIN-SERVERS');

/**
 * GET /api/admin/servers
 * 获取所有3X-UI服务器列表
 */
router.get('/', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;

    // 查询所有服务器
    const servers = await db.prepare(`
      SELECT id, name, api_url, host, client_port, status, last_check_at, created_at
      FROM xui_servers
      ORDER BY created_at DESC
    `).all();

    // 格式化服务器数据
    const formattedServers = await Promise.all(servers.map(async (server) => {
      // 查询服务器节点数和用户数（从 xui_nodes 表获取）
      const nodeStats = await db.prepare(`
        SELECT 
          COUNT(*) as node_count,
          COALESCE(SUM(user_count), 0) as user_count,
          COALESCE(SUM(online_count), 0) as online_count
        FROM xui_nodes 
        WHERE server_id = ?
      `).get(server.id);

      return {
        id: server.id,
        name: server.name,
        api_url: server.api_url,
        host: server.host || '',
        client_port: server.client_port || 0,
        status: server.status,
        status_text: server.status === 1 ? '在线' : '离线',
        node_count: nodeStats.node_count || 0,
        user_count: nodeStats.user_count || 0,
        online_count: nodeStats.online_count || 0,
        last_check_at: server.last_check_at,
        created_at: server.created_at
      };
    }));

    logger.info(`获取服务器列表成功，共 ${formattedServers.length} 台服务器`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        servers: formattedServers
      }
    });
  } catch (error) {
    logger.error(`获取服务器列表错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * POST /api/admin/servers
 * 添加3X-UI服务器
 */
router.post('/', authenticateAdmin, [
  body('name')
    .notEmpty()
    .withMessage('服务器名称不能为空'),
  body('api_url')
    .notEmpty()
    .withMessage('面板地址不能为空')
    .matches(/^https?:\/\/.+/)
    .withMessage('面板地址格式不正确'),
  body('api_username')
    .notEmpty()
    .withMessage('API用户名不能为空'),
  body('api_password')
    .notEmpty()
    .withMessage('API密码不能为空')
], async (req, res) => {
  try {
    // 验证请求参数
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('添加服务器参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const { name, api_url, api_username, api_password } = req.body;
    const host = req.body.host || '';
    const clientPort = parseInt(req.body.client_port, 10) || 0;
    const db = req.app.locals.db;

    // 测试连接（模拟）
    const isConnected = await testXuiConnection(api_url, api_username, api_password);
    
    if (!isConnected) {
      logger.warn(`添加服务器失败: 连接测试失败 - ${api_url}`);
      return res.status(400).json({
        code: 3001,
        message: '连接 3X-UI 面板失败，请检查地址和凭据',
        data: null
      });
    }

    // 插入服务器记录
    const result = await db.prepare(`
      INSERT INTO xui_servers (name, api_url, api_username, api_password, host, client_port, status, last_check_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `).run(name, api_url, api_username, api_password, host, clientPort, Math.floor(Date.now() / 1000));

    logger.info(`添加服务器成功: ${name} (ID: ${result.lastInsertRowid})`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        id: result.lastInsertRowid,
        name,
        api_url,
        host,
        client_port: clientPort,
        status: 1,
        message: '服务器添加成功，连接测试通过'
      }
    });
  } catch (error) {
    logger.error(`添加服务器错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * PUT /api/admin/servers/:id
 * 修改3X-UI服务器信息
 */
router.put('/:id', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数'),
  body('name')
    .optional()
    .notEmpty()
    .withMessage('服务器名称不能为空'),
  body('api_url')
    .optional()
    .matches(/^https?:\/\/.+/)
    .withMessage('面板地址格式不正确'),
  body('api_username')
    .optional()
    .notEmpty()
    .withMessage('API用户名不能为空'),
  body('api_password')
    .optional()
    .notEmpty()
    .withMessage('API密码不能为空')
], async (req, res) => {
  try {
    // 验证请求参数
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('修改服务器参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const serverId = parseInt(req.params.id);
    const db = req.app.locals.db;

    // 检查服务器是否存在
    const existingServer = await db.prepare('SELECT * FROM xui_servers WHERE id = ?').get(serverId);
    
    if (!existingServer) {
      logger.warn(`修改服务器失败: 服务器不存在 - ${serverId}`);
      return res.status(400).json({
        code: 1001,
        message: '服务器不存在',
        data: null
      });
    }

    // 构建更新字段
    const updates = [];
    const values = [];
    
    if (req.body.name !== undefined) {
      updates.push('name = ?');
      values.push(req.body.name);
    }
    if (req.body.api_url !== undefined) {
      updates.push('api_url = ?');
      values.push(req.body.api_url);
    }
    if (req.body.api_username !== undefined) {
      updates.push('api_username = ?');
      values.push(req.body.api_username);
    }
    if (req.body.api_password !== undefined) {
      updates.push('api_password = ?');
      values.push(req.body.api_password);
    }
    if (req.body.host !== undefined) {
      updates.push('host = ?');
      values.push(req.body.host);
    }
    if (req.body.client_port !== undefined) {
      updates.push('client_port = ?');
      values.push(parseInt(req.body.client_port, 10) || 0);
    }

    if (updates.length === 0) {
      logger.warn('修改服务器失败: 没有要更新的字段');
      return res.status(400).json({
        code: 1001,
        message: '没有要更新的字段',
        data: null
      });
    }

    // 执行更新
    values.push(serverId);
    await db.prepare(`UPDATE xui_servers SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    // 查询更新后的服务器
    const updatedServer = await db.prepare('SELECT * FROM xui_servers WHERE id = ?').get(serverId);

    logger.info(`修改服务器成功: ${updatedServer.name} (ID: ${serverId})`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        id: updatedServer.id,
        name: updatedServer.name,
        api_url: updatedServer.api_url,
        host: updatedServer.host || '',
        client_port: updatedServer.client_port || 0,
        status: updatedServer.status,
        message: '服务器信息更新成功'
      }
    });
  } catch (error) {
    logger.error(`修改服务器错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * DELETE /api/admin/servers/:id
 * 删除3X-UI服务器
 */
router.delete('/:id', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数')
], async (req, res) => {
  try {
    // 验证请求参数
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('删除服务器参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const serverId = parseInt(req.params.id);
    const db = req.app.locals.db;

    // 检查服务器是否存在
    const existingServer = await db.prepare('SELECT * FROM xui_servers WHERE id = ?').get(serverId);
    
    if (!existingServer) {
      logger.warn(`删除服务器失败: 服务器不存在 - ${serverId}`);
      return res.status(400).json({
        code: 1001,
        message: '服务器不存在',
        data: null
      });
    }

    // 删除服务器关联的节点
    await db.prepare('DELETE FROM xui_nodes WHERE server_id = ?').run(serverId);
    
    // 删除服务器
    await db.prepare('DELETE FROM xui_servers WHERE id = ?').run(serverId);

    logger.info(`删除服务器成功: ${existingServer.name} (ID: ${serverId})`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        message: '服务器已删除'
      }
    });
  } catch (error) {
    logger.error(`删除服务器错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * GET /api/admin/servers/:id/detail
 * 获取服务器详细信息
 */
router.get('/:id/detail', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数')
], async (req, res) => {
  try {
    // 验证请求参数
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('获取服务器详情参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const serverId = parseInt(req.params.id);
    const db = req.app.locals.db;

    // 查询服务器信息
    const server = await db.prepare('SELECT * FROM xui_servers WHERE id = ?').get(serverId);
    
    if (!server) {
      logger.warn(`获取服务器详情失败: 服务器不存在 - ${serverId}`);
      return res.status(400).json({
        code: 1001,
        message: '服务器不存在',
        data: null
      });
    }

    // 从 3X-UI 服务器获取真实的节点和用户信息
    let nodesWithUsers = [];
    
    try {
      const xuiService = new XuiService(server.api_url, server.api_username, server.api_password);
      await xuiService.init();
      
      // 获取所有 inbounds
      const inboundsResult = await xuiService.getInbounds();
      
      if (inboundsResult.success) {
        // 获取在线用户（返回邮箱字符串数组）
        const onlineResult = await xuiService.getOnlineClients();
        const onlineEmails = onlineResult.success ? onlineResult.data : [];
        
        // 处理每个 inbound
        for (const inbound of inboundsResult.data) {
          const clientStats = inbound.clientStats || [];
          
          // 从 settings 中解析客户端配置（包含 totalGB 等信息）
          let clientsConfig = [];
          try {
            const settings = JSON.parse(inbound.settings || '{}');
            clientsConfig = settings.clients || [];
          } catch (e) {
            logger.warn(`解析 inbound settings 失败: ${e.message}`);
          }
          
          // 获取每个用户的详细信息
          const users = clientStats.map(client => {
            // 计算流量使用情况
            const trafficUsed = (client.up || 0) + (client.down || 0);
            
            // 从 settings.clients 中获取流量限制（totalGB 字段，单位是 GB）
            const clientConfig = clientsConfig.find(c => c.email === client.email);
            const trafficLimit = clientConfig ? (clientConfig.totalGB || 0) : 0;
            
            // 检查用户是否在线（onlineClients 是邮箱字符串数组）
            const isOnline = onlineEmails.includes(client.email);
            
            return {
              email: client.email,
              enabled: client.enable,
              expire_at: client.expiryTime ? Math.floor(client.expiryTime / 1000) : null,
              expire_text: client.expiryTime ? formatTime(Math.floor(client.expiryTime / 1000)) : '永不过期',
              traffic_used: trafficUsed,
              traffic_limit: trafficLimit,
              traffic_used_text: formatTraffic(trafficUsed),
              traffic_limit_text: trafficLimit > 0 ? formatTraffic(trafficLimit) : '无限制',
              is_online: isOnline
            };
          });
          
          // 计算在线用户数
          const onlineCount = users.filter(u => u.is_online).length;
          
          nodesWithUsers.push({
            inbound_id: inbound.id,
            remark: inbound.remark,
            port: inbound.port,
            protocol: inbound.protocol,
            settings: typeof inbound.settings === 'string' ? inbound.settings : JSON.stringify(inbound.settings || {}),
            stream_settings: typeof inbound.streamSettings === 'string' ? inbound.streamSettings : JSON.stringify(inbound.streamSettings || {}),
            user_count: clientStats.length,
            online_count: onlineCount,
            users: users
          });
        }
        
        // 更新数据库中的节点信息
        await db.prepare('DELETE FROM xui_nodes WHERE server_id = ?').run(serverId);
        
        for (const node of nodesWithUsers) {
          await db.prepare(`
            INSERT INTO xui_nodes (server_id, inbound_id, remark, port, protocol, settings, stream_settings, user_count, online_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(serverId, node.inbound_id, node.remark, node.port, node.protocol, node.settings, node.stream_settings, node.user_count, node.online_count);
        }
        
        logger.info(`从 3X-UI 获取节点信息成功: ${nodesWithUsers.length} 个节点`);
      } else {
        logger.warn(`获取 inbounds 失败: ${inboundsResult.message}`);
        // 如果获取失败，从数据库读取
        const nodes = await db.prepare(`
          SELECT inbound_id, remark, port, protocol, user_count, online_count
          FROM xui_nodes
          WHERE server_id = ?
          ORDER BY port ASC
        `).all(serverId);
        
        nodesWithUsers = nodes.map(node => ({
          ...node,
          users: []
        }));
      }
    } catch (error) {
      logger.error(`从 3X-UI 获取信息错误: ${error.message}`);
      // 如果出错，从数据库读取
      const nodes = await db.prepare(`
        SELECT inbound_id, remark, port, protocol, user_count, online_count
        FROM xui_nodes
        WHERE server_id = ?
        ORDER BY port ASC
      `).all(serverId);
      
      nodesWithUsers = nodes.map(node => ({
        ...node,
        users: []
      }));
    }

    logger.info(`获取服务器详情成功: ${server.name}`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        server: {
          id: server.id,
          name: server.name,
          api_url: server.api_url,
          host: server.host || '',
          client_port: server.client_port || 0,
          status: server.status,
          last_check_at: server.last_check_at
        },
        nodes: nodesWithUsers
      }
    });
  } catch (error) {
    logger.error(`获取服务器详情错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * POST /api/admin/servers/:id/sync
 * 手动同步服务器状态
 */
router.post('/:id/sync', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数')
], async (req, res) => {
  try {
    // 验证请求参数
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('同步服务器参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const serverId = parseInt(req.params.id);
    const db = req.app.locals.db;

    // 查询服务器信息
    const server = await db.prepare('SELECT * FROM xui_servers WHERE id = ?').get(serverId);
    
    if (!server) {
      logger.warn(`同步服务器失败: 服务器不存在 - ${serverId}`);
      return res.status(400).json({
        code: 1001,
        message: '服务器不存在',
        data: null
      });
    }

    // 同步服务器状态
    const syncResult = await syncServerStatus(server);

    // 更新服务器状态
    await db.prepare('UPDATE xui_servers SET status = ?, last_check_at = ? WHERE id = ?')
      .run(syncResult.status, Math.floor(Date.now() / 1000), serverId);

    // 更新节点信息
    if (syncResult.success && syncResult.nodes && syncResult.nodes.length > 0) {
      // 删除旧节点
      await db.prepare('DELETE FROM xui_nodes WHERE server_id = ?').run(serverId);
      
      // 插入新节点
      for (const node of syncResult.nodes) {
        const settings = typeof node.settings === 'string' ? node.settings : JSON.stringify(node.settings || {});
        const streamSettings = typeof node.stream_settings === 'string' ? node.stream_settings : JSON.stringify(node.stream_settings || {});
        
        await db.prepare(`
          INSERT INTO xui_nodes (server_id, inbound_id, remark, port, protocol, settings, stream_settings, user_count, online_count)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(serverId, node.inbound_id, node.remark, node.port, node.protocol, settings, streamSettings, node.user_count, node.online_count);
      }
      
      logger.info(`更新节点信息成功: ${syncResult.nodes.length} 个节点`);
    }

    logger.info(`同步服务器成功: ${server.name}`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        synced_at: Math.floor(Date.now() / 1000),
        node_count: syncResult.node_count,
        user_count: syncResult.user_count,
        online_count: syncResult.online_count,
        message: '同步完成'
      }
    });
  } catch (error) {
    logger.error(`同步服务器错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * PUT /api/admin/servers/:id/users
 * 更新3X-UI用户信息
 */
router.put('/:id/users', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数'),
  body('inboundId')
    .notEmpty()
    .withMessage('inboundId不能为空'),
  body('email')
    .notEmpty()
    .withMessage('用户标识不能为空')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('更新用户参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const serverId = parseInt(req.params.id);
    const db = req.app.locals.db;
    const { inboundId, email, expiryTime, totalGB, enabled } = req.body;

    // 查询服务器信息
    const server = await db.prepare('SELECT * FROM xui_servers WHERE id = ?').get(serverId);
    
    if (!server) {
      logger.warn(`更新用户失败: 服务器不存在 - ${serverId}`);
      return res.status(400).json({
        code: 1001,
        message: '服务器不存在',
        data: null
      });
    }

    // 调用 XuiService 更新用户
    const xuiService = new XuiService(server.api_url, server.api_username, server.api_password);
    const result = await xuiService.updateClient(inboundId, email, {
      expiryTime,
      totalGB,
      enabled
    });

    if (result.success) {
      logger.info(`更新用户成功: ${email}`);
      res.json({
        code: 0,
        message: 'ok',
        data: {
          message: '用户更新成功'
        }
      });
    } else {
      logger.warn(`更新用户失败: ${result.message}`);
      res.status(400).json({
        code: 3001,
        message: result.message || '更新用户失败',
        data: null
      });
    }
  } catch (error) {
    logger.error(`更新用户错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * DELETE /api/admin/servers/:id/users
 * 删除3X-UI用户
 */
router.delete('/:id/users', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数'),
  body('inboundId')
    .notEmpty()
    .withMessage('inboundId不能为空'),
  body('email')
    .notEmpty()
    .withMessage('用户标识不能为空')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('删除用户参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const serverId = parseInt(req.params.id);
    const db = req.app.locals.db;
    const { inboundId, email } = req.body;

    // 查询服务器信息
    const server = await db.prepare('SELECT * FROM xui_servers WHERE id = ?').get(serverId);
    
    if (!server) {
      logger.warn(`删除用户失败: 服务器不存在 - ${serverId}`);
      return res.status(400).json({
        code: 1001,
        message: '服务器不存在',
        data: null
      });
    }

    // 调用 XuiService 删除用户
    const xuiService = new XuiService(server.api_url, server.api_username, server.api_password);
    const result = await xuiService.deleteClientByEmail(inboundId, email);

    if (result.success) {
      logger.info(`删除用户成功: ${email}`);
      res.json({
        code: 0,
        message: 'ok',
        data: {
          message: '用户删除成功'
        }
      });
    } else {
      logger.warn(`删除用户失败: ${result.message}`);
      res.status(400).json({
        code: 3001,
        message: result.message || '删除用户失败',
        data: null
      });
    }
  } catch (error) {
    logger.error(`删除用户错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * 测试3X-UI连接
 * @param {string} apiUrl - 面板地址
 * @param {string} username - 用户名
 * @param {string} password - 密码
 * @returns {Promise<boolean>} 连接是否成功
 */
async function testXuiConnection(apiUrl, username, password) {
  try {
    logger.info(`测试3X-UI连接: ${apiUrl}`);
    const xuiService = new XuiService(apiUrl, username, password);
    const isConnected = await xuiService.testConnection();
    return isConnected;
  } catch (error) {
    logger.error(`测试3X-UI连接错误: ${error.message}`);
    return false;
  }
}

/**
 * 同步服务器状态
 * @param {Object} server - 服务器信息
 * @returns {Promise<Object>} 同步结果
 */
async function syncServerStatus(server) {
  try {
    logger.info(`同步服务器状态: ${server.name}`);
    const xuiService = new XuiService(server.api_url, server.api_username, server.api_password);
    const syncResult = await xuiService.syncServerStatus();
    
    logger.info(`同步结果: ${JSON.stringify(syncResult)}`);
    
    return {
      success: syncResult.success,
      status: syncResult.status,
      node_count: syncResult.node_count,
      user_count: syncResult.user_count,
      online_count: syncResult.online_count,
      nodes: syncResult.nodes,
      online_clients: syncResult.online_clients
    };
  } catch (error) {
    logger.error(`同步服务器状态错误: ${error.message}`);
    logger.error(`错误堆栈: ${error.stack}`);
    return {
      success: false,
      status: 0,
      node_count: 0,
      user_count: 0,
      online_count: 0,
      nodes: [],
      online_clients: []
    };
  }
}

/**
 * 格式化流量显示
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的流量字符串
 */
function formatTraffic(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 格式化时间显示
 * @param {number} timestamp - 时间戳
 * @returns {string} 格式化后的时间字符串
 */
function formatTime(timestamp) {
  if (!timestamp) return null;
  return new Date(timestamp * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

module.exports = router;