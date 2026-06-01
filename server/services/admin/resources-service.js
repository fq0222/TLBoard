const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { parsePagination } = require('../../shared/utils/pagination');
const { getUnixTimestamp } = require('../../shared/utils/time');
const { createLogger } = require('../../utils/logger');
const resourcesRepository = require('../../repositories/resources-repository');
const { upsertUserDistribution } = require('../shared/resource-distribution-service');

const logger = createLogger('ADMIN-RESOURCES');

const DEFAULT_RESOURCE_CONFIG = {
  max_file_size: 100,
  download_speed_limit: 0
};

/**
 * 管理端资源服务。
 * 负责资源配置、上传记录、分发记录等业务规则，并保持旧接口语义不变。
 */

/**
 * 构造兼容旧接口的业务错误。
 *
 * @param {string} message - 错误消息
 * @param {Object} [options] - 错误扩展参数
 * @param {number} [options.statusCode] - HTTP 状态码
 * @param {number} [options.code] - 业务码
 * @param {*} [options.data] - 响应 data
 * @returns {Error} 业务异常对象
 */
function createLegacyBusinessError(message, options = {}) {
  const error = new Error(message);
  error.isLegacyBusinessError = true;
  error.statusCode = options.statusCode || 400;
  error.code = options.code || 1001;
  error.data = options.data === undefined ? null : options.data;
  return error;
}

/**
 * 生成下载 token。
 *
 * @returns {string} 32 位十六进制 token
 */
function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * 规范化可选过期时间戳，兼容旧接口可能传入的 null / 空字符串。
 *
 * @param {*} expireAt - 原始过期时间
 * @returns {number|null} 规范化后的时间戳
 */
function normalizeOptionalExpireAt(expireAt) {
  if (expireAt === undefined || expireAt === null || expireAt === '') {
    return null;
  }

  const parsedExpireAt = Number(expireAt);
  if (!Number.isInteger(parsedExpireAt) || parsedExpireAt < 0) {
    throw createLegacyBusinessError('过期时间必须是时间戳');
  }

  return parsedExpireAt;
}

/**
 * 规范化资源分发的 ID 列表，过滤重复值并拦截非法输入。
 *
 * @param {Array<*>} ids - 原始 ID 列表
 * @param {string} emptyMessage - 空列表时的报错消息
 * @param {string} invalidMessage - 非法值时的报错消息
 * @returns {Array<number>} 去重后的 ID 列表
 */
function normalizePositiveIntegerIds(ids, emptyMessage, invalidMessage) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw createLegacyBusinessError(emptyMessage);
  }

  const normalizedIds = [];
  const seenIds = new Set();

  for (const id of ids) {
    const parsedId = Number(id);
    if (!Number.isInteger(parsedId) || parsedId < 1) {
      throw createLegacyBusinessError(invalidMessage);
    }

    if (seenIds.has(parsedId)) {
      continue;
    }

    seenIds.add(parsedId);
    normalizedIds.push(parsedId);
  }

  return normalizedIds;
}

/**
 * 规范化分发过期分钟数，兼容旧接口省略该字段时“不设置过期时间”。
 *
 * @param {*} expireMinutes - 原始过期分钟数
 * @returns {number|null} 规范化后的分钟数
 */
function normalizeExpireMinutes(expireMinutes) {
  if (expireMinutes === undefined || expireMinutes === null || expireMinutes === '') {
    return null;
  }

  const parsedExpireMinutes = Number(expireMinutes);
  if (!Number.isInteger(parsedExpireMinutes) || parsedExpireMinutes < 1) {
    throw createLegacyBusinessError('过期时间必须是大于0的整数');
  }

  return parsedExpireMinutes;
}

/**
 * 规范化下载资源分类。
 * @param {*} category - 管理端传入的分类文本
 * @returns {string} 去除空白后的分类，空值归入“其他”
 */
function normalizeDownloadCategory(category) {
  const normalizedCategory = String(category || '').trim();
  return normalizedCategory || '其他';
}

/**
 * 校验资源是否存在。
 *
 * @param {Object} db - 数据库实例
 * @param {number} resourceId - 资源 ID
 * @returns {Promise<Object>} 资源记录
 */
