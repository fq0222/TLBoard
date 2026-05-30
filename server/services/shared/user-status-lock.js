const crypto = require('crypto');

/**
 * 用户启用状态互斥锁辅助
 *
 * 续费解禁、超量禁用和重试任务都会修改同一个用户的 enabled 状态。
 * 这里统一使用 userId 级 PostgreSQL advisory lock，避免多个流程并发覆盖状态。
 */

/**
 * 根据 userId 生成稳定的 advisory lock key
 * @param {number|string} userId - 用户 ID
 * @returns {number} PostgreSQL advisory lock key
 */
function buildUserStatusLockKey(userId) {
  const hex = crypto.createHash('sha1').update(`user-status:${userId}`).digest('hex').slice(0, 15);
  return parseInt(hex, 16);
}

/**
 * 在 userId 级互斥锁内执行状态迁移逻辑
 * @param {Object} db - 数据库实例
 * @param {number|string} userId - 用户 ID
 * @param {Function} handler - 持锁执行的异步逻辑
 * @returns {Promise<Object>} handler 返回结果，或锁获取失败时的 retryable 结果
 */
async function withUserStatusLock(db, userId, handler) {
  const lockKey = buildUserStatusLockKey(userId);
  const result = await db.prepare('SELECT pg_try_advisory_lock($1) AS locked').get(lockKey);

  if (!result || !result.locked) {
    return {
      success: false,
      retryable: true,
      message: `failed to acquire user status lock: ${userId}`
    };
  }

  try {
    return await handler();
  } finally {
    await db.prepare('SELECT pg_advisory_unlock($1) AS unlocked').get(lockKey);
  }
}

module.exports = {
  buildUserStatusLockKey,
  withUserStatusLock
};
