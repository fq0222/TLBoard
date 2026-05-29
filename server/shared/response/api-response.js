const ERROR_CODES = require('../errors/error-codes');

/**
 * 创建统一响应体
 * 统一成功/失败类接口的基础结构，减少后续路由重复拼装。
 *
 * @param {boolean} success - 是否成功
 * @param {string} code - 业务错误码或成功码
 * @param {string} message - 响应消息
 * @param {*} [data] - 成功场景下返回的数据
 * @param {*} [details] - 失败场景下的补充详情
 * @returns {Object} 统一响应对象
 */
function createResponse(success, code, message, data, details) {
  const response = {
    success,
    code,
    message
  };

  if (data !== undefined) {
    response.data = data;
  }

  if (details !== undefined) {
    response.details = details;
  }

  return response;
}

/**
 * 发送成功响应
 *
 * @param {Object} res - Express 响应对象
 * @param {*} [data] - 返回数据
 * @param {string} [message] - 成功提示
 * @param {number} [statusCode] - HTTP 状态码
 * @returns {Object} Express 响应结果
 */
function success(res, data = null, message = '操作成功', statusCode = 200) {
  return res.status(statusCode).json(
    createResponse(true, ERROR_CODES.SUCCESS, message, data)
  );
}

/**
 * 发送失败响应
 *
 * @param {Object} res - Express 响应对象
 * @param {string} [message] - 错误提示
 * @param {Object} [options] - 失败响应扩展参数
 * @param {number} [options.statusCode] - HTTP 状态码
 * @param {string} [options.code] - 业务错误码
 * @param {*} [options.details] - 附加错误详情
 * @returns {Object} Express 响应结果
 */
function fail(res, message = '操作失败', options = {}) {
  const {
    statusCode = 500,
    code = ERROR_CODES.INTERNAL_ERROR,
    details
  } = options;

  return res.status(statusCode).json(
    createResponse(false, code, message, undefined, details)
  );
}

/**
 * 发送参数校验失败响应
 *
 * @param {Object} res - Express 响应对象
 * @param {*} [details] - 校验失败详情
 * @param {string} [message] - 错误提示
 * @returns {Object} Express 响应结果
 */
function validationError(res, details = null, message = '请求参数校验失败') {
  return fail(res, message, {
    statusCode: 400,
    code: ERROR_CODES.VALIDATION_ERROR,
    details
  });
}

/**
 * 发送资源不存在响应
 *
 * @param {Object} res - Express 响应对象
 * @param {string} [message] - 错误提示
 * @param {*} [details] - 附加信息
 * @returns {Object} Express 响应结果
 */
function notFound(res, message = '资源不存在', details = null) {
  return fail(res, message, {
    statusCode: 404,
    code: ERROR_CODES.NOT_FOUND,
    details
  });
}

/**
 * 发送兼容旧接口的成功响应
 * 用于阶段二过渡时复用旧格式，确保路由接入 shared 层后仍保持 { code, message, data } 不变。
 *
 * @param {Object} res - Express 响应对象
 * @param {*} [data] - 返回数据
 * @param {Object} [options] - 旧格式响应配置
 * @param {number} [options.statusCode] - HTTP 状态码
 * @param {number} [options.code] - 旧接口业务码
 * @param {string} [options.message] - 旧接口提示信息
 * @returns {Object} Express 响应结果
 */
function legacySuccess(res, data = null, options = {}) {
  const {
    statusCode = 200,
    code = 0,
    message = 'ok'
  } = options;

  return res.status(statusCode).json({
    code,
    message,
    data
  });
}

/**
 * 发送兼容旧接口的失败响应
 * 用于阶段二过渡时统一旧路由错误响应，不改变现有 code/message/data 语义。
 *
 * @param {Object} res - Express 响应对象
 * @param {Object} [options] - 旧格式错误响应配置
 * @param {number} [options.statusCode] - HTTP 状态码
 * @param {number} [options.code] - 旧接口业务码
 * @param {string} [options.message] - 旧接口提示信息
 * @param {*} [options.data] - 旧接口错误场景的 data 字段
 * @returns {Object} Express 响应结果
 */
function legacyFail(res, options = {}) {
  const {
    statusCode = 500,
    code = 500,
    message = '服务器内部错误',
    data = null
  } = options;

  return res.status(statusCode).json({
    code,
    message,
    data
  });
}

/**
 * 发送兼容旧接口的参数校验失败响应
 *
 * @param {Object} res - Express 响应对象
 * @param {Object} [options] - 旧格式参数校验响应配置
 * @param {string} [options.message] - 旧接口提示信息
 * @param {number} [options.code] - 旧接口业务码
 * @param {*} [options.data] - 旧接口错误场景的 data 字段
 * @returns {Object} Express 响应结果
 */
function legacyValidationError(res, options = {}) {
  const {
    message = '参数校验失败',
    code = 1001,
    data = null
  } = options;

  return legacyFail(res, {
    statusCode: 400,
    code,
    message,
    data
  });
}

/**
 * 发送兼容旧接口的资源不存在响应
 *
 * @param {Object} res - Express 响应对象
 * @param {Object} [options] - 旧格式资源不存在响应配置
 * @param {string} [options.message] - 旧接口提示信息
 * @param {number} [options.code] - 旧接口业务码
 * @param {*} [options.data] - 旧接口错误场景的 data 字段
 * @returns {Object} Express 响应结果
 */
function legacyNotFound(res, options = {}) {
  const {
    message = '资源不存在',
    code = 404,
    data = null
  } = options;

  return legacyFail(res, {
    statusCode: 404,
    code,
    message,
    data
  });
}

module.exports = {
  createResponse,
  success,
  fail,
  validationError,
  notFound,
  legacySuccess,
  legacyFail,
  legacyValidationError,
  legacyNotFound
};
