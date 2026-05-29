/**
 * 解析分页参数
 * 当前优先兼容常见的 page/limit 分页形式，并返回数据库查询所需的 offset。
 *
 * @param {Object} query - 请求查询参数对象
 * @param {Object} [options] - 分页默认配置
 * @param {number} [options.defaultPage] - 默认页码
 * @param {number} [options.defaultLimit] - 默认每页数量
 * @param {number} [options.maxLimit] - 最大每页数量，防止一次查询过大
 * @returns {{page: number, limit: number, offset: number}} 标准分页结果
 */
function parsePagination(query = {}, options = {}) {
  const {
    defaultPage = 1,
    defaultLimit = 10,
    maxLimit = 100
  } = options;

  const rawPage = Number(query.page);
  const rawLimit = Number(query.limit);

  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : defaultPage;
  const requestedLimit = Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : defaultLimit;
  const limit = Math.min(requestedLimit, maxLimit);
  const offset = (page - 1) * limit;

  return {
    page,
    limit,
    offset
  };
}

module.exports = {
  parsePagination
};
