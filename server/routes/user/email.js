/**
 * 用户端 Email 路由。
 * 仅负责路径定义、鉴权、中间件、参数校验和 controller 映射。
 */

const express = require('express');
const { body, param } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth-user');
const emailController = require('../../controllers/user/email-controller');

const router = express.Router();

router.post(
  '/tutorial',
  authenticateUser,
  [body('type').notEmpty().withMessage('教程类型不能为空')],
  emailController.sendTutorialEmail
);

router.post(
  '/:action',
  authenticateUser,
  [
    param('action').notEmpty().withMessage('操作名不能为空'),
    body('variables').optional().isObject().withMessage('variables 必须是对象')
  ],
  emailController.sendPresetEmail
);

module.exports = router;
