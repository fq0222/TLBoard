/**
 * 帮助中心文章只读仓储
 * 负责封装用户端帮助中心所需的博客文章只读查询，保持当前筛选、排序和分页语义不变。
 */

/**
 * 构建已发布文章列表查询参数
 * 统一处理分类、关键字与分页参数，避免控制器和服务层重复拼接 SQL 条件。
 *
 * @param {Object} [options] - 查询参数
 * @param {number} [options.page] - 当前页码
 * @param {number} [options.limit] - 每页条数
 * @param {string} [options.category] - 分类筛选
 * @param {string} [options.keyword] - 关键字筛选
 * @returns {{whereSql: string, params: Array, page: number, limit: number, offset: number}} 查询参数
 */
function buildPublishedArticleQuery(options = {}) {
  const where = ["status = 'published'"];
  const params = [];

  if (options.category) {
    where.push('category = ?');
    params.push(options.category);
  }

  if (options.keyword) {
    where.push('(title ILIKE ? OR summary ILIKE ?)');
    params.push(`%${options.keyword}%`, `%${options.keyword}%`);
  }

  const page = Math.max(parseInt(options.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(options.limit, 10) || 10, 1), 100);
  const offset = (page - 1) * limit;

  return {
    whereSql: `WHERE ${where.join(' AND ')}`,
    params,
    page,
    limit,
    offset
  };
}

/**
 * 查询已发布帮助文章列表
 *
 * @param {Object} db - 数据库实例
 * @param {Object} [options] - 列表查询参数
 * @returns {Promise<Object>} 文章分页结果
 */
async function listPublishedArticles(db, options = {}) {
  const { whereSql, params, page, limit, offset } = buildPublishedArticleQuery(options);
  const totalRow = await db.prepare(`SELECT COUNT(*) as count FROM blog_articles ${whereSql}`).get(...params);
  const list = await db.prepare(`
    SELECT id, title, summary, category, status, created_at, updated_at
    FROM blog_articles
    ${whereSql}
    ORDER BY updated_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return {
    total: Number(totalRow?.count || 0),
    page,
    limit,
    list
  };
}

/**
 * 查询已发布帮助文章分类列表
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<string[]>} 分类列表
 */
async function listPublishedCategories(db) {
  const rows = await db.prepare(`
    SELECT DISTINCT category
    FROM blog_articles
    WHERE status = 'published' AND category IS NOT NULL AND category != ''
    ORDER BY category ASC
  `).all();

  return rows.map((row) => row.category);
}

/**
 * 查询已发布帮助文章详情
 *
 * @param {Object} db - 数据库实例
 * @param {number} id - 文章 ID
 * @returns {Promise<Object|null>} 文章详情，不存在时返回 null
 */
async function getPublishedArticleById(db, id) {
  return (await db.prepare("SELECT * FROM blog_articles WHERE id = ? AND status = 'published'").get(id)) || null;
}

module.exports = {
  listPublishedArticles,
  listPublishedCategories,
  getPublishedArticleById
};
