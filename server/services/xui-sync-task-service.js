/**
 * 3X-UI 同步任务队列服务
 *
 * 用于持久化注册、续费、启用/禁用等 3X-UI 同步动作。
 * 任务失败后不会丢失，而是按退避时间写回 pending 状态，等待 worker 再次处理。
 */

const { createLogger } = require('../utils/logger');
const xuiSyncRepository = require('../repositories/xui-sync-repository');

const logger = createLogger('XUI-SYNC-TASK');

const TASK_TYPES = {
  INITIAL_USER_SYNC: 'initial_user_sync',
  RENEW_SYNC: 'renew_sync',
  USER_SYNC: 'user_sync',
  ENABLE_SYNC: 'enable_sync',
  DISABLE_SYNC: 'disable_sync'
};

const TASK_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SUCCESS: 'success',
  FAILED: 'failed'
};

const RETRY_DELAYS = [60, 5 * 60, 15 * 60, 60 * 60, 4 * 60 * 60];

const USER_SYNC_TASK_TYPES = [
  TASK_TYPES.INITIAL_USER_SYNC,
  TASK_TYPES.RENEW_SYNC,
  TASK_TYPES.USER_SYNC
];

/**
 * 判断是否为用户资料同步类任务
 * @param {string} taskType - 任务类型
 * @returns {boolean}
 */
function isUserSyncTaskType(taskType) {
  return USER_SYNC_TASK_TYPES.includes(taskType);
}

/**
 * 根据失败次数获取下一次重试延迟
 * @param {number} attempts - 已失败次数
 * @returns {number} 延迟秒数
 */
function getRetryDelaySeconds(attempts) {
  const index = Math.max(0, Math.min(attempts - 1, RETRY_DELAYS.length - 1));
  return RETRY_DELAYS[index];
}

/**
 * 解析任务 payload，避免坏数据影响 worker 主循环
 * @param {string|Object|null} payload - 数据库中保存的 payload
 * @returns {Object} payload 对象
 */
function parsePayload(payload) {
  if (!payload) return {};
  if (typeof payload === 'object') return payload;
  try {
    return JSON.parse(payload);
  } catch (error) {
    return {};
  }
}

/**
 * 将同一用户旧的 pending 用户同步任务标记为已取代
 *
 * 用户续费会生成新的同步任务，旧任务的 payload 可能包含旧流量上限。
 * 在新任务入队前关闭旧 pending 任务，避免后续按旧快照重复同步。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {string} reason - 取代原因
 * @returns {Promise<number>} 被标记的任务数量
 */
async function supersedePendingUserSyncTasks(db, userId, reason = '已被新的用户同步任务取代') {
  if (!userId) return 0;

  const now = Math.floor(Date.now() / 1000);
  const result = await xuiSyncRepository.supersedePendingUserSyncTasks(db, userId, reason, now);

  if (result.changes > 0) {
    logger.info(`旧 3X-UI 用户同步任务已取代: user=${userId}, count=${result.changes}, reason=${reason}`);
  }

  return result.changes || 0;
}

/**
 * 创建同步任务
 * @param {Object} db - 数据库实例
 * @param {Object} options - 任务参数
 * @param {number} options.userId - 用户 ID
 * @param {string} options.taskType - 任务类型
 * @param {Object} [options.payload] - 同步所需快照
 * @param {number|null} [options.runAt] - 指定执行时间戳
 * @returns {Promise<number>} 任务 ID
 */
async function enqueueTask(db, { userId, taskType, payload = {}, runAt = null }) {
  const now = Math.floor(Date.now() / 1000);
  const nextRetryAt = runAt || now;

  if (isUserSyncTaskType(taskType)) {
    await supersedePendingUserSyncTasks(db, userId, `被新的 ${taskType} 任务取代`);
  }

  const result = await xuiSyncRepository.insertXuiSyncTask(db, {
    userId,
    taskType,
    payloadText: JSON.stringify(payload),
    nextRetryAt,
    createdAt: now,
    updatedAt: now
  });

  logger.info(`创建 3X-UI 同步任务: task=${result.lastInsertRowid}, user=${userId}, type=${taskType}`);
  return result.lastInsertRowid;
}

/**
 * 获取到期可执行的 pending 任务
 * @param {Object} db - 数据库实例
 * @param {number} limit - 最大任务数
 * @returns {Promise<Array>} 待处理任务
 */
