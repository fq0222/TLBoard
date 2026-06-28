# CF IP 50 选 5优选逻辑实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 CF IP 候选池改为随机 50 个（IPv6 充足时固定 3 个），以最大并发 10、每 IP 5 次、单次 3 秒完成测速，并按丢包率优先、平均延迟次之推荐 5 个 IP。

**Architecture:** 后端服务只负责按地址类型随机抽样；用户浏览器继续负责反映本地网络质量的测速。前端新增纯工具模块，隔离并发调度、排序及推荐规则，Vue 页面只管理响应式状态和提示。

**Tech Stack:** Node.js、`node:test`、Vue 3 Composition API、Vite。

---

## 文件结构

- 修改 `server/services/user/cf-optimize-service.js`：将候选总数从 20 调整为 50，保持最多 3 个 IPv6 的抽样规则。
- 创建 `server/test/test-cf-optimize-service.js`：覆盖 50 个候选、3 个 IPv6及池容量不足的降级行为。
- 修改 `client-user/src/utils/cf-ip-test-config.js`：统一声明 5 次、3 秒、200ms 间隔和最大并发 10。
- 修改 `client-user/test/cf-ip-test-config.test.js`：锁定测速配置。
- 创建 `client-user/src/utils/cf-ip-optimizer.js`：实现动态并发池、结果排序及 5 个推荐地址选择。
- 创建 `client-user/test/cf-ip-optimizer.test.js`：覆盖并发上限、及时补位、排序和 IPv6 兜底。
- 修改 `client-user/src/views/user/CfOptimize.vue`：接入工具函数，并更新“随机 50 个”提示。

项目规范要求未经用户明确要求不暂存刚写完的文件，因此各任务不执行 `git add` 或 `git commit`。

### Task 1：后端随机返回 50 个候选

**Files:**
- Create: `server/test/test-cf-optimize-service.js`
- Modify: `server/services/user/cf-optimize-service.js`

- [ ] **Step 1：编写候选数量与 IPv6 数量的失败测试**

在 `server/test/test-cf-optimize-service.js` 创建测试，保存并恢复 repository 方法，避免污染其他测试：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const cfOptimizeService = require('../services/user/cf-optimize-service');
const cfOptimizeRepository = require('../repositories/cf-optimize-repository');

function createIpRows(ipv4Count, ipv6Count) {
  return [
    ...Array.from({ length: ipv4Count }, (_, index) => ({
      id: index + 1,
      ip: `198.51.100.${index + 1}`
    })),
    ...Array.from({ length: ipv6Count }, (_, index) => ({
      id: ipv4Count + index + 1,
      ip: `2001:db8::${index + 1}`
    }))
  ];
}

async function getCandidates(rows) {
  const originalListEnabled = cfOptimizeRepository.listEnabledCfIps;
  const originalListCurrent = cfOptimizeRepository.listCurrentUserCfIps;
  cfOptimizeRepository.listEnabledCfIps = async () => rows;
  cfOptimizeRepository.listCurrentUserCfIps = async () => [];

  try {
    return await cfOptimizeService.getCfIps(
      {},
      { id: 1, email: 'user@example.com' }
    );
  } finally {
    cfOptimizeRepository.listEnabledCfIps = originalListEnabled;
    cfOptimizeRepository.listCurrentUserCfIps = originalListCurrent;
  }
}

