/**
 * 判断地址是否为 IPv6。
 * @param {string} ip - 待判断的 IP 地址。
 * @returns {boolean} 地址中包含冒号时返回 true。
 */
export function isIpv6(ip) {
  return typeof ip === 'string' && ip.includes(':')
}

/**
 * 判断测速结果是否已完成且可用。
 * @param {Object} item - CF IP 测速结果。
 * @returns {boolean} 完成测速且延迟大于零时返回 true。
 */
function isAvailable(item) {
  return item?.testStatus === 'done' && Number(item.latency) > 0
}

/**
 * 将排序指标规范化为有限数值。
 * @param {*} value - 待规范化的丢包率或平均延迟。
 * @returns {number} 有限数值保持不变，否则返回正无穷以排到末尾。
 */
function normalizeMetric(value) {
  const metric = Number(value)
  return Number.isFinite(metric) ? metric : Number.POSITIVE_INFINITY
}

const MAX_RECOMMENDED_PACKET_LOSS = 20

/**
 * 判断测速结果是否满足公共 CF IP 自动推荐门槛。
 * @param {Object} item - CF IP 测速结果。
 * @returns {boolean} 测试完成、延迟可用、丢包率在 0~20 且平均延迟为正有限数时返回 true。
 */
function isRecommendationCandidate(item) {
  const packetLoss = Number(item?.packetLoss)
  const avgLatency = Number(item?.avgLatency)

  return isAvailable(item) &&
    item?.packetLoss !== null &&
    item?.packetLoss !== '' &&
    Number.isFinite(packetLoss) &&
    packetLoss >= 0 &&
    packetLoss <= MAX_RECOMMENDED_PACKET_LOSS &&
    item?.avgLatency !== null &&
    item?.avgLatency !== '' &&
    Number.isFinite(avgLatency) &&
    avgLatency > 0
}

/**
 * 比较两个 CF IP 测速结果。
 * @param {Object} a - 第一个测速结果。
 * @param {Object} b - 第二个测速结果。
 * @returns {number} 可用项优先，再按丢包率和平均延迟升序排列。
 */
export function compareCfIpResults(a, b) {
  const aAvailable = isAvailable(a)
  const bAvailable = isAvailable(b)

  if (aAvailable !== bAvailable) return aAvailable ? -1 : 1
  if (!aAvailable) return 0

  const aPacketLoss = normalizeMetric(a.packetLoss)
  const bPacketLoss = normalizeMetric(b.packetLoss)
  if (aPacketLoss !== bPacketLoss) return aPacketLoss < bPacketLoss ? -1 : 1

  const aAvgLatency = normalizeMetric(a.avgLatency)
  const bAvgLatency = normalizeMetric(b.avgLatency)
  if (aAvgLatency !== bAvgLatency) return aAvgLatency < bAvgLatency ? -1 : 1

  return 0
}

/**
 * 从测速结果中选择指定数量的推荐 IP。
 * @param {Object[]} results - CF IP 测速结果列表。
 * @param {number} limit - 最大推荐数量，默认五个。
 * @returns {Object[]} 不区分协议族，按丢包率和平均延迟排序后的前若干项。
 */
export function selectRecommendedCfIps(results, limit = 5) {
  if (limit <= 0) return []

  return results
    .filter(isRecommendationCandidate)
    .sort(compareCfIpResults)
    .slice(0, limit)
}

/**
 * 使用动态工作池并发处理列表，任务结束后立即领取下一项，直到全部完成。
 * @param {Array} items - 待处理的数据列表。
 * @param {Function} worker - 异步任务函数，接收当前数据项。
 * @param {number} concurrency - 最大并发任务数，必须为正整数；列表为空时也会先校验。
 * @returns {Promise<void>} 所有任务完成后解决；任务失败时等待已调度工作池全部结束后拒绝。
 */
export async function runWithConcurrency(items, worker, concurrency) {
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new RangeError('concurrency 必须为正整数')
  }

  let nextIndex = 0

  async function runWorker() {
    while (nextIndex < items.length) {
      const item = items[nextIndex]
      nextIndex += 1
      await worker(item)
    }
  }

  const workerCount = Math.min(concurrency, items.length)
  const results = await Promise.allSettled(
    Array.from({ length: workerCount }, () => runWorker())
  )
  const firstRejection = results.find(result => result.status === 'rejected')
  if (firstRejection) throw firstRejection.reason
}
