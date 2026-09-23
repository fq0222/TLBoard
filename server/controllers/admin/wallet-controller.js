/** 管理端钱包控制器：从鉴权上下文读取处理人，统一安全 JSON 与禁止缓存的 PNG 响应。 */
const { validationResult } = require('express-validator');
const { legacySuccess, legacyFail, legacyValidationError } = require('../../shared/response/api-response');
const walletService = require('../../services/admin/wallet-service');

class AdminWalletController {
  /** service 为管理端钱包依赖；数据库始终来自当前应用上下文。 */
  constructor(service = walletService) {
    this.service = service;
  }

  /** 校验后执行指定业务；仅公开受控业务异常，未知异常不写原始日志，防止二维码泄漏。 */
  async execute(req, res, method, args, png = false) {
    if (!validationResult(req).isEmpty()) return legacyValidationError(res);
    try {
      const data = await this.service[method](req.app.locals.db, ...args);
      return png ? res.type('png').send(data) : legacySuccess(res, data);
    } catch (error) {
      const statusCode = error.statusCode || error.status;
      if (error.expose && statusCode >= 400 && statusCode < 500) {
        return legacyFail(res, { statusCode, code: statusCode, message: error.message });
      }
      return legacyFail(res);
    }
  }

  /** 只转发邮箱与分页，不允许查询字符串注入其他数据库筛选条件。 */
  listUsers(req, res) {
    const { email, page, limit } = req.query;
    return this.execute(req, res, 'listUsers', [{ email, page, limit }]);
  }

  /** 查看路径选定用户的只读概览及待处理申请。 */
  getUserDetail(req, res) {
    return this.execute(req, res, 'getUserDetail', [Number(req.params.userId)]);
  }

  /** 用户归属由路径决定，仅转发类型、关键字和分页筛选。 */
  listUserTransactions(req, res) {
    const { page, limit, type, keyword } = req.query;
    return this.execute(req, res, 'listUserTransactions', [Number(req.params.userId), { page, limit, type, keyword }]);
  }

  /** PNG 和错误响应都禁止缓存；不通过 JSON 传输原始收款链接或密文。 */
  getWithdrawalQr(req, res) {
    res.set({ 'Cache-Control': 'no-store, private', Pragma: 'no-cache' });
    return this.execute(req, res, 'getWithdrawalQr', [Number(req.params.id)], true);
  }

  /** 处理人只取 req.admin.id；请求体中的处理人、金额等字段均不采纳。 */
  completeWithdrawal(req, res) {
    return this.execute(req, res, 'completeWithdrawal', [Number(req.params.id), { adminId: req.admin.id }]);
  }

  /** 仅传递当前管理员和驳回原因；退款金额与用户由被锁定的申请记录提供。 */
  rejectWithdrawal(req, res) {
    return this.execute(req, res, 'rejectWithdrawal', [Number(req.params.id), { adminId: req.admin.id, reason: req.body?.reason }]);
  }
}

module.exports = new AdminWalletController();
