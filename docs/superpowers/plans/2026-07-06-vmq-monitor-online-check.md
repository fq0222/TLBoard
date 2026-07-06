# VMQ 监控端在线检查 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在注册购买和非余额续费创建订单前确认 VMQ 监控端在线，失败时阻止支付并返回统一提示。

**Architecture:** 在现有 VMQ 集成模块中增加一个失败关闭的布尔状态方法，集中解释 `/getState` 响应。注册和续费服务在任何数据库写入之前调用该方法；余额续费保留现有流程并绕过检查。

**Tech Stack:** Node.js、CommonJS、Axios、内置 `assert` 测试脚本

---

## 文件结构

- Modify: `server/integrations/vmq/vmq-service.js` — 归一化 VMQ 监控端状态。
- Create: `server/test/test-vmq-monitor-status.js` — 覆盖在线、离线、异常及支付入口行为。
- Modify: `server/services/user/auth-service.js` — 注册购买写库前拦截不可用的 VMQ。
- Modify: `server/services/user/renew-service.js` — 非余额续费写库前拦截，余额支付绕过。

### Task 1: VMQ 状态归一化

**Files:**
- Modify: `server/integrations/vmq/vmq-service.js`
- Create: `server/test/test-vmq-monitor-status.js`

- [ ] **Step 1: 编写 VMQ 状态判断失败测试**

新增测试，通过替换 Axios 的 `get` 方法驱动真实 `getState()` 请求链路：

```javascript
const assert = require('assert');
const axios = require('axios');
const vmqService = require('../integrations/vmq/vmq-service');

async function withAxiosResponse(response, callback) {
  const originalGet = axios.get;
  axios.get = async () => response;
  try {
    return await callback();
  } finally {
    axios.get = originalGet;
  }
}

async function testStringOneMeansOnline() {
  await withAxiosResponse({
    status: 200,
    data: { code: 1, data: { state: '1' } }
  }, async () => {
    assert.strictEqual(await vmqService.isMonitorOnline(), true);
  });
}

async function testOtherStatesMeanOffline() {
  for (const state of ['0', '-1', 1]) {
    await withAxiosResponse({
      status: 200,
      data: { code: 1, data: { state } }
    }, async () => {
      assert.strictEqual(await vmqService.isMonitorOnline(), false);
    });
  }
}

async function testRequestFailureMeansOffline() {
  const originalGet = axios.get;
  axios.get = async () => {
    throw new Error('timeout');
  };
  try {
    assert.strictEqual(await vmqService.isMonitorOnline(), false);
  } finally {
    axios.get = originalGet;
  }
}
```

将三个测试加入脚本的 `run()`，成功日志固定为 `vmq monitor status tests passed`。

- [ ] **Step 2: 运行测试并确认按预期失败**

Run:

```bash
cd server
node test/test-vmq-monitor-status.js
```

Expected: FAIL，错误表明 `vmqService.isMonitorOnline is not a function`。

- [ ] **Step 3: 实现最小状态判断**

在 `getState()` 后增加带职责、参数和返回语义注释的方法：

```javascript
/**
 * 判断 VMQ 监控端是否明确在线。
 * 状态请求失败或响应结构不符合约定时采用失败关闭策略。
 *
 * @returns {Promise<boolean>} 仅 state 严格等于字符串 "1" 时返回 true
 */
async function isMonitorOnline() {
  try {
    const result = await getState();
    return Number(result?.code) === 1 && result?.data?.state === '1';
  } catch (error) {
    return false;
  }
}
```

在 `module.exports` 中导出 `isMonitorOnline`。

- [ ] **Step 4: 运行测试并确认通过**

Run:

```bash
cd server
node test/test-vmq-monitor-status.js
```

Expected: PASS，并输出 `vmq monitor status tests passed`。

- [ ] **Step 5: 提交状态判断**

```bash
git add server/integrations/vmq/vmq-service.js server/test/test-vmq-monitor-status.js
git commit -m "功能：增加VMQ监控端在线判断"
```

### Task 2: 注册购买离线拦截

**Files:**
- Modify: `server/test/test-vmq-monitor-status.js`
- Modify: `server/services/user/auth-service.js`

- [ ] **Step 1: 编写注册购买失败测试**

在测试脚本中替换 `vmqService.isMonitorOnline` 为返回 `false`，并提供只允许读取用户和套餐的假数据库。调用：

```javascript
await assert.rejects(
  () => authService.registerAndPay(db, {
    email: 'offline@example.com',
    password: 'Password123',
    plan_id: 1,
    pay_type: 2
  }),
  (error) => {
    assert.strictEqual(error.statusCode, 503);
    assert.strictEqual(error.code, 5004);
    assert.strictEqual(error.message, '暂时无法支付，请联系客服');
    return true;
  }
);
assert.strictEqual(db.transactionCalled, false);
```

