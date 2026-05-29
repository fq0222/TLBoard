/**
 * 用户端公告路由
 * 处理公告列表查询。
 */

const express = require('express');
const { query, validationResult } = require('express-validator');
const {
  legacySuccess,
  legacyFail,
  legacyValidationError
} = require('../../shared/response/api-response');
const { parsePagination } = require('../../shared/utils/pagination');
const { createLogger } = require('../../utils/logger');

const router = express.Router();
const logger = createLogger('USER-ANNOUNCEMENTS');

/**
 * GET /api/user/announcements
 * 获取公告列表。
 */
router.get('/', [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('页码必须是大于 0 的整数'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('每页条数必须是 1-100 之间的整数')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('获取公告列表参数校验失败');
      return legacyValidationError(res);
    }

    const { page, limit, offset } = parsePagination(req.query);
    const db = req.app.locals.db;

    const total = (await db.prepare('SELECT COUNT(*) as count FROM announcements WHERE enabled = 1').get()).count;
    const announcements = await db.prepare(`
      SELECT id, title, content, pinned, created_at, updated_at
      FROM announcements
      WHERE enabled = 1
      ORDER BY pinned DESC, created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    logger.info(`获取公告列表成功，共 ${announcements.length} 条公告`);

    return legacySuccess(res, {
      total,
      page,
      limit,
      list: announcements
    });
  } catch (error) {
    logger.error(`获取公告列表错误: ${error.message}`);
    return legacyFail(res);
  }
});

module.exports = router;
