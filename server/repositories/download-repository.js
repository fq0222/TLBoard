/**
 * 下载仓储。
 * 负责下载链路涉及的 resources、resource_distributions 与 system_settings 数据访问。
 */

async function getResourceConfigRow(db) {
  return db.prepare("SELECT value FROM system_settings WHERE key = 'resource_config'").get();
}

/**
 * 查询最新可用的下载资源。
 *
 * @param {Object} db - 数据库实例
 * @param {string} keyword - 资源名称关键字
 * @returns {Promise<Object|undefined>} 资源记录
 */
async function findLatestEnabledResourceByKeyword(db, keyword) {
  return db.prepare(`
    SELECT *
    FROM resources
    WHERE enabled = 1 AND name LIKE ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(`%${keyword}%`);
}

/**
 * 查询用户端帮助页可展示的下载资源列表。
 * @param {Object} db - 数据库实例
 * @param {number} now - 当前时间戳，用于过滤已过期资源
 * @returns {Promise<Array>} 可下载资源列表
 */
async function listDownloadResources(db, now) {
  return db.prepare(`
    SELECT id, name, size, download_category
    FROM resources
    WHERE enabled = 1
      AND is_download_resource = 1
      AND (expire_at IS NULL OR expire_at > ?)
    ORDER BY download_category ASC, created_at DESC, id DESC
  `).all(now);
}

/**
 * 按资源 ID 查询可生成用户下载链接的资源。
 * @param {Object} db - 数据库实例
 * @param {number} resourceId - 资源 ID
 * @param {number} now - 当前时间戳，用于过滤已过期资源
 * @returns {Promise<Object|undefined>} 可下载资源记录
 */
async function findDownloadResourceById(db, resourceId, now) {
  return db.prepare(`
    SELECT *
    FROM resources
    WHERE id = ?
      AND enabled = 1
      AND is_download_resource = 1
      AND (expire_at IS NULL OR expire_at > ?)
    LIMIT 1
  `).get(resourceId, now);
}

/**
 * 按 token 查询分发下载记录。
 *
 * @param {Object} db - 数据库实例
 * @param {string} token - 下载 token
 * @returns {Promise<Object|undefined>} 分发记录
 */
async function findDistributionDownloadByToken(db, token) {
  return db.prepare(`
    SELECT rd.*, r.name, r.filename, r.original_name, r.size, r.mimetype, r.path
    FROM resource_distributions rd
    JOIN resources r ON rd.resource_id = r.id
    WHERE rd.download_token = ?
  `).get(token);
}

/**
 * 按 token 查询全局资源下载记录。
 *
 * @param {Object} db - 数据库实例
 * @param {string} token - 下载 token
 * @returns {Promise<Object|undefined>} 资源记录
 */
async function findResourceDownloadByToken(db, token) {
  return db.prepare('SELECT * FROM resources WHERE download_token = ?').get(token);
}

/**
 * 根据资源 ID 查询资源记录。
 *
 * @param {Object} db - 数据库实例
 * @param {number} resourceId - 资源 ID
 * @returns {Promise<Object|undefined>} 资源记录
 */
async function findResourceById(db, resourceId) {
  return db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);
}

/**
 * 增加分发记录下载次数。
 *
 * @param {Object} db - 数据库实例
 * @param {number} distributionId - 分发记录 ID
 * @returns {Promise<void>}
 */
async function incrementDistributionDownloadCount(db, distributionId) {
  await db.prepare('UPDATE resource_distributions SET download_count = download_count + 1 WHERE id = ?')
    .run(distributionId);
}

/**
 * 增加资源记录下载次数。
 *
 * @param {Object} db - 数据库实例
 * @param {number} resourceId - 资源 ID
 * @returns {Promise<void>}
 */
async function incrementResourceDownloadCount(db, resourceId) {
  await db.prepare('UPDATE resources SET download_count = download_count + 1 WHERE id = ?').run(resourceId);
}

module.exports = {
  getResourceConfigRow,
  findLatestEnabledResourceByKeyword,
  listDownloadResources,
  findDownloadResourceById,
  findDistributionDownloadByToken,
  findResourceDownloadByToken,
  findResourceById,
  incrementDistributionDownloadCount,
  incrementResourceDownloadCount
};
