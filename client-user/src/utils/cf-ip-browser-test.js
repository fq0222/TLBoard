import { CF_IP_TEST_TIMEOUT } from './cf-ip-test-config.js'
import { isIpv6 } from './cf-ip-optimizer.js'

/**
 * 构造基于 gotl 泛域名的浏览器测速 URL。
 * @param {string} ip - 待测速 IPv4 地址。
 * @param {string} rel - 防缓存随机参数。
 * @returns {string} 完整测速 URL。
 */
export function buildCfTraceUrl(ip, rel) {
  if (isIpv6(ip)) {
    return `https://ipv6-test.gotl.xyz/cdn-cgi/trace?rel=${encodeURIComponent(rel)}`
  }

  const host = String(ip || '').trim().replace(/\./g, '-')
  return `https://${host}.gotl.xyz/cdn-cgi/trace?rel=${encodeURIComponent(rel)}`
}

/**
 * 执行单次浏览器侧 CF 延迟采样。
 * @param {string} ip - 待测速 IP。
 * @param {Object} options - 可注入依赖，便于单元测试。
 * @param {Function} [options.fetchImpl] - 自定义 fetch 实现。
 * @param {Function} [options.now] - 自定义计时函数。
 * @param {string} [options.randomValue] - 指定随机参数。
 * @returns {Promise<number>} 成功返回正延迟，失败返回 -1。
 */
export async function createCfLatencySample(ip, options = {}) {
  const fetchImpl = options.fetchImpl || window.fetch.bind(window)
  const now = options.now || window.performance.now.bind(window.performance)
  const randomValue = options.randomValue || `${Date.now()}-${Math.random()}`
  const controller = new AbortController()
  const startTime = now()
  const timeoutId = setTimeout(() => {
    controller.abort()
  }, CF_IP_TEST_TIMEOUT)

  try {
    const url = buildCfTraceUrl(ip, randomValue)
    await fetchImpl(url, {
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal
    })

    return Math.max(1, Math.round(now() - startTime))
  } catch {
    return -1
  } finally {
    clearTimeout(timeoutId)
  }
}
