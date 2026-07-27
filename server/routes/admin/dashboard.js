/**
 * 管理端仪表盘路由
 * 获取系统统计数据。
 */

const express = require('express');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const dashboardController = require('../../controllers/admin/dashboard-controller');

const router = express.Router();

/**
 * GET /api/admin/dashboard/stats
 * 获取系统统计数据。
 */
router.get('/stats', authenticateAdmin, dashboardController.getStats);

/**
 * GET /api/admin/dashboard/traffic-usage
 * 获取最近一轮服务器流量统计。
 */
router.get('/traffic-usage', authenticateAdmin, dashboardController.getTrafficUsageStats);

module.exports = router;
