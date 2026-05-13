/**
 * 用户认证路由
 * 处理用户注册、登录、获取个人信息等操作
 */

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const config = require('../../config');
const { authenticateUser } = require('../../middleware/auth-user');
const { userLoginLimiter, userRegisterLimiter } = require('../../middleware/rate-limiter');
const vmqService = require('../../services/vmq-service');
const { createLogger } = require('../../utils/logger');
const { generateSubscriptionUrls } = require('../../utils/site-url');

const router = express.Router();
const logger = createLogger('USER-AUTH');

/**
 * POST /api/user/register-and-pay
 * 注册并发起支付
 */
router.post('/register-and-pay', [
  userRegisterLimiter, // 添加速率限制中间件
  body('email')
    .isEmail()
    .withMessage('请输入有效的邮箱地址')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 })
    .withMessage('密码长度至少8位')
    .matches(/^(?=.*[A-Za-z])(?=.*\d)/)
    .withMessage('密码必须包含字母和数字'),
  body('plan_id')
    .isInt({ min: 1 })
    .withMessage('套餐ID必须是大于0的整数'),
  body('pay_type')
    .optional()
    .isIn([1, 2, '1', '2'])
    .withMessage('支付方式必须是1(微信)或2(支付宝)')
], async (req, res) => {
  try {
    // 验证请求参数
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const firstError = errors.array()[0];
      logger.warn('注册参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: firstError?.msg || '参数校验失败',
        data: {
          errors: errors.array()
        }
      });
    }

    const { email, password, plan_id } = req.body;
    // VMQ 支付方式：1=微信，2=支付宝
    const payType = Number(req.body.pay_type || config.payment.vmqDefaultType || 2);
    const db = req.app.locals.db;

    // 检查邮箱是否已注册
    const existingUser = await db.prepare('SELECT id, enabled, expire_at FROM users WHERE email = ?').get(email);
    
    if (existingUser) {
      // 检查用户是否有未过期套餐（expire_at为0或'0'表示无限期）
      const now = Math.floor(Date.now() / 1000);
      const expireAt = Number(existingUser.expire_at) || 0;
      if (existingUser.enabled && (expireAt === 0 || expireAt > now)) {
        logger.warn(`注册失败: 邮箱已注册且有未过期套餐 - ${email}`);
        return res.status(400).json({
          code: 2001,
          message: '该邮箱已注册，如需续费请先登录',
          data: null
        });
      }
    }

    // 检查套餐是否存在
    const plan = await db.prepare('SELECT * FROM plans WHERE id = ? AND enabled = 1').get(plan_id);
    
    if (!plan) {
      logger.warn(`注册失败: 套餐不存在或已下架 - ${plan_id}`);
      return res.status(400).json({
        code: 1001,
        message: '套餐不存在或已下架',
        data: null
      });
    }

    // 检查套餐是否售罄
    if (plan.sales_limit !== -1 && plan.sales_count >= plan.sales_limit) {
      logger.warn(`注册失败: 套餐已售罄 - ${plan_id}`);
      return res.status(400).json({
        code: 1002,
        message: '该套餐已售罄',
        data: null
      });
    }

    // 生成订阅Token（用于3X-UI节点认证）
    const subscriptionToken = crypto.randomUUID();
    
    // 生成订阅链接ID（用于订阅链接，不暴露UUID）
    const subId = crypto.randomBytes(8).toString('hex');

    // 加密密码
    const passwordHash = await bcrypt.hash(password, config.security.bcryptRounds);

    // 开始事务
    const transaction = db.transaction(async () => {
      // 创建或更新用户
      let userId;
      if (existingUser) {
        // 更新现有用户
        await db.prepare(`
          UPDATE users SET 
            password_hash = ?,
            plan_id = ?,
            subscription_token = ?,
            sub_id = ?,
            traffic_used = 0,
            traffic_limit = ?,
            enabled = 0,
            updated_at = ?
          WHERE id = ?
        `).run(passwordHash, plan_id, subscriptionToken, subId, plan.traffic_limit, Math.floor(Date.now() / 1000), existingUser.id);
        userId = existingUser.id;
      } else {
        // 创建新用户
        const result = await db.prepare(`
          INSERT INTO users (email, password_hash, plan_id, subscription_token, sub_id, traffic_used, traffic_limit, enabled)
          VALUES (?, ?, ?, ?, ?, 0, ?, 0)
        `).run(email, passwordHash, plan_id, subscriptionToken, subId, plan.traffic_limit);
        userId = result.lastInsertRowid;
      }

      // 生成商户订单号
      const outTradeNo = `ORD${Date.now()}${Math.random().toString(36).substr(2, 9)}`;

      // 创建订单
      const orderResult = await db.prepare(`
        INSERT INTO orders (user_id, email, plan_id, amount, out_trade_no, status)
        VALUES (?, ?, ?, ?, ?, 'pending')
      `).run(userId, email, plan_id, plan.price, outTradeNo);

      // 增加销售计数
      await db.prepare('UPDATE plans SET sales_count = sales_count + 1 WHERE id = ?').run(plan_id);

      return { userId, orderId: orderResult.lastInsertRowid, outTradeNo };
    });

    // 执行事务
    const { userId, orderId, outTradeNo } = await transaction();
    // VMQ 接口要求金额使用元并保留两位小数
    const amount = (Number(plan.price) / 100).toFixed(2);
    const vmqResult = await vmqService.createOrder({
      payId: outTradeNo,
      param: String(userId),
      type: payType,
      price: amount,
      isHtml: 0
    });

    if (Number(vmqResult.code) !== 1 || !vmqResult.data) {
      await db.prepare(`
        UPDATE orders SET status = 'expired'
        WHERE out_trade_no = ?
      `).run(outTradeNo);

      return res.status(502).json({
        code: 5002,
        message: vmqResult.msg || '创建VMQ支付订单失败',
        data: null
      });
    }

    // isAuto=1 代表用户需要手动输入金额，这会带来少付风险，直接拒绝下发
    if (Number(vmqResult.data.isAuto) === 1) {
      await db.prepare(`
        UPDATE orders SET status = 'expired'
        WHERE out_trade_no = ?
      `).run(outTradeNo);

      try {
        await vmqService.closeOrder(vmqResult.data.orderId);
      } catch (closeError) {
        logger.warn(`关闭需手输金额的VMQ订单失败: ${vmqResult.data.orderId} - ${closeError.message}`);
      }

      logger.warn(`VMQ返回需手输金额的支付链接，已拒绝下发: ${outTradeNo}`);
      return res.status(502).json({
        code: 5003,
        message: '当前支付通道需要用户手动输入金额，存在少付风险，请更换VMQ监控通道配置后再试',
        data: null
      });
    }

    const paymentUrl = vmqResult.data.payUrl;
    // 保存 VMQ 云端订单号、支付链接和实际支付金额（VMQ可能会递增0.01元）
    const realAmount = Math.round(Number(vmqResult.data.reallyPrice) * 100); // 元转分
    await db.prepare(`
      UPDATE orders SET
        trade_no = ?,
        payment_url = ?,
        amount = ?
      WHERE out_trade_no = ?
    `).run(vmqResult.data.orderId, paymentUrl, realAmount, outTradeNo);

    logger.info(`用户注册成功: ${email}，订单号: ${outTradeNo}`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        order_id: orderId,
        user_id: userId,
        out_trade_no: outTradeNo,
        vmq_order_id: vmqResult.data.orderId,
        pay_type: vmqResult.data.payType,
        really_price: vmqResult.data.reallyPrice,
        payment_url: paymentUrl,
        expire_in: Number(vmqResult.data.timeOut || 5) * 60
      }
    });
  } catch (error) {
    logger.error(`用户注册错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * POST /api/user/login
 * 用户登录
 */
router.post('/login', [
  userLoginLimiter, // 添加速率限制中间件
  body('email')
    .isEmail()
    .withMessage('请输入有效的邮箱地址')
    .normalizeEmail(),
  body('password')
    .notEmpty()
    .withMessage('密码不能为空')
], async (req, res) => {
  try {
    // 验证请求参数
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const firstError = errors.array()[0];
      logger.warn('登录参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: firstError?.msg || '参数校验失败',
        data: {
          errors: errors.array()
        }
      });
    }

    const { email, password } = req.body;
    const db = req.app.locals.db;

    // 查询用户
    const user = await db.prepare(`
      SELECT u.*, p.name as plan_name 
      FROM users u 
      LEFT JOIN plans p ON u.plan_id = p.id 
      WHERE u.email = ?
    `).get(email);
    
    if (!user) {
      logger.warn(`用户登录失败: 邮箱不存在 - ${email}`);
      return res.status(400).json({
        code: 2002,
        message: '邮箱或密码错误',
        data: null
      });
    }

    // 验证密码
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!isValidPassword) {
      logger.warn(`用户登录失败: 密码错误 - ${email}`);
      return res.status(400).json({
        code: 2002,
        message: '邮箱或密码错误',
        data: null
      });
    }

    // 检查账号是否被禁用
    if (!user.enabled) {
      logger.warn(`用户登录失败: 账号已被禁用 - ${email}`);
      return res.status(400).json({
        code: 2003,
        message: '账号已被禁用，请联系管理员',
        data: null
      });
    }

    // 生成JWT Token
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        plan_id: user.plan_id
      },
      config.user.jwtSecret,
      { expiresIn: config.user.jwtExpiresIn }
    );

    logger.info(`用户登录成功: ${email}`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        token,
        expires_in: 604800, // 7天 = 604800秒
        user: {
          id: user.id,
          email: user.email,
          plan_name: user.plan_name,
          expire_at: user.expire_at,
          enabled: user.enabled
        }
      }
    });
  } catch (error) {
    logger.error(`用户登录错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * GET /api/user/profile
 * 获取当前登录用户个人信息
 */
router.get('/profile', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
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
      logger.error(`用户不存在: ${userId}`);
      return res.status(400).json({
        code: 2004,
        message: '用户不存在',
        data: null
      });
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

    // 检查用户是否已完成 CF 优选
    const cfIps = await db.prepare(`
      SELECT 1 FROM user_cf_ips WHERE user_id = ? LIMIT 1
    `).get(userId);
    const cfOptimized = !!cfIps;

    logger.info(`获取用户信息成功: ${user.email}`);

    const urls = generateSubscriptionUrls(req, user.sub_id);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        id: user.id,
        email: user.email,
        plan_id: user.plan_id,
        plan_name: user.plan_name,
        subscription_url: cfOptimized ? urls.subscription_url : '',
        clash_url: cfOptimized ? urls.clash_url : '',
        cf_optimized: cfOptimized,
        traffic_used: user.traffic_used,
        traffic_limit: user.traffic_limit,
        traffic_used_text: formatTraffic(user.traffic_used),
        traffic_limit_text: formatTraffic(user.traffic_limit),
        traffic_percent: trafficPercent,
        expire_at: user.expire_at,
        expire_text: formatTime(user.expire_at),
        enabled: user.enabled,
        created_at: user.created_at
      }
    });
  } catch (error) {
    logger.error(`获取用户信息错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

module.exports = router;
