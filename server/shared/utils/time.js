/**
 * 获取 Unix 秒级时间戳
 * 统一处理系统内常见的秒级时间写入场景。
 *
 * @param {Date|number|string} [input] - 可选时间输入，默认使用当前时间
 * @returns {number} Unix 秒时间戳
 */
function getUnixTimestamp(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  return Math.floor(date.getTime() / 1000);
}

/**
 * 获取指定时间对应的今日起点 Date 对象
 * 适用于按天统计或比较当天区间的场景。
 *
 * @param {Date|number|string} [input] - 可选时间输入，默认使用当前时间
 * @returns {Date} 今日 00:00:00 的 Date 对象
 */
function getStartOfToday(input = new Date()) {
  const date = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * 获取指定时间对应的今日起点毫秒时间戳
 *
 * @param {Date|number|string} [input] - 可选时间输入，默认使用当前时间
 * @returns {number} 今日 00:00:00 的毫秒时间戳
 */
function getStartOfTodayTimestamp(input = new Date()) {
  return getStartOfToday(input).getTime();
}

module.exports = {
  getUnixTimestamp,
  getStartOfToday,
  getStartOfTodayTimestamp
};
