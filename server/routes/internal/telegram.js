const express = require('express');
const { body, param, query } = require('express-validator');
const { authenticateInternalTelegram } = require('../../middleware/auth-internal-telegram');
const telegramInternalController = require('../../controllers/admin/telegram-internal-controller');

const router = express.Router();

router.use('/api/internal/telegram', authenticateInternalTelegram);

router.get('/api/internal/telegram/health', telegramInternalController.getHealth);

router.post('/api/internal/telegram/admin/bind/verify', [
  body('bind_code')
    .trim()
    .notEmpty()
    .withMessage('bind_code 不能为空'),
  body('chat_id')
    .trim()
    .notEmpty()
    .withMessage('chat_id 不能为空')
], telegramInternalController.verifyAdminBindCode);

router.get('/api/internal/telegram/admin/by-chat/:chatId', [
  param('chatId')
    .trim()
    .notEmpty()
    .withMessage('chatId 不能为空')
], telegramInternalController.getAdminByChatId);

router.get('/api/internal/telegram/servers/health', [
  query('chat_id')
    .trim()
    .notEmpty()
    .withMessage('chat_id 不能为空')
], telegramInternalController.getServersHealthSummary);

router.get('/api/internal/telegram/servers/health/:serverId', [
  param('serverId')
    .isInt({ min: 1 })
    .withMessage('serverId 必须是大于 0 的整数'),
  query('chat_id')
    .trim()
    .notEmpty()
    .withMessage('chat_id 不能为空')
], telegramInternalController.getServerHealthDetail);

router.get('/api/internal/telegram/alerts', [
  query('chat_id')
    .trim()
    .notEmpty()
    .withMessage('chat_id 不能为空'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('limit 必须在 1 到 100 之间')
], telegramInternalController.listAlerts);

router.get('/api/internal/telegram/alerts/pending', [
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('limit 必须在 1 到 100 之间')
], telegramInternalController.listPendingAlerts);

router.post('/api/internal/telegram/alerts/:alertId/sent', [
  param('alertId')
    .isInt({ min: 1 })
    .withMessage('alertId 必须是大于 0 的整数'),
  body('result_status')
    .isIn(['sent', 'failed'])
    .withMessage('result_status 必须是 sent 或 failed')
], telegramInternalController.markAlertSent);

router.get('/api/internal/telegram/admin/users/lookup', [
  query('chat_id')
    .trim()
    .notEmpty()
    .withMessage('chat_id 不能为空'),
  query('email')
    .optional()
    .isEmail()
    .withMessage('email 格式不正确'),
  query('user_id')
    .optional()
    .isInt({ min: 1 })
    .withMessage('user_id 必须是大于 0 的整数'),
  query()
    .custom((value) => !!value.email || !!value.user_id)
    .withMessage('email 和 user_id 至少需要一个')
], telegramInternalController.lookupAdminUser);

module.exports = router;