async function getDueTasks(db, limit = 20) {
  const now = Math.floor(Date.now() / 1000);
  const tasks = await xuiSyncRepository.listDueXuiSyncTasks(db, now, limit);

  return tasks.map(task => ({
    ...task,
    payload_data: parsePayload(task.payload)
  }));
}

/**
 * 标记任务处理中
 * @param {Object} db - 数据库实例
 * @param {number} taskId - 任务 ID
 */
async function markProcessing(db, taskId) {
  const now = Math.floor(Date.now() / 1000);
  await xuiSyncRepository.markXuiSyncTaskProcessing(db, taskId, now);
}

/**
 * 标记任务成功
 * @param {Object} db - 数据库实例
 * @param {number} taskId - 任务 ID
 */
async function markSuccess(db, taskId) {
  const now = Math.floor(Date.now() / 1000);
  await xuiSyncRepository.markXuiSyncTaskSuccess(db, taskId, now);
}

/**
 * 标记任务等待重试
 * @param {Object} db - 数据库实例
 * @param {number} taskId - 任务 ID
 * @param {number} attempts - 新的失败次数
 * @param {string} errorMessage - 最近一次错误信息
 */
async function markRetry(db, taskId, attempts, errorMessage) {
  const now = Math.floor(Date.now() / 1000);
  const nextRetryAt = now + getRetryDelaySeconds(attempts);
  await xuiSyncRepository.markXuiSyncTaskRetry(db, {
    taskId,
    attempts,
    nextRetryAt,
    errorMessage,
    updatedAt: now
  });
}

/**
 * 标记任务最终失败
 * @param {Object} db - 数据库实例
 * @param {number} taskId - 任务 ID
 * @param {number} attempts - 最终失败次数
 * @param {string} errorMessage - 错误信息
 */
async function markFailed(db, taskId, attempts, errorMessage) {
  const now = Math.floor(Date.now() / 1000);
  await xuiSyncRepository.markXuiSyncTaskFailed(db, {
    taskId,
    attempts,
    errorMessage,
    updatedAt: now
  });
}

/**
 * 处理单个同步任务
 *
 * handler 返回 { success: false } 或抛错都会触发重试逻辑。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} task - 同步任务
 * @param {Function} handler - 具体任务处理器
 * @param {Object} options - 处理选项
 * @returns {Promise<Object>} 处理结果
 */
async function processTask(db, task, handler, options = {}) {
  const maxAttempts = options.maxAttempts || 10;
  await markProcessing(db, task.id);

  try {
    const result = await handler(task);
    if (result && result.success === false) {
      throw new Error(result.message || '同步任务执行失败');
    }

    await markSuccess(db, task.id);
    return { success: true };
  } catch (error) {
    const attempts = Number(task.attempts || 0) + 1;
    if (attempts >= maxAttempts) {
      await markFailed(db, task.id, attempts, error.message);
      logger.error(`3X-UI 同步任务最终失败: task=${task.id}, error=${error.message}`);
      return { success: false, final: true, error: error.message };
    }

    await markRetry(db, task.id, attempts, error.message);
    logger.warn(`3X-UI 同步任务失败，已安排重试: task=${task.id}, attempts=${attempts}, error=${error.message}`);
    return { success: false, final: false, error: error.message };
  }
}

/**
 * 批量处理到期任务
 * @param {Object} db - 数据库实例
 * @param {Function} handler - 具体任务处理器
 * @param {Object} options - 处理选项
 * @returns {Promise<Object>} 批量处理统计
 */
async function processDueTasks(db, handler, options = {}) {
  const tasks = await getDueTasks(db, options.limit || 20);
  const result = {
    processed: 0,
    success: 0,
    failed: 0,
    finalFailed: 0
  };

  if (tasks.length > 0 && typeof options.onStart === 'function') {
    options.onStart(tasks);
  }

  for (const task of tasks) {
    result.processed++;
    const taskResult = await processTask(db, task, handler, options);
    if (taskResult.success) {
      result.success++;
    } else {
      result.failed++;
      if (taskResult.final) {
        result.finalFailed++;
      }
    }
  }

  return result;
}

module.exports = {
  TASK_TYPES,
  TASK_STATUS,
  enqueueTask,
  getDueTasks,
  getRetryDelaySeconds,
  isUserSyncTaskType,
  processDueTasks,
  processTask,
  supersedePendingUserSyncTasks
};
