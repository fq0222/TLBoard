# CF IP 测速配置共享 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一三个 CF IP 优选入口的测速配置，并将测试次数和超时分别调整为 2 次与 2000 毫秒。

**Architecture:** 使用一个无状态 ES 模块提供测速常量，三个 Vue 页面只消费该模块。Node 内置测试直接导入模块，锁定配置契约。

**Tech Stack:** Vue 3、Vite、Node.js `node:test`

---

### Task 1: 建立共享测速配置契约

**Files:**
- Create: `client-user/test/cf-ip-test-config.test.js`
- Create: `client-user/src/utils/cf-ip-test-config.js`

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CF_IP_TEST_COUNT,
  CF_IP_TEST_TIMEOUT,
  CF_IP_TEST_INTERVAL
} from '../src/utils/cf-ip-test-config.js'

test('CF IP 测速使用统一的次数、超时和间隔配置', () => {
  assert.equal(CF_IP_TEST_COUNT, 2)
  assert.equal(CF_IP_TEST_TIMEOUT, 2000)
  assert.equal(CF_IP_TEST_INTERVAL, 200)
})
```

- [ ] **Step 2: 确认测试因共享模块不存在而失败**

Run: `node --test test/cf-ip-test-config.test.js`

Expected: FAIL，提示无法找到 `cf-ip-test-config.js`。

- [ ] **Step 3: 实现共享配置**

```js
/**
 * CF IP 浏览器测速的共享参数。
 * 测试次数与超时控制单个 IP 的探测上限，间隔用于降低连续请求压力。
 */
export const CF_IP_TEST_COUNT = 2
export const CF_IP_TEST_TIMEOUT = 2000
export const CF_IP_TEST_INTERVAL = 200
```

- [ ] **Step 4: 确认配置测试通过**

Run: `node --test test/cf-ip-test-config.test.js`

Expected: PASS，1 个测试通过。

### Task 2: 三个入口接入共享配置

**Files:**
- Modify: `client-user/src/views/user/Profile.vue`
- Modify: `client-user/src/views/user/Subscription.vue`
- Modify: `client-user/src/views/user/CfOptimize.vue`

- [ ] **Step 1: 在三个页面导入共享常量**

```js
import {
  CF_IP_TEST_COUNT as TEST_COUNT,
  CF_IP_TEST_TIMEOUT as TEST_TIMEOUT,
  CF_IP_TEST_INTERVAL as TEST_INTERVAL
} from '@/utils/cf-ip-test-config'
```

- [ ] **Step 2: 删除三个页面中的本地重复常量**

删除各文件原有的 `TEST_COUNT`、`TEST_TIMEOUT`、`TEST_INTERVAL` 声明，其他测速逻辑保持不变。

- [ ] **Step 3: 运行配置测试**

Run: `node --test test/cf-ip-test-config.test.js`

Expected: PASS，1 个测试通过。

- [ ] **Step 4: 执行生产构建**

Run: `npm run build`

Expected: Vite 构建完成，退出码为 0。

> 按项目协作规范，本次不自动执行暂存、提交或推送。