async function requireResource(db, resourceId) {
  const resource = await resourcesRepository.findResourceById(db, resourceId);
  if (!resource) {
    throw createLegacyBusinessError('资源不存在');
  }

  return resource;
}

/**
 * 校验一批用户是否存在，避免事务内出现“部分成功后才发现非法用户”。
 *
 * @param {Object} db - 数据库实例
 * @param {Array<number>} userIds - 用户 ID 列表
 * @returns {Promise<void>}
 */
async function requireExistingUsers(db, userIds) {
  const users = await resourcesRepository.findUsersByIds(db, userIds);
  const existingUserIds = new Set(users.map(user => Number(user.id)));
  const missingUserIds = userIds.filter(userId => !existingUserIds.has(userId));

  if (missingUserIds.length > 0) {
    throw createLegacyBusinessError(`以下用户不存在: ${missingUserIds.join(',')}`);
  }
}

async function getResourceConfig(db) {
  const configRow = await resourcesRepository.getResourceConfigRow(db);
  if (!configRow) {
    return DEFAULT_RESOURCE_CONFIG;
  }

  return JSON.parse(configRow.value);
}

async function saveResourceConfig(db, payload) {
  const config = {
    max_file_size: parseInt(payload.max_file_size, 10),
    download_speed_limit: parseInt(payload.download_speed_limit, 10)
  };

  await resourcesRepository.saveResourceConfig(
    db,
    JSON.stringify(config),
    getUnixTimestamp()
  );

  logger.info(`保存资源配置成功: ${JSON.stringify(config)}`);
  return config;
}

async function getResourceList(db, query) {
  const { page, limit, offset } = parsePagination(query, {
    defaultPage: 1,
    defaultLimit: 20,
    maxLimit: 100
  });
  const totalRow = await resourcesRepository.countResources(db);
  const list = await resourcesRepository.listResources(db, limit, offset);

  logger.info(`获取资源列表成功，共 ${list.length} 条`);
  return {
    total: totalRow.count,
    page,
    limit,
    list
  };
}

async function createUploadedResource(db, file, customName) {
  const name = customName || path.parse(file.originalname).name;
  const result = await resourcesRepository.createResource(db, {
    name,
    filename: file.filename,
    originalName: file.originalname,
    size: file.size,
    mimetype: file.mimetype,
    filePath: file.path,
    downloadToken: generateToken()
  });

  const resource = await resourcesRepository.findResourceById(db, result.lastInsertRowid);
  logger.info(`上传文件成功: ${file.originalname} (ID: ${result.lastInsertRowid})`);
  return resource;
}

async function updateResource(db, resourceId, payload) {
  await requireResource(db, resourceId);

  const updates = [];
  const values = [];
  const nextIsDownloadResource = payload.is_download_resource !== undefined
    ? Boolean(payload.is_download_resource)
    : undefined;

  if (payload.name !== undefined) {
    updates.push('name = ?');
    values.push(payload.name);
  }

  if (payload.enabled !== undefined) {
    updates.push('enabled = ?');
    values.push(payload.enabled ? 1 : 0);
  }

  if (payload.is_download_resource !== undefined) {
    updates.push('is_download_resource = ?');
    values.push(nextIsDownloadResource ? 1 : 0);
  }

  if (payload.download_category !== undefined || nextIsDownloadResource === true) {
    updates.push('download_category = ?');
    values.push(normalizeDownloadCategory(payload.download_category));
  }

  if (updates.length === 0) {
    throw createLegacyBusinessError('没有要更新的字段');
  }

  updates.push('updated_at = ?');
  values.push(getUnixTimestamp());

  await resourcesRepository.updateResourceFields(db, resourceId, updates, values);
  const resource = await resourcesRepository.findResourceById(db, resourceId);
  logger.info(`更新资源成功: ${resource.name} (ID: ${resourceId})`);
  return resource;
}

