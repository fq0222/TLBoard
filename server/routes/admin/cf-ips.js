/**
 * 管理端Cloudflare IP池管理路由
 */

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const { createLogger } = require('../../utils/logger');

const router = express.Router();
const logger = createLogger('ADMIN-CF-IPS');

/**
 * GET /api/admin/cf-ips
 * 获取IP池列表（支持分页）
 */
router.get('/', authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const db = req.app.locals.db;

    const total = (await db.prepare('SELECT COUNT(*) as total FROM cf_ip_pool').get()).total;
    const ips = await db.prepare('SELECT id, ip, enabled, created_at FROM cf_ip_pool ORDER BY id ASC LIMIT $1 OFFSET $2').all(limit, offset);

    logger.info(`获取CF IP池列表成功，第${page}页，共 ${ips.length} 条记录`);

    res.json({ code: 0, message: 'ok', data: { total, page, limit, list: ips } });
  } catch (error) {
    logger.error(`获取CF IP池列表错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

/**
 * POST /api/admin/cf-ips
 * 添加IP
 */
router.post('/', authenticateAdmin, [
  body('ip').notEmpty().withMessage('IP地址不能为空'),
  body('enabled').optional().isBoolean().withMessage('enabled必须是布尔值')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ code: 1001, message: '参数校验失败', data: null });
    }

    const { ip, enabled = true } = req.body;
    const db = req.app.locals.db;

    const existingIp = await db.prepare('SELECT id FROM cf_ip_pool WHERE ip = $1').get(ip);
    if (existingIp) {
      return res.status(400).json({ code: 1001, message: 'IP已存在', data: null });
    }

    const result = await db.prepare('INSERT INTO cf_ip_pool (ip, enabled) VALUES ($1, $2)').run(ip, enabled ? 1 : 0);

    logger.info(`添加CF IP成功: ${ip} (ID: ${result.lastInsertRowid})`);

    res.json({
      code: 0, message: 'ok',
      data: { id: result.lastInsertRowid, ip, enabled: enabled ? 1 : 0, created_at: Math.floor(Date.now() / 1000) }
    });
  } catch (error) {
    logger.error(`添加CF IP错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

/**
 * PUT /api/admin/cf-ips/:id
 * 修改IP
 */
router.put('/:id', authenticateAdmin, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数'),
  body('ip').optional().notEmpty().withMessage('IP地址不能为空'),
  body('enabled').optional().isBoolean().withMessage('enabled必须是布尔值')
], async (req, res) => {
  try {
    const ipId = parseInt(req.params.id);
    const db = req.app.locals.db;

    const existingIp = await db.prepare('SELECT * FROM cf_ip_pool WHERE id = $1').get(ipId);
    if (!existingIp) {
      return res.status(400).json({ code: 1001, message: 'IP不存在', data: null });
    }

    const updates = [];
    const values = [];
    if (req.body.ip !== undefined) { updates.push('ip = $' + (values.length + 1)); values.push(req.body.ip); }
    if (req.body.enabled !== undefined) { updates.push('enabled = $' + (values.length + 1)); values.push(req.body.enabled ? 1 : 0); }

    if (updates.length === 0) {
      return res.status(400).json({ code: 1001, message: '没有要更新的字段', data: null });
    }

    values.push(ipId);
    await db.prepare(`UPDATE cf_ip_pool SET ${updates.join(', ')} WHERE id = $${values.length}`).run(...values);

    const updatedIp = await db.prepare('SELECT * FROM cf_ip_pool WHERE id = $1').get(ipId);

    logger.info(`修改CF IP成功: ${updatedIp.ip} (ID: ${ipId})`);

    res.json({
      code: 0, message: 'ok',
      data: { id: updatedIp.id, ip: updatedIp.ip, enabled: updatedIp.enabled, created_at: updatedIp.created_at }
    });
  } catch (error) {
    logger.error(`修改CF IP错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

/**
 * DELETE /api/admin/cf-ips/:id
 * 删除IP
 */
router.delete('/:id', authenticateAdmin, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数')
], async (req, res) => {
  try {
    const ipId = parseInt(req.params.id);
    const db = req.app.locals.db;

    const existingIp = await db.prepare('SELECT * FROM cf_ip_pool WHERE id = $1').get(ipId);
    if (!existingIp) {
      return res.status(400).json({ code: 1001, message: 'IP不存在', data: null });
    }

    await db.prepare('DELETE FROM cf_ip_pool WHERE id = $1').run(ipId);

    logger.info(`删除CF IP成功: ${existingIp.ip} (ID: ${ipId})`);

    res.json({ code: 0, message: 'ok', data: { message: 'IP 已删除' } });
  } catch (error) {
    logger.error(`删除CF IP错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

/**
 * POST /api/admin/cf-ips/import
 * 批量导入IP
 */
router.post('/import', authenticateAdmin, [
  body('ips').isArray({ min: 1 }).withMessage('IP列表不能为空'),
  body('ips.*').notEmpty().withMessage('IP地址不能为空'),
  body('enabled').optional().isBoolean().withMessage('enabled必须是布尔值')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ code: 1001, message: '参数校验失败', data: null });
    }

    const { ips, enabled = true } = req.body;
    const db = req.app.locals.db;

    let imported = 0;
    let skipped = 0;

    const transaction = db.transaction(async () => {
      const insertStmt = db.prepare('INSERT INTO cf_ip_pool (ip, enabled) VALUES ($1, $2)');
      const checkStmt = db.prepare('SELECT id FROM cf_ip_pool WHERE ip = $1');

      for (const ip of ips) {
        const ipAddr = typeof ip === 'string' ? ip : ip.ip;
        const existing = await checkStmt.get(ipAddr);
        
        if (existing) {
          skipped++;
          continue;
        }

        await insertStmt.run(ipAddr, enabled ? 1 : 0);
        imported++;
      }
    });

    await transaction();

    logger.info(`批量导入CF IP完成: 导入 ${imported} 个，跳过 ${skipped} 个`);

    res.json({
      code: 0, message: 'ok',
      data: {
        imported, skipped,
        message: skipped > 0 ? `成功导入 ${imported} 个 IP，跳过 ${skipped} 个重复 IP` : `成功导入 ${imported} 个 IP`
      }
    });
  } catch (error) {
    logger.error(`批量导入CF IP错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

module.exports = router;