/** 管理端钱包服务：编排只读概览、收款码渲染和并发安全的提现处理。 */
const withdrawalRepository = require('../../repositories/withdrawal-repository');
const { BalanceService } = require('../shared/balance-service');
const PaymentQrService = require('../shared/payment-qr-service');
const AppError = require('../../shared/errors/app-error');

/** 固定业务提示可公开；数据库、二维码内容及未知异常不能由本层拼入消息。 */
function walletError(message, statusCode = 400) {
  return new AppError(message, { statusCode, code: statusCode });
}

/** ID 必须为正安全整数，防止直接服务调用绕过 HTTP 的身份/路径校验。 */
function validateId(id) {
  if (!Number.isSafeInteger(id) || id <= 0) throw walletError('用户、申请或管理员编号无效');
  return id;
}

/** 白名单投影用户概览；余额与累计推广奖励各自转换数值，不返回用户其他资料。 */
function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    balance: Number(row.balance) || 0,
    reward_total: Number(row.reward_total) || 0,
    pending_withdrawal_id: row.pending_withdrawal_id ?? null,
    pending_withdrawal_amount: row.pending_withdrawal_amount === null || row.pending_withdrawal_amount === undefined
      ? null
      : Number(row.pending_withdrawal_amount),
    pending_withdrawal_status: row.pending_withdrawal_status ?? null
  };
}

/** 白名单投影申请元数据；即使仓储返回密文/摘要，JSON 也不能包含这些内部字段。 */
function publicWithdrawal(row) {
  return row ? {
    id: row.id, user_id: row.user_id, amount: Number(row.amount), payment_type: row.payment_type,
    status: row.status, reject_reason: row.reject_reason, processed_by: row.processed_by,
    processed_at: row.processed_at, created_at: row.created_at
  } : null;
}

class AdminWalletService {
  /** 依赖可替换；二维码服务延迟创建，缺少加密密钥不阻止钱包查询与状态处理。 */
  constructor({ repository = withdrawalRepository, balanceService = new BalanceService(), paymentQrService = null } = {}) {
    this.repository = repository;
    this.balanceService = balanceService;
    this.paymentQrService = paymentQrService;
  }

  /** filters 为页码及页大小；页大小封顶 100，无法安全表示的偏移直接拒绝。 */
  pagination(filters = {}) {
    const size = Number(filters.limit);
    const requestedPage = Number(filters.page);
    const limit = Number.isSafeInteger(size) && size > 0 ? Math.min(size, 100) : 20;
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const offset = (page - 1) * limit;
    if (!Number.isSafeInteger(offset)) throw walletError('分页参数超出范围');
    return { page, limit, offset };
  }

  /** 邮箱搜索与分页同时作用于汇总列表和总数；所有管理员均可只读查看。 */
  async listUsers(db, filters = {}) {
    const { page, limit, offset } = this.pagination(filters);
    const options = { email: filters.email, limit, offset };
    const totalRow = await this.repository.countWalletUsers(db, options);
    const rows = await this.repository.listWalletUsers(db, options);
    return { list: rows.map(publicUser), total: Number(totalRow && totalRow.total) || 0, page, limit };
  }

  /** userId 来自校验后的路径；详情仅返回钱包概览与当前 pending，不泄漏收款码。 */
  async getUserDetail(db, userId) {
    validateId(userId);
    const user = await this.repository.getWalletUser(db, userId);
    if (!user) throw walletError('用户不存在', 404);
    const pending = await this.repository.getAdminPendingWithdrawal(db, userId);
    return { user: publicUser(user), pending_withdrawal: publicWithdrawal(pending) };
  }

  /** 仅允许查看 pending 的申请时快照；已完成或驳回返回冲突，不再解密旧收款码。 */
  async getWithdrawalQr(db, id) {
    validateId(id);
    const row = await this.repository.getWithdrawal(db, id);
    if (!row) throw walletError('提现申请不存在', 404);
    if (row.status !== 'pending') throw walletError('提现申请已处理', 409);
    if (!this.paymentQrService) this.paymentQrService = new PaymentQrService();
    return this.paymentQrService.renderQrPng(row.qr_payload_encrypted);
  }

  /** 确认只用 pending 条件 UPDATE；失败时区分不存在和已处理，不触碰用户余额。 */
  async completeWithdrawal(db, id, { adminId } = {}) {
    validateId(id);
    validateId(adminId);
    const row = await this.repository.completeWithdrawal(db, id, adminId);
    if (!row) {
      if (!await this.repository.getWithdrawal(db, id)) throw walletError('提现申请不存在', 404);
      throw walletError('提现申请已处理', 409);
    }
    return publicWithdrawal(row);
  }

  /**
   * reason 必须为非空字符串；固定申请→用户锁顺序，状态、退款与流水在同一专用连接提交。
   * 金额、退款用户与业务引用均取自被锁定申请；失败或重复处理整体回滚。
   */
  async rejectWithdrawal(db, id, { adminId, reason } = {}) {
    validateId(id);
    validateId(adminId);
    if (typeof reason !== 'string' || !reason.trim()) throw walletError('请填写驳回原因');
    return db.transaction(async transactionDb => {
      const request = await this.repository.lockWithdrawal(transactionDb, id);
      if (!request) throw walletError('提现申请不存在', 404);
      if (request.status !== 'pending') throw walletError('提现申请已处理', 409);
      const row = await this.repository.rejectWithdrawal(transactionDb, id, { adminId, reason: reason.trim() });
      if (!row) throw walletError('提现申请已处理', 409);
      await this.balanceService.credit(transactionDb, {
        userId: request.user_id, amount: Number(request.amount), type: 'withdrawal_refund',
        referenceType: 'withdrawal_request', referenceId: request.id, description: '提现驳回退款'
      });
      return publicWithdrawal(row);
    })();
  }

  /** userId 固定为路径用户；仅透传流水筛选和分页，查询参数无法替换用户。 */
  async listUserTransactions(db, userId, filters = {}) {
    validateId(userId);
    if (!await this.repository.getUserBalance(db, userId)) throw walletError('用户不存在', 404);
    const { page, limit, offset } = this.pagination(filters);
    const { items, total } = await this.balanceService.listTransactions(db, { userId, type: filters.type, keyword: filters.keyword, limit, offset });
    return { list: items, total, page, limit };
  }
}

module.exports = new AdminWalletService();
module.exports.AdminWalletService = AdminWalletService;
