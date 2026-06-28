# CF IP 自动推荐优先级调整 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自动推荐仅选择丢包率不高于 20% 的测速结果，并在合格候选中按平均延迟升序选择最多 5 个 IP。

**Architecture:** 以 `selectRecommendedCfIps()` 作为唯一推荐策略入口，在工具层完成合格性筛选、平均延迟排序和 IPv6 兜底选择。Profile、Subscription 和 CfOptimize 三个入口只负责传入测速结果、处理空结果并应用返回值。

**Tech Stack:** Vue 3、JavaScript ES Modules、Node.js `node:test`、Vite

---

## 文件结构

- 修改 `client-user/src/utils/cf-ip-optimizer.js`：定义 20% 丢包率阈值，并实现统一的推荐候选筛选与平均延迟排序。
- 修改 `client-user/test/cf-ip-optimizer.test.js`：覆盖阈值边界、平均延迟优先级、无效指标和现有 IPv6 规则。
- 创建 `client-user/test/cf-ip-recommendation-views.test.js`：验证 Profile、Subscription 和 CfOptimize 三个自动推荐入口均调用公共推荐函数。
- 修改 `client-user/src/views/user/Profile.vue`：用公共推荐函数替换页面内筛选、排序和地址类型补位逻辑。
- 修改 `client-user/src/views/user/Subscription.vue`：用公共推荐函数替换页面内筛选、排序和地址类型补位逻辑。

### Task 1: 更新公共推荐策略

**Files:**
- Modify: `client-user/test/cf-ip-optimizer.test.js`
- Modify: `client-user/src/utils/cf-ip-optimizer.js`

- [ ] **Step 1: 写入失败测试**

将原“优先低丢包率”测试替换为合格候选按平均延迟排序，并新增 20% 阈值与无效平均延迟测试：

```javascript
test('selectRecommendedCfIps 在丢包率不高于 20% 的候选中按平均延迟排序', () => {
  const items = [
    result(1, '1.1.1.1', { packetLoss: 0, avgLatency: 200 }),
    result(2, '1.0.0.1', { packetLoss: 20, avgLatency: 50 }),
    result(3, '8.8.8.8', { packetLoss: 21, avgLatency: 10 })
  ]

  assert.deepEqual(selectRecommendedCfIps(items).map(item => item.id), [2, 1])
})

test('selectRecommendedCfIps 排除平均延迟无效的候选', () => {
  const items = [
    result(1, '1.1.1.1', { avgLatency: 0 }),
    result(2, '1.0.0.1', { avgLatency: Infinity }),
    result(3, '8.8.8.8', { avgLatency: 80 })
  ]

  assert.deepEqual(selectRecommendedCfIps(items).map(item => item.id), [3])
})
```

将“无 IPv6 时按排序选择 IPv4”用例的期望值由 `[3, 2, 1]` 改为 `[3, 1, 2]`，对应平均延迟 `50ms、100ms、200ms`。

- [ ] **Step 2: 运行测试确认按预期失败**

Run:

```bash
node --test client-user/test/cf-ip-optimizer.test.js
```

Expected: FAIL；丢包率 21% 的结果仍被推荐，且丢包率较低但平均延迟较高的结果仍排在前面。

- [ ] **Step 3: 实现最小公共策略**

在 `client-user/src/utils/cf-ip-optimizer.js` 中定义并使用阈值：

```javascript
const MAX_RECOMMENDED_PACKET_LOSS = 20

/**
 * 判断测速结果是否符合自动推荐条件。
 * @param {Object} item - CF IP 测速结果。
 * @returns {boolean} 测试完成、成功连通、平均延迟有效且丢包率不高于阈值时返回 true。
 */
function isRecommendedCandidate(item) {
  const packetLoss = Number(item?.packetLoss)
  const avgLatency = Number(item?.avgLatency)

  return isAvailable(item)
    && Number.isFinite(packetLoss)
    && packetLoss >= 0
    && packetLoss <= MAX_RECOMMENDED_PACKET_LOSS
    && Number.isFinite(avgLatency)
    && avgLatency > 0
}
```

