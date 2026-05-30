/**
 * 博客管理仓储。
 * 负责 blog_articles 的管理端读写 SQL 访问，供 blog-service 与管理端控制器复用。
 */

function buildAdminArticleQuery(options = {}) {
  const where = [];
  const params = [];

  if (options.status) {
    where.push('status = ?');
    params.push(options.status);
  }

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
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return {
    whereSql,
    params,
    page,
    limit,
    offset
  };
}

/**
 * 确保博客表及索引存在。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<void>}
 */
async function ensureBlogArticlesTable(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS blog_articles (
      id SERIAL PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      summary VARCHAR(500) NOT NULL,
      category VARCHAR(100),
      content TEXT NOT NULL,
      status VARCHAR(20) DEFAULT 'draft',
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
      updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
    )
  `);
  await db.exec('CREATE INDEX IF NOT EXISTS idx_blog_articles_status ON blog_articles(status)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_blog_articles_category ON blog_articles(category)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_blog_articles_updated_at ON blog_articles(updated_at)');
}

/**
 * 查询管理端文章分页列表。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} options - 列表查询参数
 * @returns {Promise<Object>} 列表结果
 */
async function listAdminArticles(db, options = {}) {
  const { whereSql, params, page, limit, offset } = buildAdminArticleQuery(options);
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

async function insertArticle(db, payload) {
  const {
    title,
    summary,
    category,
    content,
    status,
    now
  } = payload;

  return db.prepare(`
    INSERT INTO blog_articles (title, summary, category, content, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(title, summary, category, content, status, now, now);
}

/**
 * 根据文章 ID 查询管理端详情。
 *
 * @param {Object} db - 数据库实例
 * @param {number} articleId - 文章 ID
 * @returns {Promise<Object|undefined>} 文章记录
 */
async function findAdminArticleById(db, articleId) {
  return db.prepare('SELECT * FROM blog_articles WHERE id = ?').get(articleId);
}

/**
 * 更新文章内容。
 *
 * @param {Object} db - 数据库实例
 * @param {number} articleId - 文章 ID
 * @param {Object} payload - 更新参数
 * @returns {Promise<void>}
 */
async function updateArticleFields(db, articleId, payload) {
  const {
    title,
    summary,
    category,
    content,
    status,
    updatedAt
  } = payload;

  await db.prepare(`
    UPDATE blog_articles
    SET title = ?, summary = ?, category = ?, content = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(title, summary, category, content, status, updatedAt, articleId);
}

/**
 * 查询管理端分类列表。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<string[]>} 分类列表
 */
async function listAdminCategories(db) {
  const rows = await db.prepare(`
    SELECT DISTINCT category
    FROM blog_articles
    WHERE category IS NOT NULL AND category != ''
    ORDER BY category ASC
  `).all();
  return rows.map((row) => row.category);
}

/**
 * 删除文章记录。
 *
 * @param {Object} db - 数据库实例
 * @param {number} articleId - 文章 ID
 * @returns {Promise<void>}
 */
async function deleteArticle(db, articleId) {
  await db.prepare('DELETE FROM blog_articles WHERE id = ?').run(articleId);
}

/**
 * 查询除当前文章外的其他文章内容，用于图片引用检查。
 *
 * @param {Object} db - 数据库实例
 * @param {number} excludeArticleId - 需排除的文章 ID
 * @returns {Promise<Array>} 其他文章内容列表
 */
async function listOtherArticleContents(db, excludeArticleId) {
  return db.prepare('SELECT id, content FROM blog_articles WHERE id != ?').all(excludeArticleId);
}

module.exports = {
  ensureBlogArticlesTable,
  listAdminArticles,
  insertArticle,
  findAdminArticleById,
  updateArticleFields,
  listAdminCategories,
  deleteArticle,
  listOtherArticleContents
};
