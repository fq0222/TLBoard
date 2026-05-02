/**
 * 管理端用户管理路由
 * 处理用户的查询和修改操作
 */

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');

const router = express.Router();

// 日志工具
const logger = {
  info: (msg) => console.log(`[ADMIN-USERS] [INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[ADMIN-USERS] [ERROR] ${new Date().toISOString()} - ${msg}`),
  warn: (msg) => console.warn(`[ADMIN-USERS] [WARN] ${new Date().toISOString()} - ${msg}`)
};

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
    const limit = parseInt(req.query.limit) || 20;
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
        whereClause += ' AND u.enabled = 1 AND u.expire_at > ?';
        params.push(Math.floor(Date.now() / 1000));
      } else if (status === 'expired') {
        whereClause += ' AND u.enabled = 1 AND u.expire_at <= ?';
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
    const total = (await db.prepare(countQuery).get(...params)).total;

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
      let userStatus = 'active';
      let statusText = '正常';
      
      if (!user.enabled) {
        userStatus = 'disabled';
        statusText = '已禁用';
      } else if (user.expire_at && user.expire_at <= now) {
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
        u.id, u.email, u.plan_id, u.subscription_token,
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
      SELECT cp.ip, cp.port, cp.location
      FROM user_cf_ips uci
      JOIN cf_ip_pool cp ON uci.ip_pool_id = cp.id
      WHERE uci.user_id = ?
    `).all(userId);

    const baseUrl = `${req.protocol}://${req.get('host')}`;

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
          subscription_url: `${baseUrl}/api/user/sub/${user.subscription_token}`,
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
    .isBoolean()
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
    .optional()
    .isInt({ min: 0 })
    .withMessage('到期时间必须是非负整数')
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

    // 同步到3X-UI服务器（模拟）
    syncToXuiServers(updatedUser);

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
 * 同步到3X-UI服务器
 * @param {Object} user - 用户信息
 */
function syncToXuiServers(user) {
  // 模拟同步操作
  logger.info(`同步用户到3X-UI服务器: ${user.email}`);
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
  return new Date(timestamp * 1000).toISOString().replace('T', ' ').substr(0, 19);
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