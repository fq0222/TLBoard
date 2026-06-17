/**
 * 管理端批量订阅生成服务。
 * 负责持久化任务创建、空闲调度、任务恢复、状态广播与逐用户订阅生成。
 */

const { EventEmitter } = require('events');
const { createLogger } = require('../../utils/logger');
const xuiActivityTracker = require('../../utils/xui-activity-tracker');
const usersService = require('./users-service');
const batchRepository = require('../../repositories/batch-subscription-repository');

const logger = createLogger('BATCH-SUB');
const IDLE_CHECK_INTERVAL = 2000;
const FINISHED_STATUSES = new Set(['completed', 'failed']);

class BatchSubscriptionService extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.processing = false;
  }

  /**
   * 绑定数据库实例，供应用启动和接口调用复用同一个服务单例。
   *
   * @param {Object} db - 数据库代理对象
   * @returns {void}
   */
  bindDb(db) {
    this.db = db;
  }

  /**
   * 启动服务恢复逻辑。
   * 将重启前处于 running/paused 的任务恢复为 paused，并等待空闲继续执行。
   *
   * @param {Object} db - 数据库代理对象
   * @returns {Promise<void>}
   */
  async resumeUnfinishedTask(db) {
    this.bindDb(db);
    const task = await batchRepository.findActiveTask(db);
    if (!task) {
      return;
    }

    await batchRepository.resetRunningItems(db, task.id);
    await batchRepository.updateTask(db, task.id, {
      status: 'paused',
      current_email: '',
      last_error: '服务重启后恢复任务'
    });
    this.processTask(task.id).catch(error => {
      logger.error(`恢复批量订阅任务失败: ${error.message}`);
    });
  }

  /**
   * 创建并启动批量订阅生成任务。
   *
   * @param {Object} db - 数据库代理对象
   * @param {Object} options - 批处理选项
   * @param {boolean} options.cfOptimizedOnly - 是否仅处理已优选 CF IP 的用户
   * @returns {Promise<Object>} 任务状态
   */
  async startTask(db, options = {}) {
    this.bindDb(db);
    const activeTask = await batchRepository.findActiveTask(db);
    if (activeTask) {
      this.ensureTaskProcessing(activeTask.id, '继续批量订阅任务');
      return this.buildStatus(activeTask);
    }

    const cfOptimizedOnly = options.cfOptimizedOnly !== false;
    const users = await batchRepository.listBatchUsers(db, { cfOptimizedOnly });
    const task = await batchRepository.createTaskWithItems(db, {
      cfOptimizedOnly,
      users
    });

    this.emitStatus(task);
    this.ensureTaskProcessing(task.id, '执行批量订阅任务');
    return this.buildStatus(task);
  }

  /**
   * 查询最近任务状态。
   *
   * @param {Object} db - 数据库代理对象
   * @returns {Promise<Object|null>} 状态对象
   */
  async getLatestStatus(db) {
    this.bindDb(db);
    const task = await batchRepository.findLatestTask(db);
    if (task) {
      this.ensureTaskProcessing(task.id, '唤醒批量订阅任务状态查询');
    }
    return task ? this.buildStatus(task) : null;
  }

  /**
   * 按任务 ID 查询状态。
   *
   * @param {number} taskId - 任务 ID
   * @returns {Promise<Object|null>} 状态对象
   */
  async getStatusById(taskId) {
    if (!this.db) {
      return null;
    }
    const task = await batchRepository.getTaskById(this.db, taskId);
    if (task) {
      this.ensureTaskProcessing(task.id, '唤醒批量订阅任务 WebSocket');
    }
    return task ? this.buildStatus(task) : null;
  }

  /**
   * 确保未结束任务有后台执行循环。
   * WebSocket 或状态查询可能晚于任务创建，因此这里做一次幂等唤醒，避免页面只看到 pending 旧状态。
   *
   * @param {number} taskId - 任务 ID
   * @param {string} action - 当前唤醒来源描述
   * @returns {void}
   */
  ensureTaskProcessing(taskId, action) {
    if (this.processing || !this.db) {
      return;
    }

    this.processTask(taskId).catch(error => {
      logger.error(`${action}失败: ${error.message}`);
    });
  }

  /**
   * 等待 3X-UI 空闲。
   * 如果当前有其它 3X-UI 访问，则将任务标记为 paused，并定期重试。
   *
   * @param {number} taskId - 任务 ID
   * @returns {Promise<void>}
   */
  async waitForXuiIdle(taskId) {
    let markedPaused = false;
    while (xuiActivityTracker.isBusy()) {
      if (!markedPaused) {
        await batchRepository.updateTask(this.db, taskId, {
          status: 'paused',
          current_email: ''
        });
        this.emitStatus(await batchRepository.getTaskById(this.db, taskId));
        markedPaused = true;
      }
      await new Promise(resolve => setTimeout(resolve, IDLE_CHECK_INTERVAL));
    }
  }

  /**
   * 后台执行指定批量任务。
   * 单进程内只允许一个执行循环，避免重复消费同一任务。
   *
   * @param {number} taskId - 任务 ID
   * @returns {Promise<void>}
   */
  async processTask(taskId) {
    if (this.processing || !this.db) {
      return;
    }

    this.processing = true;
    try {
      let task = await batchRepository.getTaskById(this.db, taskId);
      if (!task || FINISHED_STATUSES.has(task.status)) {
        return;
      }

      if (Number(task.total_count) === 0) {
        await batchRepository.updateTask(this.db, taskId, {
          status: 'completed',
          current_email: '',
          finished_at: batchRepository.nowTimestamp()
        });
        this.emitStatus(await batchRepository.getTaskById(this.db, taskId));
        return;
      }

      // 同一批量任务内复用服务器 inbound 快照，避免每个用户重复访问 3X-UI。
      const inboundSnapshotCache = new Map();

      while (true) {
        await this.waitForXuiIdle(taskId);
        const item = await batchRepository.findNextPendingItem(this.db, taskId);
        if (!item) {
          await batchRepository.updateTask(this.db, taskId, {
            status: 'completed',
            current_email: '',
            finished_at: batchRepository.nowTimestamp()
          });
          this.emitStatus(await batchRepository.getTaskById(this.db, taskId));
          return;
        }

        await batchRepository.updateTask(this.db, taskId, {
          status: 'running',
          current_email: item.email,
          started_at: batchRepository.nowTimestamp()
        });
        await batchRepository.markItemRunning(this.db, item.id);
        this.emitStatus(await batchRepository.getTaskById(this.db, taskId));

        try {
          await usersService.generateSubscription(this.db, item.user_id, logger, {
            inboundSnapshotCache
          });
          await batchRepository.markItemSuccess(this.db, item.id);
        } catch (error) {
          await batchRepository.markItemFailed(this.db, item.id, error.message);
          await batchRepository.updateTask(this.db, taskId, {
            last_error: `${item.email}: ${error.message}`
          });
          logger.warn(`批量生成订阅失败: user=${item.email}, error=${error.message}`);
        }

        await batchRepository.updateTask(this.db, taskId, {
          current_email: ''
        });
        task = await batchRepository.refreshTaskCounters(this.db, taskId);
        this.emitStatus(task);
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * 标准化前端展示需要的任务状态。
   *
   * @param {Object} task - 任务记录
   * @returns {Object} 状态对象
   */
  buildStatus(task) {
    return {
      id: task.id,
      status: task.status,
      status_text: this.getStatusText(task.status),
      current_email: task.current_email || '',
      completed_count: Number(task.completed_count) || 0,
      total_count: Number(task.total_count) || 0,
      failed_count: Number(task.failed_count) || 0,
      last_error: task.last_error || '',
      filter_cf_optimized: !!task.filter_cf_optimized
    };
  }

  /**
   * 转换任务状态为中文文案。
   *
   * @param {string} status - 任务状态
   * @returns {string} 中文状态
   */
  getStatusText(status) {
    const map = {
      pending: '等待中',
      running: '进行中',
      paused: '暂停',
      completed: '完成',
      failed: '失败'
    };
    return map[status] || status;
  }

  /**
   * 广播任务状态。
   *
   * @param {Object} task - 任务记录
   * @returns {void}
   */
  emitStatus(task) {
    if (!task) {
      return;
    }
    this.emit('status', this.buildStatus(task));
  }
}

module.exports = new BatchSubscriptionService();
