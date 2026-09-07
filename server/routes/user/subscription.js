/**
 * 用户端订阅路由。
 * 仅负责挂载订阅生成、订阅详情与订阅文本输出入口，
 * 具体业务逻辑交由 subscription controller / service 处理。
 */

const express = require('express');
const { body, param, query } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth-user');
const { subscriptionInvalidTokenLimiter } = require('../../middleware/rate-limiter');
const subscriptionController = require('../../controllers/user/subscription-controller');
const subscriptionService = require('../../services/user/subscription-service');

const router = express.Router();

router.post('/generate', authenticateUser, subscriptionController.generateSubscription);
router.post('/replace-link', authenticateUser, subscriptionController.replaceSubscriptionLink);
router.get('/home-routing/options', authenticateUser, subscriptionController.getHomeRoutingOptions);
router.put('/home-routing', authenticateUser, [
  body('server_ids')
    .isArray({ min: 1, max: 2 })
    .withMessage('最多选择两台服务器'),
  body('server_ids.*')
    .isInt({ min: 1 })
    .withMessage('服务器ID必须是大于0的整数')
], subscriptionController.updateHomeRouting);
router.get('/', authenticateUser, subscriptionController.getSubscriptionInfo);
router.get('/sub/:token', subscriptionInvalidTokenLimiter, [
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
