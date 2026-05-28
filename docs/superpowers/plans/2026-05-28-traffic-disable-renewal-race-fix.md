# 流量禁用与续费解禁竞态修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复“流量超限自动禁用”和“用户续费后自动解禁”之间的竞态，确保刚续费用户不会被旧快照重新禁用，并让相关状态同步入口走统一规则。

**Architecture:** 新增独立的 `userId` 级 PostgreSQL advisory lock 辅助，给续费解禁和超限禁用两条路径共用；在 `traffic-manager` 中把禁用逻辑改成“候选筛选 + 最新状态二次校验”；在 `order-service` 中改为依据续费前状态决定是否解禁，并在锁竞争时把 3X-UI 状态同步降级到现有 `xui_sync_tasks` 队列。顺手收口与本问题直接相关的重复入口，避免旧实现绕过新规则。

**Tech Stack:** Node.js, Express, PostgreSQL, 现有脚本测试（`node server/test/*.js`）

---

## 文件结构

| 文件 | 类型 | 作用 |
|------|------|------|
| `server/services/user-status-lock.js` | 新增 | 提供 `buildUserStatusLockKey()` 和 `withUserStatusLock()`，封装 `pg_try_advisory_lock` |
| `server/services/traffic-manager.js` | 修改 | 为超限禁用增加二次校验、锁保护、锁失败可重试语义 |
| `server/services/order-service.js` | 修改 | 修复续费解禁死判断，接入锁和补偿队列 |
| `server/jobs/index.js` | 修改 | 清理与本问题直接相关的重复入口，确保任务路径只走统一逻辑 |
| `server/test/test-user-status-race.js` | 新增 | 覆盖续费解禁、旧快照误禁用、锁竞争和补偿语义 |
| `server/test/test-xui-sync-task-service.js` | 现有回归 | 验证现有重试队列行为未被破坏 |

---

### Task 1: 先写失败测试，固定竞态行为

**Files:**
- Create: `server/test/test-user-status-race.js`
- Test: `server/test/test-user-status-race.js`

- [ ] **Step 1: 新建测试脚本骨架**

使用 `apply_patch` 新建 `server/test/test-user-status-race.js`：

