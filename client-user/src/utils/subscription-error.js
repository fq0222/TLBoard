/**
 * 提取生成订阅链接时应展示给用户的错误提示。
 * @param {Error|Object} error - Axios 拦截器抛出的错误对象
 * @returns {string} 后端业务提示或通用兜底文案
 */
export function getSubscriptionGenerationErrorMessage(error) {
  return error?.userMessage || error?.response?.data?.message || '生成订阅链接失败'
}
