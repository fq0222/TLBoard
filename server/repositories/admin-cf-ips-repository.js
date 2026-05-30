/**
 * 管理端 CF IP 池仓储。
 * 负责 cf_ip_pool 的列表、增删改查与导入相关 SQL 访问。
 */

async function countCfIps(db) {
  return db.prepare('SELECT COUNT(*) as total FROM cf_ip_pool').get();
}

/**
 * 分页查询 CF IP 列表。
 *
 * @param {Object} db - 数据库实例
 * @param {number} limit - 分页条数
 * @param {number} offset - 分页偏移
 * @returns {Promise<Array>} IP 列表
 */
async function listCfIps(db, limit, offset) {
  return db.prepare(`
    SELECT id, ip, enabled, created_at
    FROM cf_ip_pool
    ORDER BY id ASC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

/**
 * 根据 IP 地址查询 IP 记录。
 *
 * @param {Object} db - 数据库实例
 * @param {string} ip - IP 地址
 * @returns {Promise<Object|undefined>} IP 记录
 */
async function findCfIpByIp(db, ip) {
  return db.prepare('SELECT * FROM cf_ip_pool WHERE ip = ?').get(ip);
}

/**
 * 根据 ID 查询 IP 记录。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ipId - IP 记录 ID
 * @returns {Promise<Object|undefined>} IP 记录
 */
async function findCfIpById(db, ipId) {
  return db.prepare('SELECT * FROM cf_ip_pool WHERE id = ?').get(ipId);
}

/**
 * 创建 IP 记录。
 *
 * @param {Object} db - 数据库实例
 * @param {string} ip - IP 地址
 * @param {number} enabled - 启用状态
 * @returns {Promise<Object>} 插入结果
 */
async function createCfIp(db, ip, enabled) {
  return db.prepare('INSERT INTO cf_ip_pool (ip, enabled) VALUES (?, ?)').run(ip, enabled);
}

/**
 * 按动态字段更新 IP 记录。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ipId - IP 记录 ID
 * @param {Array<string>} updates - 更新语句片段
 * @param {Array<*>} values - 绑定参数
 * @returns {Promise<void>}
 */
async function updateCfIpFields(db, ipId, updates, values) {
  await db.prepare(`UPDATE cf_ip_pool SET ${updates.join(', ')} WHERE id = ?`).run(...values, ipId);
}

/**
 * 删除 IP 记录。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ipId - IP 记录 ID
 * @returns {Promise<void>}
 */
async function deleteCfIp(db, ipId) {
  await db.prepare('DELETE FROM cf_ip_pool WHERE id = ?').run(ipId);
}

module.exports = {
  countCfIps,
  listCfIps,
  findCfIpByIp,
  findCfIpById,
  createCfIp,
  updateCfIpFields,
  deleteCfIp
};
