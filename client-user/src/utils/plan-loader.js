/**
 * 加载首页套餐并在失败时自动重试。
 *
 * @param {Function} getPlans - 执行套餐请求的函数，需返回用户端 API 响应。
 * @param {number} maxRetries - 最大重试次数，默认仅重试一次。
 * @returns {Promise<Array<Object>>} 后端返回的套餐列表。
 */
export async function loadPlansWithRetry(getPlans, maxRetries = 1) {
  let lastError

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await getPlans()
      if (response?.code === 0) {
        return response.data?.plans || []
      }

      throw new Error(response?.message || '获取套餐列表失败')
    } catch (error) {
      lastError = error
    }
  }

  throw lastError
}
