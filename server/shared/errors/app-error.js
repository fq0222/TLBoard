const ERROR_CODES = require('./error-codes');

/**
 * 应用层通用异常
 * 用于在后续路由/服务中携带状态码、错误码和附加细节，统一交给响应层处理。
 */
class AppError extends Error {
  /**
   * @param {string} message - 面向接口调用方的错误信息
   * @param {Object} [options] - 异常扩展配置
   * @param {string} [options.code] - 业务错误码
   * @param {number} [options.statusCode] - HTTP 状态码
   * @param {*} [options.details] - 附加错误详情，常用于校验失败字段信息
   * @param {boolean} [options.expose] - 是否允许直接向客户端暴露 message
   */
  constructor(message, options = {}) {
    super(message);

    const {
      code = ERROR_CODES.INTERNAL_ERROR,
      statusCode = 500,
      details = null,
      expose = statusCode < 500
    } = options;

    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.expose = expose;
  }

  /**
   * 转为普通对象
   * 便于日志记录或响应层做结构化处理。
   *
   * @returns {Object} 标准化异常对象
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      details: this.details,
      expose: this.expose
    };
  }
}

module.exports = AppError;
