/**
 * SQL 工具模块
 * 负责处理 SQLite 风格 SQL 到 PostgreSQL 风格 SQL 的占位符转换。
 */

/**
 * 将 SQL 中的 ? 占位符转换为 $1, $2, ...。
 * @param {string} sql - 原始 SQL
 * @returns {string} 转换后的 SQL
 */
function convertPlaceholders(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

module.exports = {
  convertPlaceholders
};
