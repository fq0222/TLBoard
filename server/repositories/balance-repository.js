/**
 * 余额仓储。
 * 职责：封装用户余额锁定、原子增减、余额流水追加及流水分页查询 SQL。
 * 关键约束：所有方法只使用调用方传入的 db，确保余额和流水落在同一专用事务连接。
 */

/**
 * 转义 PostgreSQL LIKE/ILIKE 模式中的特殊字符。
 * @param {string} keyword - 用户输入的搜索关键字
 * @returns {string} 可安全放入参数化 ILIKE 模式的文本
 * 核心分支：反斜杠、百分号和下划线均按字面值查询。
 */
function escapeLikePattern(keyword) {
  return String(keyword).replace(/[\\%_]/g, character => `\\${character}`);
}

/**
 * 构建流水查询条件和绑定参数。
 * @param {Object} filters - userId/type/keyword 筛选条件
 * @returns {{whereClause:string,params:Array}} WHERE 子句与参数
 * 核心分支：type 和非空 keyword 可选；keyword 只通过参数化 ILIKE 使用。
 */
function buildTransactionFilters({ userId, type, keyword } = {}) {
  const conditions = ['user_id = ?'];
  const params = [userId];

  if (type) {
    conditions.push('type = ?');
    params.push(type);
  }

  const normalizedKeyword = typeof keyword === 'string' ? keyword.trim() : '';
  if (normalizedKeyword) {
    const pattern = `%${escapeLikePattern(normalizedKeyword)}%`;
    conditions.push("(description ILIKE ? ESCAPE '\\' OR reference_type ILIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }

  return {
    whereClause: `WHERE ${conditions.join(' AND ')}`,
    params
  };
}

/**
 * 锁定并读取用户余额。
 * @param {Object} db - 绑定专用 pg.Client 的事务数据库适配器
 * @param {number} userId - 用户 ID
 * @returns {Promise<Object|undefined>} 用户及当前余额
 * 核心分支：FOR UPDATE 串行化同一用户的全部余额变更。
 */
async function lockUser(db, userId) {
  return db.prepare(`
    SELECT id, COALESCE(balance, 0) AS balance
    FROM users
    WHERE id = ?
    FOR UPDATE
  `).get(userId);
}

/**
 * 原子增加用户余额并返回数据库写入后的最新余额。
 * @param {Object} db - 事务数据库适配器
 * @param {number} userId - 用户 ID
 * @param {number} amount - 正整数金额，单位分
 * @returns {Promise<Object|undefined>} 包含 balance 的更新行
 * 核心分支：COALESCE 兼容历史空余额，RETURNING 值供流水快照使用。
 */
async function incrementBalance(db, userId, amount) {
  return db.prepare(`
    UPDATE users
    SET balance = COALESCE(balance, 0) + ?
    WHERE id = ?
    RETURNING balance
  `).get(amount, userId);
}

/**
 * 在余额充足时原子扣减并返回数据库写入后的最新余额。
 * @param {Object} db - 事务数据库适配器
 * @param {number} userId - 用户 ID
 * @param {number} amount - 正整数金额，单位分
 * @returns {Promise<Object|undefined>} 成功时包含 balance，余额不足时为空
 * 核心分支：WHERE 中保留余额条件，防止调用方误用时出现负余额。
 */
async function decrementBalance(db, userId, amount) {
  return db.prepare(`
    UPDATE users
    SET balance = COALESCE(balance, 0) - ?
    WHERE id = ? AND COALESCE(balance, 0) >= ?
    RETURNING balance
  `).get(amount, userId, amount);
}

/**
 * 追加一条不可变余额流水。
 * @param {Object} db - 事务数据库适配器
 * @param {Object} payload - 用户、带符号金额、余额快照和业务引用
 * @returns {Promise<Object>} 新增流水
 * 核心分支：不提供更新或删除接口，唯一业务引用冲突交由服务层转换。
 */
async function insertTransaction(db, payload) {
  const {
    userId,
    type,
    amount,
    balanceAfter,
    referenceType,
    referenceId,
    description = ''
  } = payload;

  return db.prepare(`
    INSERT INTO balance_transactions
      (user_id, type, amount, balance_after, reference_type, reference_id, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(userId, type, amount, balanceAfter, referenceType, referenceId, description);
}

/**
 * 统计符合条件的余额流水。
 * @param {Object} db - 数据库适配器
 * @param {Object} filters - userId/type/keyword 筛选条件
 * @returns {Promise<Object>} 包含 total 的统计行
 * 核心分支：与列表查询复用同一筛选构建逻辑，避免总数和明细漂移。
 */
async function countTransactions(db, filters) {
  const { whereClause, params } = buildTransactionFilters(filters);
  return db.prepare(`
    SELECT COUNT(*) AS total
    FROM balance_transactions
    ${whereClause}
  `).get(...params);
}

/**
 * 分页查询符合条件的余额流水。
 * @param {Object} db - 数据库适配器
 * @param {Object} options - userId/type/keyword/limit/offset 查询参数
 * @returns {Promise<Array>} 按时间和 ID 倒序的流水列表
 * 核心分支：分页值由服务层规范化，本层只参数化绑定。
 */
async function listTransactions(db, options) {
  const { limit, offset } = options;
  const { whereClause, params } = buildTransactionFilters(options);
  return db.prepare(`
    SELECT id, user_id, type, amount, balance_after,
      reference_type, reference_id, description, created_at
    FROM balance_transactions
    ${whereClause}
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
}

module.exports = {
  lockUser,
  incrementBalance,
  decrementBalance,
  insertTransaction,
  countTransactions,
  listTransactions
};
