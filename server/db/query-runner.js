/**
 * 查询执行模块
 * 负责提供带重试的 PostgreSQL 查询能力。
 */

/**
 * 创建带重试的查询函数。
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @param {object} logger - 日志实例
 * @returns {Function} 带重试的查询函数
 */
function createQueryWithRetry(pool, logger) {
  /**
   * 执行带重试的数据库查询。
   * @param {string} sql - SQL 语句
   * @param {Array} params - 参数
   * @param {number} maxRetries - 最大重试次数
   * @returns {Promise<Object>} 查询结果
   */
  return async function queryWithRetry(sql, params = [], maxRetries = 2) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await pool.query(sql, params);
        return result;
      } catch (error) {
        lastError = error;
        if (
          attempt < maxRetries &&
          (error.code === 'ECONNRESET' || error.code === '57P01' || error.message.includes('connection'))
        ) {
          logger.warn(`数据库查询失败，正在重试 (${attempt}/${maxRetries}): ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        } else {
          throw error;
        }
      }
    }
    throw lastError;
  };
}

module.exports = {
  createQueryWithRetry
};
