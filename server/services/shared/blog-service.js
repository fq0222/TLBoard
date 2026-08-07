const fs = require('fs');
const path = require('path');
const { getSiteBaseUrl } = require('../../utils/site-url');
const blogRepository = require('../../repositories/blog-repository');

const ALLOWED_STATUSES = ['draft', 'published'];
const BLOG_IMAGE_PREFIX = '/api/user/help/images/';
const BLOG_VIDEO_PREFIX = '/api/user/help/videos/';
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_VIDEO_MIME_TYPES = ['video/mp4'];

function buildBlogImageUrl(filename) {
  const baseUrl = getSiteBaseUrl();
  const imagePath = `${BLOG_IMAGE_PREFIX}${filename}`;

  return baseUrl ? `${baseUrl}${imagePath}` : imagePath;
}

function buildBlogImageMarkdown(filename, alt = '\u56fe\u7247\u8bf4\u660e') {
  return `![${alt}](${buildBlogImageUrl(filename)})`;
}

/**
 * 构造博客视频的用户端访问地址。
 *
 * @param {string} filename - 视频文件名
 * @returns {string} 视频访问 URL
 */
function buildBlogVideoUrl(filename) {
  const baseUrl = getSiteBaseUrl();
  const videoPath = `${BLOG_VIDEO_PREFIX}${filename}`;

  return baseUrl ? `${baseUrl}${videoPath}` : videoPath;
}

/**
 * 构造博客视频插入片段，使用浏览器原生 video 播放器。
 *
 * @param {string} filename - 视频文件名
 * @returns {string} 可插入文章内容的视频 HTML
 */
function buildBlogVideoMarkdown(filename) {
  return `<video controls preload="metadata" src="${buildBlogVideoUrl(filename)}"></video>`;
}

/**
 * 判断博客图片 MIME 类型是否允许上传。
 *
 * @param {string} mimetype - 文件 MIME 类型
 * @returns {boolean} 是否允许上传
 */
function isAllowedBlogImageMimeType(mimetype) {
  return ALLOWED_MIME_TYPES.includes(mimetype);
}

/**
 * 判断博客视频 MIME 类型是否允许上传。
 *
 * @param {string} mimetype - 文件 MIME 类型
 * @returns {boolean} 是否允许上传
 */
function isAllowedBlogVideoMimeType(mimetype) {
  return ALLOWED_VIDEO_MIME_TYPES.includes(mimetype);
}

/**
 * 构造图片上传成功后的旧接口返回结构。
 *
 * @param {string} filename - 图片文件名
 * @returns {{filename:string,url:string,markdown:string}} 上传结果
 */
function buildUploadedImagePayload(filename) {
  return {
    filename,
    url: buildBlogImageUrl(filename),
    markdown: buildBlogImageMarkdown(filename)
  };
}

/**
 * 构造视频上传成功后的旧接口返回结构。
 *
 * @param {string} filename - 视频文件名
 * @returns {{filename:string,url:string,markdown:string}} 上传结果
 */
function buildUploadedVideoPayload(filename) {
  return {
    filename,
    url: buildBlogVideoUrl(filename),
    markdown: buildBlogVideoMarkdown(filename)
  };
}

function normalizeArticleInput(data) {
  const title = String(data.title || '').trim();
  const summary = String(data.summary || '').trim();
  const category = data.category === undefined || data.category === null ? null : String(data.category).trim();
  const content = String(data.content || '').trim();
  const status = data.status || 'draft';
  const pinned = data.pinned ? 1 : 0;

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
    status,
    pinned
  };
}

async function ensureBlogArticlesTable(db) {
  await blogRepository.ensureBlogArticlesTable(db);
}

async function listArticles(db, options = {}) {
  if (options.publishedOnly) {
    const blogReadRepository = require('../../repositories/blog-read-repository');
    return blogReadRepository.listPublishedArticles(db, options);
  }

  return blogRepository.listAdminArticles(db, options);
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
  const result = await blogRepository.insertArticle(db, {
    ...article,
    now
  });
  return getAdminArticle(db, result.lastInsertRowid);
}

async function getAdminArticle(db, id) {
  return (await blogRepository.findAdminArticleById(db, id)) || null;
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
    status: data.status !== undefined ? data.status : existing.status,
    pinned: data.pinned !== undefined ? data.pinned : existing.pinned
  });

  await blogRepository.updateArticleFields(db, id, {
    ...merged,
    updatedAt: Math.floor(Date.now() / 1000)
  });

  return getAdminArticle(db, id);
}

