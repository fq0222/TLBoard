/**
 * CF IP 排序与推荐策略回归测试。
 * 覆盖可用性、丢包率、平均延迟和 IPv6 兜底选择规则。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isIpv6,
  compareCfIpResults,
  selectRecommendedCfIps,
  runWithConcurrency
} from '../src/utils/cf-ip-optimizer.js'

/**
 * 构造单条 CF IP 测速结果。
 * @param {number} id - 测试数据标识。
 * @param {string} ip - IP 地址。
 * @param {Object} options - 需要覆盖的测速字段。
 * @returns {Object} 完整测速结果。
 */
function result(id, ip, options = {}) {
  return {
    id,
    ip,
    testStatus: 'done',
    latency: 100,
    packetLoss: 0,
    avgLatency: 100,
    medianLatency: 100,
    successTimes: 5,
    testedTimes: 5,
    testResults: [100, 100, 100, 100, 100],
    ...options
  }
}

test('isIpv6 识别 IPv6 地址', () => {
  assert.equal(isIpv6('2606:4700:4700::1111'), true)
  assert.equal(isIpv6('1.1.1.1'), false)
})

test('compareCfIpResults 优先成功次数', () => {
  const lowerSuccessLowLatency = result(1, '1.1.1.1', { successTimes: 1, avgLatency: 20 })
  const higherSuccessHighLatency = result(2, '1.0.0.1', { successTimes: 5, avgLatency: 200 })

  assert.deepEqual(
    [lowerSuccessLowLatency, higherSuccessHighLatency].sort(compareCfIpResults).map(item => item.id),
    [2, 1]
  )
})

test('compareCfIpResults 在成功次数相同时优先低中位数延迟', () => {
  const slow = result(1, '1.1.1.1', { successTimes: 5, avgLatency: 180, medianLatency: 180 })
  const fast = result(2, '1.0.0.1', { successTimes: 5, avgLatency: 80, medianLatency: 80 })

  assert.deepEqual([slow, fast].sort(compareCfIpResults).map(item => item.id), [2, 1])
})

test('compareCfIpResults 将中位数延迟缺失或非有限的可用项排在完整项之后', () => {
  const missingLatency = result(1, '1.1.1.1', { avgLatency: undefined, medianLatency: undefined, testResults: [] })
  const infiniteLatency = result(2, '1.0.0.1', { avgLatency: Infinity, medianLatency: Infinity, testResults: [] })
  const complete = result(3, '8.8.8.8', { avgLatency: 100, medianLatency: 100 })

  assert.deepEqual(
    [missingLatency, infiniteLatency, complete].sort(compareCfIpResults).map(item => item.id),
    [3, 1, 2]
  )
})

test('selectRecommendedCfIps 不为较慢的 IPv6 强制保留名额', () => {
  const items = [
    result(1, '2606:4700::1', { packetLoss: 0, avgLatency: 500, medianLatency: 500 }),
    result(2, '1.1.1.1', { packetLoss: 0, avgLatency: 10, medianLatency: 10 }),
    result(3, '1.0.0.1', { packetLoss: 0, avgLatency: 20, medianLatency: 20 }),
    result(4, '8.8.8.8', { packetLoss: 0, avgLatency: 30, medianLatency: 30 }),
    result(5, '8.8.4.4', { packetLoss: 0, avgLatency: 40, medianLatency: 40 }),
    result(6, '9.9.9.9', { packetLoss: 0, avgLatency: 50, medianLatency: 50 })
  ]

  assert.deepEqual(selectRecommendedCfIps(items).map(item => item.id), [2, 3, 4, 5, 6])
})

test('selectRecommendedCfIps 在成功次数相同时按中位数延迟选择', () => {
  const items = [
    result(1, '2606:4700::1', { successTimes: 4, avgLatency: 10, medianLatency: 10 }),
    result(2, '1.1.1.1', { successTimes: 5, avgLatency: 200, medianLatency: 200 }),
    result(3, '1.0.0.1', { successTimes: 5, avgLatency: 30, medianLatency: 30 })
  ]

  assert.deepEqual(selectRecommendedCfIps(items, 2).map(item => item.id), [3, 2])
})

