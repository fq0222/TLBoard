/**
 * 管理端用户管理路由
 * 处理用户的查询和修改操作
 */

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const { createLogger } = require('../../utils/logger');
const { generateSubscriptionUrls } = require('../../utils/site-url');
const { syncAllServers } = require('../../services/xui-sync');
const { getStrategyFromRemark, processNodeLink } = require('../../services/subscription-strategy');
const { fetchOriginalSubscription, parseSubscriptionContent } = require('../../services/subscription-service');
const XuiService = require('../../services/xui-service');
const { DISABLE_REASONS } = require('../../services/renew-policy');

const router = express.Router();
const logger = createLogger('ADMIN-USERS');

/**
 * GET /api/admin/users
 * 获取用户列表
 */
router.get('/', authenticateAdmin, [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('页码必须是大于0的整数'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('每页条数必须是1-100之间的整数'),
  query('keyword')
    .optional()
    .isString()
    .withMessage('关键词必须是字符串'),
  query('status')
    .optional()
    .isIn(['active', 'expired', 'disabled'])
    .withMessage('状态必须是active、expired或disabled'),
  query('plan_id')
    .optional()
    .isInt({ min: 1 })
    .withMessage('套餐ID必须是大于0的整数')
], async (req, res) => {
  try {
    // 验证请求参数
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('获取用户列表参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const keyword = req.query.keyword || '';
    const status = req.query.status;
    const planId = req.query.plan_id;
    const offset = (page - 1) * limit;
    const db = req.app.locals.db;

    // 构建查询条件
    let whereClause = 'WHERE 1=1';
    const params = [];
    
    if (keyword) {
      whereClause += ' AND u.email LIKE ?';
      params.push(`%${keyword}%`);
    }
    
    if (status) {
      if (status === 'active') {
        // 正常状态：已启用且未过期（expire_at为0或'0'表示无限期）
        whereClause += ' AND u.enabled = 1 AND (u.expire_at = 0 OR u.expire_at = \'0\' OR u.expire_at IS NULL OR u.expire_at > ?)';
        params.push(Math.floor(Date.now() / 1000));
      } else if (status === 'expired') {
        // 已过期：已启用且已过期（expire_at不为0且小于当前时间）
        whereClause += ' AND u.enabled = 1 AND u.expire_at != 0 AND u.expire_at != \'0\' AND u.expire_at IS NOT NULL AND u.expire_at <= ?';
        params.push(Math.floor(Date.now() / 1000));
      } else if (status === 'disabled') {
        whereClause += ' AND u.enabled = 0';
      }
    }
    
    if (planId) {
      whereClause += ' AND u.plan_id = ?';
      params.push(planId);
    }

    // 查询总数
    const countQuery = `SELECT COUNT(*) as total FROM users u ${whereClause}`;
    const total = Number((await db.prepare(countQuery).get(...params)).total) || 0;

    // 查询用户列表
    const query = `
      SELECT 
        u.id, u.email, u.plan_id, u.traffic_used, u.traffic_limit,
        u.expire_at, u.enabled, u.created_at,
        p.name as plan_name
      FROM users u
      LEFT JOIN plans p ON u.plan_id = p.id
      ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `;
    
    const users = await db.prepare(query).all(...params, limit, offset);

    // 格式化用户数据
    const formattedUsers = users.map(user => {
      const now = Math.floor(Date.now() / 1000);
      const expireAt = Number(user.expire_at) || 0;
      let userStatus = 'active';
      let statusText = '正常';
      
      if (!user.enabled) {
        userStatus = 'disabled';
        statusText = '已禁用';
      } else if (expireAt !== 0 && expireAt <= now) {
        // expire_at为0表示无限期，不认为是过期
        userStatus = 'expired';
        statusText = '已过期';
      }

      return {
        id: user.id,
        email: user.email,
        plan_id: user.plan_id,
        plan_name: user.plan_name,
        traffic_used: user.traffic_used,
        traffic_limit: user.traffic_limit,
        traffic_used_text: formatTraffic(user.traffic_used),
        traffic_limit_text: formatTraffic(user.traffic_limit),
        expire_at: user.expire_at,
        expire_text: formatTime(user.expire_at),
        enabled: user.enabled,
        status: userStatus,
        status_text: statusText,
        created_at: user.created_at
      };
    });

    logger.info(`获取用户列表成功，共 ${formattedUsers.length} 条记录`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        total,
        page,
        limit,
        list: formattedUsers
      }
    });
  } catch (error) {
    logger.error(`获取用户列表错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * GET /api/admin/users/:id
 * 获取用户详情
 */
router.get('/:id', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数')
], async (req, res) => {
  try {
    // 验证请求参数
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('获取用户详情参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const userId = parseInt(req.params.id);
    const db = req.app.locals.db;

    // 查询用户信息
    const user = await db.prepare(`
      SELECT 
        u.id, u.email, u.plan_id, u.subscription_token, u.sub_id,
        u.traffic_used, u.traffic_limit, u.expire_at, u.enabled, u.created_at,
        p.name as plan_name
      FROM users u
      LEFT JOIN plans p ON u.plan_id = p.id
      WHERE u.id = ?
    `).get(userId);
    
    if (!user) {
      logger.warn(`获取用户详情失败: 用户不存在 - ${userId}`);
      return res.status(400).json({
        code: 2004,
        message: '用户不存在',
        data: null
      });
    }

    // 查询用户订单
    const orders = await db.prepare(`
      SELECT id, out_trade_no, plan_id, amount, status, paid_at, created_at
      FROM orders
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `).all(userId);

    // 查询用户CF优选IP
    const cfIps = await db.prepare(`
      SELECT cp.id, cp.ip
      FROM user_cf_ips uci
      JOIN cf_ip_pool cp ON uci.ip_pool_id = cp.id
      WHERE uci.user_id = ?
    `).all(userId);

    const urls = generateSubscriptionUrls(req, user.sub_id);

    logger.info(`获取用户详情成功: ${user.email}`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        user: {
          id: user.id,
          email: user.email,
          plan_id: user.plan_id,
          plan_name: user.plan_name,
          subscription_url: urls.subscription_url,
          clash_url: urls.clash_url,
          traffic_used: user.traffic_used,
          traffic_limit: user.traffic_limit,
          traffic_used_text: formatTraffic(user.traffic_used),
          traffic_limit_text: formatTraffic(user.traffic_limit),
          expire_at: user.expire_at,
          expire_text: formatTime(user.expire_at),
          enabled: user.enabled,
          created_at: user.created_at
        },
        orders: orders.map(order => ({
          id: order.id,
          out_trade_no: order.out_trade_no,
          plan_name: user.plan_name,
          amount: order.amount,
          amount_text: (order.amount / 100).toFixed(2),
          status: order.status,
          status_text: getStatusText(order.status),
          paid_at: order.paid_at,
          created_at: order.created_at
        })),
        cf_ips: cfIps
      }
    });
  } catch (error) {
    logger.error(`获取用户详情错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * PUT /api/admin/users/:id
 * 修改用户信息
 */
router.put('/:id', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数'),
  body('enabled')
    .optional()
    .isIn([true, false, 0, 1, '0', '1', 'true', 'false'])
    .withMessage('enabled必须是布尔值'),
  body('plan_id')
    .optional()
    .isInt({ min: 1 })
    .withMessage('套餐ID必须是大于0的整数'),
  body('traffic_limit')
    .optional()
    .isInt({ min: 0 })
    .withMessage('流量上限必须是非负整数'),
  body('expire_at')
    .optional({ values: 'null' })
    .custom((value) => {
      if (value === null || value === undefined) return true;
      return Number.isInteger(value) && value >= 0;
    })
    .withMessage('到期时间必须是非负整数或null')
], async (req, res) => {
  try {
    // 验证请求参数
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('修改用户信息参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const userId = parseInt(req.params.id);
    const db = req.app.locals.db;

    // 检查用户是否存在
    const existingUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    
    if (!existingUser) {
      logger.warn(`修改用户信息失败: 用户不存在 - ${userId}`);
      return res.status(400).json({
        code: 2004,
        message: '用户不存在',
        data: null
      });
    }

    // 构建更新字段
    const updates = [];
    const values = [];
    
    if (req.body.enabled !== undefined) {
      updates.push('enabled = ?');
      values.push(req.body.enabled ? 1 : 0);
      updates.push('disable_reason = ?');
      values.push(req.body.enabled ? null : DISABLE_REASONS.ADMIN);
    }
    if (req.body.plan_id !== undefined) {
      updates.push('plan_id = ?');
      values.push(req.body.plan_id);
    }
    if (req.body.traffic_limit !== undefined) {
      updates.push('traffic_limit = ?');
      values.push(req.body.traffic_limit);
    }
    if (req.body.expire_at !== undefined) {
      updates.push('expire_at = ?');
      values.push(req.body.expire_at);
    }

    if (updates.length === 0) {
      logger.warn('修改用户信息失败: 没有要更新的字段');
      return res.status(400).json({
        code: 1001,
        message: '没有要更新的字段',
        data: null
      });
    }

    // 添加更新时间
    updates.push('updated_at = ?');
    values.push(Math.floor(Date.now() / 1000));

    // 执行更新
    values.push(userId);
    await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    // 查询更新后的用户
    const updatedUser = await db.prepare(`
      SELECT u.*, p.name as plan_name
      FROM users u
      LEFT JOIN plans p ON u.plan_id = p.id
      WHERE u.id = ?
    `).get(userId);

    // 同步到3X-UI服务器
    await syncToXuiServers(db, updatedUser);

    logger.info(`修改用户信息成功: ${updatedUser.email}`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        id: updatedUser.id,
        email: updatedUser.email,
        plan_id: updatedUser.plan_id,
        plan_name: updatedUser.plan_name,
        traffic_limit: updatedUser.traffic_limit,
        traffic_limit_text: formatTraffic(updatedUser.traffic_limit),
        expire_at: updatedUser.expire_at,
        expire_text: formatTime(updatedUser.expire_at),
        enabled: updatedUser.enabled,
        message: '用户信息已更新，已同步到 3X-UI 服务器'
      }
    });
  } catch (error) {
    logger.error(`修改用户信息错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * PUT /api/admin/users/:id/cf-ips
 * 更新用户的 CF 优选 IP
 */
router.put('/:id/cf-ips', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数'),
  body('ip_pool_ids')
    .isArray({ min: 1, max: 5 })
    .withMessage('IP数量必须在1-5之间'),
  body('ip_pool_ids.*')
    .isInt({ min: 1 })
    .withMessage('IP ID必须是大于0的整数')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('更新用户CF IP参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const userId = parseInt(req.params.id);
    let { ip_pool_ids } = req.body;
    const db = req.app.locals.db;

    // 去重
    ip_pool_ids = [...new Set(ip_pool_ids)];

    // 验证用户存在
    const user = await db.prepare('SELECT id, email FROM users WHERE id = ?').get(userId);
    if (!user) {
      logger.warn(`更新用户CF IP失败: 用户不存在 - ${userId}`);
      return res.status(400).json({
        code: 2004,
        message: '用户不存在',
        data: null
      });
    }

    // 验证 IP ID 有效性
    const validIps = await db.prepare(`
      SELECT id, ip FROM cf_ip_pool 
      WHERE id IN (${ip_pool_ids.map(() => '?').join(',')}) AND enabled = 1
    `).all(...ip_pool_ids);

    if (validIps.length !== ip_pool_ids.length) {
      logger.warn(`更新用户CF IP失败: 部分IP无效 - ${JSON.stringify(ip_pool_ids)}`);
      return res.status(400).json({
        code: 4002,
        message: 'IP ID 无效或已禁用',
        data: null
      });
    }

    // 事务中删除旧记录，插入新记录
    const transaction = db.transaction(async () => {
      await db.prepare('DELETE FROM user_cf_ips WHERE user_id = ?').run(userId);
      const insertStmt = db.prepare('INSERT INTO user_cf_ips (user_id, ip_pool_id) VALUES (?, ?)');
      for (const ipId of ip_pool_ids) {
        await insertStmt.run(userId, ipId);
      }
    });

    await transaction();

    logger.info(`更新用户CF IP成功: ${user.email}, ${validIps.length}个IP`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        cf_ips: validIps
      }
    });
  } catch (error) {
    logger.error(`更新用户CF IP错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * POST /api/admin/users/:id/generate-subscription
 * 为用户生成订阅链接
 */
router.post('/:id/generate-subscription', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('生成用户订阅链接参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const userId = parseInt(req.params.id);
    const db = req.app.locals.db;

    // 查询用户信息
    const user = await db.prepare(`
      SELECT 
        u.id, u.email, u.sub_id, u.enabled
      FROM users u
      WHERE u.id = ?
    `).get(userId);

    if (!user) {
      logger.warn(`生成订阅链接失败: 用户不存在 - ${userId}`);
      return res.status(400).json({
        code: 2004,
        message: '用户不存在',
        data: null
      });
    }

    // 检查账号是否启用
    if (!user.enabled) {
      logger.warn(`生成订阅链接失败: 账号已禁用 - ${user.email}`);
      return res.status(400).json({
        code: 2003,
        message: '账号已被禁用',
        data: null
      });
    }

    // 检查是否已配置 CF IP
    const cfIps = await db.prepare(`
      SELECT cp.ip
      FROM user_cf_ips uci
      JOIN cf_ip_pool cp ON uci.ip_pool_id = cp.id
      WHERE uci.user_id = ? AND cp.enabled = 1
    `).all(userId);

    if (cfIps.length === 0) {
      logger.warn(`生成订阅链接失败: 未配置CF IP - ${user.email}`);
      return res.status(400).json({
        code: 3001,
        message: '请先配置优选 IP',
        data: null
      });
    }

    // 同步服务器节点信息
    logger.info(`用户 ${user.email} 生成订阅链接，开始同步节点信息`);
    const syncResult = await syncAllServers(db);
    logger.info(`节点同步完成: ${syncResult.syncedCount}/${syncResult.totalCount} 台服务器`);

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
          JOIN xui_nodes xn ON unc.server_id = xn.server_id AND unc.inbound_id = xn.inbound_id
          WHERE unc.user_id = ? AND unc.server_id = ?
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

        // 并发获取所有节点的原始订阅
        const subscriptionPromises = nodeConfigs.map(async (config) => {
          try {
            const originalContent = await fetchOriginalSubscription(server.sub_url, config.sub_id);
            const links = parseSubscriptionContent(originalContent);
            if (links.length > 0) {
              logger.info(`从服务器 ${server.name} 获取节点 ${config.remark} 的原始链接`);
              return { config, originalLink: links[0] };
            }
          } catch (error) {
            logger.warn(`从服务器 ${server.name} 获取节点 ${config.remark} 原始订阅失败: ${error.message}`);
          }
          return { config, originalLink: null };
        });

        const subscriptionResults = await Promise.all(subscriptionPromises);

        // 处理节点链接
        for (const { config, originalLink } of subscriptionResults) {
          if (!originalLink) {
            logger.warn(`找不到节点 ${config.remark} 的原始链接`);
            continue;
          }

          const strategy = getStrategyFromRemark(config.remark);
          let processedLink;

          if (strategy === 'cf') {
            // 为每个 CF 优选 IP 生成一个节点
            for (let i = 0; i < cfIps.length; i++) {
              processedLink = processNodeLink(originalLink, 'cf', {
                cfIp: cfIps[i].ip,
                clientPort: server.client_port,
                host: server.host
              });
              const baseName = `${server.name}-${config.remark}`;
              const nodeName = cfIps.length > 1 ? `${baseName}-${i + 1}` : baseName;
              const hashIdx = processedLink.indexOf('#');
              if (hashIdx > 0) {
                processedLink = processedLink.substring(0, hashIdx + 1) + encodeURIComponent(nodeName);
              }
              logger.info(`生成CF节点: nodeName=${nodeName}`);
              allNodes.push({
                server_name: server.name,
                node_name: nodeName,
                protocol: config.protocol,
                strategy: strategy,
                link: processedLink,
                original_link: originalLink
              });
            }
          } else {
            processedLink = processNodeLink(originalLink, 'direct');
            const nodeName = `${server.name}-${config.remark}`;
            const hashIdx = processedLink.indexOf('#');
            if (hashIdx > 0) {
              processedLink = processedLink.substring(0, hashIdx + 1) + encodeURIComponent(nodeName);
            }
            logger.info(`生成Direct节点: nodeName=${nodeName}`);
            allNodes.push({
              server_name: server.name,
              node_name: nodeName,
              protocol: config.protocol,
              strategy: strategy,
              link: processedLink,
              original_link: originalLink
            });
          }
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
    const urls = generateSubscriptionUrls(req, user.sub_id);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        subscription_url: urls.subscription_url,
        clash_url: urls.clash_url,
        node_count: allNodes.length
      }
    });
  } catch (error) {
    logger.error(`生成用户订阅链接错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * 同步用户状态到所有3X-UI服务器
 * @param {Object} db - 数据库实例
 * @param {Object} user - 用户信息
 */
async function syncToXuiServers(db, user) {
  try {
    logger.info(`开始同步用户到3X-UI服务器: ${user.email}`);

    // 查询所有在线的3X-UI服务器
    const servers = await db.prepare('SELECT id, name, api_url, api_token FROM xui_servers WHERE status = 1').all();

    if (servers.length === 0) {
      logger.warn('没有在线的3X-UI服务器');
      return;
    }

    // 查询用户在哪些节点上有客户端（通过 email 标识）
    const userNodes = await db.prepare(`
      SELECT server_id, inbound_id 
      FROM xui_nodes 
      WHERE user_count > 0
    `).all();

    // 按服务器分组
    const nodesByServer = {};
    for (const node of userNodes) {
      if (!nodesByServer[node.server_id]) {
        nodesByServer[node.server_id] = [];
      }
      nodesByServer[node.server_id].push(node.inbound_id);
    }

    // 同步到每个服务器
    const syncResults = [];
    for (const server of servers) {
      const inboundIds = nodesByServer[server.id] || [];
      
      if (inboundIds.length === 0) {
        logger.info(`服务器 ${server.name} 没有节点，跳过`);
        continue;
      }

      try {
        // 创建 XuiService 实例
        const xuiService = await XuiService.getInstance(server.api_url, server.api_token);
        
        // 计算到期时间（3XUI 使用毫秒时间戳，0 表示无限期）
        const expireAt = Number(user.expire_at) || 0;
        const expiryTime = expireAt > 0 ? expireAt * 1000 : 0;
        
        // 计算流量上限（3XUI 使用 GB）
        const trafficLimit = Number(user.traffic_limit) || 0;
        const totalGB = trafficLimit > 0 ? trafficLimit / (1024 * 1024 * 1024) : 0;
        
        // 同步到每个 inbound
        for (const inboundId of inboundIds) {
          // 查询节点备注，生成新的邮箱格式
          const node = await db.prepare('SELECT remark FROM xui_nodes WHERE server_id = ? AND inbound_id = ?').get(server.id, inboundId);
          const nodeEmail = `${user.email}-${node?.remark || inboundId}`;
          
          const result = await xuiService.updateClient(inboundId, nodeEmail, {
            enabled: !!user.enabled,
            expiryTime: expiryTime,
            totalGB: totalGB
          });

          if (result.success) {
            logger.info(`同步成功: 服务器=${server.name}, inbound=${inboundId}, 用户=${user.email}`);
            syncResults.push({ server: server.name, inboundId, success: true });
          } else {
            // 如果是"未找到用户"，可能是该节点没有这个用户的客户端，不算失败
            if (result.message.includes('未找到用户')) {
              logger.info(`服务器 ${server.name} 的 inbound ${inboundId} 中未找到用户 ${user.email}，跳过`);
            } else {
              logger.warn(`同步失败: 服务器=${server.name}, inbound=${inboundId}, 原因=${result.message}`);
              syncResults.push({ server: server.name, inboundId, success: false, message: result.message });
            }
          }
        }
      } catch (error) {
        logger.error(`同步到服务器 ${server.name} 失败: ${error.message}`);
        syncResults.push({ server: server.name, success: false, message: error.message });
      }
    }

    logger.info(`用户 ${user.email} 同步完成，成功: ${syncResults.filter(r => r.success).length}，失败: ${syncResults.filter(r => !r.success).length}`);
  } catch (error) {
    logger.error(`同步用户到3X-UI服务器失败: ${error.message}`);
  }
}

/**
 * 格式化流量显示
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的流量字符串
 */
function formatTraffic(bytes) {
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
 * 格式化时间显示
 * @param {number} timestamp - 时间戳
 * @returns {string} 格式化后的时间字符串
 */
function formatTime(timestamp) {
  if (!timestamp || timestamp === 0 || timestamp === '0') return '无限期';
  return new Date(timestamp * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

/**
 * 获取状态文本
 * @param {string} status - 状态值
 * @returns {string} 状态文本
 */
function getStatusText(status) {
  const statusMap = {
    'pending': '待支付',
    'paid': '已支付',
    'expired': '已过期'
  };
  return statusMap[status] || status;
}

module.exports = router;