```javascript
const assert = require('assert');
const trafficManager = require('../services/traffic-manager');
const orderService = require('../services/order-service');
const xuiSyncTaskService = require('../services/xui-sync-task-service');

function createFakeDb() {
  const users = new Map();
  const tasks = [];
  const locks = new Set();

  return {
    users,
    tasks,
    locks,
    pool: {
      async connect() {
        return {
          async query() {
            return { rows: [] };
          },
          release() {}
        };
      }
    },
    prepare(sql) {
      return {
        async get(...params) {
          throw new Error(`Unhandled SQL(get): ${sql} :: ${JSON.stringify(params)}`);
        },
        async run(...params) {
          throw new Error(`Unhandled SQL(run): ${sql} :: ${JSON.stringify(params)}`);
        },
        async all(...params) {
          throw new Error(`Unhandled SQL(all): ${sql} :: ${JSON.stringify(params)}`);
        }
      };
    }
  };
}

async function run() {
  console.log('placeholder');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: 写失败测试，验证“续费前禁用”才决定是否解禁**

在同一文件中新增一个先失败的测试：

```javascript
async function testRenewalShouldUsePreRenewEnabledState() {
  const db = createFakeDb();
  let enqueueCalls = [];

  db.users.set(7, {
    id: 7,
    email: 'renew@test.com',
    enabled: 1,
    current_enabled: 0,
    current_expire_at: 100,
    current_traffic_limit: 10,
    current_plan_id: 1
  });

  const originalEnqueue = xuiSyncTaskService.enqueueTask;
  xuiSyncTaskService.enqueueTask = async (_db, task) => {
    enqueueCalls.push(task);
    return 99;
  };

  try {
    await orderService.completePaidOrder(db, 'REN-001', 'TRADE-001');
    assert.strictEqual(enqueueCalls.some(item => item.taskType === xuiSyncTaskService.TASK_TYPES.ENABLE_SYNC), true);
  } finally {
    xuiSyncTaskService.enqueueTask = originalEnqueue;
  }
}
```

- [ ] **Step 3: 写失败测试，验证流量任务禁用前会重新读取最新 `traffic_limit`**

继续补测试：

```javascript
async function testDisableShouldSkipWhenRenewalRaisedTrafficLimit() {
  const db = createFakeDb();
  db.users.set(8, {
    id: 8,
    email: 'traffic@test.com',
    enabled: 1,
    traffic_used: 120,
    traffic_limit: 200,
    traffic_used_at: null
  });

  let disableCalls = 0;
  const originalSyncDisable = trafficManager.syncDisableStatusToXui;
  trafficManager.syncDisableStatusToXui = async () => {
    disableCalls++;
    return true;
  };

  try {
    await trafficManager.checkAndDisableOverLimitUsers(db, {
      8: {
        email: 'traffic@test.com',
        trafficUsed: 120,
        trafficLimit: 100,
        isOverLimit: true
      }
    });

    assert.strictEqual(disableCalls, 0);
    assert.strictEqual(db.users.get(8).enabled, 1);
  } finally {
    trafficManager.syncDisableStatusToXui = originalSyncDisable;
  }
}
```

- [ ] **Step 4: 写失败测试，验证锁竞争时返回可重试而不是继续执行**

继续补测试：

```javascript
async function testDisableShouldReturnRetryableWhenLockBusy() {
  const db = createFakeDb();
  db.users.set(9, {
    id: 9,
    email: 'busy@test.com',
    enabled: 1,
    traffic_used: 150,
    traffic_limit: 100
  });

  db.locks.add('user-status:9');

  const result = await trafficManager.checkAndDisableOverLimitUsers(db, {
    9: {
      email: 'busy@test.com',
      trafficUsed: 150,
      trafficLimit: 100,
      isOverLimit: true
    }
  });

  assert.strictEqual(result.retryCount, 1);
  assert.strictEqual(db.users.get(9).enabled, 1);
}
```

- [ ] **Step 5: 让测试脚本执行全部用例**

把 `run()` 改成：

```javascript
async function run() {
  await testRenewalShouldUsePreRenewEnabledState();
  await testDisableShouldSkipWhenRenewalRaisedTrafficLimit();
  await testDisableShouldReturnRetryableWhenLockBusy();
  console.log('user status race tests passed');
}
```

- [ ] **Step 6: 运行测试，确认当前失败**

Run: `node server/test/test-user-status-race.js`  
Expected: FAIL，至少有一个断言失败，指向当前实现仍使用事务后 `enabled` 或仍直接按旧 `isOverLimit` 禁用。

- [ ] **Step 7: Commit**

```bash
git add server/test/test-user-status-race.js
git commit -m "test: 新增续费解禁与流量禁用竞态失败测试"
```

---

### Task 2: 提取用户状态锁并接入流量禁用二次校验

**Files:**
- Create: `server/services/user-status-lock.js`
- Modify: `server/services/traffic-manager.js`
- Test: `server/test/test-user-status-race.js`

- [ ] **Step 1: 新增独立锁辅助文件**

使用 `apply_patch` 新建 `server/services/user-status-lock.js`：

```javascript
const crypto = require('crypto');

function buildUserStatusLockKey(userId) {
  const hex = crypto.createHash('sha1').update(`user-status:${userId}`).digest('hex').slice(0, 15);
  return parseInt(hex, 16);
}

async function withUserStatusLock(db, userId, handler) {
  const lockKey = buildUserStatusLockKey(userId);
  const result = await db.prepare('SELECT pg_try_advisory_lock($1) AS locked').get(lockKey);

  if (!result || !result.locked) {
    return {
      success: false,
      retryable: true,
      message: `failed to acquire user status lock: ${userId}`
    };
  }

  try {
    return await handler();
  } finally {
    await db.prepare('SELECT pg_advisory_unlock($1) AS unlocked').get(lockKey);
  }
}

