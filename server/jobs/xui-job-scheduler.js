const { createLogger } = require('../utils/logger');
const xuiActivityTracker = require('../utils/xui-activity-tracker');

const logger = createLogger('XUI-JOB-SCHEDULER');
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;
const DEFAULT_FOREGROUND_IDLE_MS = 60 * 1000;

class XuiJobScheduler {
  /**
   * 创建串行执行、同名合并、前台优先并带 3X-UI 访问后冷却的后台任务调度器。
   * @param {{ cooldownMs?: number, foregroundIdleMs?: number }} options 调度选项。
   */
  constructor(options = {}) {
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.foregroundIdleMs = options.foregroundIdleMs ?? DEFAULT_FOREGROUND_IDLE_MS;
    this.queue = [];
    this.scheduledNames = new Set();
    this.runningName = null;
    this.lastFinishedAt = 0;
    this.cooldownTimer = null;
    this.stopped = false;
  }

  /**
   * 按 FIFO 顺序处理任务；只有本轮实际访问过 3X-UI 时才刷新 5 分钟冷却。
   * @returns {Promise<void>} 当前一轮处理完成的 Promise。
   */
  async processQueue() {
    if (this.stopped || this.runningName || this.queue.length === 0 || this.cooldownTimer) return;

    const remaining = Math.max(0, this.lastFinishedAt + this.cooldownMs - Date.now());
    if (remaining > 0) {
      logger.info(`3X-UI 下一任务等待冷却: ${remaining}ms`);
      this.cooldownTimer = setTimeout(() => {
        this.cooldownTimer = null;
        void this.processQueue();
      }, remaining);
      return;
    }

    const foregroundRemaining = xuiActivityTracker.getForegroundIdleDelayMs(this.foregroundIdleMs);
    if (foregroundRemaining > 0) {
      logger.info(`3X-UI 后台任务等待前台请求空闲: ${foregroundRemaining}ms`);
      this.cooldownTimer = setTimeout(() => {
        this.cooldownTimer = null;
        void this.processQueue();
      }, foregroundRemaining);
      return;
    }

    const item = this.queue.shift();
    this.scheduledNames.delete(item.name);
    this.runningName = item.name;
    const startedAt = Date.now();
    const backgroundRequestCountBefore = xuiActivityTracker.getBackgroundRequestCount();
    let status = 'success';

    try {
      logger.info(`开始执行 3X-UI 任务: ${item.name}`);
      await xuiActivityTracker.runAsBackground(() => item.handler());
    } catch (error) {
      status = 'failed';
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`3X-UI 任务执行失败: ${item.name}, error=${errorMessage}`);
    } finally {
      const finishedAt = Date.now();
      const backgroundRequestCountAfter = xuiActivityTracker.getBackgroundRequestCount();
      if (backgroundRequestCountAfter > backgroundRequestCountBefore) {
        this.lastFinishedAt = finishedAt;
      }
      logger.info(`3X-UI 任务执行结束: ${item.name}, status=${status}, duration=${finishedAt - startedAt}ms`);
      this.runningName = null;
      void this.processQueue();
    }
  }

  /**
   * 将任务加入队列；同名运行中或排队任务会被合并。
   * @param {string} name 唯一任务名称。
   * @param {() => Promise<void>} handler 异步任务处理函数。
   * @returns {boolean} 是否成功加入队列。
   */
  schedule(name, handler) {
    if (this.stopped) {
      this.stopped = false;
      logger.info('3X-UI 调度器已重新激活');
    }
    if (this.runningName === name || this.scheduledNames.has(name)) {
      logger.info(`合并重复 3X-UI 任务: ${name}`);
      return false;
    }

    this.queue.push({ name, handler });
    this.scheduledNames.add(name);
    logger.info(`3X-UI 任务已入队: ${name}, queue=${this.queue.length}`);
    void this.processQueue();
    return true;
  }

  /**
   * 停止调度并丢弃待执行任务；正在运行的任务允许自然结束。
   * @returns {void}
   */
  stop() {
    this.stopped = true;
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = null;
    }
    const discarded = this.queue.length;
    this.queue.length = 0;
    this.scheduledNames.clear();
    logger.info(`3X-UI 调度器已停止，丢弃待执行任务: ${discarded}`);
  }
}

const scheduler = new XuiJobScheduler();

module.exports = {
  DEFAULT_COOLDOWN_MS,
  DEFAULT_FOREGROUND_IDLE_MS,
  XuiJobScheduler,
  schedule: scheduler.schedule.bind(scheduler),
  stop: scheduler.stop.bind(scheduler)
};
