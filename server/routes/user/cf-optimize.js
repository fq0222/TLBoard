/**
 * 用户端 CF 优选路由。
 * 负责鉴权、参数校验与 controller 映射，具体优选逻辑下沉到 user service。
 */

const express = require('express');
const { body } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth-user');
const cfOptimizeController = require('../../controllers/user/cf-optimize-controller');

const router = express.Router();

router.get('/', authenticateUser, cfOptimizeController.getCfIps);

router.post('/apply', authenticateUser, [
  body('ip_ids').isArray({ min: 1 }).withMessage('至少选择1个IP'),
  body('ip_ids.*').isInt({ min: 1 }).withMessage('IP ID必须是大于0的整数')
], cfOptimizeController.applyCfIps);

router.post('/apply-by-ip', authenticateUser, [
  body('ips').isArray({ min: 1 }).withMessage('至少选择1个IP'),
  body('ips.*').isString().withMessage('IP地址必须是字符串')
], cfOptimizeController.applyCfIpsByAddress);

router.patch('/slots/:slotIndex', authenticateUser, [
  body('ip').isString().withMessage('IP地址必须是字符串')
], cfOptimizeController.replaceCfIpSlotByAddress);

module.exports = router;