module.exports = {
  buildUserStatusLockKey,
  withUserStatusLock
};
```

- [ ] **Step 2: 在测试桩里补齐 advisory lock SQL 行为**

修改 `server/test/test-user-status-race.js` 的 `createFakeDb()`，在 `prepare(sql).get()` 里加入：

```javascript
if (sql.includes('SELECT pg_try_advisory_lock')) {
  const lockKey = params[0];
  const token = `pg:${lockKey}`;
  if (locks.has(token) || locks.has(`user-status:${lockKey}`)) {
    return { locked: false };
  }
  locks.add(token);
  return { locked: true };
}

if (sql.includes('SELECT pg_advisory_unlock')) {
  locks.delete(`pg:${params[0]}`);
  return { unlocked: true };
}
```

- [ ] **Step 3: 给 `traffic-manager.js` 提取最新状态读取辅助**

在 `server/services/traffic-manager.js` 中新增：

```javascript
async function getLatestUserDisableState(db, userId) {
  return db.prepare(`
    SELECT id, email, enabled, traffic_used, traffic_limit, traffic_used_at
    FROM users
    WHERE id = ?
  `).get(userId);
}
```

- [ ] **Step 4: 把 `checkAndDisableOverLimitUsers()` 改成“锁 + 最新状态二次校验”**

把核心分支替换成：

```javascript
const { withUserStatusLock } = require('./user-status-lock');

async function checkAndDisableOverLimitUsers(db, userTrafficData) {
  let disabledCount = 0;
  let retryCount = 0;

  for (const userId of Object.keys(userTrafficData)) {
    const data = userTrafficData[userId];
    if (!data.isOverLimit) continue;

    const lockedResult = await withUserStatusLock(db, userId, async () => {
      const latestUser = await getLatestUserDisableState(db, userId);
      if (!latestUser || latestUser.enabled === 0) {
        return { success: true, action: 'skip-disabled' };
      }

      const latestUsed = Number(latestUser.traffic_used) || 0;
      const latestLimit = Number(latestUser.traffic_limit) || 0;
      const stillOverLimit = latestLimit > 0 && latestUsed >= latestLimit;

      if (!stillOverLimit) {
        return { success: true, action: 'skip-rechecked' };
      }

      const syncSuccess = await syncDisableStatusToXui(db, Number(userId), true);
      if (!syncSuccess) {
        return { success: false, retryable: true, message: `同步禁用状态失败: ${userId}` };
      }

      await db.prepare(`
        UPDATE users SET enabled = 0, traffic_used_at = ? WHERE id = ?
      `).run(Math.floor(Date.now() / 1000), userId);

      return { success: true, action: 'disabled' };
    });

    if (lockedResult.retryable) {
      retryCount++;
      continue;
    }
    if (lockedResult.success && lockedResult.action === 'disabled') {
      disabledCount++;
    }
  }

  return { disabledCount, retryCount };
}
```

- [ ] **Step 5: 运行新测试，确认流量侧用例通过**

Run: `node server/test/test-user-status-race.js`  
Expected: 仍可能 FAIL，但失败点只剩续费解禁路径相关断言。

- [ ] **Step 6: Commit**

```bash
git add server/services/user-status-lock.js server/services/traffic-manager.js server/test/test-user-status-race.js
git commit -m "feat: 为流量禁用增加用户状态锁与二次校验"
```

---

### Task 3: 修复续费解禁判断，并把锁失败降级到重试队列

**Files:**
- Modify: `server/services/order-service.js`
- Modify: `server/services/traffic-manager.js`
- Test: `server/test/test-user-status-race.js`
- Test: `server/test/test-xui-sync-task-service.js`

- [ ] **Step 1: 让订单查询带出续费前 `enabled`**

把 `completePaidOrder()` 的订单查询 SQL 从：

```javascript
SELECT o.*, u.expire_at as current_expire_at, u.traffic_limit as current_traffic_limit,
       u.email, u.subscription_token, u.plan_id as current_plan_id
