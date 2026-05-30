/**
 * 管理员仓储。
 * 负责 admin auth 模块涉及的 admins 表读写，
 * 避免 route/controller/service 直接写 SQL。
 */

/**
 * 根据用户名查询管理员。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} username - 管理员用户名
 * @returns {Promise<Object|undefined>} 管理员记录
 */
async function findAdminByUsername(db, username) {
  return db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
}

/**
 * 根据 ID 查询管理员。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} adminId - 管理员 ID
 * @returns {Promise<Object|undefined>} 管理员记录
 */
async function findAdminById(db, adminId) {
  return db.prepare('SELECT * FROM admins WHERE id = ?').get(adminId);
}

/**
 * 更新管理员密码哈希。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} adminId - 管理员 ID
 * @param {string} passwordHash - 新密码哈希
 * @returns {Promise<void>}
 */
async function updateAdminPasswordHash(db, adminId, passwordHash) {
  await db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(passwordHash, adminId);
}

module.exports = {
  findAdminByUsername,
  findAdminById,
  updateAdminPasswordHash
};