test('CF IP 候选池数据充足时随机返回 50 个且包含 3 个 IPv6', async () => {
  const result = await getCandidates(createIpRows(60, 8));
  assert.equal(result.ips.length, 50);
  assert.equal(result.ips.filter(item => item.ip.includes(':')).length, 3);
  assert.equal(new Set(result.ips.map(item => item.id)).size, 50);
});
```

- [ ] **Step 2：运行测试并确认因仍返回 20 个而失败**

Run: `node --test server/test/test-cf-optimize-service.js`

Expected: FAIL，`20 !== 50`。

- [ ] **Step 3：最小修改后端候选总数**

在 `server/services/user/cf-optimize-service.js` 的 `getCfIps()` 中增加职责明确的常量并替换硬编码：

```js
const CF_IP_CANDIDATE_COUNT = 50;
const CF_IPV6_CANDIDATE_COUNT = 3;
```

```js
const selectedIpv6 = shuffle(ipv6List).slice(
  0,
  Math.min(CF_IPV6_CANDIDATE_COUNT, ipv6List.length)
);
const remainingCount = CF_IP_CANDIDATE_COUNT - selectedIpv6.length;
```

- [ ] **Step 4：运行测试并确认通过**

Run: `node --test server/test/test-cf-optimize-service.js`

Expected: PASS，1 test passed。

- [ ] **Step 5：补充池容量不足的失败测试**

追加：

```js
test('CF IP 候选池不足 50 个时返回全部地址且不重复', async () => {
  const result = await getCandidates(createIpRows(6, 2));
  assert.equal(result.ips.length, 8);
  assert.equal(result.ips.filter(item => item.ip.includes(':')).length, 2);
  assert.equal(new Set(result.ips.map(item => item.id)).size, 8);
});
```

- [ ] **Step 6：运行测试确认现有实现已覆盖降级行为**

Run: `node --test server/test/test-cf-optimize-service.js`

Expected: PASS，2 tests passed。该测试是对既有降级行为的回归锁定，不新增生产代码。

### Task 2：更新测速参数

**Files:**
- Modify: `client-user/test/cf-ip-test-config.test.js`
- Modify: `client-user/src/utils/cf-ip-test-config.js`

- [ ] **Step 1：先修改配置测试**

将断言改为：

```js
import {
  CF_IP_TEST_CONCURRENCY,
  CF_IP_TEST_COUNT,
  CF_IP_TEST_INTERVAL,
  CF_IP_TEST_TIMEOUT
} from '../src/utils/cf-ip-test-config.js'

test('CF IP 测速参数符合优选策略', () => {
  assert.equal(CF_IP_TEST_COUNT, 5)
  assert.equal(CF_IP_TEST_TIMEOUT, 3000)
  assert.equal(CF_IP_TEST_INTERVAL, 200)
  assert.equal(CF_IP_TEST_CONCURRENCY, 10)
})
```

- [ ] **Step 2：运行测试并确认失败**

Run: `node --test client-user/test/cf-ip-test-config.test.js`

Expected: FAIL，次数或超时时间不匹配，且并发常量尚未导出。

- [ ] **Step 3：最小修改配置**

将 `client-user/src/utils/cf-ip-test-config.js` 调整为：

```js
/**
 * CF IP 浏览器测速的共享参数。
 * 测试次数与超时控制单个 IP 的探测上限，间隔用于降低连续请求压力，
 * 最大并发数用于限制同时测速的 IP 数量。
 */
export const CF_IP_TEST_COUNT = 5
export const CF_IP_TEST_TIMEOUT = 3000
export const CF_IP_TEST_INTERVAL = 200
export const CF_IP_TEST_CONCURRENCY = 10
```

- [ ] **Step 4：运行测试并确认通过**

Run: `node --test client-user/test/cf-ip-test-config.test.js`

Expected: PASS。

### Task 3：实现丢包率优先排序和 IPv6 兜底推荐

**Files:**
- Create: `client-user/test/cf-ip-optimizer.test.js`
- Create: `client-user/src/utils/cf-ip-optimizer.js`

- [ ] **Step 1：编写排序失败测试**

创建测试文件：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  compareCfIpResults,
  selectRecommendedCfIps
} from '../src/utils/cf-ip-optimizer.js'

function ip(id, address, packetLoss, avgLatency, latency = avgLatency) {
  return {
    id,
    ip: address,
    packetLoss,
    avgLatency,
    latency,
    testStatus: 'done'
  }
}

test('排序时丢包率优先于平均延迟', () => {
  const highLossFast = ip(1, '198.51.100.1', 20, 30)
  const noLossSlow = ip(2, '198.51.100.2', 0, 120)
  const result = [highLossFast, noLossSlow].sort(compareCfIpResults)
  assert.deepEqual(result.map(item => item.id), [2, 1])
})

test('丢包率相同时按平均延迟升序排列', () => {
  const result = [
    ip(1, '198.51.100.1', 0, 90),
    ip(2, '198.51.100.2', 0, 40)
  ].sort(compareCfIpResults)
  assert.deepEqual(result.map(item => item.id), [2, 1])
})
```

- [ ] **Step 2：运行测试并确认模块不存在**

Run: `node --test client-user/test/cf-ip-optimizer.test.js`

Expected: FAIL，无法找到 `cf-ip-optimizer.js`。

- [ ] **Step 3：实现最小排序函数**

创建 `client-user/src/utils/cf-ip-optimizer.js`：

