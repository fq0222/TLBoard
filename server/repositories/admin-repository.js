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
 * 查询管理员列表。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Array>} 管理员列表
 */
async function listAdmins(db) {
  return db.prepare(`
    SELECT id, username, is_super, created_at
    FROM admins
    ORDER BY created_at DESC
  `).all();
}

/**
 * 创建管理员账号。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 管理员写入参数
 * @returns {Promise<Object>} 插入结果
 */
async function createAdmin(db, payload) {
  const {
    username,
    passwordHash,
    isSuper
  } = payload;

  return db.prepare(`
    INSERT INTO admins (username, password_hash, is_super)
    VALUES (?, ?, ?)
  `).run(username, passwordHash, isSuper);
}

/**
 * 删除管理员账号。
 *
 * @param {Object} db - 数据库实例
 * @param {number} adminId - 管理员 ID
 * @returns {Promise<void>}
 */
async function deleteAdmin(db, adminId) {
  await db.prepare('DELETE FROM admins WHERE id = ?').run(adminId);
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
  listAdmins,
  findAdminByUsername,
  findAdminById,
  createAdmin,
  deleteAdmin,
  updateAdminPasswordHash
};
