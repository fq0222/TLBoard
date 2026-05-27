const fs = require('fs');
const path = require('path');
const { getSiteBaseUrl } = require('../utils/site-url');

const ALLOWED_STATUSES = ['draft', 'published'];
const BLOG_IMAGE_PREFIX = '/api/user/help/images/';

function buildBlogImageUrl(filename) {
  const baseUrl = getSiteBaseUrl();
  const imagePath = `${BLOG_IMAGE_PREFIX}${filename}`;

  return baseUrl ? `${baseUrl}${imagePath}` : imagePath;
}

function buildBlogImageMarkdown(filename, alt = '\u56fe\u7247\u8bf4\u660e') {
  return `![${alt}](${buildBlogImageUrl(filename)})`;
}

function normalizeArticleInput(data) {
  const title = String(data.title || '').trim();
  const summary = String(data.summary || '').trim();
  const category = data.category === undefined || data.category === null ? null : String(data.category).trim();
  const content = String(data.content || '').trim();
  const status = data.status || 'draft';

  if (!title) throw new Error('标题不能为空');
  if (!summary) throw new Error('简介不能为空');
  if (!content) throw new Error('内容不能为空');
  if (title.length > 200) throw new Error('标题不能超过200个字符');
  if (summary.length > 500) throw new Error('简介不能超过500个字符');
  if (category && category.length > 100) throw new Error('分类不能超过100个字符');
  if (!ALLOWED_STATUSES.includes(status)) throw new Error('状态不合法');

  return {
    title,
    summary,
    category: category || null,
    content,
    status
  };
}

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

function buildListQuery({ publishedOnly = false, page = 1, limit = 10, category, status, keyword } = {}) {
  const where = [];
  const params = [];

  if (publishedOnly) {
    where.push('status = ?');
    params.push('published');
  } else if (status && ALLOWED_STATUSES.includes(status)) {
    where.push('status = ?');
    params.push(status);
  }

  if (category) {
    where.push('category = ?');
    params.push(category);
  }

  if (keyword) {
    where.push('(title ILIKE ? OR summary ILIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
  const offset = (safePage - 1) * safeLimit;
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return { whereSql, params, page: safePage, limit: safeLimit, offset };
}

async function listArticles(db, options = {}) {
  const { whereSql, params, page, limit, offset } = buildListQuery(options);
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

async function listAdminArticles(db, options = {}) {
  return listArticles(db, options);
}

async function listPublishedArticles(db, options = {}) {
  return listArticles(db, { ...options, publishedOnly: true });
}

async function createArticle(db, data) {
  const article = normalizeArticleInput(data);
  const now = Math.floor(Date.now() / 1000);
  const result = await db.prepare(`
    INSERT INTO blog_articles (title, summary, category, content, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(article.title, article.summary, article.category, article.content, article.status, now, now);
  return getAdminArticle(db, result.lastInsertRowid);
}

async function getAdminArticle(db, id) {
  return (await db.prepare('SELECT * FROM blog_articles WHERE id = ?').get(id)) || null;
}

async function getPublishedArticle(db, id) {
  return (await db.prepare("SELECT * FROM blog_articles WHERE id = ? AND status = 'published'").get(id)) || null;
}

async function updateArticle(db, id, data) {
  const existing = await getAdminArticle(db, id);
  if (!existing) return null;

  const merged = normalizeArticleInput({
    title: data.title !== undefined ? data.title : existing.title,
    summary: data.summary !== undefined ? data.summary : existing.summary,
    category: data.category !== undefined ? data.category : existing.category,
    content: data.content !== undefined ? data.content : existing.content,
    status: data.status !== undefined ? data.status : existing.status
  });

  await db.prepare(`
    UPDATE blog_articles
    SET title = ?, summary = ?, category = ?, content = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(
    merged.title,
    merged.summary,
    merged.category,
    merged.content,
    merged.status,
    Math.floor(Date.now() / 1000),
    id
  );

  return getAdminArticle(db, id);
}

async function listCategories(db, { publishedOnly = false } = {}) {
  const whereSql = publishedOnly
    ? "WHERE status = 'published' AND category IS NOT NULL AND category != ''"
    : "WHERE category IS NOT NULL AND category != ''";
  const rows = await db.prepare(`
    SELECT DISTINCT category
    FROM blog_articles
    ${whereSql}
    ORDER BY category ASC
  `).all();
  return rows.map((row) => row.category);
}

async function listAdminCategories(db) {
  return listCategories(db, { publishedOnly: false });
}

async function listPublishedCategories(db) {
  return listCategories(db, { publishedOnly: true });
}

function isSafeBlogImageFilename(filename) {
  return /^[a-f0-9-]+\.(jpg|jpeg|png|gif|webp)$/i.test(filename);
}

function extractLocalBlogImageFilenames(content = '') {
  const filenames = new Set();
  const markdownImageRegex = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match;

  while ((match = markdownImageRegex.exec(content))) {
    const rawUrl = match[1];
    let pathname = rawUrl;

    try {
      pathname = new URL(rawUrl, 'http://local.test').pathname;
    } catch {
      pathname = rawUrl;
    }

    if (pathname.startsWith(BLOG_IMAGE_PREFIX)) {
      const filename = decodeURIComponent(path.basename(pathname));
      if (isSafeBlogImageFilename(filename)) {
        filenames.add(filename);
      }
    }
  }

  return Array.from(filenames);
}

async function isImageReferencedByOtherArticles(db, filename, excludeArticleId) {
  const rows = await db.prepare('SELECT id, content FROM blog_articles WHERE id != ?').all(excludeArticleId);
  return rows.some((row) => extractLocalBlogImageFilenames(row.content).includes(filename));
}

async function cleanupUnreferencedBlogImages(db, deletedArticle, { uploadDir, logger } = {}) {
  const filenames = extractLocalBlogImageFilenames(deletedArticle.content);
  const deleted = [];

  for (const filename of filenames) {
    const stillReferenced = await isImageReferencedByOtherArticles(db, filename, deletedArticle.id);
    if (stillReferenced) continue;

    const filePath = path.resolve(uploadDir, filename);
    const resolvedUploadDir = path.resolve(uploadDir);

    if (!filePath.startsWith(resolvedUploadDir + path.sep)) continue;

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        deleted.push(filename);
      }
    } catch (error) {
      if (logger) {
        logger.error(`删除博客图片失败: ${filename} - ${error.message}`);
      }
    }
  }

  return deleted;
}

async function deleteArticle(db, id, options = {}) {
  const existing = await getAdminArticle(db, id);
  if (!existing) return null;

  await db.prepare('DELETE FROM blog_articles WHERE id = ?').run(id);

  if (options.uploadDir) {
    await cleanupUnreferencedBlogImages(db, existing, options);
  }

  return existing;
}

module.exports = {
  BLOG_IMAGE_PREFIX,
  buildBlogImageUrl,
  buildBlogImageMarkdown,
  ensureBlogArticlesTable,
  createArticle,
  updateArticle,
  deleteArticle,
  getAdminArticle,
  getPublishedArticle,
  listAdminArticles,
  listPublishedArticles,
  listAdminCategories,
  listPublishedCategories,
  extractLocalBlogImageFilenames,
  isSafeBlogImageFilename,
  cleanupUnreferencedBlogImages
};
