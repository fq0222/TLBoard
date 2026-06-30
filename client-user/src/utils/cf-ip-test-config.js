/**
 * CF IP 浏览器测速的共享参数。
 * 测试次数与超时控制单个 IP 的探测上限，间隔用于降低连续请求压力。
 */
export const CF_IP_TEST_COUNT = 5
export const CF_IP_TEST_TIMEOUT = 1500
export const CF_IP_TEST_INTERVAL = 200

// 限制同时执行的 CF IP 测速任务数量，避免浏览器并发请求过载。
export const CF_IP_TEST_CONCURRENCY = 10
