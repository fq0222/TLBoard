/**
 * 管理员认证路由
 * 负责登录、修改密码接口的路径声明、中间件挂载、参数校验与 controller 映射
 */

const express = require('express');
const { body } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const authController = require('../../controllers/admin/auth-controller');

const router = express.Router();

router.post('/login', [
  body('username')
    .notEmpty()
    .withMessage('用户名不能为空'),
  body('password')
    .notEmpty()
    .withMessage('密码不能为空')
], authController.login);

router.put('/password', authenticateAdmin, [
  body('old_password')
    .notEmpty()
    .withMessage('原密码不能为空'),
  body('new_password')
    .isLength({ min: 8 })
    .withMessage('新密码长度至少8位')
    .matches(/^(?=.*[A-Za-z])(?=.*\d)/)
    .withMessage('新密码必须包含字母和数字')
], authController.updatePassword);

module.exports = router;
