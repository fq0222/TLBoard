/**
 * 用户端续费路由
 * 负责续费接口的鉴权、参数校验与 controller 映射
 */

const express = require('express');
const { body } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth-user');
const renewController = require('../../controllers/user/renew-controller');

const router = express.Router();

router.post('/', authenticateUser, [
  body('plan_id')
    .isInt({ min: 1 })
    .withMessage('套餐ID无效'),
  body('pay_type')
    .optional()
    .isInt({ min: 1, max: 10 })
    .withMessage('支付类型无效')
], renewController.createRenewOrder);

module.exports = router;
