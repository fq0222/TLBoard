/**
 * 3X-UI 访问活动追踪器。
 * 负责记录当前正在访问 3X-UI 的请求数量，供低优先级批处理任务判断是否需要暂停。
 */

let activeCount = 0;

/**
 * 标记一次 3X-UI 请求开始。
 *
 * @returns {void}
 */
function beginRequest() {
  activeCount += 1;
}

/**
 * 标记一次 3X-UI 请求结束。
 *
 * @returns {void}
 */
function endRequest() {
  activeCount = Math.max(0, activeCount - 1);
}

/**
 * 判断当前是否有 3X-UI 请求正在执行。
 *
 * @returns {boolean} 是否繁忙
 */
function isBusy() {
  return activeCount > 0;
}

/**
 * 获取当前 3X-UI 活跃请求数。
 *
 * @returns {number} 活跃请求数
 */
function getActiveCount() {
  return activeCount;
}

module.exports = {
  beginRequest,
  endRequest,
  isBusy,
  getActiveCount
};
