/**
 * VMQ 支付服务封装。
 * 处理 VMQ 订单创建、状态查询、关单和回调验签。
 */

const axios = require('axios');
const crypto = require('crypto');
const config = require('../../config');

/**
 * 计算 MD5 签名。
 *
 * @param {string} value - 待签名字串
 * @returns {string} MD5 签名结果
 */
function md5(value) {
  return crypto.createHash('md5').update(String(value)).digest('hex');
}

/**
 * 获取 VMQ 支付配置。
 *
 * @returns {Object} VMQ 配置对象
 */
function getPaymentConfig() {
  return {
    apiUrl: (config.payment.vmqApiUrl || config.payment.apiUrl || '').replace(/\/+$/, ''),
    key: config.payment.vmqKey || config.payment.key,
    defaultType: Number(config.payment.vmqDefaultType || 2),
    timeout: Number(config.payment.vmqTimeout || 10000)
  };
}

/**
 * 调用 VMQ 接口。
 *
 * @param {string} path - 接口路径
 * @param {Object} params - 请求参数
 * @returns {Promise<Object>} 接口响应数据
 */
async function request(path, params) {
  const { apiUrl, timeout } = getPaymentConfig();

  if (!apiUrl) {
    throw new Error('VMQ apiUrl is not configured');
  }

  const response = await axios.get(`${apiUrl}${path}`, {
    params,
    timeout,
    validateStatus: () => true
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`VMQ request failed with HTTP ${response.status}`);
  }

  return response.data;
}

/**
 * 生成创建订单签名。
 *
 * @param {Object} options - 签名参数
 * @param {string} options.payId - 商户订单号
 * @param {string} [options.param] - 透传参数
 * @param {number|string} options.type - 支付方式
 * @param {string|number} options.price - 订单金额
 * @returns {string} 签名结果
 */
function createOrderSign({ payId, param = '', type, price }) {
  const { key } = getPaymentConfig();
  return md5(`${payId}${param}${type}${price}${key}`);
}

/**
 * 生成关闭订单签名。
 *
 * @param {string} orderId - VMQ 订单号
 * @returns {string} 签名结果
 */
function closeOrderSign(orderId) {
  const { key } = getPaymentConfig();
  return md5(`${orderId}${key}`);
}

/**
 * 生成服务状态查询签名。
 *
 * @param {number} timestamp - 当前时间戳
 * @returns {string} 签名结果
 */
function stateSign(timestamp) {
  const { key } = getPaymentConfig();
  return md5(`${timestamp}${key}`);
}

/**
 * 校验 VMQ 支付回调签名。
 *
 * @param {Object} params - 回调参数
 * @returns {boolean} 签名是否有效
 */
function verifyNotifySign(params) {
  const { key } = getPaymentConfig();
  const payId = params.payId || '';
  const param = params.param || '';
  const type = params.type || '';
  const price = params.price || '';
  const reallyPrice = params.reallyPrice || '';
  const sign = params.sign || '';
  const expected = md5(`${payId}${param}${type}${price}${reallyPrice}${key}`);

  return expected.toLowerCase() === String(sign).toLowerCase();
}

/**
 * 创建 VMQ 订单。
 *
 * @param {Object} options - 下单参数
 * @param {string} options.payId - 商户订单号
 * @param {string} [options.param] - 透传参数
 * @param {number|string} options.type - 支付方式
 * @param {string|number} options.price - 订单金额
 * @param {number} [options.isHtml=0] - 是否直接跳转支付页
 * @returns {Promise<Object>} VMQ 下单结果
 */
async function createOrder({ payId, param = '', type, price, isHtml = 0 }) {
  const payType = Number(type || getPaymentConfig().defaultType);
  const amount = Number(price).toFixed(2);
  const sign = createOrderSign({ payId, param, type: payType, price: amount });

  return request('/createOrder', {
    payId,
    type: payType,
    price: amount,
    sign,
    param,
    isHtml
  });
}

/**
 * 查询 VMQ 订单详情。
 *
 * @param {string} orderId - VMQ 订单号
 * @returns {Promise<Object>} 订单详情
 */
async function getOrder(orderId) {
  return request('/getOrder', { orderId });
}

/**
 * 查询 VMQ 订单支付状态。
 *
 * @param {string} orderId - VMQ 订单号
 * @returns {Promise<Object>} 支付状态结果
 */
async function checkOrder(orderId) {
  return request('/checkOrder', { orderId });
}

/**
 * 关闭 VMQ 订单。
 *
 * @param {string} orderId - VMQ 订单号
 * @returns {Promise<Object>} 关单结果
 */
async function closeOrder(orderId) {
  return request('/closeOrder', {
    orderId,
    sign: closeOrderSign(orderId)
  });
}

/**
 * 查询 VMQ 服务状态。
 *
 * @returns {Promise<Object>} 服务状态结果
 */
async function getState() {
  const t = Date.now();
  return request('/getState', {
    t,
    sign: stateSign(t)
  });
}

/**
 * 判断 VMQ 监控端是否在线，仅接受成功响应中的字符串在线状态。
 *
 * @returns {Promise<boolean>} 监控端是否在线
 */
async function isMonitorOnline() {
  try {
    const result = await getState();
    return Number(result?.code) === 1 && result?.data?.state === '1';
  } catch (error) {
    return false;
  }
}

module.exports = {
  createOrder,
  getOrder,
  checkOrder,
  closeOrder,
  getState,
  isMonitorOnline,
  verifyNotifySign
};
