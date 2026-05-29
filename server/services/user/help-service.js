/**
 * 用户端帮助中心服务
 * 负责编排帮助文章只读能力，并封装图片路径解析与安全边界判断。
 */

const path = require('path');
const blogReadRepository = require('../../repositories/blog-read-repository');

const HELP_IMAGE_UPLOAD_DIR = path.join(__dirname, '../../uploads/blog-images');
const HELP_IMAGE_FILENAME_PATTERN = /^[a-f0-9-]+\.(jpg|jpeg|png|gif|webp)$/i;

/**
 * 获取帮助文章列表
 *
 * @param {Object} db - 数据库实例
 * @param {Object} options - 列表查询参数
 * @returns {Promise<Object>} 文章分页结果
 */
async function listHelpArticles(db, options = {}) {
  return blogReadRepository.listPublishedArticles(db, options);
}

/**
 * 获取帮助文章分类
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<string[]>} 分类列表
 */
async function listHelpCategories(db) {
  return blogReadRepository.listPublishedCategories(db);
}

/**
 * 获取帮助文章详情
 *
 * @param {Object} db - 数据库实例
 * @param {number} id - 文章 ID
 * @returns {Promise<Object|null>} 文章详情，不存在时返回 null
 */
async function getHelpArticleById(db, id) {
  return blogReadRepository.getPublishedArticleById(db, id);
}

/**
 * 校验帮助中心图片文件名是否合法
 *
 * @param {string} filename - 图片文件名
 * @returns {boolean} 是否通过校验
 */
function isSafeHelpImageFilename(filename) {
  return HELP_IMAGE_FILENAME_PATTERN.test(filename);
}

/**
 * 解析帮助中心图片文件路径，并返回是否仍在上传目录内
 *
 * @param {string} filename - 请求中的图片文件名
 * @returns {{ filename: string, filePath: string, uploadRoot: string, isInsideUploadRoot: boolean }} 解析结果
 */
function resolveHelpImageFile(filename) {
  const safeFilename = path.basename(filename);
  const filePath = path.resolve(HELP_IMAGE_UPLOAD_DIR, safeFilename);
  const uploadRoot = path.resolve(HELP_IMAGE_UPLOAD_DIR);

  return {
    filename: safeFilename,
    filePath,
    uploadRoot,
    isInsideUploadRoot: filePath.startsWith(uploadRoot + path.sep)
  };
}

module.exports = {
  listHelpArticles,
  listHelpCategories,
  getHelpArticleById,
  isSafeHelpImageFilename,
  resolveHelpImageFile
};
