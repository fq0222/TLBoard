/**
 * 管理端 Passkey 路由。
 * 职责：使用管理员鉴权保护分组查询与单密钥撤销，拒绝非法分页及目标 ID。
 */
const express = require('express');
const { query, param } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const controller = require('../../controllers/admin/passkeys-controller');

const router = express.Router();

router.get('/', authenticateAdmin, [
  query('page').optional().isString().bail().isInt({ min: 1, max: 2147483647 }).withMessage('页码必须是正整数').toInt(),
  query('limit').optional().isString().bail().isInt({ min: 1, max: 100 }).withMessage('每页条数必须为1–100').toInt(),
  query('keyword').optional().isString().withMessage('搜索关键词必须为文本').bail().trim()
], controller.listPasskeys);

router.delete('/:id', authenticateAdmin, [
  param('id').isInt({ min: 1, max: 2147483647 }).withMessage('ID必须是有效的正整数').toInt()
], controller.revokePasskey);

module.exports = router;
