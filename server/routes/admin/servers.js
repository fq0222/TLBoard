/**
 * 管理端 3X-UI 服务器路由。
 * 负责服务器接口的鉴权、参数校验与 controller 映射。
 */

const express = require('express');
const { body, param } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const serversController = require('../../controllers/admin/servers-controller');

const router = express.Router();

router.get('/', authenticateAdmin, serversController.listServers);

router.post('/backup/run', authenticateAdmin, serversController.runBackupTask);

router.post('/', authenticateAdmin, [
  body('name')
    .notEmpty()
    .withMessage('服务器名称不能为空'),
  body('api_url')
    .notEmpty()
    .withMessage('面板地址不能为空')
    .matches(/^https?:\/\/.+/)
    .withMessage('面板地址格式不正确'),
  body('api_token')
    .notEmpty()
    .withMessage('API Token不能为空'),
  body('panel_version')
    .optional()
    .isString()
    .withMessage('3X-UI 面板版本号格式不正确')
], serversController.createServer);

router.put('/:id', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数'),
  body('name')
    .optional()
    .notEmpty()
    .withMessage('服务器名称不能为空'),
  body('api_url')
    .optional()
    .matches(/^https?:\/\/.+/)
    .withMessage('面板地址格式不正确'),
  body('api_token')
    .optional({ checkFalsy: true })
    .notEmpty()
    .withMessage('API Token不能为空'),
  body('panel_version')
    .optional()
    .isString()
    .withMessage('3X-UI 面板版本号格式不正确')
], serversController.updateServer);

router.delete('/:id', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数')
], serversController.deleteServer);

router.get('/:id/detail', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数')
], serversController.getServerDetail);

router.get('/:id/online-count', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于 0 的整数')
], serversController.getServerOnlineCount);

router.post('/:id/sync', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数')
], serversController.syncServer);

router.put('/:id/users', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数'),
  body('inboundId')
    .notEmpty()
    .withMessage('inboundId不能为空'),
  body('email')
    .notEmpty()
    .withMessage('用户标识不能为空')
], serversController.updateServerUser);

router.delete('/:id/users', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数'),
  body('inboundId')
    .notEmpty()
    .withMessage('inboundId不能为空'),
  body('email')
    .notEmpty()
    .withMessage('用户标识不能为空')
], serversController.deleteServerUser);

module.exports = router;
