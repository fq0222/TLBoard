/**
 * 统一日志工具
 * 集中管理日志格式，方便维护
 */

function getLocalTime() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

/**
 * 创建日志工具实例
 * @param {string} module - 模块名称
 * @returns {Object} 日志工具
 */
function createLogger(module) {
  return {
    info: (msg) => console.log(`[${module}] [INFO] ${getLocalTime()} - ${msg}`),
    error: (msg) => console.error(`[${module}] [ERROR] ${getLocalTime()} - ${msg}`),
    warn: (msg) => console.warn(`[${module}] [WARN] ${getLocalTime()} - ${msg}`)
  };
}

module.exports = { createLogger };
