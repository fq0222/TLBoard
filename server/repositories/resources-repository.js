/**
 * 资源仓储。
 * 负责 resources 与 resource_distributions 的数据库访问。
 */

async function countResources(db) {
  return db.prepare('SELECT COUNT(*) as count FROM resources').get();
}

async function listResources(db, limit, offset) {
  return db.prepare(`
    SELECT id, name, filename, original_name, size, mimetype, download_token,
           expire_at, download_count, enabled, is_download_resource, download_category,
           created_at, updated_at
    FROM resources
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

async function findResourceById(db, resourceId) {
  return db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);
}

/**
 * 新建资源记录。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} resourceData - 资源写入数据
 * @returns {Promise<Object>} 插入结果
 */
async function createResource(db, resourceData) {
  const {
    name,
    filename,
    originalName,
    size,
    mimetype,
    filePath,
    downloadToken
  } = resourceData;

  return db.prepare(`
    INSERT INTO resources (name, filename, original_name, size, mimetype, path, download_token)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    filename,
    originalName,
    size,
    mimetype,
    filePath,
    downloadToken
  );
}

/**
 * 更新资源字段。
 * 由 service 决定更新哪些字段，repository 只负责执行 SQL。
 *
 * @param {Object} db - 数据库实例
 * @param {number} resourceId - 资源 ID
 * @param {Array<string>} updates - 更新表达式列表
 * @param {Array<*>} values - 更新值列表
 * @returns {Promise<void>}
 */
async function updateResourceFields(db, resourceId, updates, values) {
  await db.prepare(`UPDATE resources SET ${updates.join(', ')} WHERE id = ?`).run(...values, resourceId);
}

async function deleteResource(db, resourceId) {
  await db.prepare('DELETE FROM resources WHERE id = ?').run(resourceId);
}

async function listResourceDistributions(db, resourceId) {
  return db.prepare(`
    SELECT *
    FROM (
      SELECT DISTINCT ON (rd.user_id) rd.*, u.email
      FROM resource_distributions rd
      LEFT JOIN users u ON rd.user_id = u.id
      WHERE rd.resource_id = ?
      ORDER BY rd.user_id, rd.created_at DESC, rd.id DESC
    ) latest
    ORDER BY latest.created_at DESC
  `).all(resourceId);
}

async function batchUpdateDistributionExpireAt(db, ids, expireAt) {
  await db.prepare(
    'UPDATE resource_distributions SET expire_at = ? WHERE id = ANY(?)'
  ).run(expireAt, ids);
}

async function deleteDistribution(db, distributionId) {
  await db.prepare('DELETE FROM resource_distributions WHERE id = ?').run(distributionId);
}

/**
 * 查询一批用户是否存在，用于分发前的原子性校验。
 *
 * @param {Object} db - 数据库实例
 * @param {Array<number>} userIds - 用户 ID 列表
 * @returns {Promise<Array<{id:number,email:string}>>} 已存在的用户记录
 */
async function findUsersByIds(db, userIds) {
  return db.prepare(`
    SELECT id, email
    FROM users
    WHERE id = ANY(?)
  `).all(userIds);
}

/**
 * 查询用户当前的资源分发记录，按最新记录优先。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @returns {Promise<Array>} 分发记录列表
 */
async function findUserDistributions(db, userId) {
  return db.prepare(`
    SELECT rd.*, r.name as resource_name, r.enabled as resource_enabled
    FROM resource_distributions rd
    LEFT JOIN resources r ON rd.resource_id = r.id
    WHERE rd.user_id = ?
    ORDER BY rd.created_at DESC, rd.id DESC
  `).all(userId);
}

/**
 * 批量删除分发记录，供去重流程复用。
 *
 * @param {Object} db - 数据库实例
 * @param {Array<number>} distributionIds - 分发记录 ID 列表
 * @returns {Promise<void>}
 */
async function deleteDistributionsByIds(db, distributionIds) {
  await db.prepare('DELETE FROM resource_distributions WHERE id = ANY(?)').run(distributionIds);
}

/**
 * 更新既有分发记录。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 更新参数
 * @param {number} payload.distributionId - 分发记录 ID
 * @param {number} payload.resourceId - 资源 ID
 * @param {string} payload.downloadToken - 下载令牌
 * @param {number|null} payload.expireAt - 过期时间戳
 * @returns {Promise<void>}
 */
async function updateDistribution(db, payload) {
  const {
    distributionId,
    resourceId,
    downloadToken,
    expireAt
  } = payload;

  await db.prepare(`
    UPDATE resource_distributions
    SET resource_id = ?, download_token = ?, expire_at = ?, enabled = 1, download_count = 0
    WHERE id = ?
  `).run(resourceId, downloadToken, expireAt, distributionId);
}

/**
 * 创建新的资源分发记录。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 创建参数
 * @param {number} payload.resourceId - 资源 ID
 * @param {number} payload.userId - 用户 ID
 * @param {string} payload.downloadToken - 下载令牌
 * @param {number|null} payload.expireAt - 过期时间戳
 * @returns {Promise<Object>} 插入结果
 */
async function createDistribution(db, payload) {
  const {
    resourceId,
    userId,
    downloadToken,
    expireAt
  } = payload;

  return db.prepare(`
    INSERT INTO resource_distributions (resource_id, user_id, download_token, expire_at)
    VALUES (?, ?, ?, ?)
  `).run(resourceId, userId, downloadToken, expireAt);
}

module.exports = {
  countResources,
  listResources,
  findResourceById,
  createResource,
  updateResourceFields,
  deleteResource,
  listResourceDistributions,
  batchUpdateDistributionExpireAt,
  deleteDistribution,
  findUsersByIds,
  findUserDistributions,
  deleteDistributionsByIds,
  updateDistribution,
  createDistribution
};
