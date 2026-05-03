/**
 * 管理端公告管理路由
 * 处理公告的增删改查操作
 */

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const { createLogger } = require('../../utils/logger');

const router = express.Router();
const logger = createLogger('ADMIN-ANNOUNCEMENTS');

/**
 * GET /api/admin/announcements
 * 获取所有公告
 */
router.get('/', authenticateAdmin, [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('页码必须是大于0的整数'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('每页条数必须是1-100之间的整数')
], async (req, res) => {
  try {
    // 验证请求参数
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('获取公告列表参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const db = req.app.locals.db;

    // 查询总数
    const total = (await db.prepare('SELECT COUNT(*) as count FROM announcements').get()).count;

    // 查询公告列表
    const announcements = await db.prepare(`
      SELECT id, title, content, pinned, enabled, created_at, updated_at
      FROM announcements
      ORDER BY pinned DESC, created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    logger.info(`获取公告列表成功，共 ${announcements.length} 条公告`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        total,
        page,
        limit,
        list: announcements
      }
    });
  } catch (error) {
    logger.error(`获取公告列表错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * POST /api/admin/announcements
 * 添加公告
 */
router.post('/', authenticateAdmin, [
  body('title')
    .notEmpty()
    .withMessage('公告标题不能为空'),
  body('content')
    .optional()
    .isString()
    .withMessage('公告内容必须是字符串'),
  body('pinned')
    .optional()
    .isBoolean()
    .withMessage('pinned必须是布尔值'),
  body('enabled')
    .optional()
    .isBoolean()
    .withMessage('enabled必须是布尔值')
], async (req, res) => {
  try {
    // 验证请求参数
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('添加公告参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const { title, content, pinned = false, enabled = true } = req.body;
    const db = req.app.locals.db;

    // 插入公告记录
    const result = await db.prepare(`
      INSERT INTO announcements (title, content, pinned, enabled)
      VALUES (?, ?, ?, ?)
    `).run(title, content || null, pinned ? 1 : 0, enabled ? 1 : 0);

    logger.info(`添加公告成功: ${title} (ID: ${result.lastInsertRowid})`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        id: result.lastInsertRowid,
        title,
        content: content || null,
        pinned: pinned ? 1 : 0,
        enabled: enabled ? 1 : 0,
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000)
      }
    });
  } catch (error) {
    logger.error(`添加公告错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * PUT /api/admin/announcements/:id
 * 修改公告
 */
router.put('/:id', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数'),
  body('title')
    .optional()
    .notEmpty()
    .withMessage('公告标题不能为空'),
  body('content')
    .optional()
    .isString()
    .withMessage('公告内容必须是字符串'),
  body('pinned')
    .optional()
    .isBoolean()
    .withMessage('pinned必须是布尔值'),
  body('enabled')
    .optional()
    .isBoolean()
    .withMessage('enabled必须是布尔值')
], async (req, res) => {
  try {
    // 验证请求参数
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('修改公告参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const announcementId = parseInt(req.params.id);
    const db = req.app.locals.db;

    // 检查公告是否存在
    const existingAnnouncement = await db.prepare('SELECT * FROM announcements WHERE id = ?').get(announcementId);
    
    if (!existingAnnouncement) {
      logger.warn(`修改公告失败: 公告不存在 - ${announcementId}`);
      return res.status(400).json({
        code: 1001,
        message: '公告不存在',
        data: null
      });
    }

    // 构建更新字段
    const updates = [];
    const values = [];
    
    if (req.body.title !== undefined) {
      updates.push('title = ?');
      values.push(req.body.title);
    }
    if (req.body.content !== undefined) {
      updates.push('content = ?');
      values.push(req.body.content);
    }
    if (req.body.pinned !== undefined) {
      updates.push('pinned = ?');
      values.push(req.body.pinned ? 1 : 0);
    }
    if (req.body.enabled !== undefined) {
      updates.push('enabled = ?');
      values.push(req.body.enabled ? 1 : 0);
    }

    if (updates.length === 0) {
      logger.warn('修改公告失败: 没有要更新的字段');
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
    values.push(announcementId);
    await db.prepare(`UPDATE announcements SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    // 查询更新后的公告
    const updatedAnnouncement = await db.prepare('SELECT * FROM announcements WHERE id = ?').get(announcementId);

    logger.info(`修改公告成功: ${updatedAnnouncement.title} (ID: ${announcementId})`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        id: updatedAnnouncement.id,
        title: updatedAnnouncement.title,
        content: updatedAnnouncement.content,
        pinned: updatedAnnouncement.pinned,
        enabled: updatedAnnouncement.enabled,
        created_at: updatedAnnouncement.created_at,
        updated_at: updatedAnnouncement.updated_at
      }
    });
  } catch (error) {
    logger.error(`修改公告错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * DELETE /api/admin/announcements/:id
 * 删除公告
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
      logger.warn('删除公告参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const announcementId = parseInt(req.params.id);
    const db = req.app.locals.db;

    // 检查公告是否存在
    const existingAnnouncement = await db.prepare('SELECT * FROM announcements WHERE id = ?').get(announcementId);
    
    if (!existingAnnouncement) {
      logger.warn(`删除公告失败: 公告不存在 - ${announcementId}`);
      return res.status(400).json({
        code: 1001,
        message: '公告不存在',
        data: null
      });
    }

    // 删除公告
    await db.prepare('DELETE FROM announcements WHERE id = ?').run(announcementId);

    logger.info(`删除公告成功: ${existingAnnouncement.title} (ID: ${announcementId})`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        message: '公告已删除'
      }
    });
  } catch (error) {
    logger.error(`删除公告错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

module.exports = router;