假数据库应在检测到事务调用时设置 `transactionCalled = true`，以证明离线状态下没有数据库写入。

- [ ] **Step 2: 运行测试并确认按预期失败**

Run:

```bash
cd server
node test/test-vmq-monitor-status.js
```

Expected: FAIL，因为注册流程尚未调用状态检查，随后会进入事务或其他下游逻辑。

- [ ] **Step 3: 在注册写库前增加拦截**

在套餐存在和库存校验之后、生成 token 和哈希密码之前加入：

```javascript
if (!await vmqService.isMonitorOnline()) {
  throw createLegacyBusinessError('暂时无法支付，请联系客服', {
    statusCode: 503,
    code: 5004
  });
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run:

```bash
cd server
node test/test-vmq-monitor-status.js
```

Expected: PASS，并输出 `vmq monitor status tests passed`。

- [ ] **Step 5: 提交注册拦截**

```bash
git add server/services/user/auth-service.js server/test/test-vmq-monitor-status.js
git commit -m "功能：注册支付前检查VMQ监控端"
```

### Task 3: 续费支付离线拦截和余额绕过

**Files:**
- Modify: `server/test/test-vmq-monitor-status.js`
- Modify: `server/services/user/renew-service.js`

- [ ] **Step 1: 编写非余额续费离线测试**

替换订单仓储的用户和套餐查询方法，使续费资格通过；替换 `vmqService.isMonitorOnline` 为返回 `false`。断言：

```javascript
await assert.rejects(
  () => renewService.createRenewOrder(db, 7, {
    plan_id: 2,
    pay_type: 2
  }),
  (error) => {
    assert.strictEqual(error.statusCode, 503);
    assert.strictEqual(error.code, 5004);
    assert.strictEqual(error.message, '暂时无法支付，请联系客服');
    return true;
  }
);
assert.strictEqual(db.transactionCalled, false);
```

- [ ] **Step 2: 编写余额续费绕过测试**

将 `vmqService.isMonitorOnline` 替换为一旦调用便抛错的方法，使用足额余额和可执行事务的假数据库，并替换 `orderService.completePaidOrder` 记录完成状态：

```javascript
vmqService.isMonitorOnline = async () => {
  throw new Error('余额支付不应检查 VMQ');
};

const result = await renewService.createRenewOrder(db, 7, {
  plan_id: 2,
  pay_type: 9
});

assert.strictEqual(result.payment_method, 'balance');
assert.strictEqual(result.paid, true);
assert.strictEqual(completed, true);
```

每项替换都必须在 `finally` 中恢复，避免测试相互污染。

- [ ] **Step 3: 运行测试并确认按预期失败**

Run:

```bash
cd server
node test/test-vmq-monitor-status.js
```

Expected: 非余额续费测试 FAIL，因为流程尚未在事务前拦截；余额测试应保持 PASS。

- [ ] **Step 4: 在非余额续费写库前增加拦截**

放在现有余额支付分支返回之后、非余额订单事务之前：

```javascript
if (!await vmqService.isMonitorOnline()) {
  throw createLegacyBusinessError('暂时无法支付，请联系客服', {
    statusCode: 503,
    code: 5004
  });
}
```

该位置天然保证余额支付不会调用检查。

- [ ] **Step 5: 运行测试并确认通过**

Run:

```bash
cd server
node test/test-vmq-monitor-status.js
```

Expected: PASS，并输出 `vmq monitor status tests passed`。

- [ ] **Step 6: 提交续费拦截**

```bash
git add server/services/user/renew-service.js server/test/test-vmq-monitor-status.js
git commit -m "功能：续费支付前检查VMQ监控端"
```

### Task 4: 回归验证与提交整理

**Files:**
- Verify: `server/integrations/vmq/vmq-service.js`
- Verify: `server/services/user/auth-service.js`
- Verify: `server/services/user/renew-service.js`
- Verify: `server/test/test-vmq-monitor-status.js`

- [ ] **Step 1: 运行新增测试**

```bash
cd server
node test/test-vmq-monitor-status.js
```

Expected: `vmq monitor status tests passed`。

- [ ] **Step 2: 运行相关回归测试**

```bash
cd server
node test/test-user-payment-service.js
node test/test-renew-policy.js
node test/test-referral-service.js
```

Expected: 所有脚本退出码均为 `0`，分别输出各自通过日志。

- [ ] **Step 3: 检查差异和工作区**

```bash
git diff --check
git status --short
git log -5 --oneline
```

Expected: `git diff --check` 无输出；仅保留用户原有未提交改动；本功能实现整理为少量中文提交。

- [ ] **Step 4: 交付**

展示上述测试日志，说明注册和非余额续费会失败关闭、余额续费不受影响，并提醒用户因修改 `server/**/*.js` 需要重启后端服务器。不要自行启动服务器，不要推送远程仓库。
