const express = require('express');
const { body } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const systemSettingsController = require('../../controllers/admin/system-settings-controller');
const systemSettingsService = require('../../services/admin/system-settings-service');

const router = express.Router();

router.get('/traffic', authenticateAdmin, systemSettingsController.getTrafficConfig);

router.put('/traffic', authenticateAdmin, [
  body('traffic_usage_multiplier')
    .isFloat({ min: 0, max: 100 })
    .withMessage('流量统计倍率必须是 0 到 100 之间的数字'),
  body('referral_reward_traffic')
    .isInt({ min: 0 })
    .withMessage('推广奖励流量必须是大于等于 0 的整数')
], systemSettingsController.saveTrafficConfig);

router.get('/email', authenticateAdmin, systemSettingsController.getEmailConfig);

router.put('/email', authenticateAdmin, [
  body('api_key').optional({ values: 'falsy' }).isString().withMessage('api_key 格式不正确'),
  body('sender_email').optional({ values: 'falsy' }).isString().withMessage('sender_email 格式不正确'),
  body('sender_name').optional({ values: 'falsy' }).isString().withMessage('sender_name 格式不正确'),
  body('daily_limit').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('daily_limit 必须是正整数'),
  body('campaign_daily_limit').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('campaign_daily_limit 必须是正整数')
], systemSettingsController.saveEmailConfig);

router.get('/resource', authenticateAdmin, systemSettingsController.getResourceConfig);

router.put('/resource', authenticateAdmin, [
  body('max_file_size')
    .isInt({ min: 1, max: 1024 })
    .withMessage('最大文件大小必须是1-1024之间的整数'),
  body('download_speed_limit')
    .isInt({ min: 0 })
    .withMessage('下载速度限制必须是大于等于0的整数')
], systemSettingsController.saveResourceConfig);

router.get('/subscription', authenticateAdmin, systemSettingsController.getSubscriptionConfig);

router.put('/subscription', authenticateAdmin, [
  body('clash_config_name')
    .trim()
    .notEmpty()
    .withMessage('订阅名称不能为空')
    .isLength({ max: 100 })
    .withMessage('订阅名称不能超过 100 个字符'),
  body('clash_profile_update_interval')
    .isInt({ min: 1, max: 168 })
    .withMessage('自动更新间隔必须是 1 到 168 之间的整数'),
  body('telegram_channel_url')
    .optional({ checkFalsy: true })
    .trim()
    .isURL({ require_protocol: true, protocols: ['http', 'https'] })
    .withMessage('Telegram 频道链接必须是有效的 http 或 https 地址'),
  body('online_customer_service_url')
    .optional({ checkFalsy: true })
    .trim()
    .isURL({ require_protocol: true, protocols: ['http', 'https'] })
    .withMessage('在线客服链接必须是有效的 http 或 https 地址')
], systemSettingsController.saveSubscriptionConfig);

// 兼容既有测试脚本直接从路由模块读取配置函数的用法。
router.getTrafficConfig = systemSettingsService.getTrafficConfig;
router.saveTrafficConfig = systemSettingsService.saveTrafficConfig;
router.getEmailConfig = systemSettingsService.getEmailConfig;
router.saveEmailConfig = systemSettingsService.saveEmailConfig;
router.getResourceConfig = systemSettingsService.getResourceConfig;
router.saveResourceConfig = systemSettingsService.saveResourceConfig;
router.getSubscriptionConfig = systemSettingsService.getSubscriptionConfig;
router.saveSubscriptionConfig = systemSettingsService.saveSubscriptionConfig;

module.exports = router;
