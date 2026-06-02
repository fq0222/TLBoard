/**
 * 管理端 3X-UI 数据库手动备份任务服务。
 * 负责串联备份执行器、任务状态缓存和 WebSocket 所需的实时状态广播。
 */

const { EventEmitter } = require('events');
const { backupXuiDatabases } = require('../../jobs/backupDB');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('XUI-BACKUP-TASK');
const FINISHED_STATUSES = new Set(['completed', 'failed']);

class XuiBackupTaskService extends EventEmitter {
  /**
   * @param {Object} [options] - 服务选项
   * @param {Function} [options.backupRunner] - 可注入的备份执行器，便于测试
   */
  constructor(options = {}) {
    super();
    this.backupRunner = options.backupRunner || backupXuiDatabases;
    this.currentTask = null;
  }

  /**
   * 启动一次手动备份任务。
   * 若已有进行中的任务，则复用当前任务状态，避免重复执行。
   *
   * @param {Object} db - 数据库代理对象
   * @returns {Object} 当前任务状态
   */
  startTask(db) {
    if (this.currentTask && !FINISHED_STATUSES.has(this.currentTask.status)) {
      return this.buildStatus(this.currentTask);
    }

    this.currentTask = {
      id: Date.now(),
      status: 'pending',
      totalCount: 0,
      completedCount: 0,
      currentServerName: '',
      failedServers: [],
      lastError: ''
    };

    this.emitStatus();
    const taskId = this.currentTask.id;
    this.runTask(db, taskId).catch((error) => {
      logger.error(`手动备份任务执行失败: ${error.message}`);
      if (!this.currentTask || Number(this.currentTask.id) !== Number(taskId)) {
        return;
      }
      this.currentTask.status = 'failed';
      this.currentTask.currentServerName = '';
      this.currentTask.lastError = error.message;
      this.emitStatus();
    });

    return this.buildStatus(this.currentTask);
  }

  /**
   * 获取当前任务状态。
   *
   * @param {number|null} [taskId] - 任务 ID，可选
   * @returns {Object|null} 任务状态
   */
  getStatus(taskId = null) {
    if (!this.currentTask) {
      return null;
    }
    if (taskId && Number(taskId) !== Number(this.currentTask.id)) {
      return null;
    }
    return this.buildStatus(this.currentTask);
  }

  /**
   * 后台执行备份任务，并在进度回调中更新状态。
   *
   * @param {Object} db - 数据库代理对象
   * @param {number} taskId - 任务 ID
   * @returns {Promise<void>}
   */
  async runTask(db, taskId) {
    const summary = await this.backupRunner(db, {
      onProgress: (event) => {
        if (!this.currentTask || Number(this.currentTask.id) !== Number(taskId)) {
          return;
        }
        this.applyProgress(event);
      }
    });

    if (!this.currentTask || Number(this.currentTask.id) !== Number(taskId)) {
      return;
    }

    this.currentTask.totalCount = Number(summary.total) || 0;
    this.currentTask.completedCount = this.currentTask.totalCount;
    this.currentTask.currentServerName = '';
    this.currentTask.status = this.currentTask.failedServers.length > 0 ? 'failed' : 'completed';
    this.emitStatus();
  }

  /**
   * 将备份执行器上报的进度事件转换为页面需要的状态。
   *
   * @param {Object} event - 进度事件
   * @returns {void}
   */
  applyProgress(event) {
    if (!this.currentTask || !event) {
      return;
    }

    if (event.type === 'start') {
      this.currentTask.status = 'running';
      this.currentTask.totalCount = Number(event.total) || 0;
      this.currentTask.completedCount = Number(event.completed) || 0;
      this.currentTask.currentServerName = '';
      this.currentTask.failedServers = [];
      this.currentTask.lastError = '';
      this.emitStatus();
      return;
    }

    if (event.type === 'server_start') {
      this.currentTask.status = 'running';
      this.currentTask.totalCount = Number(event.total) || this.currentTask.totalCount;
      this.currentTask.completedCount = Number(event.completed) || 0;
      this.currentTask.currentServerName = event.server?.name || '';
      this.emitStatus();
      return;
    }

    if (event.type === 'server_complete') {
      this.currentTask.totalCount = Number(event.total) || this.currentTask.totalCount;
      this.currentTask.completedCount = Number(event.completed) || this.currentTask.completedCount;

      if (!event.result?.success) {
        const failedName = event.server?.name || '未知服务器';
        if (!this.currentTask.failedServers.includes(failedName)) {
          this.currentTask.failedServers.push(failedName);
        }
        if (event.result?.error) {
          this.currentTask.lastError = event.result.error;
        }
      }

      this.emitStatus();
      return;
    }

    if (event.type === 'finish') {
      const summary = event.summary || {};
      this.currentTask.totalCount = Number(summary.total) || this.currentTask.totalCount;
      this.currentTask.completedCount = this.currentTask.totalCount;
      this.currentTask.currentServerName = '';
      this.currentTask.failedServers = (summary.results || [])
        .filter((item) => !item.success)
        .map((item) => item.server?.name || '未知服务器');
      this.emitStatus();
    }
  }

  /**
   * 统一构造前端和 WebSocket 共享的状态对象。
   *
   * @param {Object} task - 当前任务
   * @returns {Object} 标准化状态对象
   */
  buildStatus(task) {
    return {
      id: task.id,
      status: task.status,
      status_text: this.getStatusText(task.status),
      total_count: Number(task.totalCount) || 0,
      completed_count: Number(task.completedCount) || 0,
      current_server_name: task.currentServerName || '',
      failed_servers: Array.isArray(task.failedServers) ? [...task.failedServers] : [],
      last_error: task.lastError || ''
    };
  }

  /**
   * 生成中文状态文案，供接口和前端兜底展示。
   *
   * @param {string} status - 状态码
   * @returns {string} 中文状态
   */
  getStatusText(status) {
    const statusMap = {
      pending: '等待中',
      running: '执行中',
      completed: '已完成',
      failed: '已完成（存在失败）'
    };
    return statusMap[status] || status;
  }

  /**
   * 广播最新状态，供 WebSocket 订阅端实时消费。
   *
   * @returns {void}
   */
  emitStatus() {
    if (!this.currentTask) {
      return;
    }
    this.emit('status', this.buildStatus(this.currentTask));
  }
}

const xuiBackupTaskService = new XuiBackupTaskService();

module.exports = xuiBackupTaskService;
module.exports.XuiBackupTaskService = XuiBackupTaskService;