```

改成：

```javascript
SELECT o.*, u.expire_at as current_expire_at, u.traffic_limit as current_traffic_limit,
       u.email, u.subscription_token, u.plan_id as current_plan_id,
       u.enabled as current_enabled
```

- [ ] **Step 2: 删掉事务后“重新查 enabled 是否为 0”的死判断**

把：

```javascript
const user = await db.prepare('SELECT enabled FROM users WHERE id = ?').get(order.user_id);
if (user && user.enabled === 0) {
  await db.prepare('UPDATE users SET enabled = 1, traffic_used_at = NULL WHERE id = ?').run(order.user_id);
  trafficManager.syncDisableStatusToXui(db, order.user_id, false).catch(...);
}
```

替换为：

```javascript
if (isRenewOrder && Number(order.current_enabled) === 0) {
  await db.prepare('UPDATE users SET enabled = 1, traffic_used_at = NULL WHERE id = ?').run(order.user_id);
  trafficManager.enqueueUserStatusSync(db, order.user_id, false).catch(error => {
    logger.error(`后台同步解除禁用到 3X-UI 失败: ${error.message}`);
  });
}
```

- [ ] **Step 3: 在 `traffic-manager.js` 新增统一状态同步包装**

新增一个对外可复用的包装函数，负责“拿锁失败时入队补偿”：

```javascript
async function enqueueUserStatusSync(db, userId, disable) {
  const taskType = disable
    ? xuiSyncTaskService.TASK_TYPES.DISABLE_SYNC
    : xuiSyncTaskService.TASK_TYPES.ENABLE_SYNC;

  const result = await syncDisableStatusToXui(db, userId, disable);
  if (result === true) {
    return { success: true, action: disable ? 'disable' : 'enable' };
  }

  await xuiSyncTaskService.enqueueTask(db, {
    userId,
    taskType,
    payload: { disable }
  });

  return { success: false, retryable: true, action: 'queued' };
}
```

- [ ] **Step 4: 让 `syncDisableStatusToXui()` 内部也走用户状态锁**

在 `traffic-manager.js` 中，把 `syncDisableStatusToXui()` 的外层包进：

```javascript
const locked = await withUserStatusLock(db, userId, async () => {
  // 保留原有遍历 server / inbound / client 的同步逻辑
  return { success: allSucceeded };
});

if (!locked.success && locked.retryable) {
  return false;
}

