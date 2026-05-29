/**
 * 格式化流量字节数
 * 兼容数据库中常见的 null、undefined、空字符串和字符串数字场景。
 *
 * @param {number|string|null|undefined} bytes - 原始字节数
 * @returns {string} 格式化后的流量字符串
 */
function formatTraffic(bytes) {
  if (bytes === null || bytes === undefined || bytes === '') {
    return '0 B';
  }

  const numBytes = Number(bytes);

  if (Number.isNaN(numBytes) || numBytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = numBytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  if (unitIndex === 0) {
    return `${Math.floor(value)} ${units[unitIndex]}`;
  }

  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

module.exports = {
  formatTraffic
};
