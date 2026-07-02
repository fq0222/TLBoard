const { createLogger } = require('../utils/logger');

const logger = createLogger('XUI-JOB-SCHEDULER');
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * 创建串行执行、同名合并且带结束后冷却的 3X-UI 任务调度器。
 * @param {{ cooldownMs?: number }} options 调度选项，cooldownMs 为任务结束后的冷却毫秒数。
 * @returns {{ schedule: (name: string, handler: () => Promise<void>) => boolean, stop: () => void }} 调度与停止方法。
 */
function createXuiJobScheduler(options = {}) {
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const queue = [];
  const scheduledNames = new Set();
  let runningName = null;
  let lastFinishedAt = 0;
  let cooldownTimer = null;
  let stopped = false;

  /**
   * 按 FIFO 顺序处理任务；运行中、停止、空队列或冷却计时中时直接返回。
   * 任务异常仅记录失败，不阻断后续任务。
   * @returns {Promise<void>} 当前一轮处理完成的 Promise。
   */
  async function processQueue() {
    if (stopped || runningName || queue.length === 0 || cooldownTimer) return;

    const remaining = Math.max(0, lastFinishedAt + cooldownMs - Date.now());
    if (remaining > 0) {
      logger.info(`3X-UI 下一任务等待冷却: ${remaining}ms`);
      cooldownTimer = setTimeout(() => {
        cooldownTimer = null;
        void processQueue();
      }, remaining);
      return;
    }

    const item = queue.shift();
    scheduledNames.delete(item.name);
    runningName = item.name;
    const startedAt = Date.now();
    let status = 'success';

    try {
      logger.info(`开始执行 3X-UI 任务: ${item.name}`);
      await item.handler();
    } catch (error) {
      status = 'failed';
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`3X-UI 任务执行失败: ${item.name}, error=${errorMessage}`);
    } finally {
      lastFinishedAt = Date.now();
      logger.info(`3X-UI 任务执行结束: ${item.name}, status=${status}, duration=${lastFinishedAt - startedAt}ms`);
      runningName = null;
      void processQueue();
    }
  }

  /**
   * 将任务加入队列；停止后首次调度会重新激活，同名运行中或排队任务会被合并。
   * @param {string} name 唯一任务名称。
   * @param {() => Promise<void>} handler 异步任务处理函数。
   * @returns {boolean} 是否成功加入队列。
   */
  function schedule(name, handler) {
    if (stopped) {
      stopped = false;
      logger.info('3X-UI 调度器已重新激活');
    }
    if (runningName === name || scheduledNames.has(name)) {
      logger.info(`合并重复 3X-UI 任务: ${name}`);
      return false;
    }

    queue.push({ name, handler });
    scheduledNames.add(name);
    logger.info(`3X-UI 任务已入队: ${name}, queue=${queue.length}`);
    void processQueue();
    return true;
  }

  /**
   * 停止调度并丢弃待执行任务；正在运行的任务允许自然结束。
   * 后续再次调用 schedule 时会自动重新激活。
   * @returns {void}
   */
  function stop() {
    stopped = true;
    if (cooldownTimer) {
      clearTimeout(cooldownTimer);
      cooldownTimer = null;
    }
    const discarded = queue.length;
    queue.length = 0;
    scheduledNames.clear();
    logger.info(`3X-UI 调度器已停止，丢弃待执行任务: ${discarded}`);
  }

  return { schedule, stop };
}

const scheduler = createXuiJobScheduler();

module.exports = {
  DEFAULT_COOLDOWN_MS,
  createXuiJobScheduler,
  schedule: scheduler.schedule,
  stop: scheduler.stop
};
