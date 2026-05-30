/**
 * 用户端订单路由
 * 负责订单列表与订单状态轮询接口的鉴权、参数校验与 controller 映射
 */

const express = require('express');
const { query, param } = require('express-validator');
const { authenticateUser, optionalAuth } = require('../../middleware/auth-user');
const ordersController = require('../../controllers/user/orders-controller');

const router = express.Router();

router.get('/', authenticateUser, [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('页码必须是大于0的整数'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('每页条数必须是1-100之间的整数'),
  query('status')
    .optional()
    .isIn(['pending', 'paid', 'expired'])
    .withMessage('状态必须是pending、paid或expired')
], ordersController.listOrders);

router.get('/status/:id', optionalAuth, [
  param('id')
    .notEmpty()
    .withMessage('订单ID不能为空')
], ordersController.getPublicOrderStatus);

router.get('/:id/status', authenticateUser, [
  param('id')
    .notEmpty()
    .withMessage('订单ID不能为空')
], ordersController.getUserOrderStatus);

module.exports = router;
