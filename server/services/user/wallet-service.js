/** 用户钱包服务：编排本人摘要、内存收款码处理、原子提现及余额流水查询。 */
const withdrawalRepository = require('../../repositories/withdrawal-repository');
const balanceRepository = require('../../repositories/balance-repository');
const { BalanceService } = require('../shared/balance-service');
const PaymentQrService = require('../shared/payment-qr-service');
const AppError = require('../../shared/errors/app-error');

/** 创建固定文案的业务错误；参数及二维码内容不进入错误消息。 */
function walletError(message, statusCode = 400) {
  return new AppError(message, { statusCode, code: statusCode });
}

/** 只返回可公开的申请字段，防止仓储未来扩展导致密文或摘要进入 JSON。 */
function publicWithdrawal(row) {
  return row ? { id: row.id, amount: Number(row.amount), status: row.status, created_at: row.created_at } : null;
}

class UserWalletService {
  /** 可替换依赖用于离线验证；二维码服务延迟到上传时创建，缺密钥时不会阻止余额查询。 */
  constructor({ repository = withdrawalRepository, balances = balanceRepository, balanceService = new BalanceService(), paymentQrService = null } = {}) {
    this.repository = repository;
    this.balances = balances;
    this.balanceService = balanceService;
    this.paymentQrService = paymentQrService;
  }

  /**
   * 延迟创建并校验二维码加密服务；查询接口不依赖密钥，保存与提交提现必须先通过校验。
   * @returns {PaymentQrService} 已配置有效 32 字节密钥的二维码服务
   */
  requirePaymentQrService() {
    if (!this.paymentQrService) this.paymentQrService = new PaymentQrService();
    return this.paymentQrService;
  }

  /** db 为事务或普通代理；缺失、空白、非法或非正最低额均默认 2000 分。 */
  async getMinimumAmount(db) {
    const setting = await this.repository.getMinimumAmount(db);
    const value = setting && setting.value;
    const amount = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
    return Number.isSafeInteger(amount) && amount > 0 ? amount : 2000;
  }

  /** userId 只能来自已鉴权用户；返回余额和收款方式标志，绝不返回二维码数据。 */
  async getSummary(db, userId) {
    const user = await this.repository.getUserBalance(db, userId);
    if (!user) throw walletError('用户不存在', 404);
    const qr = await this.repository.getPaymentQr(db, userId);
    const balance = Number(user.balance) || 0;
    return { balance, balance_text: `${(balance / 100).toFixed(2)}元`, payment_type: qr ? qr.payment_type : null, has_payment_qr: !!qr };
  }

  /** fileBuffer 仅在内存解码；成功后在用户锁下原子保存密文，避免申请快照与平台错配。 */
  async savePaymentQr(db, userId, { paymentType, fileBuffer } = {}) {
    if (!['wechat', 'alipay'].includes(paymentType)) throw walletError('收款方式必须为微信或支付宝');
    const paymentQrService = this.requirePaymentQrService();
    let parsed;
    try {
      parsed = await paymentQrService.parseAndEncrypt(fileBuffer, paymentType);
    } catch (error) {
      // 二维码服务的 400 均为固定安全文案；包装成可公开业务错误，其他异常统一隐藏。
      if (error.status === 400) throw walletError(error.message);
      throw error;
    }
    const { encryptedPayload, digest } = parsed;
    await db.transaction(async transactionDb => {
      if (!await this.balances.lockUser(transactionDb, userId)) throw walletError('用户不存在', 404);
      await this.repository.savePaymentQr(transactionDb, { userId, paymentType, qrPayloadEncrypted: encryptedPayload, qrPayloadDigest: digest });
    })();
    return { payment_type: paymentType, has_payment_qr: true };
  }

  /** 提现页概览只包含本人余额、最低额及当前 pending 的公开元数据。 */
  async getWithdrawalOverview(db, userId) {
    const summary = await this.getSummary(db, userId);
    const minimum = await this.getMinimumAmount(db);
    const pending = await this.repository.getPendingWithdrawal(db, userId);
    return { ...summary, minimum_withdrawal_amount: minimum, pending_withdrawal: publicWithdrawal(pending) };
  }

  /**
   * amount 必须为正安全整数分；先锁用户，再检查 pending/收款码/余额，随后创建快照并扣款写流水。
   * BalanceService 在同一连接重入相同锁是安全的；任一步失败交由 transaction 整体回滚。
   */
  async createWithdrawal(db, userId, { amount } = {}) {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw walletError('提现金额必须为正的安全整数分');
    this.requirePaymentQrService();
    try {
      return await db.transaction(async transactionDb => {
        const user = await this.balances.lockUser(transactionDb, userId);
        if (!user) throw walletError('用户不存在', 404);
        const pending = await this.repository.getPendingWithdrawal(transactionDb, userId);
        if (pending) throw walletError('已有处理中提现申请', 409);
        const qr = await this.repository.getPaymentQr(transactionDb, userId);
        if (!qr) throw walletError('请先上传收款码');
        const minimum = await this.getMinimumAmount(transactionDb);
        if (amount < minimum) throw walletError(`最低提现金额为${(minimum / 100).toFixed(2)}元`);
        if (Number(user.balance) < amount) throw walletError('余额不足', 409);
        const request = await this.repository.createWithdrawal(transactionDb, {
          userId, amount, paymentType: qr.payment_type,
          qrPayloadEncrypted: qr.qr_payload_encrypted, qrPayloadDigest: qr.qr_payload_digest
        });
        await this.balanceService.debit(transactionDb, {
          userId, amount, type: 'withdrawal', referenceType: 'withdrawal_request', referenceId: request.id, description: '提现申请'
        });
        return publicWithdrawal(request);
      })();
    } catch (error) {
      if (error.code === '23505' && error.constraint === 'idx_withdrawal_requests_one_pending_per_user') {
        throw walletError('已有处理中提现申请', 409);
      }
      throw error;
    }
  }

  /** filters 只允许筛选/分页参数；用户归属始终由 userId 覆盖，页大小封顶 100，偏移必须安全。 */
  async listUserTransactions(db, userId, filters = {}) {
    const requestedLimit = Number(filters.limit);
    const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 20;
    const requestedPage = Number(filters.page);
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const offset = (page - 1) * limit;
    if (!Number.isSafeInteger(offset)) throw walletError('分页参数超出范围');
    const { items, total } = await this.balanceService.listTransactions(db, { userId, type: filters.type, keyword: filters.keyword, limit, offset });
    return { list: items, total, page, limit };
  }
}

module.exports = new UserWalletService();
module.exports.UserWalletService = UserWalletService;
