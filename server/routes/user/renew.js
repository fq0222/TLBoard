/**
 * 用户端续费路由
 * 处理用户续费请求，创建续费订单并调用VMQ支付
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth-user');
const vmqService = require('../../services/vmq-service');
const { createLogger } = require('../../utils/logger');
const crypto = require('crypto');

const router = express.Router();
const logger = createLogger('USER-RENEW');

/**
 * POST /api/user/renew
 * 用户续费接口
 */
router.post('/', authenticateUser, [
  body('plan_id')
    .isInt({ min: 1 })
    .withMessage('套餐ID无效'),
  body('pay_type')
    .optional()
    .isInt({ min: 1, max: 10 })
    .withMessage('支付类型无效')
], async (req, res) => {
  try {
    // 验证参数
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('续费参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const userId = req.user.id;
    const { plan_id } = req.body;
    const db = req.app.locals.db;

    // 1. 查询用户信息
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      logger.warn(`续费失败: 用户不存在 - ${userId}`);
      return res.json({
        code: 2004,
        message: '用户不存在',
        data: null
      });
    }

    // 2. 检查用户是否被禁用
    if (!user.enabled) {
      logger.warn(`续费失败: 账号已被禁用 - ${user.email}`);
      return res.json({
        code: 2003,
        message: '账号已被禁用，请联系管理员',
        data: null
      });
    }

    // 3. 验证用户有有效套餐（已购买过）
    if (!user.plan_id) {
      logger.warn(`续费失败: 用户未购买过套餐 - ${user.email}`);
      return res.json({
        code: 2004,
        message: '请先购买套餐后再续费',
        data: null
      });
    }

    // 4. 验证套餐存在且启用
    const plan = await db.prepare('SELECT * FROM plans WHERE id = ? AND enabled = 1').get(plan_id);
    if (!plan) {
      logger.warn(`续费失败: 套餐不存在或未启用 - ${plan_id}`);
      return res.json({
        code: 1001,
        message: '套餐不存在或未启用',
        data: null
      });
    }

    // 5. 生成商户订单号（REN前缀表示续费订单）
    const outTradeNo = 'REN' + Date.now() + crypto.randomBytes(3).toString('hex');

    // 6. 开始事务 - 创建订单并调用VMQ
    let orderId;
    const transaction = db.transaction(async () => {
      // 创建订单
      const orderResult = await db.prepare(`
        INSERT INTO orders (user_id, email, plan_id, amount, out_trade_no, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?)
      `).run(userId, user.email, plan_id, plan.price, outTradeNo, Math.floor(Date.now() / 1000));

      orderId = orderResult.lastInsertRowid;
      logger.info(`续费订单创建成功: ${outTradeNo}, 用户: ${user.email}, 套餐: ${plan.name}`);
    });

    // 执行事务
    await transaction();

    // 7. 调用VMQ创建支付订单
    // VMQ 接口要求金额使用元并保留两位小数
    const amount = (Number(plan.price) / 100).toFixed(2);
    const vmqResult = await vmqService.createOrder({
      payId: outTradeNo,
      param: String(userId),
      type: req.body.pay_type || 2, // 默认支付宝
      price: amount,
      isHtml: 0
    });

    // 检查VMQ响应 - 使用 code 字段而非 success
    if (Number(vmqResult.code) !== 1 || !vmqResult.data) {
      // VMQ失败时将订单标记为 expired
      await db.prepare("UPDATE orders SET status = 'expired' WHERE out_trade_no = ?").run(outTradeNo);
      logger.error(`VMQ创建订单失败: ${outTradeNo} - ${vmqResult.msg || '未知错误'}`);
      return res.json({
        code: 5002,
        message: vmqResult.msg || 'VMQ创建订单失败',
        data: null
      });
    }

    // 8. 检查是否需要手输金额（isAuto=1）
    if (Number(vmqResult.data.isAuto) === 1) {
      logger.warn(`VMQ通道需要手输金额，拒绝下单: ${outTradeNo}`);
      // 关闭本地订单
      await db.prepare("UPDATE orders SET status = 'expired' WHERE out_trade_no = ?").run(outTradeNo);

      // 关闭VMQ侧订单
      try {
        await vmqService.closeOrder(vmqResult.data.orderId);
      } catch (closeError) {
        logger.warn(`关闭需手输金额的VMQ订单失败: ${vmqResult.data.orderId} - ${closeError.message}`);
      }

      return res.json({
        code: 5003,
        message: '当前支付通道需要用户手动输入金额，存在少付风险，请更换VMQ监控通道配置后再试',
        data: null
      });
    }

    // 9. 更新订单的VMQ订单号
    await db.prepare('UPDATE orders SET trade_no = ?, payment_url = ? WHERE out_trade_no = ?')
      .run(vmqResult.data.orderId, vmqResult.data.payUrl, outTradeNo);

    // 10. 返回支付信息
    logger.info(`续费订单支付链接生成成功: ${outTradeNo}`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        order_id: orderId,
        out_trade_no: outTradeNo,
        vmq_order_id: vmqResult.data.orderId,
        pay_type: vmqResult.data.payType,
        really_price: vmqResult.data.reallyPrice.toString(),
        payment_url: vmqResult.data.payUrl,
        expire_in: Number(vmqResult.data.timeOut || 5) * 60 // 分钟转秒，提供默认值5分钟
      }
    });
  } catch (error) {
    logger.error(`续费接口错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

module.exports = router;