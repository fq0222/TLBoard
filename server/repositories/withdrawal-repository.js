/** 提现仓储：封装本人余额摘要、最低额、收款码和申请 SQL；写入只接收调用方的事务 db。 */
class WithdrawalRepository {
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
