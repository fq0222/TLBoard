/**
 * 用户端订阅路由。
 * 仅负责挂载订阅生成、订阅详情与订阅文本输出入口，
 * 具体业务逻辑交由 subscription controller / service 处理。
 */

const express = require('express');
const { param, query } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth-user');
const subscriptionController = require('../../controllers/user/subscription-controller');
const subscriptionService = require('../../services/user/subscription-service');

const router = express.Router();

router.post('/generate', authenticateUser, subscriptionController.generateSubscription);
router.get('/', authenticateUser, subscriptionController.getSubscriptionInfo);
router.get('/sub/:token', [
  param('token')
    .notEmpty()
    .withMessage('订阅token不能为空'),
  query('clash')
    .optional()
    .isIn(['0', '1'])
    .withMessage('clash参数必须是0或1'),
  query('v2ray')
    .optional()
    .isIn(['0', '1'])
    .withMessage('v2ray参数必须是0或1')
], subscriptionController.getSubscriptionContent);

router.generateClashConfig = subscriptionService.generateClashConfig;

module.exports = router;
