# CF IP 泛域名测速改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将用户端 CF IP 优选测速切换到 `*.gotl.xyz` 泛域名链路，使用 1500ms 硬超时和双次采样，按成功次数与平均延迟推荐前 5 个 IP。

**Architecture:** 保留现有浏览器侧并发测速架构，不改服务端接口与数据结构。通过抽离公共测速辅助函数，统一 `CfOptimize.vue`、`Profile.vue`、`Subscription.vue` 三处页面的 URL 生成、超时控制、失败判定和延迟统计逻辑，同时将排序规则收敛到共享优化器中。

**Tech Stack:** Vue 3、Vite、浏览器 Fetch API、AbortController、performance.now()、Node `node:test`

---

### Task 1: 收敛测速配置与推荐规则

**Files:**
- Modify: `client-user/src/utils/cf-ip-test-config.js`
- Modify: `client-user/src/utils/cf-ip-optimizer.js`
- Test: `client-user/test/cf-ip-optimizer.test.js`

- [ ] **Step 1: 写推荐规则的失败测试**

在 `client-user/test/cf-ip-optimizer.test.js` 增加以下断言：

```js
test('selectRecommendedCfIps 优先成功次数，再按平均延迟排序', () => {
  const items = [
    result(1, '1.1.1.1', { successTimes: 1, testedTimes: 2, avgLatency: 20, latency: 20 }),
    result(2, '1.0.0.1', { successTimes: 2, testedTimes: 2, avgLatency: 100, latency: 100 }),
    result(3, '8.8.8.8', { successTimes: 2, testedTimes: 2, avgLatency: 50, latency: 50 })
  ]

  assert.deepEqual(selectRecommendedCfIps(items).map(item => item.id), [3, 2, 1])
})

test('selectRecommendedCfIps 排除两次都失败的结果', () => {
  const items = [
    result(1, '1.1.1.1', { successTimes: 0, testedTimes: 2, avgLatency: 0, latency: -1 }),
    result(2, '1.0.0.1', { successTimes: 1, testedTimes: 2, avgLatency: 80, latency: 80 })
  ]

  assert.deepEqual(selectRecommendedCfIps(items).map(item => item.id), [2])
})
```

- [ ] **Step 2: 运行测试确认当前失败**

Run: `node client-user/test/cf-ip-optimizer.test.js`  
Expected: 与“成功次数优先”相关的新用例失败，说明当前排序规则尚未满足新设计。

- [ ] **Step 3: 最小化修改推荐逻辑**

将 `client-user/src/utils/cf-ip-test-config.js` 和 `client-user/src/utils/cf-ip-optimizer.js` 调整为：

```js
export const CF_IP_TEST_COUNT = 2
export const CF_IP_TEST_TIMEOUT = 1500
export const CF_IP_TEST_INTERVAL = 200
export const CF_IP_TEST_CONCURRENCY = 10
```

```js
function isAvailable(item) {
  return item?.testStatus === 'done' && Number(item?.successTimes) > 0
}

export function compareCfIpResults(a, b) {
  const aAvailable = isAvailable(a)
  const bAvailable = isAvailable(b)

  if (aAvailable !== bAvailable) return aAvailable ? -1 : 1
  if (!aAvailable) return 0

  const aSuccessTimes = Number(a.successTimes) || 0
  const bSuccessTimes = Number(b.successTimes) || 0
  if (aSuccessTimes !== bSuccessTimes) return aSuccessTimes > bSuccessTimes ? -1 : 1

  const aAvgLatency = normalizeMetric(a.avgLatency)
  const bAvgLatency = normalizeMetric(b.avgLatency)
  if (aAvgLatency !== bAvgLatency) return aAvgLatency < bAvgLatency ? -1 : 1

  return 0
}

function isRecommendationCandidate(item) {
  const avgLatency = Number(item?.avgLatency)

  return isAvailable(item) &&
    Number.isFinite(avgLatency) &&
    avgLatency > 0
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node client-user/test/cf-ip-optimizer.test.js`  
Expected: 所有测试通过，推荐策略已按“成功次数 + 平均延迟”工作。

- [ ] **Step 5: 提交本任务**

```bash
git add client-user/src/utils/cf-ip-test-config.js client-user/src/utils/cf-ip-optimizer.js client-user/test/cf-ip-optimizer.test.js
git commit -m "优化CF IP推荐排序规则"
```

### Task 2: 抽离公共泛域名测速工具

**Files:**
- Create: `client-user/src/utils/cf-ip-browser-test.js`
- Test: `client-user/test/cf-ip-browser-test.test.js`

- [ ] **Step 1: 先写测速工具测试**

创建 `client-user/test/cf-ip-browser-test.test.js`，至少覆盖 URL 生成和失败判定：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCfTraceUrl, createCfLatencySample } from '../src/utils/cf-ip-browser-test.js'

test('buildCfTraceUrl 将 IPv4 转成 gotl 泛域名地址', () => {
  const url = buildCfTraceUrl('104.16.0.1', '12345')
  assert.equal(url, 'https://104-16-0-1.gotl.xyz/cdn-cgi/trace?rel=12345')
})

test('buildCfTraceUrl 遇到 IPv6 时报错', () => {
  assert.throws(() => buildCfTraceUrl('2606:4700::1', '1'))
})