让 `selectRecommendedCfIps()` 先筛选再按平均延迟排序：

```javascript
const available = [...results]
  .filter(isRecommendedCandidate)
  .sort((a, b) => Number(a.avgLatency) - Number(b.avgLatency))
```

`compareCfIpResults()` 继续服务完整结果列表展示，不负责自动推荐门槛。

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
node --test client-user/test/cf-ip-optimizer.test.js
```

Expected: PASS，所有推荐策略及并发池测试通过。

### Task 2: 统一三个自动推荐入口

**Files:**
- Create: `client-user/test/cf-ip-recommendation-views.test.js`
- Modify: `client-user/src/views/user/Profile.vue`
- Modify: `client-user/src/views/user/Subscription.vue`
- Verify: `client-user/src/views/user/CfOptimize.vue`

- [ ] **Step 1: 创建失败的页面结构测试**

创建带职责注释的 `client-user/test/cf-ip-recommendation-views.test.js`：

```javascript
/**
 * CF IP 自动推荐入口结构测试。
 * 确保三个用户端入口统一使用公共推荐策略，避免筛选和排序规则漂移。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const expectations = [
  ['Profile.vue', /selectRecommendedCfIps\(ipTestData\)/],
  ['Subscription.vue', /selectRecommendedCfIps\(ipTestData\)/],
  ['CfOptimize.vue', /selectRecommendedCfIps\(sortedIpList\.value,\s*MAX_SELECTED\)/]
]

for (const [viewName, callPattern] of expectations) {
  test(`${viewName} 使用统一的 CF IP 自动推荐函数`, () => {
    const viewPath = fileURLToPath(new URL(`../src/views/user/${viewName}`, import.meta.url))
    const source = readFileSync(viewPath, 'utf8')

    assert.match(source, callPattern)
  })
}
```

- [ ] **Step 2: 运行测试确认按预期失败**

Run:

```bash
node --test client-user/test/cf-ip-recommendation-views.test.js
```

Expected: FAIL；Profile 和 Subscription 尚未引用 `selectRecommendedCfIps`，CfOptimize 通过。

- [ ] **Step 3: 修改 Profile 和 Subscription**

在两个页面中分别加入：

```javascript
import { selectRecommendedCfIps } from '@/utils/cf-ip-optimizer'
```

将页面内从 `availableIps` 到 `selectedIps` 的重复逻辑替换为：

```javascript
const selectedIps = selectRecommendedCfIps(ipTestData)

if (selectedIps.length === 0) {
  throw new Error('没有丢包率不高于 20% 的可用线路')
}
```

后续 `ipIds` 映射和调用 `applyCfIps()` 的逻辑保持不变。

- [ ] **Step 4: 运行相关测试**

Run:

```bash
node --test client-user/test/cf-ip-optimizer.test.js client-user/test/cf-ip-recommendation-views.test.js client-user/test/cf-optimize-view.test.js
```

Expected: PASS，三个测试文件全部通过。

### Task 3: 完整验证与交付

**Files:**
- Verify: `client-user/src/utils/cf-ip-optimizer.js`
- Verify: `client-user/src/views/user/Profile.vue`
- Verify: `client-user/src/views/user/Subscription.vue`
- Verify: `client-user/src/views/user/CfOptimize.vue`

- [ ] **Step 1: 运行用户端全部 Node 测试**

Run:

```bash
node --test client-user/test/*.test.js
```

Expected: PASS，零失败。

- [ ] **Step 2: 运行生产构建**

Run:

```bash
cd client-user
npm run build
```

Expected: Vite 构建成功并以退出码 0 结束。

- [ ] **Step 3: 检查最终差异**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` 无输出；状态仅包含本计划列出的业务代码和测试文件。

- [ ] **Step 4: 等待用户确认是否提交**

展示修改摘要与完整测试日志。用户明确要求提交后，仅暂存本计划涉及的文件，并使用中文提交信息。
