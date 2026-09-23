/** 管理端钱包路由：所有已登录管理员可只读查看钱包及处理提现，没有直接调账接口。 */
const express = require('express');
const { body, param, query } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const { TRANSACTION_TYPES } = require('../../services/shared/balance-service');
const controller = require('../../controllers/admin/wallet-controller');

const router = express.Router();
const pagination = [
  query('page').optional().isInt({ min: 1, max: Number.MAX_SAFE_INTEGER }),
  query('limit').optional().isInt({ min: 1, max: 100 })
];
const userId = param('userId').isInt({ min: 1, max: Number.MAX_SAFE_INTEGER });
const withdrawalId = param('id').isInt({ min: 1, max: Number.MAX_SAFE_INTEGER });

router.use(authenticateAdmin);
router.get('/users', [...pagination, query('email').optional().isString().isLength({ max: 200 })], controller.listUsers.bind(controller));
router.get('/users/:userId', userId, controller.getUserDetail.bind(controller));
router.get('/users/:userId/transactions', [
  userId, ...pagination,
  query('type').optional().isIn([...TRANSACTION_TYPES]),
  query('keyword').optional().isString().isLength({ max: 200 })
], controller.listUserTransactions.bind(controller));
router.get('/withdrawals/:id/qr', withdrawalId, controller.getWithdrawalQr.bind(controller));
router.post('/withdrawals/:id/complete', withdrawalId, controller.completeWithdrawal.bind(controller));
router.post('/withdrawals/:id/reject', [
  withdrawalId,
  body('reason').isString().bail().custom(value => !!value.trim()).withMessage('请填写驳回原因')
], controller.rejectWithdrawal.bind(controller));

module.exports = router;
