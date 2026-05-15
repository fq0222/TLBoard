/**
 * 用户同步状态路由
 * 提供同步状态轮询接口
 */

const express = require('express');
const { authenticateUser } = require('../../middleware/auth-user');
const { createLogger } = require('../../utils/logger');

const router = express.Router();
const logger = createLogger('SYNC-STATUS');

/**
 * GET /api/user/sync-status
 * 获取当前用户的同步状态
 */
router.get('/', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const db = req.app.locals.db;

    const user = await db.prepare('SELECT sync_status FROM users WHERE id = ?').get(userId);
    
    if (!user) {
      return res.status(400).json({
        code: 2004,
        message: '用户不存在',
        data: null
      });
    }

    res.json({
      code: 0,
      message: 'ok',
      data: {
        sync_status: user.sync_status
      }
    });
  } catch (error) {
    logger.error(`获取同步状态错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

module.exports = router;