test('createCfLatencySample 为成功样本返回正延迟', async () => {
  const fetchImpl = async () => ({ ok: true })
  const value = await createCfLatencySample('1.1.1.1', {
    fetchImpl,
    now: (() => {
      let current = 0
      return () => (current += 25)
    })()
  })

  assert.equal(value, 25)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node client-user/test/cf-ip-browser-test.test.js`  
Expected: FAIL，提示新工具文件或导出函数不存在。

- [ ] **Step 3: 实现公共测速工具**

创建 `client-user/src/utils/cf-ip-browser-test.js`，实现如下骨架：

```js
import { CF_IP_TEST_TIMEOUT } from './cf-ip-test-config'
import { isIpv6 } from './cf-ip-optimizer'

/**
 * 构造基于 gotl 泛域名的浏览器测速 URL。
 * @param {string} ip - 待测速 IPv4 地址。
 * @param {string} rel - 防缓存随机参数。
 * @returns {string} 完整测速 URL。
 */
export function buildCfTraceUrl(ip, rel) {
  if (isIpv6(ip)) {
    throw new Error('暂不支持 IPv6 gotl 泛域名测速')
  }

  const host = String(ip).trim().replace(/\./g, '-')
  return `https://${host}.gotl.xyz/cdn-cgi/trace?rel=${encodeURIComponent(rel)}`
}

/**
 * 执行单次浏览器侧 CF 延迟采样。
 * @param {string} ip - 待测速 IP。
 * @param {Object} options - 可注入依赖，便于单元测试。
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node client-user/test/cf-ip-browser-test.test.js`  
Expected: PASS，说明公共测速工具已具备 URL 生成、超时控制和失败返回能力。

- [ ] **Step 5: 提交本任务**

```bash
git add client-user/src/utils/cf-ip-browser-test.js client-user/test/cf-ip-browser-test.test.js
git commit -m "抽离CF IP泛域名测速工具"
```

### Task 3: 替换三个页面的内联测速实现

**Files:**
- Modify: `client-user/src/views/user/CfOptimize.vue`
- Modify: `client-user/src/views/user/Profile.vue`
- Modify: `client-user/src/views/user/Subscription.vue`

- [ ] **Step 1: 让页面先引用公共测速函数**

在三个页面的 `script` 中统一增加：

```js
import { createCfLatencySample } from '@/utils/cf-ip-browser-test'
```

- [ ] **Step 2: 用公共函数替换内联 ping 逻辑**

将页面中原有的 `pingIp(ip)` 替换为：

```js
function pingIp(ip) {
  return createCfLatencySample(ip)
}
```

并删除旧实现里这些行为：

```js
const host = ip.includes(':') ? `[${ip}]` : ip
const url = `https://${host}:443/cdn-cgi/trace`
const controller = new AbortController()
const timeoutId = setTimeout(() => {
  controller.abort()
  resolve(-1)
}, TEST_TIMEOUT)

fetch(url, {
  mode: 'no-cors',
  signal: controller.signal,
  cache: 'no-store'
}).then(() => {
  ...
}).catch(() => {
  const elapsed = endTime - startTime
  resolve(elapsed < 50 ? -1 : Math.round(elapsed))
})
```

- [ ] **Step 3: 保持现有统计结构，但修正失败语义**

确认三个页面里的 `testSingleIp` 保持以下语义：

```js
const latency = await pingIp(ipData.ip)
ipData.testedTimes += 1

if (latency > 0) {
  ipData.successTimes += 1
  ipData.testResults.push(latency)
  ipData.latency = latency
}

if (ipData.testResults.length > 0) {
  const sum = ipData.testResults.reduce((a, b) => a + b, 0)
  ipData.avgLatency = Math.round(sum / ipData.testResults.length)
}
```

失败时不再把耗时折算成延迟，不额外制造伪成功样本。

- [ ] **Step 4: 运行页面相关回归测试或最小脚本验证**

如果已有页面推荐逻辑测试，运行相关测试；若没有，至少执行：

Run: `node client-user/test/cf-ip-optimizer.test.js`  
Expected: PASS，且三个页面的导入不引入新的语法错误。

- [ ] **Step 5: 提交本任务**

```bash
git add client-user/src/views/user/CfOptimize.vue client-user/src/views/user/Profile.vue client-user/src/views/user/Subscription.vue
git commit -m "统一用户端CF IP测速实现"
```

### Task 4: 做用户端构建验证

**Files:**
- Verify only: `client-user/`

- [ ] **Step 1: 运行用户端测试**

Run: `node client-user/test/cf-ip-browser-test.test.js`  
Expected: PASS

Run: `node client-user/test/cf-ip-optimizer.test.js`  
Expected: PASS

- [ ] **Step 2: 执行用户端构建**

Run: `cd client-user && npx vite build --minify esbuild`  
Expected: 构建成功，无语法错误、无导入路径错误。

- [ ] **Step 3: 记录验证日志**

在最终交付说明中保留：

```text
node client-user/test/cf-ip-browser-test.test.js
node client-user/test/cf-ip-optimizer.test.js
npx vite build --minify esbuild
```

以及每条命令的通过结果，满足项目“完成时必须展示测试日志”的要求。

- [ ] **Step 4: 提交本任务**

```bash
git add -A
git commit -m "完成CF IP泛域名测速改造验证"
```
