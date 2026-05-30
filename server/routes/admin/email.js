/**
 * 管理端 Email 路由。
 * 仅负责路径定义、鉴权、中间件、参数校验和 controller 映射。
 */

const express = require('express');
const { body, param, query } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const emailController = require('../../controllers/admin/email-controller');

const router = express.Router();

router.get('/config', authenticateAdmin, emailController.getConfig);

router.put(
  '/config',
  authenticateAdmin,
  [
    body('api_key').optional({ values: 'falsy' }).isString().withMessage('api_key 格式不正确'),
    body('sender_email').optional({ values: 'falsy' }).isString().withMessage('sender_email 格式不正确'),
    body('sender_name').optional({ values: 'falsy' }).isString().withMessage('sender_name 格式不正确'),
    body('daily_limit').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('daily_limit 必须是正整数'),
    body('campaign_daily_limit').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('campaign_daily_limit 必须是正整数')
  ],
  emailController.saveConfig
);

router.post(
  '/test',
  authenticateAdmin,
  [body('email').notEmpty().withMessage('请输入测试邮箱')],
  emailController.sendTestEmail
);

router.get('/templates', authenticateAdmin, emailController.listTemplates);

router.post(
  '/templates',
  authenticateAdmin,
  [
    body('name').notEmpty().withMessage('请填写完整信息'),
    body('subject').notEmpty().withMessage('请填写完整信息'),
    body('content').notEmpty().withMessage('请填写完整信息')
  ],
  emailController.createTemplate
);

router.put(
  '/templates/:id',
  authenticateAdmin,
  [
    param('id').isInt({ min: 1 }).withMessage('模板 ID 必须是正整数'),
    body('name').notEmpty().withMessage('请填写完整信息'),
    body('subject').notEmpty().withMessage('请填写完整信息'),
    body('content').notEmpty().withMessage('请填写完整信息')
  ],
  emailController.updateTemplate
);

router.delete(
  '/templates/:id',
  authenticateAdmin,
  [param('id').isInt({ min: 1 }).withMessage('模板 ID 必须是正整数')],
  emailController.deleteTemplate
);

router.get(
  '/templates/:id/preview',
  authenticateAdmin,
  [
    param('id').isInt({ min: 1 }).withMessage('模板 ID 必须是正整数'),
    query('user_id').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('user_id 必须是正整数')
  ],
  emailController.previewTemplate
);

router.post(
  '/send',
  authenticateAdmin,
  [
    body('to').notEmpty().withMessage('请填写完整信息'),
    body('subject').notEmpty().withMessage('请填写完整信息'),
    body('content').notEmpty().withMessage('请填写完整信息'),
    body('user_id').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('user_id 必须是正整数')
  ],
  emailController.sendSingleEmail
);

router.post(
  '/campaigns',
  authenticateAdmin,
  [
    body('name').notEmpty().withMessage('请填写完整信息'),
    body('template_id').notEmpty().withMessage('请填写完整信息'),
    body('target_type').notEmpty().withMessage('请填写完整信息')
  ],
  emailController.createCampaign
);

router.get('/campaigns', authenticateAdmin, emailController.listCampaigns);

router.get(
  '/campaigns/:id',
  authenticateAdmin,
  [param('id').isInt({ min: 1 }).withMessage('任务 ID 必须是正整数')],
  emailController.getCampaignDetail
);

router.post(
  '/campaigns/:id/pause',
  authenticateAdmin,
  [param('id').isInt({ min: 1 }).withMessage('任务 ID 必须是正整数')],
  emailController.pauseCampaign
);

router.post(
  '/campaigns/:id/resume',
  authenticateAdmin,
  [param('id').isInt({ min: 1 }).withMessage('任务 ID 必须是正整数')],
  emailController.resumeCampaign
);

router.delete(
  '/campaigns/:id',
  authenticateAdmin,
  [param('id').isInt({ min: 1 }).withMessage('任务 ID 必须是正整数')],
  emailController.deleteCampaign
);

router.get(
  '/campaigns/:id/logs',
  authenticateAdmin,
  [
    param('id').isInt({ min: 1 }).withMessage('任务 ID 必须是正整数'),
    query('page').optional().isInt({ min: 1 }).withMessage('page 必须是正整数'),
    query('limit').optional().isInt({ min: 1 }).withMessage('limit 必须是正整数')
  ],
  emailController.listCampaignLogs
);

router.get(
  '/logs',
  authenticateAdmin,
  [
    query('page').optional().isInt({ min: 1 }).withMessage('page 必须是正整数'),
    query('limit').optional().isInt({ min: 1 }).withMessage('limit 必须是正整数')
  ],
  emailController.listLogs
);

router.delete(
  '/logs/clear',
  authenticateAdmin,
  [body('before_days').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('before_days 必须是正整数')],
  emailController.clearExpiredLogs
);

router.delete(
  '/logs/batch',
  authenticateAdmin,
  [body('ids').isArray({ min: 1 }).withMessage('请选择要删除的日志')],
  emailController.batchDeleteLogs
);

router.delete(
  '/logs/:id',
  authenticateAdmin,
  [param('id').isInt({ min: 1 }).withMessage('日志 ID 必须是正整数')],
  emailController.deleteLog
);

router.get(
  '/users/search',
  authenticateAdmin,
  [query('keyword').optional({ values: 'falsy' }).isString().withMessage('keyword 格式不正确')],
  emailController.searchUsers
);

module.exports = router;
