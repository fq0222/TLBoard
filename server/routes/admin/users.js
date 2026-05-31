/**
 * 管理端用户管理路由
 * 负责用户查询、编辑、CF IP 配置与订阅生成的鉴权、参数校验和 controller 映射
 */

const express = require('express');
const { body, param, query } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const usersController = require('../../controllers/admin/users-controller');

const router = express.Router();

router.get('/', authenticateAdmin, [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('页码必须是大于0的整数'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('每页条数必须是1-100之间的整数'),
  query('keyword')
    .optional()
    .isString()
    .withMessage('关键词必须是字符串'),
  query('status')
    .optional()
    .isIn(['active', 'expired', 'disabled'])
    .withMessage('状态必须是active、expired或disabled'),
  query('plan_id')
    .optional()
    .isInt({ min: 1 })
    .withMessage('套餐ID必须是大于0的整数')
], usersController.listUsers);

router.post('/batch-generate-subscriptions', authenticateAdmin, [
  body('cf_optimized_only')
    .optional()
    .isIn([true, false, 0, 1, '0', '1', 'true', 'false'])
    .withMessage('cf_optimized_only必须是布尔值')
], usersController.startBatchGenerateSubscriptions);

router.get('/batch-generate-subscriptions/status', authenticateAdmin, usersController.getBatchGenerateSubscriptionStatus);

router.get('/:id', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数')
], usersController.getUserDetail);

router.put('/:id', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数'),
  body('enabled')
    .optional()
    .isIn([true, false, 0, 1, '0', '1', 'true', 'false'])
    .withMessage('enabled必须是布尔值'),
  body('plan_id')
    .optional()
    .isInt({ min: 1 })
    .withMessage('套餐ID必须是大于0的整数'),
  body('traffic_limit')
    .optional()
    .isInt({ min: 0 })
    .withMessage('流量上限必须是非负整数'),
  body('expire_at')
    .optional({ values: 'null' })
    .custom((value) => {
      if (value === null || value === undefined) return true;
      return Number.isInteger(value) && value >= 0;
    })
    .withMessage('到期时间必须是非负整数或null')
], usersController.updateUser);

router.put('/:id/cf-ips', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数'),
  body('ip_pool_ids')
    .isArray({ min: 1, max: 5 })
    .withMessage('IP数量必须在1-5之间'),
  body('ip_pool_ids.*')
    .isInt({ min: 1 })
    .withMessage('IP ID必须是大于0的整数')
], usersController.updateUserCfIps);

router.post('/:id/generate-subscription', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数')
], usersController.generateSubscription);

module.exports = router;
