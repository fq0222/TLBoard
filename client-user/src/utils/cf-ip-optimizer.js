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
  return item?.testStatus === 'done' && Number(item?.successTimes) > 0
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

const MIN_RECOMMENDED_SUCCESS_TIMES = 4

/**
 * 计算测速结果的中位数延迟。
 * @param {Object} item - CF IP 测速结果。
 * @returns {number} 中位数延迟；无有效样本时返回正无穷。
 */
function getMedianLatency(item) {
  const normalizedMedian = Number(item?.medianLatency)
  if (Number.isFinite(normalizedMedian) && normalizedMedian > 0) {
    return normalizedMedian
  }

  if (!Array.isArray(item?.testResults) || item.testResults.length === 0) {
    return Number.POSITIVE_INFINITY
  }

  const samples = item.testResults
    .map(value => Number(value))
    .filter(value => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)

  if (samples.length === 0) {
    return Number.POSITIVE_INFINITY
  }

  const middleIndex = Math.floor(samples.length / 2)
  if (samples.length % 2 === 1) {
    return samples[middleIndex]
  }

  return (samples[middleIndex - 1] + samples[middleIndex]) / 2
}

function isRecommendationCandidate(item) {
  const successTimes = Number(item?.successTimes) || 0
  const medianLatency = getMedianLatency(item)

  return isAvailable(item) &&
    successTimes >= MIN_RECOMMENDED_SUCCESS_TIMES &&
    Number.isFinite(medianLatency) &&
    medianLatency > 0
}

/**
 * 比较两个 CF IP 测速结果。
 * @param {Object} a - 第一个测速结果。
 * @param {Object} b - 第二个测速结果。
 * @returns {number} 可用项优先，再按成功次数降序和中位数延迟升序排列。
 */
export function compareCfIpResults(a, b) {
  const aAvailable = isAvailable(a)
  const bAvailable = isAvailable(b)

  if (aAvailable !== bAvailable) return aAvailable ? -1 : 1
  if (!aAvailable) return 0

  const aSuccessTimes = Number(a?.successTimes) || 0
  const bSuccessTimes = Number(b?.successTimes) || 0
  if (aSuccessTimes !== bSuccessTimes) return aSuccessTimes > bSuccessTimes ? -1 : 1

  const aMedianLatency = normalizeMetric(getMedianLatency(a))
  const bMedianLatency = normalizeMetric(getMedianLatency(b))
  if (aMedianLatency !== bMedianLatency) return aMedianLatency < bMedianLatency ? -1 : 1

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
