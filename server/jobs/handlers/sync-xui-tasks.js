/**
 * 3X-UI 同步重试队列任务
 * 负责注册并执行到期补偿任务的轮询处理逻辑。
 */

const orderService = require('../../services/shared/order-service');
const trafficManager = require('../../services/shared/traffic-manager');
const xuiSyncTaskService = require('../../integrations/xui/xui-sync-task-service');
const xuiSyncRepository = require('../../repositories/xui-sync-repository');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('JOBS');

// 3X-UI 同步重试队列使用进程内锁，避免上一轮超时未结束时并发启动下一轮
let isXuiSyncTaskRunning = false;

/**
 * 注册 3X-UI 同步重试队列 worker
 * 首次延迟 30 秒执行，之后每 1 分钟处理一次到期 pending 任务。
 * @param {Object} context - 任务上下文
 * @param {Object} context.db - 数据库实例
 * @param {Array} context.intervals - 间隔任务引用集合
 * @param {Function} context.registerTimeout - 延迟任务注册函数
 */
function registerXuiSyncTaskJob({ db, intervals, registerTimeout }) {
  registerTimeout(async () => {
    await runXuiSyncTasks(db);
  }, 30 * 1000);

  const interval = setInterval(async () => {
    await runXuiSyncTasks(db);
  }, 60 * 1000);

  intervals.push(interval);
  logger.info('3X-UI 同步重试队列 worker 已注册（每1分钟执行一次）');
}

/**
 * 获取队列任务执行时的最新用户同步快照
 * 避免旧任务使用过期 payload 覆盖最新用户状态。
 * @param {Object} db - 数据库实例
 * @param {Object} task - 同步任务
 * @param {Object} payload - 任务 payload
 * @returns {Promise<Object|null>} 最新用户信息
 */
async function getLatestUserForSyncTask(db, task, payload) {
  const userId = task.user_id || payload.user?.id;
  if (!userId) return null;

  const user = await xuiSyncRepository.findUserForSyncTask(db, userId);

  if (!user) {
    return null;
  }

  const payloadUser = payload.user || {};
  if (
    Number(payloadUser.traffic_limit || 0) !== Number(user.traffic_limit || 0) ||
    Number(payloadUser.expire_at || 0) !== Number(user.expire_at || 0)
  ) {
    logger.info(`3X-UI 同步队列任务使用最新用户状态: task=${task.id}, user=${user.email}, traffic_limit=${payloadUser.traffic_limit || 0}->${user.traffic_limit || 0}, expire_at=${payloadUser.expire_at || 0}->${user.expire_at || 0}`);
  }

  return user;
}

/**
 * 判断启用/禁用同步任务是否仍符合用户最新状态。
 * 职责：避免旧的 disable_sync/enable_sync 在续费或管理员操作后覆盖 3X-UI 的新状态。
 * 核心分支：本地状态已与任务目标相反时，任务按成功跳过；用户不存在时同样跳过。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} task - 同步任务
 * @param {boolean} disable - 本次任务是否想禁用用户
 * @returns {Promise<{skip:boolean,message:string,userId:number|string|null}>} 是否跳过真实同步
 */
async function shouldSkipStaleStatusSyncTask(db, task, disable) {
  const userId = task.user_id || task.payload_data?.user?.id;
  if (!userId) {
    return { skip: true, message: '任务缺少用户 ID，已跳过', userId: null };
  }

  const user = await xuiSyncRepository.findUserForSyncTask(db, userId);
  if (!user) {
    return { skip: true, message: '用户不存在，任务已跳过', userId };
  }

  const latestEnabled = Number(user.enabled) === 1;
  if (disable && latestEnabled) {
    logger.info(`跳过过期禁用同步任务: task=${task.id}, user=${user.email}, enabled=${user.enabled}`);
    return { skip: true, message: '用户已启用，过期禁用任务已跳过', userId };
  }

  if (!disable && !latestEnabled) {
    logger.info(`跳过过期启用同步任务: task=${task.id}, user=${user.email}, enabled=${user.enabled}`);
    return { skip: true, message: '用户已禁用，过期启用任务已跳过', userId };
  }

  return { skip: false, message: '', userId };
}

/**
 * 执行 3X-UI 同步重试队列
 * 根据任务类型分发到用户同步或启用/禁用同步逻辑。
 * @param {Object} db - 数据库实例
 */
async function runXuiSyncTasks(db) {
  if (isXuiSyncTaskRunning) {
    logger.info('3X-UI 同步重试队列上一轮仍在执行，本轮跳过');
    return;
  }

  isXuiSyncTaskRunning = true;
  const startTime = Date.now();
  let result = { processed: 0, success: 0, failed: 0, finalFailed: 0 };
  let hasExecutableTasks = false;
  let status = 'failed';

  try {
    result = await xuiSyncTaskService.processDueTasks(db, async task => {
      const payload = task.payload_data || {};

      if (
        task.task_type === xuiSyncTaskService.TASK_TYPES.INITIAL_USER_SYNC ||
        task.task_type === xuiSyncTaskService.TASK_TYPES.RENEW_SYNC ||
        task.task_type === xuiSyncTaskService.TASK_TYPES.USER_SYNC
      ) {
        const currentUser = await getLatestUserForSyncTask(db, task, payload);
        if (!currentUser) {
          logger.warn(`3X-UI 同步队列任务对应用户不存在，跳过任务: task=${task.id}, user=${task.user_id || payload.user?.id || 'unknown'}`);
          return { success: true, message: '用户不存在，任务已跳过' };
        }

        return orderService.syncUserToXuiServers(db, currentUser, payload.plan || {});
      }

      if (task.task_type === xuiSyncTaskService.TASK_TYPES.ENABLE_SYNC) {
        const staleCheck = await shouldSkipStaleStatusSyncTask(db, task, false);
        if (staleCheck.skip) {
          return { success: true, message: staleCheck.message };
        }

        const ok = await trafficManager.syncDisableStatusToXui(db, staleCheck.userId, false);
        return { success: ok, message: ok ? 'ok' : '同步启用状态失败' };
      }

      if (task.task_type === xuiSyncTaskService.TASK_TYPES.DISABLE_SYNC) {
        const staleCheck = await shouldSkipStaleStatusSyncTask(db, task, true);
        if (staleCheck.skip) {
          return { success: true, message: staleCheck.message };
        }

        const ok = await trafficManager.syncDisableStatusToXui(db, staleCheck.userId, true);
        return { success: ok, message: ok ? 'ok' : '同步禁用状态失败' };
      }

      return { success: false, message: `未知任务类型: ${task.task_type}` };
    }, {
      onStart: tasks => {
        hasExecutableTasks = true;
        logger.info(`开始执行 3X-UI 同步重试队列任务: count=${tasks.length}`);
      }
    });

    status = 'success';
  } catch (error) {
    logger.error(`3X-UI 同步重试队列执行错误: ${error.message}`);
  } finally {
    const duration = Date.now() - startTime;
    if (hasExecutableTasks || result.processed > 0) {
      logger.info(`3X-UI 同步重试队列任务执行结束: status=${status}, processed=${result.processed}, success=${result.success}, failed=${result.failed}, finalFailed=${result.finalFailed}, duration=${duration}ms`);
    }
    isXuiSyncTaskRunning = false;
  }
}

module.exports = {
  registerXuiSyncTaskJob,
  runXuiSyncTasks,
  shouldSkipStaleStatusSyncTask
};
