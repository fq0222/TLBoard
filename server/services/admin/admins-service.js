const bcrypt = require('bcrypt');
const config = require('../../config');
const adminRepository = require('../../repositories/admin-repository');

/**
 * 管理端管理员管理服务。
 * 负责管理员列表、创建、删除等业务规则，并保持旧接口语义兼容。
 */

function createLegacyBusinessError(message, options = {}) {
  const error = new Error(message);
  error.isLegacyBusinessError = true;
  error.statusCode = options.statusCode || 400;
  error.code = options.code || 1001;
  error.data = options.data === undefined ? null : options.data;
  return error;
}

async function listAdmins(db) {
  return {
    list: await adminRepository.listAdmins(db)
  };
}

/**
 * 创建管理员账号。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 创建参数
 * @returns {Promise<Object>} 新建管理员
 */
async function createAdmin(db, payload) {
  const { username, password } = payload;
  const isSuper = payload.is_super ? 1 : 0;
  const existingAdmin = await adminRepository.findAdminByUsername(db, username);

  if (existingAdmin) {
    throw createLegacyBusinessError('用户名已存在', {
      code: 2001
    });
  }

  const passwordHash = await bcrypt.hash(password, config.security.bcryptRounds);
  const result = await adminRepository.createAdmin(db, {
    username,
    passwordHash,
    isSuper
  });

  return {
    id: result.lastInsertRowid,
    username,
    is_super: isSuper,
    created_at: Math.floor(Date.now() / 1000)
  };
}

/**
 * 删除管理员账号。
 *
 * @param {Object} db - 数据库实例
 * @param {number} adminId - 目标管理员 ID
 * @param {number} currentAdminId - 当前管理员 ID
 * @returns {Promise<Object>} 删除结果
 */
async function deleteAdmin(db, adminId, currentAdminId) {
  if (adminId === currentAdminId) {
    throw createLegacyBusinessError('不能删除自己的账号', {
      code: 1004
    });
  }

  const admin = await adminRepository.findAdminById(db, adminId);
  if (!admin) {
    throw createLegacyBusinessError('管理员不存在', {
      code: 1004
    });
  }

  await adminRepository.deleteAdmin(db, adminId);
  return {
    message: '管理员已删除'
  };
}

module.exports = {
  listAdmins,
  createAdmin,
  deleteAdmin
};