test('selectRecommendedCfIps 推荐数量非正数时返回空数组', () => {
  const items = [
    result(1, '2606:4700::1'),
    result(2, '1.1.1.1')
  ]

  assert.deepEqual(selectRecommendedCfIps(items, 0), [])
})

test('selectRecommendedCfIps 对不同协议族统一按质量排序', () => {
  const items = [
    result(1, '2606:4700::1', { avgLatency: 10, medianLatency: 10 }),
    result(2, '2606:4700::2', { avgLatency: 20, medianLatency: 20 }),
    result(3, '2606:4700::3', { avgLatency: 30, medianLatency: 30 }),
    result(4, '1.1.1.1', { avgLatency: 40, medianLatency: 40 }),
    result(5, '1.0.0.1', { avgLatency: 50, medianLatency: 50 })
  ]

  assert.deepEqual(selectRecommendedCfIps(items).map(item => item.id), [1, 2, 3, 4, 5])
})

test('selectRecommendedCfIps 无 IPv6 时按排序选择 IPv4', () => {
  const items = [
    result(1, '1.1.1.1', { successTimes: 3, avgLatency: 10, medianLatency: 10 }),
    result(2, '1.0.0.1', { successTimes: 5, avgLatency: 200, medianLatency: 200 }),
    result(3, '8.8.8.8', { successTimes: 5, avgLatency: 50, medianLatency: 50 })
  ]

  assert.deepEqual(selectRecommendedCfIps(items).map(item => item.id), [3, 2])
})

test('selectRecommendedCfIps 不再按丢包率过滤结果', () => {
  const items = [
    result(1, '1.1.1.1', { packetLoss: 20, successTimes: 5, avgLatency: 100, medianLatency: 100 }),
    result(2, '1.0.0.1', { packetLoss: 21, successTimes: 5, avgLatency: 10, medianLatency: 10 })
  ]

  assert.deepEqual(selectRecommendedCfIps(items).map(item => item.id), [2, 1])
})

test('selectRecommendedCfIps 排除中位数延迟无效的结果', () => {
  const items = [
    result(1, '1.1.1.1', { avgLatency: 0, medianLatency: 0, testResults: [] }),
    result(2, '1.0.0.1', { avgLatency: Infinity, medianLatency: Infinity, testResults: [] }),
    result(3, '8.8.8.8', { avgLatency: undefined, medianLatency: undefined, testResults: [] }),
    result(4, '8.8.4.4', { avgLatency: 80, medianLatency: 80 })
  ]

  assert.deepEqual(selectRecommendedCfIps(items).map(item => item.id), [4])
})

test('selectRecommendedCfIps 排除不可用项且不足五个时仅返回可用项', () => {
  const items = [
    result(1, '1.1.1.1'),
    result(2, '1.0.0.1', { testStatus: 'testing' }),
    result(3, '8.8.8.8', { latency: 0, successTimes: 0, testedTimes: 5, avgLatency: 0 }),
    result(4, '2606:4700::1')
  ]

  assert.deepEqual(selectRecommendedCfIps(items).map(item => item.id), [1, 4])
  assert.deepEqual(selectRecommendedCfIps(items.slice(1, 3)), [])
})

test('selectRecommendedCfIps 优先成功次数，再按中位数延迟排序', () => {
  const items = [
    result(1, '1.1.1.1', { successTimes: 3, testedTimes: 5, avgLatency: 20, medianLatency: 20, latency: 20 }),
    result(2, '1.0.0.1', { successTimes: 5, testedTimes: 5, avgLatency: 100, medianLatency: 100, latency: 100 }),
    result(3, '8.8.8.8', { successTimes: 5, testedTimes: 5, avgLatency: 50, medianLatency: 50, latency: 50 })
  ]

  assert.deepEqual(selectRecommendedCfIps(items).map(item => item.id), [3, 2])
})

test('selectRecommendedCfIps 排除成功次数不足四次的结果', () => {
  const items = [
    result(1, '1.1.1.1', { successTimes: 0, testedTimes: 5, avgLatency: 0, latency: -1 }),
    result(2, '1.0.0.1', { successTimes: 1, testedTimes: 5, avgLatency: 80, medianLatency: 80, latency: 80 })
  ]

  assert.deepEqual(selectRecommendedCfIps(items).map(item => item.id), [])
})