async function removeResource(db, resourceId) {
  const resource = await requireResource(db, resourceId);

  if (fs.existsSync(resource.path)) {
    fs.unlinkSync(resource.path);
    logger.info(`删除文件: ${resource.path}`);
  }

  await resourcesRepository.deleteResource(db, resourceId);
  logger.info(`删除资源成功: ${resource.name} (ID: ${resourceId})`);

  return {
    message: '资源已删除'
  };
}

async function refreshResourceToken(db, resourceId) {
  await requireResource(db, resourceId);

  await resourcesRepository.updateResourceFields(
    db,
    resourceId,
    ['download_token = ?', 'updated_at = ?'],
    [generateToken(), getUnixTimestamp()]
  );

  const resource = await resourcesRepository.findResourceById(db, resourceId);
  logger.info(`刷新 token 成功: ${resource.name} (ID: ${resourceId})`);
  return resource;
}

async function setResourceExpireAt(db, resourceId, expireAt) {
  const normalizedExpireAt = normalizeOptionalExpireAt(expireAt);
  await requireResource(db, resourceId);

  await resourcesRepository.updateResourceFields(
    db,
    resourceId,
    ['expire_at = ?', 'updated_at = ?'],
    [normalizedExpireAt, getUnixTimestamp()]
  );

  const resource = await resourcesRepository.findResourceById(db, resourceId);
  logger.info(`设置过期时间成功: ${resource.name} (ID: ${resourceId}, expire_at: ${normalizedExpireAt})`);
  return resource;
}

async function distributeResource(db, resourceId, userIds, expireMinutes) {
  const normalizedUserIds = normalizePositiveIntegerIds(
    userIds,
    '用户ID列表不能为空',
    '用户ID列表包含非法值'
  );
  const normalizedExpireMinutes = normalizeExpireMinutes(expireMinutes);

  const runInTransaction = db.transaction(async (transactionDb) => {
    await requireResource(transactionDb, resourceId);
    await requireExistingUsers(transactionDb, normalizedUserIds);

    const expireAt = normalizedExpireMinutes === null
      ? null
      : getUnixTimestamp() + (normalizedExpireMinutes * 60);
    const distributions = [];
    let removedDuplicateCount = 0;

    for (const userId of normalizedUserIds) {
      const result = await upsertUserDistribution({
        db: transactionDb,
        resourceId,
        userId,
        expireAt,
        tokenFactory: generateToken
      });

      removedDuplicateCount += result.removed_duplicates;
      distributions.push({
        user_id: userId,
        distribution_id: result.distribution_id,
        action: result.action
      });
    }

    return {
      distributions,
      removedDuplicateCount
    };
  });

  const result = await runInTransaction();
  logger.info(
    `分发资源成功: 资源ID ${resourceId}, 用户数 ${result.distributions.length}, 清理重复记录 ${result.removedDuplicateCount} 条`
  );

  return {
    resource_id: resourceId,
    distributions: result.distributions
  };
}

async function getResourceDistributions(db, resourceId) {
  const distributions = await resourcesRepository.listResourceDistributions(db, resourceId);
  logger.info(`获取分发列表成功: 资源ID ${resourceId}, 共 ${distributions.length} 条`);
  return distributions;
}

async function batchExpireDistributions(db, ids, expireMinutes) {
  const distributionIds = normalizePositiveIntegerIds(
    ids,
    'ID列表不能为空',
    'ID列表包含非法值'
  );
  const expireAt = getUnixTimestamp() + (expireMinutes * 60);
  await resourcesRepository.batchUpdateDistributionExpireAt(db, distributionIds, expireAt);

  logger.info(`批量设置过期时间成功: ${distributionIds.length} 条记录`);
  return {
    updated_count: distributionIds.length
  };
}

async function removeDistribution(db, distributionId) {
  await resourcesRepository.deleteDistribution(db, distributionId);
  logger.info(`删除分发记录成功: ID ${distributionId}`);

  return {
    message: '分发记录已删除'
  };
}

module.exports = {
  getResourceConfig,
  saveResourceConfig,
  getResourceList,
  createUploadedResource,
  updateResource,
  removeResource,
  refreshResourceToken,
  setResourceExpireAt,
  distributeResource,
  getResourceDistributions,
  batchExpireDistributions,
  removeDistribution
};
