/**
 * 管理端套餐路由
 * 处理套餐的增删改查操作
 */

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const { createLogger } = require('../../utils/logger');

const router = express.Router();
const logger = createLogger('ADMIN-PLANS');

/**
 * GET /api/admin/plans
 * 获取所有套餐（含未上架）
 */
router.get('/', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;

    // 查询所有套餐
    const plans = await db.prepare(`
      SELECT * FROM plans 
      ORDER BY sort_order ASC, id ASC
    `).all();

    // 格式化套餐数据
    const formattedPlans = plans.map(plan => ({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      price: plan.price,
      price_text: (plan.price / 100).toFixed(2),
      duration_days: plan.duration_days,
      traffic_limit: plan.traffic_limit,
      traffic_text: formatTraffic(plan.traffic_limit),
      sort_order: plan.sort_order,
      enabled: plan.enabled,
      sales_limit: plan.sales_limit,
      sales_count: plan.sales_count,
      updated_at: plan.updated_at,
      created_at: plan.created_at
    }));

    logger.info(`获取套餐列表成功，共 ${formattedPlans.length} 个套餐`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        list: formattedPlans
      }
    });
  } catch (error) {
    logger.error(`获取套餐列表错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * POST /api/admin/plans
 * 添加套餐
 */
router.post('/', authenticateAdmin, [
  body('name')
    .notEmpty()
    .withMessage('套餐名称不能为空'),
  body('price')
    .isInt({ min: 0 })
    .withMessage('价格必须是非负整数'),
  body('duration_days')
    .isInt({ min: 0 })
    .withMessage('有效天数必须是非负整数（0表示无限期）'),
  body('traffic_limit')
    .isInt({ min: 0 })
    .withMessage('流量上限必须是非负整数'),
  body('sort_order')
    .optional()
    .isInt({ min: 0 })
    .withMessage('排序权重必须是非负整数'),
  body('enabled')
    .optional()
    .isBoolean()
    .withMessage('enabled必须是布尔值')
], async (req, res) => {
  try {
    // 验证请求参数
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('添加套餐参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const { name, description, price, duration_days, traffic_limit, sort_order = 0, enabled = true, sales_limit = -1 } = req.body;
    const db = req.app.locals.db;

    // 插入套餐记录
    const result = await db.prepare(`
      INSERT INTO plans (name, description, price, duration_days, traffic_limit, sort_order, enabled, sales_limit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, description || null, price, duration_days, traffic_limit, sort_order, enabled ? 1 : 0, sales_limit);

    logger.info(`添加套餐成功: ${name} (ID: ${result.lastInsertRowid})`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        id: result.lastInsertRowid,
        name,
        description: description || null,
        price,
        price_text: (price / 100).toFixed(2),
        duration_days,
        traffic_limit,
        traffic_text: formatTraffic(traffic_limit),
        sort_order,
        enabled: enabled ? 1 : 0,
        sales_limit: sales_limit,
        created_at: Math.floor(Date.now() / 1000)
      }
    });
  } catch (error) {
    logger.error(`添加套餐错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * PUT /api/admin/plans/:id
 * 修改套餐
 */
router.put('/:id', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数'),
  body('name')
    .optional()
    .notEmpty()
    .withMessage('套餐名称不能为空'),
  body('price')
    .optional()
    .isInt({ min: 0 })
    .withMessage('价格必须是非负整数'),
  body('duration_days')
    .optional()
    .isInt({ min: 0 })
    .withMessage('有效天数必须是非负整数（0表示无限期）'),
  body('traffic_limit')
    .optional()
    .isInt({ min: 0 })
    .withMessage('流量上限必须是非负整数'),
  body('sort_order')
    .optional()
    .isInt({ min: 0 })
    .withMessage('排序权重必须是非负整数'),
  body('enabled')
    .optional()
    .isBoolean()
    .withMessage('enabled必须是布尔值')
], async (req, res) => {
  try {
    // 验证请求参数
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('修改套餐参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const planId = parseInt(req.params.id);
    const db = req.app.locals.db;

    // 检查套餐是否存在
    const existingPlan = await db.prepare('SELECT * FROM plans WHERE id = ?').get(planId);
    
    if (!existingPlan) {
      logger.warn(`修改套餐失败: 套餐不存在 - ${planId}`);
      return res.status(400).json({
        code: 1001,
        message: '套餐不存在',
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
    if (req.body.description !== undefined) {
      updates.push('description = ?');
      values.push(req.body.description);
    }
    if (req.body.price !== undefined) {
      updates.push('price = ?');
      values.push(req.body.price);
    }
    if (req.body.duration_days !== undefined) {
      updates.push('duration_days = ?');
      values.push(req.body.duration_days);
    }
    if (req.body.traffic_limit !== undefined) {
      updates.push('traffic_limit = ?');
      values.push(req.body.traffic_limit);
    }
    if (req.body.sort_order !== undefined) {
      updates.push('sort_order = ?');
      values.push(req.body.sort_order);
    }
    if (req.body.enabled !== undefined) {
      updates.push('enabled = ?');
      values.push(req.body.enabled ? 1 : 0);
    }
    if (req.body.sales_limit !== undefined) {
      updates.push('sales_limit = ?');
      values.push(req.body.sales_limit);
    }

    if (updates.length === 0) {
      logger.warn('修改套餐失败: 没有要更新的字段');
      return res.status(400).json({
        code: 1001,
        message: '没有要更新的字段',
        data: null
      });
    }

    // 执行更新
    values.push(planId);
    await db.prepare(`UPDATE plans SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    // 查询更新后的套餐
    const updatedPlan = await db.prepare('SELECT * FROM plans WHERE id = ?').get(planId);

    logger.info(`修改套餐成功: ${updatedPlan.name} (ID: ${planId})`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        id: updatedPlan.id,
        name: updatedPlan.name,
        description: updatedPlan.description,
        price: updatedPlan.price,
        price_text: (updatedPlan.price / 100).toFixed(2),
        duration_days: updatedPlan.duration_days,
        traffic_limit: updatedPlan.traffic_limit,
        traffic_text: formatTraffic(updatedPlan.traffic_limit),
        sort_order: updatedPlan.sort_order,
        enabled: updatedPlan.enabled,
        sales_limit: updatedPlan.sales_limit,
        updated_at: updatedPlan.updated_at,
        created_at: updatedPlan.created_at
      }
    });
  } catch (error) {
    logger.error(`修改套餐错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * DELETE /api/admin/plans/:id
 * 删除套餐
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
      logger.warn('删除套餐参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const planId = parseInt(req.params.id);
    const db = req.app.locals.db;

    // 检查套餐是否存在
    const existingPlan = await db.prepare('SELECT * FROM plans WHERE id = ?').get(planId);
    
    if (!existingPlan) {
      logger.warn(`删除套餐失败: 套餐不存在 - ${planId}`);
      return res.status(400).json({
        code: 1001,
        message: '套餐不存在',
        data: null
      });
    }

    // 检查是否有用户正在使用该套餐
    const userCount = await db.prepare('SELECT COUNT(*) as count FROM users WHERE plan_id = ?').get(planId);
    
    if (userCount.count > 0) {
      logger.warn(`删除套餐失败: 套餐下仍有活跃用户 - ${planId}`);
      return res.status(400).json({
        code: 1001,
        message: '该套餐下仍有活跃用户，无法删除',
        data: null
      });
    }

    // 删除套餐
    await db.prepare('DELETE FROM plans WHERE id = ?').run(planId);

    logger.info(`删除套餐成功: ${existingPlan.name} (ID: ${planId})`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        message: '套餐已删除'
      }
    });
  } catch (error) {
    logger.error(`删除套餐错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

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

module.exports = router;