/**
 * 管理端 Passkey 服务。
 * 职责：编排按用户分组的查询与单密钥撤销，使用白名单隔离内部凭据材料。
 */
const config = require('../../config');
const PasskeyRepository = require('../../repositories/passkey-repository');
const PasskeyConfig = require('../shared/passkey-config');

/** 提取公开元数据；row 为仓储密钥记录，内部认证字段始终不透传。 */
function publicMetadata(row) {
  return { id: row.id, name: row.name, created_at: row.created_at, last_used_at: row.last_used_at };
}

class AdminPasskeyService {
  /** 保存 db 对应的仓储；db 为提供 pool 的数据库代理。 */
  constructor(db) {
    PasskeyConfig.assertAvailable();
    this.repository = new PasskeyRepository(db);
  }

  /**
   * 查询用户分组；filters 为已校验的 keyword/page/limit。
   * 核心分支：分页与匹配由仓储按用户处理，名称命中后保留用户完整密钥数组。
   */
  async list(filters) {
    const result = await this.repository.listAdminUsersWithPasskeys(filters);
    return {
      list: result.list.map(user => ({
        user_id: user.user_id,
        email: user.email,
        passkey_count: user.passkeys.length,
        passkey_limit: config.webauthn.maxPasskeys,
        passkeys: user.passkeys.map(publicMetadata)
      })),
      total: result.total,
      page: result.page,
      limit: result.limit
    };
  }

  /**
   * 撤销单个 passkeyId；只返回审计所需归属与安全元数据。
   * 核心分支：不存在或已被撤销返回 null，不扩展任何创建、导出或读取材料操作。
   */
  async revoke(passkeyId) {
    const deleted = await this.repository.deleteCredentialByAdmin(passkeyId);
    return deleted ? { ...publicMetadata(deleted), user_id: deleted.user_id } : null;
  }
}

module.exports = AdminPasskeyService;
