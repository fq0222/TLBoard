/** 提现仓储：封装用户及管理端查询、申请行锁和条件状态更新，事务写入使用调用方的 db。 */
const WALLET_USER_COLUMNS = `
  u.id, u.email, COALESCE(u.balance, 0) AS balance,
  COALESCE((SELECT SUM(reward_amount) FROM referral_rewards WHERE referrer_user_id = u.id), 0) AS reward_total
`;

/** 每名用户最多关联一条待处理申请，历史记录不会扩大用户列表行数。 */
const WALLET_PENDING_COLUMNS = `,
  pending_withdrawal.id AS pending_withdrawal_id,
  pending_withdrawal.amount AS pending_withdrawal_amount,
  pending_withdrawal.status AS pending_withdrawal_status,
  pending_withdrawal.created_at AS pending_withdrawal_created_at
`;

const WALLET_PENDING_JOIN = `
  LEFT JOIN LATERAL (
    SELECT wr.id, wr.amount, wr.status, wr.created_at
    FROM withdrawal_requests wr
    WHERE wr.user_id = u.id AND wr.status = 'pending'
    ORDER BY wr.created_at DESC, wr.id DESC
    LIMIT 1
  ) pending_withdrawal ON TRUE
`;

class WithdrawalRepository {
  /** email 作为字面关键字绑定 ILIKE，转义通配符；列表和计数共用同一筛选。 */
  buildUserFilter(email) {
    const keyword = typeof email === 'string' ? email.trim() : '';
    return keyword
      ? { where: "WHERE u.email ILIKE ? ESCAPE '\\'", params: [`%${keyword.replace(/[\\%_]/g, character => `\\${character}`)}%`] }
      : { where: '', params: [] };
  }

  /** 统计匹配邮箱的用户数，不用奖励关联表计数，避免奖励多条造成重复用户。 */
  async countWalletUsers(db, { email }) {
    const { where, params } = this.buildUserFilter(email);
    return db.prepare(`SELECT COUNT(*) AS total FROM users u ${where}`).get(...params);
  }

