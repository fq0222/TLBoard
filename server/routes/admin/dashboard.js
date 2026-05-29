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

module.exports = router;