```js
/**
 * 判断地址是否为 IPv6。
 *
 * @param {string} address - IP 地址
 * @returns {boolean} 是否为 IPv6
 */
export function isIpv6(address) {
  return address.includes(':')
}

/**
 * 比较两个 CF IP 测速结果。
 * 可用结果优先；可用结果按丢包率、平均延迟依次升序排列。
 *
 * @param {Object} left - 左侧测速结果
 * @param {Object} right - 右侧测速结果
 * @returns {number} Array.sort 比较值
 */
export function compareCfIpResults(left, right) {
  const leftAvailable = left.testStatus === 'done' && left.latency > 0
  const rightAvailable = right.testStatus === 'done' && right.latency > 0

  if (leftAvailable !== rightAvailable) return leftAvailable ? -1 : 1
  if (!leftAvailable) return 0
  if (left.packetLoss !== right.packetLoss) {
    return left.packetLoss - right.packetLoss
  }
  return left.avgLatency - right.avgLatency
}
```

- [ ] **Step 4：运行排序测试并确认仅推荐函数导出仍失败**

Run: `node --test client-user/test/cf-ip-optimizer.test.js`

Expected: FAIL，提示 `selectRecommendedCfIps` 未导出；排序函数代码本身不报错。

- [ ] **Step 5：追加 IPv6 兜底推荐测试**

在同一测试文件追加：

```js
test('存在可用 IPv6 时选择一个最优 IPv6 作为兜底', () => {
  const candidates = [
    ip(1, '198.51.100.1', 0, 20),
    ip(2, '198.51.100.2', 0, 30),
    ip(3, '198.51.100.3', 0, 40),
    ip(4, '198.51.100.4', 0, 50),
    ip(5, '198.51.100.5', 0, 60),
    ip(6, '2001:db8::1', 20, 200),
    ip(7, '2001:db8::2', 40, 100)
  ]
  const selected = selectRecommendedCfIps(candidates, 5)
  assert.equal(selected.length, 5)
  assert.deepEqual(selected.filter(item => item.ip.includes(':')).map(item => item.id), [6])
  assert.deepEqual(selected.filter(item => !item.ip.includes(':')).map(item => item.id), [1, 2, 3, 4])
})

test('IPv4 不足时使用额外可用 IPv6 补足且忽略不可用地址', () => {
  const candidates = [
    ip(1, '198.51.100.1', 0, 20),
    ip(2, '198.51.100.2', 0, 30),
    ip(3, '2001:db8::1', 0, 60),
    ip(4, '2001:db8::2', 10, 70),
    ip(5, '2001:db8::3', 20, 80),
    ip(6, '198.51.100.6', 0, 0, 0)
  ]
  assert.deepEqual(
    selectRecommendedCfIps(candidates, 5).map(item => item.id),
    [3, 1, 2, 4, 5]
  )
})
```

- [ ] **Step 6：实现推荐函数**

追加到工具模块：

```js
/**
 * 从测速结果中选择推荐 IP。
 * 若 IPv6 可连通，先保留最优 IPv6 作为兜底，再优先填充 IPv4。
 *
 * @param {Array<Object>} candidates - CF IP 测速结果
 * @param {number} limit - 最大推荐数量
 * @returns {Array<Object>} 推荐结果
 */
export function selectRecommendedCfIps(candidates, limit = 5) {
  const available = [...candidates]
    .filter(item => item.testStatus === 'done' && item.latency > 0)
    .sort(compareCfIpResults)
  const ipv4List = available.filter(item => !isIpv6(item.ip))
  const ipv6List = available.filter(item => isIpv6(item.ip))
  const selected = ipv6List.length > 0 ? [ipv6List[0]] : []

  for (const item of ipv4List) {
    if (selected.length >= limit) break
    selected.push(item)
  }
  for (const item of ipv6List.slice(1)) {
    if (selected.length >= limit) break
    selected.push(item)
  }
  return selected
}
```

- [ ] **Step 7：运行工具测试并确认通过**

Run: `node --test client-user/test/cf-ip-optimizer.test.js`

Expected: PASS，4 tests passed。

### Task 4：实现最大并发 10 的动态测试池

**Files:**
- Modify: `client-user/test/cf-ip-optimizer.test.js`
- Modify: `client-user/src/utils/cf-ip-optimizer.js`

- [ ] **Step 1：编写并发上限与动态补位的失败测试**

更新 import，加入 `runWithConcurrency`，并追加：

```js
test('动态并发池不超过限制且任务完成后立即补位', async () => {
  let active = 0
  let maxActive = 0
  let releaseFirst
  const started = []
  const firstBlocked = new Promise(resolve => {
    releaseFirst = resolve
  })

  const running = runWithConcurrency(
    Array.from({ length: 12 }, (_, index) => index),
    async (item) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      started.push(item)
      if (item === 0) await firstBlocked
      await new Promise(resolve => setTimeout(resolve, 5))
      active -= 1
    },
    10
  )

  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(maxActive, 10)
  assert.equal(started.includes(10), true)
  assert.equal(started.includes(11), true)
  releaseFirst()
  await running
  assert.equal(active, 0)
})
```

