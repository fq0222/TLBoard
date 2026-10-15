/**
 * Passkey 数据仓储。
 * 职责：管理稳定 user handle、凭据、一次性挑战和管理员分组分页。
 * 安全边界：认证查询仅供服务内部使用；列表和删除结果仅返回安全元数据。
 */
const crypto = require('crypto');
const config = require('../config');

const metadataColumns = 'id, user_id, name, device_type, backed_up, created_at, last_used_at';

class PasskeyRepository {
  /** 保存数据库代理；db.pool 须提供 pg Pool 的 query/connect 方法。 */
  constructor(db) {
    this.db = db;
  }

  /**
   * 获取或原子创建稳定 user handle；userId 为用户 ID，client 可为已有事务连接。
   * 核心分支：COALESCE 保留已生成值，并发首次调用也始终返回同一随机标识。
   */
  async getOrCreateUserHandle(userId, client = this.db.pool) {
    const result = await client.query(`
      UPDATE users SET webauthn_user_id = COALESCE(webauthn_user_id, $2)
      WHERE id = $1 RETURNING webauthn_user_id
    `, [userId, crypto.randomBytes(32).toString('base64url')]);
    if (!result.rows[0]) {
      const error = new Error('用户不存在');
      error.code = 'USER_NOT_FOUND';
      throw error;
    }
    return result.rows[0].webauthn_user_id;
  }

  /** 查询 userId 所属的密钥安全元数据；不返回公钥、credential ID 或挑战。 */
  async listUserPasskeys(userId) {
    const result = await this.db.pool.query(`
      SELECT ${metadataColumns} FROM user_passkeys WHERE user_id = $1 ORDER BY created_at DESC, id DESC
    `, [userId]);
    return result.rows;
  }

  /** 内部注册专用：按 userId 查询邮箱与密码摘要，不存在时返回 null，禁止对外输出。 */
  async findUserForRegistration(userId) {
    const result = await this.db.pool.query('SELECT id, email, password_hash FROM users WHERE id = $1', [userId]);
    return result.rows[0] || null;
  }

  /** 内部注册排除列表：按 userId 查询已有 credential ID 与传输方式，仅用于 WebAuthn 选项。 */
  async listCredentialsForRegistration(userId) {
    const result = await this.db.pool.query('SELECT credential_id, transports FROM user_passkeys WHERE user_id = $1 ORDER BY id', [userId]);
    return result.rows;
  }

  /**
   * 内部认证专用：按 credentialId 关联凭据与 user 登录快照，不存在时返回 null。
   * 核心分支：保留凭据原字段，用户字段独立存于 user，避免两个 id 冲突；禁止对外输出。
   */
  async findCredentialForAuthentication(credentialId) {
    const result = await this.db.pool.query(`
      SELECT k.*, jsonb_build_object('id', u.id, 'email', u.email, 'plan_id', u.plan_id,
        'plan_name', p.name, 'expire_at', u.expire_at::text, 'enabled', u.enabled,
        'disable_reason', u.disable_reason, 'payment_count', u.payment_count,
        'webauthn_user_id', u.webauthn_user_id) AS "user"
      FROM user_passkeys k JOIN users u ON u.id = k.user_id
      LEFT JOIN plans p ON p.id = u.plan_id WHERE k.credential_id = $1
    `, [credentialId]);
    return result.rows[0] || null;
  }

  /**
   * 注册密钥；payload 含 userId/name/credentialId/publicKey/counter/transports/deviceType/backedUp。
   * 核心分支：锁定用户后重新计数；空名称按当前数量生成；不存在或已达两把时回滚，重复凭据由唯一约束拒绝。
   */
  async insertCredentialWithinLimit(payload) {
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      const user = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [payload.userId]);
      if (!user.rows[0]) {
        const error = new Error('用户不存在');
        error.code = 'USER_NOT_FOUND';
        throw error;
      }
      const count = await client.query('SELECT COUNT(*) AS count FROM user_passkeys WHERE user_id = $1', [payload.userId]);
      if (Number(count.rows[0].count) >= config.webauthn.maxPasskeys) {
        const error = new Error('每个用户最多绑定两个 Passkey');
        error.code = 'PASSKEY_LIMIT_REACHED';
        throw error;
      }
      const name = payload.name || `Passkey ${Number(count.rows[0].count) + 1}`;
      const result = await client.query(`
        INSERT INTO user_passkeys (user_id, name, credential_id, public_key, counter, transports, device_type, backed_up)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8) RETURNING ${metadataColumns}
      `, [payload.userId, name, payload.credentialId, Buffer.from(payload.publicKey), payload.counter,
        JSON.stringify(payload.transports || []), payload.deviceType, !!payload.backedUp]);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 更新已验证凭据状态；payload 含 passkeyId/counter/backedUp 和可选 expectedCounter。
   * 核心分支：认证传入旧值执行 CAS，竞争失败或已撤销返回 null；省略旧值兼容现有调用。
   */
  async updateAuthenticationState(payload) {
    const values = [payload.passkeyId, payload.counter, !!payload.backedUp];
    const condition = payload.expectedCounter === undefined ? '' : ' AND counter = $4';
    if (payload.expectedCounter !== undefined) values.push(payload.expectedCounter);
    const result = await this.db.pool.query(`
      UPDATE user_passkeys SET counter = $2, backed_up = $3, last_used_at = FLOOR(EXTRACT(EPOCH FROM NOW()))
      WHERE id = $1${condition} RETURNING ${metadataColumns}
    `, values);
    return result.rows[0] || null;
  }

