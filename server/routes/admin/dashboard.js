/**
 * 管理端仪表盘路由
 * 获取系统统计数据
 */

const express = require('express');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const { createLogger } = require('../../utils/logger');

const router = express.Router();
const logger = createLogger('ADMIN-DASHBOARD');

/**
 * GET /api/admin/dashboard/stats
 * 获取系统统计数据
 */
router.get('/stats', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;

    // 并行查询各项统计数据
    const [userCount, planCount, orderCount, serverCount] = await Promise.all([
      db.prepare('SELECT COUNT(*) as count FROM users').get(),
      db.prepare('SELECT COUNT(*) as count FROM plans').get(),
      db.prepare('SELECT COUNT(*) as count FROM orders').get(),
      db.prepare('SELECT COUNT(*) as count FROM xui_servers').get()
    ]);

    const stats = {
      userCount: userCount.count || 0,
      planCount: planCount.count || 0,
      orderCount: orderCount.count || 0,
      serverCount: serverCount.count || 0
    };

    logger.info(`获取统计数据成功: ${JSON.stringify(stats)}`);

    res.json({
      code: 0,
      message: 'ok',
      data: stats
    });
  } catch (error) {
    logger.error(`获取统计数据错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

module.exports = router;
