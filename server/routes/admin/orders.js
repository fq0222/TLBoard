/**
 * 管理端订单管理路由
 * 负责订单列表查询接口的鉴权、参数校验与 controller 映射
 */

const express = require('express');
const { query } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const ordersController = require('../../controllers/admin/orders-controller');

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
  query('status')
    .optional()
    .isIn(['pending', 'paid', 'expired'])
    .withMessage('状态必须是pending、paid或expired'),
  query('email')
    .optional()
    .isString()
    .withMessage('邮箱必须是字符串'),
  query('start_date')
    .optional()
    .isString()
    .withMessage('开始日期必须是字符串'),
  query('end_date')
    .optional()
    .isString()
    .withMessage('结束日期必须是字符串')
], ordersController.listOrders);

module.exports = router;
