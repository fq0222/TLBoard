/**
 * 用户认证路由
 * 负责挂载注册、登录、资料接口的限流、鉴权、参数校验与 controller 映射
 */

const express = require('express');
const { body } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth-user');
const { userLoginLimiter, userRegisterLimiter } = require('../../middleware/rate-limiter');
const authController = require('../../controllers/user/auth-controller');

const router = express.Router();

router.post('/register-and-pay', [
  userRegisterLimiter,
  body('email')
    .isEmail()
    .withMessage('请输入有效的邮箱地址')
    .normalizeEmail({ gmail_remove_dots: false }),
  body('password')
    .isLength({ min: 8 })
    .withMessage('密码长度至少8位')
    .matches(/^(?=.*[A-Za-z])(?=.*\d)/)
    .withMessage('密码必须包含字母和数字'),
  body('plan_id')
    .isInt({ min: 1 })
    .withMessage('套餐ID必须是大于0的整数'),
  body('pay_type')
    .optional()
    .isIn([1, 2, '1', '2'])
    .withMessage('支付方式必须是1(微信)或2(支付宝)')
], authController.registerAndPay);

router.post('/login', [
  userLoginLimiter,
  body('email')
    .isEmail()
    .withMessage('请输入有效的邮箱地址')
    .normalizeEmail({ gmail_remove_dots: false }),
  body('password')
    .notEmpty()
    .withMessage('密码不能为空')
], authController.login);

router.get('/profile', authenticateUser, authController.getProfile);
router.post('/onboarding/complete', authenticateUser, authController.completeOnboarding);

module.exports = router;
