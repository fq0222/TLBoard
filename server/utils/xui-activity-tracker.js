/**
 * 3X-UI 访问活动追踪器。
 * 职责：区分前台用户请求和后台巡检请求，让低优先级后台任务避让用户触发的 3X-UI 访问。
 */

const { AsyncLocalStorage } = require('node:async_hooks');

const DEFAULT_FOREGROUND_IDLE_MS = 60 * 1000;
const DEFAULT_IDLE_CHECK_INTERVAL_MS = 1000;
const requestScope = new AsyncLocalStorage();

let foregroundActiveCount = 0;
let backgroundActiveCount = 0;
let lastForegroundFinishedAt = 0;
let backgroundRequestCount = 0;

/**
 * 标准化 3X-UI 请求来源。
 * @param {string} source - 请求来源，foreground 表示用户前台请求，background 表示后台任务。
 * @returns {'foreground'|'background'} 标准化后的来源。
 */
function normalizeSource(source) {
  return source === 'background' ? 'background' : 'foreground';
}

/**
 * 获取当前异步上下文中的 3X-UI 请求来源。
 * @returns {'foreground'|'background'} 当前来源，未显式标记时默认按前台请求处理。
 */
function getCurrentSource() {
  return normalizeSource(requestScope.getStore()?.source);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 标记一次 3X-UI 请求开始。
 * @param {string} [source] - 请求来源，省略时使用当前异步上下文。
 * @returns {void}
 */
function beginRequest(source = getCurrentSource()) {
  if (normalizeSource(source) === 'background') {
    backgroundActiveCount += 1;
    // Node 单进程内自增是同步完成的；调度器只比较单调递增值，不依赖可回退状态。
    backgroundRequestCount += 1;
    return;
  }

  foregroundActiveCount += 1;
}

/**
 * 标记一次 3X-UI 请求结束。
 * @param {string} [source] - 请求来源，省略时使用当前异步上下文。
 * @returns {void}
 */
function endRequest(source = getCurrentSource()) {
  if (normalizeSource(source) === 'background') {
    backgroundActiveCount = Math.max(0, backgroundActiveCount - 1);
    return;
  }

  foregroundActiveCount = Math.max(0, foregroundActiveCount - 1);
  if (foregroundActiveCount === 0) {
    lastForegroundFinishedAt = Date.now();
  }
}

/**
 * 判断当前是否有任意 3X-UI 请求正在执行。
 * @returns {boolean} 是否繁忙。
 */
function isBusy() {
  return getActiveCount() > 0;
}

/**
 * 获取当前 3X-UI 活跃请求总数。
 * @returns {number} 活跃请求数。
 */
function getActiveCount() {
  return foregroundActiveCount + backgroundActiveCount;
}

/**
 * 获取后台 3X-UI API 请求累计次数。
 * @returns {number} 后台请求单调计数。
 */
function getBackgroundRequestCount() {
  return backgroundRequestCount;
}

/**
 * 计算后台任务距离前台空闲窗口还需要等待多久。
 * @param {number} [idleMs=60000] - 前台请求结束后的空闲窗口毫秒数。
 * @returns {number} 仍需等待的毫秒数，0 表示可执行后台任务。
 */
function getForegroundIdleDelayMs(idleMs = DEFAULT_FOREGROUND_IDLE_MS) {
  if (foregroundActiveCount > 0) {
    return Math.max(1, Math.min(idleMs, DEFAULT_IDLE_CHECK_INTERVAL_MS));
  }

  return Math.max(0, lastForegroundFinishedAt + idleMs - Date.now());
}

/**
 * 等待前台 3X-UI 请求结束并经过指定空闲窗口。
 * @param {Object} [options={}] - 等待选项。
 * @param {number} [options.idleMs=60000] - 前台请求结束后的空闲窗口毫秒数。
 * @param {number} [options.checkIntervalMs=1000] - 前台请求仍在执行时的轮询间隔。
 * @returns {Promise<void>} 空闲窗口满足后完成。
 */
async function waitForForegroundIdle(options = {}) {
  const idleMs = options.idleMs ?? DEFAULT_FOREGROUND_IDLE_MS;
  const checkIntervalMs = options.checkIntervalMs ?? DEFAULT_IDLE_CHECK_INTERVAL_MS;

  while (true) {
    const remaining = getForegroundIdleDelayMs(idleMs);
    if (remaining <= 0) {
      return;
    }
    await delay(Math.min(remaining, checkIntervalMs));
  }
}

/**
 * 在后台任务上下文中执行处理函数。
 * @param {Function} handler - 后台任务处理函数。
 * @returns {*} handler 的返回值。
 */
function runAsBackground(handler) {
  return requestScope.run({ source: 'background' }, handler);
}

/**
 * 重置追踪状态，仅供测试和任务停止时清理使用。
 * @returns {void}
 */
function reset() {
  foregroundActiveCount = 0;
  backgroundActiveCount = 0;
  lastForegroundFinishedAt = 0;
  backgroundRequestCount = 0;
}

module.exports = {
  DEFAULT_FOREGROUND_IDLE_MS,
  beginRequest,
  endRequest,
  isBusy,
  getActiveCount,
  getBackgroundRequestCount,
  getCurrentSource,
  getForegroundIdleDelayMs,
  waitForForegroundIdle,
  runAsBackground,
  reset
};
