const userRepository = require('../../repositories/user-repository');

/**
 * 用户端同步状态服务。
 * 负责查询当前用户的 sync_status，并保持旧接口错误语义兼容。
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
 * 查询当前用户同步状态。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @returns {Promise<Object>} 同步状态结果
 */
async function getSyncStatus(db, userId) {
  const user = await userRepository.findUserSyncStatusById(db, userId);
  if (!user) {
    throw createLegacyBusinessError('用户不存在', {
      code: 2004
    });
  }

  return {
    sync_status: user.sync_status
  };
}

module.exports = {
  getSyncStatus
};
