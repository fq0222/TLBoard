/**
 * 管理端家宽 IP 路由。
 * 负责家宽 SOCKS outbound 的本地管理和手动同步接口映射。
 */

const express = require('express');
const { body, param } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const homeProxiesController = require('../../controllers/admin/home-proxies-controller');

const router = express.Router();

const idValidator = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数')
];

const homeProxyValidators = [
  body('tag')
    .trim()
    .notEmpty()
    .withMessage('tag不能为空'),
  body('address')
    .trim()
    .notEmpty()
    .withMessage('SOCKS地址不能为空'),
  body('port')
    .isInt({ min: 1, max: 65535 })
    .withMessage('端口必须是1-65535的整数'),
  body('user')
    .trim()
    .notEmpty()
    .withMessage('用户名不能为空'),
  body('pass')
    .trim()
    .notEmpty()
    .withMessage('密码不能为空')
];

const homeProxyUpdateValidators = [
  body('tag')
    .trim()
    .notEmpty()
    .withMessage('tag不能为空'),
  body('address')
    .trim()
    .notEmpty()
    .withMessage('SOCKS地址不能为空'),
  body('port')
    .isInt({ min: 1, max: 65535 })
    .withMessage('端口必须是1-65535的整数'),
  body('user')
    .trim()
    .notEmpty()
    .withMessage('用户名不能为空'),
  body('pass')
    .optional({ checkFalsy: true })
    .trim()
    .notEmpty()
    .withMessage('密码不能为空')
];

router.get('/', authenticateAdmin, homeProxiesController.listHomeProxies);

router.post('/', authenticateAdmin, homeProxyValidators, homeProxiesController.createHomeProxy);

router.put('/:id', authenticateAdmin, [
  ...idValidator,
  ...homeProxyUpdateValidators
], homeProxiesController.updateHomeProxy);

router.delete('/:id', authenticateAdmin, idValidator, homeProxiesController.deleteHomeProxy);

router.post('/:id/sync', authenticateAdmin, idValidator, homeProxiesController.syncHomeProxy);

module.exports = router;
