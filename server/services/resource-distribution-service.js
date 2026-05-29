/**
 * 资源分发服务。
 * 统一处理 resource_distributions 表的创建、更新和去重逻辑。
 */

const resourcesRepository = require('../repositories/resources-repository');
const { createLogger } = require('../utils/logger');

const logger = createLogger('RESOURCE-DISTRIBUTION');

/**
 * 获取用户的所有分发记录。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @returns {Promise<Array>} 按创建时间倒序排列的分发记录
 */
async function findUserDistributions(db, userId) {
  return resourcesRepository.findUserDistributions(db, userId);
}

/**
 * 清理同一用户的历史重复分发记录。
 *
 * @param {Object} db - 数据库实例
 * @param {Array} distributions - 已按新到旧排序的分发记录
 * @returns {Promise<number>} 删除的重复记录数
 */
async function removeDuplicateDistributions(db, distributions) {
  const duplicateIds = distributions.slice(1).map(item => item.id);
  if (duplicateIds.length === 0) {
    return 0;
  }

  await resourcesRepository.deleteDistributionsByIds(db, duplicateIds);
  const userId = distributions[0]?.user_id || 'unknown';
  logger.info(`清理重复分发记录: 用户 ${userId}, 删除 ${duplicateIds.length} 条, IDs: ${duplicateIds.join(',')}`);
  return duplicateIds.length;
}

/**
 * 以 user_id 为唯一分发维度写入分发记录。
 * 已存在记录时更新同一条记录，并清理历史重复记录；不存在时创建新记录。
 *
 * @param {Object} options - 分发参数
 * @param {Object} options.db - 数据库实例
 * @param {number} options.resourceId - 资源 ID
 * @param {number} options.userId - 用户 ID
 * @param {number|null} options.expireAt - 过期时间戳
 * @param {Function} options.tokenFactory - 下载 token 生成函数
 * @returns {Promise<Object>} 分发结果
 */
async function upsertUserDistribution(options) {
  const {
    db,
    resourceId,
    userId,
    expireAt,
    tokenFactory
  } = options;

  const distributions = await findUserDistributions(db, userId);
  const existing = distributions[0];
  const removedDuplicates = await removeDuplicateDistributions(db, distributions);
  const token = tokenFactory();

  if (existing) {
    await resourcesRepository.updateDistribution(db, {
      distributionId: existing.id,
      resourceId,
      downloadToken: token,
      expireAt
    });

    logger.info(`更新用户分发记录: 用户 ${userId}, 分发ID ${existing.id}, 资源 ${resourceId}, 清理重复 ${removedDuplicates} 条`);
    return {
      distribution_id: existing.id,
      download_token: token,
      action: 'updated',
      removed_duplicates: removedDuplicates
    };
  }

  const result = await resourcesRepository.createDistribution(db, {
    resourceId,
    userId,
    downloadToken: token,
    expireAt
  });

  logger.info(`创建用户分发记录: 用户 ${userId}, 分发ID ${result.lastInsertRowid}, 资源 ${resourceId}`);
  return {
    distribution_id: result.lastInsertRowid,
    download_token: token,
    action: 'created',
    removed_duplicates: 0
  };
}

module.exports = {
  findUserDistributions,
  removeDuplicateDistributions,
  upsertUserDistribution
};
