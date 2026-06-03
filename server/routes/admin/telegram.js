const express = require('express');
const { body } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const telegramController = require('../../controllers/admin/telegram-controller');

const router = express.Router();

router.get('/config', authenticateAdmin, telegramController.getTelegramConfig);

router.post('/admin-bind-codes', authenticateAdmin, [
  body('admin_id')
    .optional()
    .isInt({ min: 1 })
    .withMessage('admin_id 必须是大于 0 的整数'),
  body('expires_in_seconds')
    .optional()
    .isInt({ min: 60, max: 86400 })
    .withMessage('expires_in_seconds 必须在 60 到 86400 之间')
], telegramController.createAdminBindCode);

router.get('/admin-bindings', authenticateAdmin, telegramController.listAdminBindings);

module.exports = router;