  /** 分页查询余额、累计奖励及唯一 pending；历史申请不会重复用户或污染分页。 */
  async listWalletUsers(db, { email, limit, offset }) {
    const { where, params } = this.buildUserFilter(email);
    return db.prepare(`
      SELECT ${WALLET_USER_COLUMNS} ${WALLET_PENDING_COLUMNS}
      FROM users u ${WALLET_PENDING_JOIN}
      ${where}
      ORDER BY
        CASE WHEN pending_withdrawal.id IS NOT NULL THEN 0 ELSE 1 END,
        pending_withdrawal.created_at ASC,
        u.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
  }

  /** 统计全局待处理提现数，供管理端导航提醒使用，不受用户列表搜索条件影响。 */
  async countPendingWithdrawals(db) {
    return db.prepare("SELECT COUNT(*) AS total FROM withdrawal_requests WHERE status = 'pending'").get();
  }

  /** userId 为管理员选中的用户，返回与列表完全相同的只读钱包概览。 */
  async getWalletUser(db, userId) {
    return db.prepare(`SELECT ${WALLET_USER_COLUMNS} FROM users u WHERE u.id = ?`).get(userId);
  }

  /** 待处理申请只读取公开元数据；管理详情不需要二维码密文或历史申请集合。 */
  async getAdminPendingWithdrawal(db, userId) {
    return db.prepare(`
      SELECT id, user_id, amount, payment_type, status, reject_reason, processed_by, processed_at, created_at
      FROM withdrawal_requests WHERE user_id = ? AND status = 'pending'
      ORDER BY created_at DESC, id DESC LIMIT 1
    `).get(userId);
  }

  /** id 为提现申请；密文仅用于管理员二维码渲染，调用方不得直接返回整行。 */
  async getWithdrawal(db, id) {
    return db.prepare(`
      SELECT id, user_id, amount, payment_type, status, qr_payload_encrypted
      FROM withdrawal_requests WHERE id = ?
    `).get(id);
  }

  /** 驳回事务首先锁申请，随后由余额服务锁用户；等待后读到其他管理员最新状态。 */
  async lockWithdrawal(db, id) {
    return db.prepare('SELECT id, user_id, amount, status FROM withdrawal_requests WHERE id = ? FOR UPDATE').get(id);
  }

  /** 单条条件更新保证只处理 pending；成功才记录处理人，不修改任何余额或流水。 */
  async completeWithdrawal(db, id, adminId) {
    return db.prepare(`
      UPDATE withdrawal_requests SET status = 'completed', processed_by = ?, processed_at = EXTRACT(EPOCH FROM NOW())
      WHERE id = ? AND status = 'pending'
      RETURNING id, user_id, amount, payment_type, status, reject_reason, processed_by, processed_at, created_at
    `).get(adminId, id);
  }

  /** 调用方须持有申请锁；原因与处理人连同状态一起写入，与退款共用事务。 */
  async rejectWithdrawal(db, id, { adminId, reason }) {
    return db.prepare(`
      UPDATE withdrawal_requests SET status = 'rejected', processed_by = ?, reject_reason = ?, processed_at = EXTRACT(EPOCH FROM NOW())
      WHERE id = ? AND status = 'pending'
      RETURNING id, user_id, amount, payment_type, status, reject_reason, processed_by, processed_at, created_at
    `).get(adminId, reason, id);
  }

  /** userId 为登录用户；只读取余额，不暴露用户其他资料。 */
  async getUserBalance(db, userId) {
    return db.prepare('SELECT id, COALESCE(balance, 0) AS balance FROM users WHERE id = ?').get(userId);
  }

  /** 返回最低提现金额配置原值；缺失与非法值交由服务层处理默认值。 */
  async getMinimumAmount(db) {
    return db.prepare('SELECT value FROM system_settings WHERE key = ?').get('minimum_withdrawal_amount');
  }

  /** userId 强制限定收款码所有者；密文与摘要仅供内部保存快照。 */
  async getPaymentQr(db, userId) {
    return db.prepare(`
      SELECT payment_type, qr_payload_encrypted, qr_payload_digest
      FROM user_payment_qr_codes WHERE user_id = ?
    `).get(userId);
  }

  /** payload 仅包含平台、密文与摘要；更新当前收款码不触及申请中的历史快照。 */
  async savePaymentQr(db, { userId, paymentType, qrPayloadEncrypted, qrPayloadDigest }) {
    return db.prepare(`
      INSERT INTO user_payment_qr_codes
        (user_id, payment_type, qr_payload_encrypted, qr_payload_digest)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET
        payment_type = EXCLUDED.payment_type,
        qr_payload_encrypted = EXCLUDED.qr_payload_encrypted,
        qr_payload_digest = EXCLUDED.qr_payload_digest,
        updated_at = EXTRACT(EPOCH FROM NOW())
      RETURNING payment_type
    `).get(userId, paymentType, qrPayloadEncrypted, qrPayloadDigest);
  }

  /** 仅读取当前用户的 pending 元数据；提交前由服务层持有用户锁以串行化检查。 */
  async getPendingWithdrawal(db, userId) {
    return db.prepare(`
      SELECT id, amount, status, created_at FROM withdrawal_requests
      WHERE user_id = ? AND status = 'pending'
      ORDER BY created_at DESC, id DESC LIMIT 1
    `).get(userId);
  }

  /** payload 中 amount 为整数分；平台与二维码双字段均复制为不可变的申请时快照。 */
  async createWithdrawal(db, { userId, amount, paymentType, qrPayloadEncrypted, qrPayloadDigest }) {
    return db.prepare(`
      INSERT INTO withdrawal_requests
        (user_id, amount, payment_type, qr_payload_encrypted, qr_payload_digest)
      VALUES (?, ?, ?, ?, ?)
      RETURNING id, amount, status, created_at
    `).get(userId, amount, paymentType, qrPayloadEncrypted, qrPayloadDigest);
  }
}

module.exports = new WithdrawalRepository();
module.exports.WithdrawalRepository = WithdrawalRepository;
