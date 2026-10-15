/**
 * 用户 Passkey 路由；挂载于 /api/user/auth。
 * 职责：管理接口强制 JWT，公开认证独立 IP 失败限流，协议校验失败不返回原始参数。
 */
const express = require('express');
const { body, param } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth-user');
const { passkeyLoginOptionsLimiter, passkeyLoginVerifyLimiter,
  passkeyPasswordVerificationLimiter } = require('../../middleware/rate-limiter');
const controller = require('../../controllers/user/passkey-controller');

const router = express.Router();

/** 复验密码参数；非字符串或空密码在调用服务前拒绝。 */
function passwordValidation() {
  return body('password').isString().bail().notEmpty();
}

/** 校验可选显示名称；按 Unicode 字符计数，名称为空时由服务生成默认值。 */
function nameValidation() {
  return body('name').optional({ nullable: true }).isString().bail()
    .custom(value => Array.from(value.trim()).length <= 50);
}

/** 校验 ceremony_id 与响应外壳；详细签名/来源/UV 交由真实 WebAuthn 验证器。 */
function ceremonyValidation() {
  return [
    body('ceremony_id').isString().bail().matches(/^[A-Za-z0-9_-]{1,64}$/),
    body('response').isObject({ strict: true }),
    body('response.id').isString().bail().isLength({ min: 1, max: 2048 }).matches(/^[A-Za-z0-9_-]+$/),
    body('response.response').isObject({ strict: true })
  ];
}

router.get('/passkeys', authenticateUser, (req, res) => controller.list(req, res));
router.post('/passkeys/registration/options', authenticateUser, passkeyPasswordVerificationLimiter, [passwordValidation(), nameValidation()],
  (req, res) => controller.registrationOptions(req, res));
// verify 的名称校验必须留给服务，在原子消费挑战后执行，确保失败响应也不能重放。
router.post('/passkeys/registration/verify', authenticateUser, ceremonyValidation(),
  (req, res) => controller.registrationVerify(req, res));
router.delete('/passkeys/:id', authenticateUser, passkeyPasswordVerificationLimiter,
  [param('id').isInt({ min: 1, max: 2147483647 }), passwordValidation()],
  (req, res) => controller.remove(req, res));
router.post('/passkey/login/options', passkeyLoginOptionsLimiter, (req, res) => controller.loginOptions(req, res));
router.post('/passkey/login/verify', passkeyLoginVerifyLimiter, ceremonyValidation(), (req, res) => controller.loginVerify(req, res));

module.exports = router;
