const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const config = require('../../config');
const adminRepository = require('../../repositories/admin-repository');

/**
 * 管理端认证服务。
 * 负责管理员登录、修改密码等业务规则与 JWT 编排，
 * 保持旧接口的错误码与响应语义兼容。
 */

/**
 * 构造兼容旧接口的业务异常。
 *
 * @param {string} message - 错误消息
 * @param {Object} [options] - 扩展配置
 * @returns {Error} 兼容旧接口的业务异常
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
 * 管理员登录。
 *
 * @param {Object} db - 数据库代理对象
 * @param {{username:string,password:string}} payload - 登录参数
 * @returns {Promise<Object>} 旧接口兼容的登录返回结构
 */
async function login(db, payload) {
  const { username, password } = payload;
  const admin = await adminRepository.findAdminByUsername(db, username);

  if (!admin) {
    throw createLegacyBusinessError('用户名或密码错误', {
      code: 2002
    });
  }

  const isValidPassword = await bcrypt.compare(password, admin.password_hash);
  if (!isValidPassword) {
    throw createLegacyBusinessError('用户名或密码错误', {
      code: 2002
    });
  }

  const token = jwt.sign(
    {
      id: admin.id,
      username: admin.username,
      is_super: admin.is_super
    },
    config.admin.jwtSecret,
    { expiresIn: config.admin.jwtExpiresIn }
  );

  return {
    token,
    expires_in: 7200,
    admin: {
      id: admin.id,
      username: admin.username,
      is_super: admin.is_super
    }
  };
}

/**
 * 修改管理员密码。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} adminId - 当前管理员 ID
 * @param {{old_password:string,new_password:string}} payload - 修改密码参数
 * @returns {Promise<{message:string}>} 旧接口兼容的返回结构
 */
async function updatePassword(db, adminId, payload) {
  const { old_password: oldPassword, new_password: newPassword } = payload;
  const admin = await adminRepository.findAdminById(db, adminId);

  if (!admin) {
    throw createLegacyBusinessError('管理员不存在', {
      code: 2002
    });
  }

  const isValidPassword = await bcrypt.compare(oldPassword, admin.password_hash);
  if (!isValidPassword) {
    throw createLegacyBusinessError('原密码错误', {
      code: 2002
    });
  }

  const newPasswordHash = await bcrypt.hash(newPassword, config.security.bcryptRounds);
  await adminRepository.updateAdminPasswordHash(db, adminId, newPasswordHash);

  return {
    message: '密码修改成功，请重新登录'
  };
}

module.exports = {
  login,
  updatePassword
};
