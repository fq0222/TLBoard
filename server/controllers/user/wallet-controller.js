/** 用户钱包控制器：读取鉴权身份与已校验参数，输出兼容旧接口的 JSON，禁止记录二维码或原始异常。 */
const { validationResult } = require('express-validator');
const { legacySuccess, legacyFail, legacyValidationError } = require('../../shared/response/api-response');
const walletService = require('../../services/user/wallet-service');

class UserWalletController {
  /** service 为钱包业务依赖；身份和数据库始终取自当前请求上下文。 */
  constructor(service = walletService) {
    this.service = service;
  }

  /**
   * 原始 amount 必须是最多两位小数的正数元字符串；使用 BigInt 做十进制位移后检查安全整数。
   * 禁止 trim、parseFloat 或浮点乘法掩盖三位小数、指数格式以及精度丢失。
   */
  parseAmount(amount) {
    if (typeof amount !== 'string' || !/^\d+(\.\d{1,2})?$/.test(amount)) return null;
    const [yuan, fraction = ''] = amount.split('.');
    const cents = Number(BigInt(yuan) * 100n + BigInt(fraction.padEnd(2, '0')));
    return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
  }

  /** 统一执行服务方法；仅已标记可公开的业务错误透出固定提示，未知错误不记录原始 message。 */
  async execute(req, res, method, payload) {
    if (!validationResult(req).isEmpty()) return legacyValidationError(res);
    try {
      const data = await this.service[method](req.app.locals.db, req.user.id, payload);
      return legacySuccess(res, data);
    } catch (error) {
      if (error.expose && (error.statusCode || error.status) >= 400 && (error.statusCode || error.status) < 500) {
        const statusCode = error.statusCode || error.status;
        return legacyFail(res, { statusCode, code: statusCode, message: error.message });
      }
      return legacyFail(res);
    }
  }

  /** 返回当前登录用户摘要；客户端提供的 userId 一律忽略。 */
  getSummary(req, res) {
    return this.execute(req, res, 'getSummary');
  }

  /** 上传中间件只保留内存 buffer，本层不转发文件名、路径或其他用户输入。 */
  savePaymentQr(req, res) {
    if (!req.file || !['wechat', 'alipay'].includes(req.body.payment_type)) {
      return legacyValidationError(res, { message: '请上传收款码并选择微信或支付宝' });
    }
    return this.execute(req, res, 'savePaymentQr', { paymentType: req.body.payment_type, fileBuffer: req.file.buffer });
  }

  /** 返回当前用户的最低提现额与 pending 元数据。 */
  getWithdrawalOverview(req, res) {
    return this.execute(req, res, 'getWithdrawalOverview');
  }

  /** HTTP 层以元字符串为契约，服务只接收精确整数分；非法金额在访问服务前拒绝。 */
  createWithdrawal(req, res) {
    const amount = this.parseAmount(req.body && req.body.amount);
    if (amount === null) return legacyValidationError(res, { message: '提现金额必须为正数且最多两位小数' });
    return this.execute(req, res, 'createWithdrawal', { amount });
  }

  /** 仅转发既定筛选与分页参数，用户归属不能由查询字符串改变。 */
  listUserTransactions(req, res) {
    const { page, limit, type, keyword } = req.query;
    return this.execute(req, res, 'listUserTransactions', { page, limit, type, keyword });
  }
}

module.exports = new UserWalletController();
