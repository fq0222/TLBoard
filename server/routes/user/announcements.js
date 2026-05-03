/**
 * 用户端公告路由
 * 处理公告列表查询
 */

const express = require('express');
const { query, validationResult } = require('express-validator');
const { createLogger } = require('../../utils/logger');

const router = express.Router();
const logger = createLogger('USER-ANNOUNCEMENTS');

/**
 * GET /api/user/announcements
 * 获取公告列表
 */
router.get('/', [
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
    const total = (await db.prepare('SELECT COUNT(*) as count FROM announcements WHERE enabled = 1').get()).count;

    // 查询公告列表
    const announcements = await db.prepare(`
      SELECT id, title, content, pinned, created_at, updated_at
      FROM announcements
      WHERE enabled = 1
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

module.exports = router;