- [ ] **Step 2：运行测试并确认缺少导出**

Run: `node --test client-user/test/cf-ip-optimizer.test.js`

Expected: FAIL，提示 `runWithConcurrency` 未导出。

- [ ] **Step 3：实现动态并发池**

追加：

```js
/**
 * 使用动态工作池处理任务，任一任务结束后立即消费下一个等待项。
 *
 * @param {Array<*>} items - 待处理项目
 * @param {Function} worker - 单项异步处理函数
 * @param {number} concurrency - 最大并发数
 * @returns {Promise<void>} 全部任务完成后结束
 */
export async function runWithConcurrency(items, worker, concurrency) {
  const workerCount = Math.min(Math.max(1, concurrency), items.length)
  let nextIndex = 0

  async function consume() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      await worker(items[currentIndex], currentIndex)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => consume()))
}
```

- [ ] **Step 4：运行工具测试并确认通过**

Run: `node --test client-user/test/cf-ip-optimizer.test.js`

Expected: PASS，5 tests passed。

### Task 5：接入 Vue 页面

**Files:**
- Modify: `client-user/src/views/user/CfOptimize.vue`

- [ ] **Step 1：引入新配置和工具函数**

将配置 import 增加并发常量，并引入工具：

```js
import {
  CF_IP_TEST_CONCURRENCY as TEST_CONCURRENCY,
  CF_IP_TEST_COUNT as TEST_COUNT,
  CF_IP_TEST_INTERVAL as TEST_INTERVAL,
  CF_IP_TEST_TIMEOUT as TEST_TIMEOUT
} from '@/utils/cf-ip-test-config'
import {
  compareCfIpResults,
  isIpv6,
  runWithConcurrency,
  selectRecommendedCfIps
} from '@/utils/cf-ip-optimizer'
```

删除组件内原有 `isIpv6()`，避免重复职责。

- [ ] **Step 2：接入丢包率优先排序**

将 `sortedIpList` 简化为：

```js
const sortedIpList = computed(() => {
  return [...ipList.value].sort(compareCfIpResults)
})
```

- [ ] **Step 3：接入最大并发 10 的测速池**

将：

```js
await Promise.all(ipList.value.map(ip => testSingleIp(ip)))
```

替换为：

```js
await runWithConcurrency(ipList.value, testSingleIp, TEST_CONCURRENCY)
```

这样每个 `testSingleIp()` 仍执行 5 次，但同时只有 10 个 IP 进入测试。

- [ ] **Step 4：接入推荐函数**

保留“未测试”和“没有可用 IP”的提示分支，将 `selectTop5()` 内手工拆分 IPv4/IPv6 的代码替换为：

```js
const selected = selectRecommendedCfIps(sortedIpList.value, MAX_SELECTED)
selectedIds.value = selected.map(ip => ip.id)
ElMessage.success(`已选择前 ${selected.length} 个 IP`)
```

- [ ] **Step 5：更新界面说明**

将候选池提示中的“每次随机展示 20 个 IP”改为“每次随机展示 50 个 IP（包含 3 个 IPv6）”；按钮继续显示“选前 5（含 IPv6）”。

- [ ] **Step 6：运行所有前端工具测试**

Run: `node --test client-user/test/cf-ip-test-config.test.js client-user/test/cf-ip-optimizer.test.js`

Expected: PASS，全部测试通过。

### Task 6：完整验证

**Files:**
- Verify only

- [ ] **Step 1：运行后端相关测试**

Run: `node --test server/test/test-cf-optimize-service.js server/test/test-stage5-layered-services.js`

Expected: PASS，无失败和未处理异常。

- [ ] **Step 2：运行用户端全部 Node 测试**

Run: `node --test client-user/test/*.js`

Expected: PASS，无失败。

- [ ] **Step 3：执行用户端生产构建**

Working directory: `client-user`

Run: `npm run build`

Expected: Vite 构建成功并生成 `dist/`；若仅因 terser 环境问题失败，按项目命令改用 `npx vite build --minify esbuild`，并如实保留两次日志。

- [ ] **Step 4：检查改动质量**

Run: `git diff --check`

Expected: 无输出，退出码 0。

- [ ] **Step 5：展示验证日志并提醒重启**

向用户汇总修改文件、测试与构建日志。由于修改了 `server/**/*.js`，明确提醒用户重启服务器，但不主动启动。
