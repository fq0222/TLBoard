/** 用户钱包路由：鉴权优先，上传全程仅用内存，并统一处理输入与 Multer 错误。 */
const express = require('express');
const multer = require('multer');
const { query } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth-user');
const { legacyValidationError } = require('../../shared/response/api-response');
const { TRANSACTION_TYPES } = require('../../services/shared/balance-service');
const controller = require('../../controllers/user/wallet-controller');

const router = express.Router();
const MAX_PAYMENT_QR_BYTES = 5 * 1024 * 1024;
const PAYMENT_QR_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, callback) => callback(
    PAYMENT_QR_MIME_TYPES.has(file.mimetype) ? null : new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname),
    PAYMENT_QR_MIME_TYPES.has(file.mimetype)
  ),
  // Busboy 在字节数恰好等于阈值时也触发超限；多放行 1 字节后仍由中间件拒绝所有大于 5 MiB 的文件。
  limits: { fileSize: MAX_PAYMENT_QR_BYTES + 1, files: 1, fields: 1, fieldSize: 32, parts: 3 }
}).single('qr_code');

/** 仅接收 multipart；错误详情可能含文件名或输入，统一转换为固定中文提示，不写日志。 */
function receivePaymentQr(req, res, next) {
  if (!req.is('multipart/form-data')) return legacyValidationError(res, { message: '请使用 multipart 上传收款码图片' });
  return upload(req, res, error => {
    if (error) return legacyValidationError(res, { message: '请使用 qr_code 上传一张不超过 5 MB 的收款码图片' });
    return next();
  });
}

router.use(authenticateUser);
router.get('/summary', controller.getSummary.bind(controller));
router.put('/payment-qr', receivePaymentQr, controller.savePaymentQr.bind(controller));
router.get('/withdrawal', controller.getWithdrawalOverview.bind(controller));
router.post('/withdrawals', controller.createWithdrawal.bind(controller));
router.get('/transactions', [
  query('page').optional().isInt({ min: 1, max: Number.MAX_SAFE_INTEGER }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('type').optional().isIn([...TRANSACTION_TYPES]),
  query('keyword').optional().isString().isLength({ max: 200 })
], controller.listUserTransactions.bind(controller));

module.exports = router;
