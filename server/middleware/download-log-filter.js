/**
 * 下载访问日志过滤器。
 * 职责：识别手机浏览器断点续传产生的成功 Range 分片请求，避免访问日志刷屏。
 */

/**
 * 判断是否跳过成功的 Range 分片下载访问日志。
 *
 * @param {Object} req - Express 请求对象
 * @param {string} req.method - HTTP 方法
 * @param {string} req.path - 请求路径
 * @param {Object} req.headers - 请求头
 * @param {Object} res - Express 响应对象
 * @param {number} res.statusCode - HTTP 响应状态码
 * @returns {boolean} 成功分片请求返回 true，错误请求和普通下载返回 false
 */
function shouldSkipSuccessfulRangeDownloadLog(req, res) {
  return req.method === 'GET' &&
    req.path?.startsWith('/api/user/download/') &&
    Boolean(req.headers?.range) &&
    res.statusCode < 400;
}

module.exports = {
  shouldSkipSuccessfulRangeDownloadLog
};