  /** 删除归属 userId 的 passkeyId；归属不符或记录不存在时返回 null。 */
  async deleteOwnedCredential(userId, passkeyId) {
    const result = await this.db.pool.query(`
      DELETE FROM user_passkeys WHERE user_id = $1 AND id = $2 RETURNING ${metadataColumns}
    `, [userId, passkeyId]);
    return result.rows[0] || null;
  }

  /** 管理员删除 passkeyId；鉴权由服务层负责，不存在时返回 null。 */
  async deleteCredentialByAdmin(passkeyId) {
    const result = await this.db.pool.query(`DELETE FROM user_passkeys WHERE id = $1 RETURNING ${metadataColumns}`, [passkeyId]);
    return result.rows[0] || null;
  }

  /**
   * 保存挑战；payload 为可选 id、type、可空 userId 和 challenge。
   * 核心分支：先有界清理过期挑战，再签发随机 ID；匿名认证允许空用户，注册用户由数据库约束强制。
   */
  async createChallenge(payload) {
    await this.cleanupExpiredChallenges();
    const result = await this.db.pool.query(`
      INSERT INTO webauthn_challenges (id, type, user_id, challenge, expires_at)
      VALUES ($1, $2, $3, $4, FLOOR(EXTRACT(EPOCH FROM NOW())) + $5) RETURNING *
    `, [payload.id || crypto.randomBytes(24).toString('base64url'), payload.type, payload.userId ?? null,
      payload.challenge, config.webauthn.challengeTtlSeconds]);
    return result.rows[0];
  }

  /**
   * 每次签发前最多清理 100 条过期挑战（含匿名记录）；不删除仍在有效秒内的挑战。
   * 核心分支：按过期索引选取最旧记录，跳过并发锁定行，限制单次清理工作量。
   */
  async cleanupExpiredChallenges() {
    await this.db.pool.query(`
      DELETE FROM webauthn_challenges WHERE id IN (
        SELECT id FROM webauthn_challenges WHERE expires_at < FLOOR(EXTRACT(EPOCH FROM NOW()))
        ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED
      )
    `);
  }

  /**
   * 原子消费挑战；payload 为 id/type/可空 userId。
   * 核心分支：类型、用户、有效期和未使用条件全部命中才更新，竞争或重放返回 null。
   */
  async consumeChallenge(payload) {
    const result = await this.db.pool.query(`
      UPDATE webauthn_challenges SET used_at = FLOOR(EXTRACT(EPOCH FROM NOW()))
      WHERE id = $1 AND type = $2 AND user_id IS NOT DISTINCT FROM $3::integer
        AND used_at IS NULL AND expires_at >= FLOOR(EXTRACT(EPOCH FROM NOW())) RETURNING *
    `, [payload.id, payload.type, payload.userId ?? null]);
    return result.rows[0] || null;
  }

  /**
   * 按用户分页密钥；filters 支持 keyword/page/limit，返回 list/total/page/limit。
   * 核心分支：关键词可匹配用户 ID、邮箱和密钥名；先分页用户，再读取其全部密钥。
   */
  async listAdminUsersWithPasskeys({ keyword = '', page = 1, limit = 20 } = {}) {
    page = Math.max(1, Math.floor(Number(page) || 1));
    limit = Math.min(100, Math.max(1, Math.floor(Number(limit) || 20)));
    const pattern = `%${String(keyword).trim().replace(/[\\%_]/g, character => `\\${character}`)}%`;
    const where = `EXISTS (SELECT 1 FROM user_passkeys p WHERE p.user_id = u.id)
      AND (u.id::text ILIKE $1 OR u.email ILIKE $1 OR EXISTS (
        SELECT 1 FROM user_passkeys matched WHERE matched.user_id = u.id AND matched.name ILIKE $1))`;
    const totalResult = await this.db.pool.query(`SELECT COUNT(*) AS total FROM users u WHERE ${where}`, [pattern]);
    const usersResult = await this.db.pool.query(`
      SELECT u.id AS user_id, u.email FROM users u WHERE ${where}
      ORDER BY u.id DESC LIMIT $2 OFFSET $3
    `, [pattern, limit, (page - 1) * limit]);
    const list = usersResult.rows;
    if (list.length) {
      const keys = await this.db.pool.query(`
        SELECT ${metadataColumns} FROM user_passkeys WHERE user_id = ANY($1::integer[])
        ORDER BY created_at DESC, id DESC
      `, [list.map(user => user.user_id)]);
      for (const user of list) {
        user.passkeys = keys.rows.filter(key => key.user_id === user.user_id);
        user.passkey_count = user.passkeys.length;
        user.passkey_limit = config.webauthn.maxPasskeys;
      }
    }
    return { list, total: Number(totalResult.rows[0].total), page, limit };
  }
}

module.exports = PasskeyRepository;