test('selectRecommendedCfIps 仅接受至少成功四次的结果', () => {
  const items = [
    result(1, '1.1.1.1', { successTimes: 3, testedTimes: 5, avgLatency: 10, medianLatency: 10 }),
    result(2, '1.0.0.1', { successTimes: 4, testedTimes: 5, avgLatency: 80, medianLatency: 80 }),
    result(3, '8.8.8.8', { successTimes: 5, testedTimes: 5, avgLatency: 120, medianLatency: 120 })
  ]

  assert.deepEqual(selectRecommendedCfIps(items).map(item => item.id), [3, 2])
})

test('selectRecommendedCfIps 在成功次数相同时按中位数延迟排序', () => {
  const items = [
    result(1, '1.1.1.1', {
      successTimes: 5,
      testedTimes: 5,
      avgLatency: 70,
      medianLatency: 50,
      testResults: [10, 20, 50, 120, 150]
    }),
    result(2, '1.0.0.1', {
      successTimes: 5,
      testedTimes: 5,
      avgLatency: 60,
      medianLatency: 60,
      testResults: [40, 50, 60, 70, 80]
    })
  ]

  assert.deepEqual(selectRecommendedCfIps(items).map(item => item.id), [1, 2])
})

test('runWithConcurrency 最大并发数不超过 10', async () => {
  let active = 0
  let maxActive = 0

  await runWithConcurrency(Array.from({ length: 30 }, (_, index) => index), async () => {
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise(resolve => setTimeout(resolve, 5))
    active -= 1
  }, 10)

  assert.equal(maxActive, 10)
})

test('runWithConcurrency 在首个任务阻塞时动态补位后续任务', async () => {
  let releaseFirst
  const firstBlocked = new Promise(resolve => {
    releaseFirst = resolve
  })
  const started = []

  const running = runWithConcurrency(Array.from({ length: 12 }, (_, index) => index + 1), async item => {
    started.push(item)
    if (item === 1) await firstBlocked
  }, 10)

  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(started, Array.from({ length: 12 }, (_, index) => index + 1))

  releaseFirst()
  await running
})

test('runWithConcurrency 空数组正常完成且不调用 worker', async () => {
  let called = false

  await runWithConcurrency([], async () => {
    called = true
  }, 10)

  assert.equal(called, false)
})

test('runWithConcurrency 等待全部任务完成后才解决', async () => {
  const items = [1, 2, 3]
  let releaseLast
  const lastBlocked = new Promise(resolve => {
    releaseLast = resolve
  })
  let completed = 0
  let settled = false

  const running = runWithConcurrency(items, async item => {
    if (item === items.at(-1)) await lastBlocked
    completed += 1
  }, 2)
  const tracked = running.finally(() => {
    settled = true
  })

  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false)

  releaseLast()
  await tracked
  assert.equal(settled, true)
  assert.equal(completed, items.length)
})

test('runWithConcurrency 拒绝非正整数并发数', async () => {
  for (const concurrency of [0, -1, NaN, 1.5]) {
    await assert.rejects(
      runWithConcurrency([1], async () => {}, concurrency),
      RangeError
    )
  }
})

test('runWithConcurrency 透传 worker 抛出的原始错误', async () => {
  const workerError = new Error('worker failed')

  await assert.rejects(
    runWithConcurrency([1], async () => {
      throw workerError
    }, 1),
    error => error === workerError
  )
})

test('runWithConcurrency 等待工作池全部结束后再拒绝首个错误', async () => {
  const workerError = new Error('first worker failed')
  let releaseBlocked
  const blocked = new Promise(resolve => {
    releaseBlocked = resolve
  })
  let settled = false

  const running = runWithConcurrency([1, 2], async item => {
    if (item === 1) throw workerError
    await blocked
  }, 2)
  const tracked = running.then(
    () => {
      settled = true
      return null
    },
    error => {
      settled = true
      return error
    }
  )

  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false)

  releaseBlocked()
  const rejectionReason = await tracked
  assert.equal(settled, true)
  assert.equal(rejectionReason, workerError)
})