async function listCategories(db, { publishedOnly = false } = {}) {
  if (publishedOnly) {
    const blogReadRepository = require('../../repositories/blog-read-repository');
    return blogReadRepository.listPublishedCategories(db);
  }

  return blogRepository.listAdminCategories(db);
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

/**
 * 判断本地博客视频文件名是否安全。
 *
 * @param {string} filename - 视频文件名
 * @returns {boolean} 是否为 UUID 风格 MP4 文件名
 */
function isSafeBlogVideoFilename(filename) {
  return /^[a-f0-9-]+\.mp4$/i.test(filename);
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

/**
 * 从文章 HTML 内容中提取本地博客视频文件名。
 *
 * @param {string} content - 文章内容
 * @returns {string[]} 本地视频文件名列表
 */
function extractLocalBlogVideoFilenames(content = '') {
  const filenames = new Set();
  const videoSrcRegex = /<video\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let match;

  while ((match = videoSrcRegex.exec(content))) {
    const rawUrl = match[1];
    let pathname = rawUrl;

    try {
      pathname = new URL(rawUrl, 'http://local.test').pathname;
    } catch {
      pathname = rawUrl;
    }

    if (pathname.startsWith(BLOG_VIDEO_PREFIX)) {
      const filename = decodeURIComponent(path.basename(pathname));
      if (isSafeBlogVideoFilename(filename)) {
        filenames.add(filename);
      }
    }
  }

  return Array.from(filenames);
}

async function isImageReferencedByOtherArticles(db, filename, excludeArticleId) {
  const rows = await blogRepository.listOtherArticleContents(db, excludeArticleId);
  return rows.some((row) => extractLocalBlogImageFilenames(row.content).includes(filename));
}

/**
 * 判断视频是否仍被其他文章引用。
 *
 * @param {Object} db - 数据库实例
 * @param {string} filename - 视频文件名
 * @param {number} excludeArticleId - 当前删除文章 ID
 * @returns {Promise<boolean>} 是否仍被其他文章引用
 */
async function isVideoReferencedByOtherArticles(db, filename, excludeArticleId) {
  const rows = await blogRepository.listOtherArticleContents(db, excludeArticleId);
  return rows.some((row) => extractLocalBlogVideoFilenames(row.content).includes(filename));
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

/**
 * 清理删除文章后不再被引用的本地博客视频。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} deletedArticle - 已删除文章快照
 * @param {Object} options - 清理配置
 * @param {string} options.videoUploadDir - 视频上传目录
 * @param {Object} options.logger - 可选日志器
 * @returns {Promise<string[]>} 已删除的视频文件名
 */
async function cleanupUnreferencedBlogVideos(db, deletedArticle, { videoUploadDir, logger } = {}) {
  const filenames = extractLocalBlogVideoFilenames(deletedArticle.content);
  const deleted = [];

  for (const filename of filenames) {
    const stillReferenced = await isVideoReferencedByOtherArticles(db, filename, deletedArticle.id);
    if (stillReferenced) continue;

    const filePath = path.resolve(videoUploadDir, filename);
    const resolvedUploadDir = path.resolve(videoUploadDir);

    if (!filePath.startsWith(resolvedUploadDir + path.sep)) continue;

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        deleted.push(filename);
      }
    } catch (error) {
      if (logger) {
        logger.error(`删除博客视频失败: ${filename} - ${error.message}`);
      }
    }
  }

  return deleted;
}

async function deleteArticle(db, id, options = {}) {
  const existing = await getAdminArticle(db, id);
  if (!existing) return null;

  await blogRepository.deleteArticle(db, id);

  if (options.uploadDir) {
    await cleanupUnreferencedBlogImages(db, existing, options);
  }

  if (options.videoUploadDir) {
    await cleanupUnreferencedBlogVideos(db, existing, options);
  }

  return existing;
}

module.exports = {
  BLOG_IMAGE_PREFIX,
  BLOG_VIDEO_PREFIX,
  isAllowedBlogImageMimeType,
  isAllowedBlogVideoMimeType,
  buildBlogImageUrl,
  buildBlogVideoUrl,
  buildBlogImageMarkdown,
  buildBlogVideoMarkdown,
  buildUploadedImagePayload,
  buildUploadedVideoPayload,
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
  extractLocalBlogVideoFilenames,
  isSafeBlogImageFilename,
  isSafeBlogVideoFilename,
  cleanupUnreferencedBlogImages,
  cleanupUnreferencedBlogVideos
};
