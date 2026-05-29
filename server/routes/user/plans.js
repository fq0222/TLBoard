/**
 * 用户端套餐路由
 * 处理套餐列表查询。
 */

const express = require('express');
const plansController = require('../../controllers/user/plans-controller');

const router = express.Router();

/**
 * GET /api/user/plans
 * 获取已上架套餐列表。
 */
router.get('/', plansController.getPlans);

module.exports = router;
