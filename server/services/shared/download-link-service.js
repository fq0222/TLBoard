/**
 * 下载链接服务
 * 负责为用户生成可直接打开的 Android-App 下载链接
 */

const crypto = require('crypto');
const downloadRepository = require('../../repositories/download-repository');
const {
  findUserDistributions,
  removeDuplicateDistributions,
  upsertUserDistribution
} = require('./resource-distribution-service');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('DOWNLOAD-LINK-SERVICE');

const DOWNLOAD_RESOURCE_KEYWORD = 'Android-App';
const DEFAULT_EXPIRE_MINUTES = 60;

/**
 * 生成 32 位下载 token
 * @returns {string} 下载 token
 */
function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * 获取资源配置
 * @param {Object} db - 数据库实例
 * @returns {Promise<Object>} 资源配置
 */
async function getResourceConfig(db) {
  try {
    const configRow = await downloadRepository.getResourceConfigRow(db);
    if (configRow) {
      return JSON.parse(configRow.value);
    }
  } catch (error) {
    logger.warn(`获取资源配置失败，使用默认配置: ${error.message}`);
  }

  return { default_expire_minutes: DEFAULT_EXPIRE_MINUTES };
}

/**
 * 生成前端可直接打开的完整下载地址
 * @param {string} siteBaseUrl - 站点基础 URL
 * @param {string} token - 下载 token
 * @returns {string} 下载地址
 */
function buildDownloadUrl(siteBaseUrl, token) {
  const baseUrl = siteBaseUrl ? siteBaseUrl.replace(/\/$/, '') : '';
  return `${baseUrl}/api/user/download/${token}`;
}

/**
 * 按原有分发规则，取最新启用的 Android-App 资源
 * @param {Object} db - 数据库实例
 * @returns {Promise<Object|undefined>} 资源记录
 */
async function findLatestDownloadResource(db) {
  return downloadRepository.findLatestEnabledResourceByKeyword(db, DOWNLOAD_RESOURCE_KEYWORD);
}

/**
 * 获取或创建用户下载链接
 * 没有分发记录时自动分配；记录过期或禁用时重置有效期；有效记录直接复用
 * @param {Object} options - 下载链接参数
 * @param {Object} options.db - 数据库实例
 * @param {number} options.userId - 用户 ID
 * @param {string} options.siteBaseUrl - 站点基础 URL
 * @param {number} [options.now] - 当前时间戳
 * @param {Function} [options.tokenFactory] - 下载 token 生成函数
 * @returns {Promise<Object>} 下载链接信息
 */
async function getOrCreateDownloadLink(options) {
  const {
    db,
    userId,
    siteBaseUrl,
    now = Math.floor(Date.now() / 1000),
    tokenFactory = generateToken
  } = options;

  const config = await getResourceConfig(db);
  const expireMinutes = Number(config.default_expire_minutes) || DEFAULT_EXPIRE_MINUTES;
  const expireAt = now + (expireMinutes * 60);
  const resource = await findLatestDownloadResource(db);
  if (!resource) {
    logger.warn(`获取下载链接失败: 用户 ${userId}, 未找到可用资源`);
    const error = new Error('暂无可用资源，请联系管理员');
    error.code = 7005;
    throw error;
  }

  const distributions = await findUserDistributions(db, userId);
  const distribution = distributions[0];

  if (
    distribution &&
    Number(distribution.resource_id) === Number(resource.id) &&
    Number(distribution.enabled) === 1 &&
    Number(distribution.resource_enabled) === 1 &&
    (!distribution.expire_at || Number(distribution.expire_at) > now)
  ) {
    const removedDuplicates = await removeDuplicateDistributions(db, distributions);

    logger.info(`复用下载链接: 用户 ${userId}, 资源 ${resource.id}, 清理重复 ${removedDuplicates} 条`);
    return {
      download_url: buildDownloadUrl(siteBaseUrl, distribution.download_token),
      expire_at: distribution.expire_at,
      resource_name: resource.name,
      action: 'reused',
      removed_duplicates: removedDuplicates
    };
  }

  const result = await upsertUserDistribution({
    db,
    resourceId: resource.id,
    userId,
    expireAt,
    tokenFactory
  });

  const action = distribution ? 'reset' : 'created';
  logger.info(`获取下载链接成功: 用户 ${userId}, 资源 ${resource.id}, 动作 ${action}, 清理重复 ${result.removed_duplicates} 条`);
  return {
    download_url: buildDownloadUrl(siteBaseUrl, result.download_token),
    expire_at: expireAt,
    resource_name: resource.name,
    action,
    removed_duplicates: result.removed_duplicates
  };
}

module.exports = {
  DOWNLOAD_RESOURCE_KEYWORD,
  getOrCreateDownloadLink
};
