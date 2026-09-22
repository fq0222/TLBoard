/**
 * 统一余额服务。
 * 职责：校验余额操作、编排同一事务连接上的余额锁定/更新/流水追加，并转换稳定业务错误。
 */

const balanceRepository = require('../../repositories/balance-repository');

const TRANSACTION_TYPES = new Set([
  'opening_balance',
  'referral_reward',
  'plan_payment',
  'withdrawal',
  'withdrawal_refund'
]);
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * 创建可供控制器稳定映射的余额业务错误。
 * @param {number} status - HTTP 状态码
 * @param {string} code - 稳定机器码
 * @param {string} message - 用户可见提示
 * @returns {Error} 带 status/statusCode/code 的错误
 * 核心分支：同时提供新旧状态字段，兼容现有控制器错误处理方式。
 */
function createBalanceError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  error.code = code;
  error.expose = true;
  return error;
}

/**
 * 校验绝对金额。
 * @param {number} amount - 单位分的绝对金额
 * @returns {number} 已校验金额
 * 核心分支：只接受大于零的安全整数，拒绝字符串隐式转换。
 */
function validateAmount(amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw createBalanceError(400, 'INVALID_BALANCE_AMOUNT', '金额必须为正的安全整数分');
  }
  return amount;
}

/**
 * 校验流水类型。
 * @param {string|undefined} type - 流水类型
 * @param {boolean} optional - 是否允许未提供类型
 * @returns {string|undefined} 已校验类型
 * 核心分支：列表筛选可省略类型，写流水必须提供允许的枚举值。
 */
function validateTransactionType(type, optional = false) {
  if (optional && (type === undefined || type === null || type === '')) {
    return undefined;
  }
  if (!TRANSACTION_TYPES.has(type)) {
    throw createBalanceError(400, 'INVALID_BALANCE_TRANSACTION_TYPE', '余额流水类型无效');
  }
  return type;
}

/**
 * 规范分页参数。
 * @param {number|string|undefined} limit - 期望条数
 * @param {number|string|undefined} offset - 期望偏移
 * @returns {{limit:number,offset:number}} 安全分页值
 * 核心分支：limit 默认 20 且最大 100，offset 非安全整数或负数时归零。
 */
function normalizePagination(limit, offset) {
  const numericLimit = Number(limit);
  const numericOffset = Number(offset);
  const safeLimit = Number.isSafeInteger(numericLimit) && numericLimit > 0
    ? Math.min(numericLimit, MAX_LIMIT)
    : DEFAULT_LIMIT;
  const safeOffset = Number.isSafeInteger(numericOffset) && numericOffset >= 0
    ? numericOffset
    : 0;
  return { limit: safeLimit, offset: safeOffset };
}

/** 判断数据库错误是否为余额流水业务引用唯一冲突。 */
function isDuplicateTransactionError(error) {
  return !!error && error.code === '23505';
}

class BalanceService {
  /**
   * @param {Object} [options] - 服务依赖
   * @param {Object} [options.repository] - 可替换的余额仓储
   */
  constructor({ repository = balanceRepository } = {}) {
    this.repository = repository;
  }

  /**
   * 增加余额并追加正数流水。
   * @param {Object} transactionDb - 绑定专用 pg.Client 的事务数据库适配器
   * @param {Object} payload - 用户、金额、类型和业务引用
   * @returns {Promise<Object>} 新增流水
   * 核心分支：锁定用户后使用 UPDATE RETURNING 的新余额写入 balance_after。
   */
  async credit(transactionDb, payload) {
    return this.changeBalance(transactionDb, payload, 'credit');
  }

  /**
   * 扣减余额并追加负数流水。
   * @param {Object} transactionDb - 绑定专用 pg.Client 的事务数据库适配器
   * @param {Object} payload - 用户、金额、类型和业务引用
   * @returns {Promise<Object>} 新增流水
   * 核心分支：锁定后余额不足立即拒绝，金额等于余额时允许扣至零。
   */
  async debit(transactionDb, payload) {
    return this.changeBalance(transactionDb, payload, 'debit');
  }

  /**
   * 执行统一余额变更流程。
   * @param {Object} transactionDb - 事务数据库适配器
   * @param {Object} payload - 余额变更参数
   * @param {'credit'|'debit'} direction - 余额方向
   * @returns {Promise<Object>} 新增流水
   * 核心分支：所有仓储调用透传同一个 transactionDb；唯一冲突转换为幂等错误。
   */
  async changeBalance(transactionDb, payload, direction) {
    const amount = validateAmount(payload && payload.amount);
    const type = validateTransactionType(payload && payload.type);
    const userId = payload && payload.userId;
    const lockedUser = await this.repository.lockUser(transactionDb, userId);

    if (!lockedUser) {
      throw createBalanceError(404, 'BALANCE_USER_NOT_FOUND', '用户不存在');
    }
    if (direction === 'debit' && Number(lockedUser.balance) < amount) {
      throw createBalanceError(409, 'INSUFFICIENT_BALANCE', '余额不足');
    }

    const updated = direction === 'credit'
      ? await this.repository.incrementBalance(transactionDb, userId, amount)
      : await this.repository.decrementBalance(transactionDb, userId, amount);

    if (!updated) {
      throw createBalanceError(409, 'INSUFFICIENT_BALANCE', '余额不足');
    }

    try {
      return await this.repository.insertTransaction(transactionDb, {
        userId,
        amount: direction === 'credit' ? amount : -amount,
        balanceAfter: Number(updated.balance),
        type,
        referenceType: payload.referenceType,
        referenceId: payload.referenceId,
        description: payload.description || ''
      });
    } catch (error) {
      if (isDuplicateTransactionError(error)) {
        throw createBalanceError(409, 'DUPLICATE_BALANCE_TRANSACTION', '该业务引用的余额流水已存在，请勿重复处理');
      }
      throw error;
    }
  }

  /**
   * 查询用户余额流水。
   * @param {Object} db - 数据库适配器
   * @param {Object} options - userId/type/keyword/limit/offset 查询参数
   * @returns {Promise<{items:Array,total:number}>} 流水分页结果
   * 核心分支：type 只允许既定枚举，分页归一化后计数与列表使用相同筛选。
   */
  async listTransactions(db, options = {}) {
    const type = validateTransactionType(options.type, true);
    const filters = {
      userId: options.userId,
      type,
      keyword: options.keyword
    };
    const pagination = normalizePagination(options.limit, options.offset);
    const totalRow = await this.repository.countTransactions(db, filters);
    const items = await this.repository.listTransactions(db, {
      ...filters,
      ...pagination
    });

    return {
      items,
      total: Number(totalRow && totalRow.total) || 0
    };
  }
}

module.exports = {
  BalanceService,
  TRANSACTION_TYPES
};
