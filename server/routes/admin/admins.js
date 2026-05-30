/**
 * 管理端管理员管理路由。
 * 负责管理员接口的鉴权、参数校验与 controller 映射。
 */

const express = require('express');
const { body, param } = require('express-validator');
const { authenticateAdmin, requireSuperAdmin } = require('../../middleware/auth-admin');
const adminsController = require('../../controllers/admin/admins-controller');

const router = express.Router();

router.get('/', authenticateAdmin, requireSuperAdmin, adminsController.listAdmins);

router.post('/', authenticateAdmin, requireSuperAdmin, [
  body('username')
    .notEmpty()
    .withMessage('用户名不能为空')
    .isLength({ min: 3, max: 20 })
    .withMessage('用户名长度必须在3-20之间'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('密码长度至少8位')
    .matches(/^(?=.*[A-Za-z])(?=.*\d)/)
    .withMessage('密码必须包含字母和数字'),
  body('is_super')
    .optional()
    .isBoolean()
    .withMessage('is_super必须是布尔值')
], adminsController.createAdmin);

router.delete('/:id', authenticateAdmin, requireSuperAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数')
], adminsController.deleteAdmin);

module.exports = router;
