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
  findDistributionDownloadByToken,
  findResourceDownloadByToken,
  findResourceById,
  incrementDistributionDownloadCount,
  incrementResourceDownloadCount
};
