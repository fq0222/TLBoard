/**
 * CF IP 浏览器测速的共享参数。
 * 测试次数与超时控制单个 IP 的探测上限，间隔用于降低连续请求压力。
 */
export const CF_IP_TEST_COUNT = 2
export const CF_IP_TEST_TIMEOUT = 2000
export const CF_IP_TEST_INTERVAL = 200
