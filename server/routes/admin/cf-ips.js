/**
 * 管理端 CF IP 池路由。
 * 负责 CF IP 池接口的鉴权、参数校验与 controller 映射。
 */

const express = require('express');
const { body, param } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const cfIpsController = require('../../controllers/admin/cf-ips-controller');

const router = express.Router();

router.get('/', authenticateAdmin, cfIpsController.listCfIps);

router.post('/', authenticateAdmin, [
  body('ip').notEmpty().withMessage('IP地址不能为空'),
  body('enabled').optional().isBoolean().withMessage('enabled必须是布尔值')
], cfIpsController.createCfIp);

router.put('/:id', authenticateAdmin, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数'),
  body('ip').optional().notEmpty().withMessage('IP地址不能为空'),
  body('enabled').optional().isBoolean().withMessage('enabled必须是布尔值')
], cfIpsController.updateCfIp);

router.delete('/:id', authenticateAdmin, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数')
], cfIpsController.deleteCfIp);

router.post('/import', authenticateAdmin, [
  body('ips').isArray({ min: 1 }).withMessage('IP列表不能为空'),
  body('ips.*').notEmpty().withMessage('IP地址不能为空'),
  body('enabled').optional().isBoolean().withMessage('enabled必须是布尔值')
], cfIpsController.importCfIps);

module.exports = router;
