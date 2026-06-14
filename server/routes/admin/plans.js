/**
 * 管理端套餐路由。
 * 负责套餐接口的鉴权、参数校验与 controller 映射。
 */

const express = require('express');
const { body, param } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const plansController = require('../../controllers/admin/plans-controller');

const router = express.Router();

router.get('/', authenticateAdmin, plansController.listPlans);

router.post('/', authenticateAdmin, [
  body('name')
    .notEmpty()
    .withMessage('套餐名称不能为空'),
  body('price')
    .isInt({ min: 0 })
    .withMessage('价格必须是非负整数'),
  body('duration_days')
    .isInt({ min: 0 })
    .withMessage('有效天数必须是非负整数（0表示无限期）'),
  body('traffic_limit')
    .isInt({ min: 0 })
    .withMessage('流量上限必须是非负整数'),
  body('plan_type')
    .optional()
    .isIn(['lifetime', 'timed'])
    .withMessage('套餐类型无效'),
  body('show_on_home')
    .optional()
    .isBoolean()
    .withMessage('show_on_home必须是布尔值'),
  body('sort_order')
    .optional()
    .isInt({ min: 0 })
    .withMessage('排序权重必须是非负整数'),
  body('enabled')
    .optional()
    .isBoolean()
    .withMessage('enabled必须是布尔值')
], plansController.createPlan);

router.put('/:id', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数'),
  body('name')
    .optional()
    .notEmpty()
    .withMessage('套餐名称不能为空'),
  body('price')
    .optional()
    .isInt({ min: 0 })
    .withMessage('价格必须是非负整数'),
  body('duration_days')
    .optional()
    .isInt({ min: 0 })
    .withMessage('有效天数必须是非负整数（0表示无限期）'),
  body('traffic_limit')
    .optional()
    .isInt({ min: 0 })
    .withMessage('流量上限必须是非负整数'),
  body('plan_type')
    .optional()
    .isIn(['lifetime', 'timed'])
    .withMessage('套餐类型无效'),
  body('show_on_home')
    .optional()
    .isBoolean()
    .withMessage('show_on_home必须是布尔值'),
  body('sort_order')
    .optional()
    .isInt({ min: 0 })
    .withMessage('排序权重必须是非负整数'),
  body('enabled')
    .optional()
    .isBoolean()
    .withMessage('enabled必须是布尔值')
], plansController.updatePlan);

router.delete('/:id', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数')
], plansController.deletePlan);

module.exports = router;
