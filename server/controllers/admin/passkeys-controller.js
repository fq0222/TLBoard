/**
 * 管理端 Passkey 控制器。
 * 职责：处理校验、兼容响应与撤销审计；异常原文及 WebAuthn 凭据材料禁止写入日志。
 */
const { validationResult } = require('express-validator');
const { legacySuccess, legacyFail, legacyValidationError, legacyNotFound } = require('../../shared/response/api-response');
const { createLogger } = require('../../utils/logger');
const AdminPasskeyService = require('../../services/admin/passkey-service');

const logger = createLogger('ADMIN-PASSKEY');

/**
 * 记录撤销结果；req.admin 为鉴权中间件可信身份，metadata 只能为服务返回的安全元数据。
 * 核心分支：失败时目标元数据不可得，明确写 null；不拼接异常消息或请求体。
 */
function logRevocation(req, metadata, result) {
  logger.info(JSON.stringify({
    action: 'revoke_passkey',
    admin_id: req.admin.id,
    admin_username: req.admin.username,
    user_id: metadata ? metadata.user_id : null,
    passkey_name: metadata ? metadata.name : null,
    result
  }));
}

/** 列出分组密钥；req.query 已经路由校验，失败响应与日志不含数据库异常原文。 */
async function listPasskeys(req, res) {
  if (!validationResult(req).isEmpty()) return legacyValidationError(res);

  try {
    const service = new AdminPasskeyService(req.app.locals.db);
    const result = await service.list({
      keyword: req.query.keyword || '',
      page: req.query.page === undefined ? 1 : req.query.page,
      limit: req.query.limit === undefined ? 20 : req.query.limit
    });
    return legacySuccess(res, result);
  } catch (error) {
    if (error?.isLegacyBusinessError) return legacyFail(res, error);
    logger.error('查询 Passkey 列表失败');
    return legacyFail(res);
  }
}

/**
 * 撤销 req.params.id 对应密钥并记录安全审计。
 * 核心分支：校验失败返回 400，不存在返回 404，异常返回 500；成功响应只包含操作结果。
 */
async function revokePasskey(req, res) {
  if (!validationResult(req).isEmpty()) {
    logRevocation(req, null, 'invalid');
    return legacyValidationError(res);
  }

  try {
    const deleted = await new AdminPasskeyService(req.app.locals.db).revoke(req.params.id);
    if (!deleted) {
      logRevocation(req, null, 'not_found');
      return legacyNotFound(res, { message: 'Passkey 不存在' });
    }
    logRevocation(req, deleted, 'success');
    return legacySuccess(res, { message: 'Passkey 已撤销' });
  } catch (error) {
    logRevocation(req, null, 'error');
    if (error?.isLegacyBusinessError) return legacyFail(res, error);
    return legacyFail(res);
  }
}

module.exports = { listPasskeys, revokePasskey };