return !!locked.success;
```

注意：如果这里发现和 `checkAndDisableOverLimitUsers()` 重复上锁，会在实现时改成“外层传 `skipLock` 选项”或“只在更高层统一上锁”，不要双重上锁。

- [ ] **Step 5: 给测试脚本补“续费路径锁忙时进入队列”的断言**

在 `server/test/test-user-status-race.js` 中新增：

```javascript
async function testRenewalShouldQueueEnableSyncWhenLockBusy() {
  const db = createFakeDb();
  const queued = [];

  const originalEnqueue = xuiSyncTaskService.enqueueTask;
  xuiSyncTaskService.enqueueTask = async (_db, task) => {
    queued.push(task);
    return 101;
  };

  db.locks.add('user-status:7');

  try {
    const result = await trafficManager.enqueueUserStatusSync(db, 7, false);
    assert.strictEqual(result.retryable, true);
    assert.strictEqual(queued[0].taskType, xuiSyncTaskService.TASK_TYPES.ENABLE_SYNC);
  } finally {
    xuiSyncTaskService.enqueueTask = originalEnqueue;
  }
}
```

- [ ] **Step 6: 运行两个测试脚本**

Run: `node server/test/test-user-status-race.js`  
Expected: `user status race tests passed`

Run: `node server/test/test-xui-sync-task-service.js`  
Expected: `xui sync task service tests passed`

- [ ] **Step 7: Commit**

```bash
git add server/services/order-service.js server/services/traffic-manager.js server/test/test-user-status-race.js
git commit -m "fix: 修复续费解禁与流量禁用状态竞态"
```

---

### Task 4: 收口重复入口并做回归验证

**Files:**
- Modify: `server/services/order-service.js`
- Modify: `server/jobs/index.js`
- Test: `server/test/test-user-status-race.js`
- Test: `server/test/test-xui-sync-task-service.js`

- [ ] **Step 1: 清理 `order-service.js` 中与本问题直接相关的重复定义**

检查并删除或合并重复定义，目标是保留单一真实入口：

```javascript
module.exports = {
  completePaidOrder,
  syncUserToXuiServers,
  enqueueAndTryUserSync
};
```

确认文件中不存在第二份“同名但旧逻辑仍在”的 `syncUserToXuiServers()` 或续费后状态同步分支。

- [ ] **Step 2: 清理 `jobs/index.js` 中重复的 `syncUsersToServer()` 定义**

保留最终生效的一份，并在注释中明确：

```javascript
// 注意：本文件只保留一个 syncUsersToServer 实现，避免旧逻辑绕过新状态同步规则。
async function syncUsersToServer(db, server, users) {
  // 现有最终实现
}
```

- [ ] **Step 3: 确认队列 worker 对启用/禁用任务仍只走统一状态同步入口**

检查 `processDueTasks()` 的处理分支，确保保留：

```javascript
if (task.task_type === xuiSyncTaskService.TASK_TYPES.ENABLE_SYNC) {
  const ok = await trafficManager.syncDisableStatusToXui(db, task.user_id, false);
  return { success: ok, message: ok ? 'ok' : '同步启用状态失败' };
}

if (task.task_type === xuiSyncTaskService.TASK_TYPES.DISABLE_SYNC) {
  const ok = await trafficManager.syncDisableStatusToXui(db, task.user_id, true);
  return { success: ok, message: ok ? 'ok' : '同步禁用状态失败' };
}
```

如果实现阶段发现更适合统一到 `enqueueUserStatusSync()`，则同步改成新入口，但最终必须只保留一种路径。

- [ ] **Step 4: 运行语法检查**

Run: `node -c server/services/user-status-lock.js`  
Expected: 无输出

Run: `node -c server/services/traffic-manager.js`  
Expected: 无输出

Run: `node -c server/services/order-service.js`  
Expected: 无输出

Run: `node -c server/jobs/index.js`  
Expected: 无输出

- [ ] **Step 5: 运行回归测试**

Run: `node server/test/test-user-status-race.js`  
Expected: `user status race tests passed`

Run: `node server/test/test-xui-sync-task-service.js`  
Expected: `xui sync task service tests passed`

- [ ] **Step 6: 检查 diff，确认没有残留旧入口**

Run: `git diff -- server/services/user-status-lock.js server/services/traffic-manager.js server/services/order-service.js server/jobs/index.js server/test/test-user-status-race.js`  
Expected: diff 中能看到 `withUserStatusLock`、`current_enabled`、二次校验逻辑和重复定义清理；不存在第二套旧续费/禁用状态同步路径。

- [ ] **Step 7: Commit**

```bash
git add server/services/user-status-lock.js server/services/traffic-manager.js server/services/order-service.js server/jobs/index.js server/test/test-user-status-race.js
git commit -m "refactor: 收口用户状态同步入口并完成竞态回归"
```

---

## 覆盖检查

- Spec 要求“修复续费解禁死判断”：由 Task 3 覆盖
- Spec 要求“禁用前二次校验最新状态”：由 Task 2 覆盖
- Spec 要求“`userId` 级 advisory lock”：由 Task 2 覆盖
- Spec 要求“锁获取失败不等待、走可重试处理”：由 Task 2 + Task 3 覆盖
- Spec 要求“支付结果不因锁竞争回滚”：由 Task 3 覆盖
- Spec 要求“收口相关重复入口”：由 Task 4 覆盖
- Spec 要求“并发、续费、误禁用回归测试”：由 Task 1 + Task 3 + Task 4 覆盖
