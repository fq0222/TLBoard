# 订单 3X-UI 服务器级并发同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将购买/续费后的 3X-UI 用户同步改为“服务器级最大并发 10、单台服务器内串行”，在不改变现有业务语义的前提下缩短多服务器场景下的总同步耗时。

**Architecture:** 在 [`server/services/shared/order-service.js`](F:\web-project\subscription-manager-v1.0.0\server\services\shared\order-service.js) 中提取单台服务器同步函数，复用已有 [`server/utils/concurrency.js`](F:\web-project\subscription-manager-v1.0.0\server\utils\concurrency.js) 的 `runWithConcurrency()` 对服务器列表做限流并发。每台服务器内部继续按 `getInbounds -> 顺序 upsert inbound -> 必要时顺序 resetClientTraffic` 执行，外层统一归并每台服务器的局部结果并保持 `users.sync_status` 的 finally 收口不变。

**Tech Stack:** Node.js CommonJS、Express 服务层、PostgreSQL 访问代理、现有 3X-UI 集成层、Node `assert` 测试脚本

## Global Constraints

- 只做“服务器级并发 10”，不把单台服务器内部多个 `inbound` 改成并发。
- 保持单台服务器内部业务顺序不变：`getInbounds -> inbound1 add/update -> inbound2 add/update -> resetClientTraffic`。
- 单台服务器失败时不阻断其他服务器同步。
- 保持现有返回语义、日志语义和补偿任务语义不变。
- 不调整 `upsertUniqueClient()` 的唯一锁实现。
- 不修改 `xui_sync_tasks` 的补偿策略。
- 不新增数据库表、迁移或配置项。
- 后端修改完成后必须运行 `server/test/` 下相关脚本验证，并展示完整测试日志。
- 由于会修改 `server/**/*.js`，实施完成后提醒用户重启服务器，不自行启动。

---

## 文件结构

- Modify: `server/services/shared/order-service.js`
  - 新增订单同步并发常量。
  - 提取单台服务器同步函数，保留服务器内串行逻辑。
  - 将外层服务器循环改为 `runWithConcurrency()`。
  - 统一归并局部结果，保留现有 `finally` 收口。
- Modify: `server/test/test-order-xui-sync.js`
  - 扩展订单同步测试，覆盖最大并发 10、单台失败隔离、单机内顺序执行和结果归并。

本次不修改 `server/services/admin/users-service.js`、不改仓储层接口、不改前端和数据库结构。

### Task 1: 为订单同步并发化补齐失败先行测试

**Files:**
- Modify: `server/test/test-order-xui-sync.js`
- Test: `server/test/test-order-xui-sync.js`

**Interfaces:**
- Consumes: `orderService.syncUserToXuiServers(db, user, plan)`
- Produces: 针对“服务器级并发 10、服务器内串行”的回归测试基线

- [ ] **Step 1: 写最大并发 10 和单台失败隔离的失败测试**

在 [`server/test/test-order-xui-sync.js`](F:\web-project\subscription-manager-v1.0.0\server\test\test-order-xui-sync.js) 追加下面的测试函数，直接复用文件内已有的 `replaceMethods()` 和 `createXuiSnapshotHelpers()`：

```javascript
async function testOrderSyncLimitsServerConcurrencyAndIsolatesFailures() {
  const originalGetInstance = XuiService.getInstance;
  let activeServers = 0;
  let maxActiveServers = 0;
  const visitedServers = [];

  const restoreXui = replaceMethods(XuiService, {
    getInstance: async (apiUrl) => ({
      ...createXuiSnapshotHelpers(),
      async upsertUniqueClient() {
        return { success: true, action: 'add' };
      },
      async getInbounds() {
        const serverId = Number(apiUrl.split('/').pop());
        visitedServers.push(serverId);
        activeServers += 1;
        maxActiveServers = Math.max(maxActiveServers, activeServers);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeServers -= 1;
        if (serverId === 7) {
          throw new Error('server-7 failed');
        }
        return {
          success: true,
          data: [{ id: serverId * 10, protocol: 'vless', remark: `cf-${serverId}` }]
        };
      }
    })
  });
  const restoreSyncRepository = replaceMethods(xuiSyncRepository, {
    listOnlineXuiServers: async () => Array.from({ length: 25 }, (_, index) => ({
      id: index + 1,
      name: `server-${index + 1}`,
      api_url: `https://xui/${index + 1}`,
      api_token: 'token',
      panel_version: '3.0.2'
    })),
    findUserNodeConfig: async (db, userId, serverId, inboundId) => ({
      uuid: `uuid-${serverId}-${inboundId}`,
      auth: '',
      sub_id: `sub-${serverId}-${inboundId}`
    })
  });
  const restoreOrderRepository = replaceMethods(orderRepository, {
    updateUserSyncStatus: async () => {}
  });

  try {
    const result = await orderService.syncUserToXuiServers({}, {
      id: 100,
      email: 'concurrency@example.com',
      enabled: 1,
      expire_at: 0,
      traffic_limit: 1073741824,
      referral_traffic_limit: 0
    }, {});

    assert.strictEqual(maxActiveServers, 10);
    assert.strictEqual(visitedServers.length, 25);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.successCount, 24);
    assert.strictEqual(result.failureCount, 1);
    assert.match(result.message, /server-7 failed/);
  } finally {
    restoreOrderRepository();
    restoreSyncRepository();
    restoreXui();
    XuiService.getInstance = originalGetInstance;
  }
}
```

- [ ] **Step 2: 写“单台服务器内 inbound 仍串行”的失败测试**

继续在同一测试文件追加下面的测试，利用事件记录验证顺序：

```javascript
async function testOrderSyncKeepsSingleServerInboundSequence() {
  const events = [];

  const fakeXuiService = {
    ...createXuiSnapshotHelpers(),
    async getInbounds() {
      events.push('getInbounds');
      return {
        success: true,
        data: [
          { id: 101, protocol: 'vless', remark: 'cf-a' },
          { id: 102, protocol: 'vless', remark: 'cf-b' }
        ]
      };
    },
    async upsertUniqueClient(db, context) {
      events.push(`upsert:${context.inbound.id}`);
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { success: true, action: 'update' };
    },
    async resetClientTraffic(inboundId) {
      events.push(`reset:${inboundId}`);
      return { success: true, message: 'reset' };
    }
  };

  const restoreXui = replaceMethods(XuiService, {
    getInstance: async () => fakeXuiService
  });
  const restoreSyncRepository = replaceMethods(xuiSyncRepository, {
    listOnlineXuiServers: async () => [{
      id: 1,
      name: 'single-server',
      api_url: 'https://xui/1',
      api_token: 'token',
      panel_version: '3.2.5'
    }],
    findUserNodeConfig: async (db, userId, serverId, inboundId) => ({
      uuid: `uuid-${inboundId}`,
      auth: '',
      sub_id: `sub-${inboundId}`
    })
  });
  const restoreOrderRepository = replaceMethods(orderRepository, {
    updateUserSyncStatus: async () => {}
  });

  try {
    const result = await orderService.syncUserToXuiServers({}, {
      id: 10,
      email: 'sequence@example.com',
      enabled: 1,
      expire_at: 1702592000,
      traffic_limit: 1073741824,
      referral_traffic_limit: 0
    }, {
      reset_client_traffic: true
    });

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(events, [
      'getInbounds',
      'upsert:101',
      'reset:101',
      'upsert:102',
      'reset:102'
    ]);
  } finally {
    restoreOrderRepository();
    restoreSyncRepository();
    restoreXui();
  }
}
```

- [ ] **Step 3: 将新测试接入 `run()` 并确认当前实现失败**

把 `run()` 调整为：

```javascript
async function run() {
  await testDisabledUserSyncKeepsDisabledState();
  await testTimedRenewSyncResetsClientTraffic();
  await testTimedRenewSyncFailsWhenTrafficResetFails();
  await testCompletePaidTimedRenewResetsLocalTraffic();
  await testOrderSyncLimitsServerConcurrencyAndIsolatesFailures();
  await testOrderSyncKeepsSingleServerInboundSequence();
  console.log('order xui sync tests passed');
}
```

运行：

```powershell
node server/test/test-order-xui-sync.js
```

Expected: FAIL，`maxActiveServers` 小于 `10`，因为当前实现仍按服务器串行执行。

- [ ] **Step 4: 记录失败点并校验测试目标**

确认失败信息至少包含以下含义：

```text
AssertionError: Expected values to be strictly equal:
1 !== 10
```

这说明测试已经锁定“当前外层仍串行”的问题，而不是误测到其他逻辑。

- [ ] **Step 5: 提交测试基线**

```powershell
git add -- server/test/test-order-xui-sync.js
git commit -m "测试：补充订单同步并发场景覆盖"
```

### Task 2: 在订单同步服务中实现服务器级并发 10

**Files:**
- Modify: `server/services/shared/order-service.js`
- Test: `server/test/test-order-xui-sync.js`

**Interfaces:**
- Consumes: `runWithConcurrency(items, limit, worker)` from `../../utils/concurrency`
- Produces:
  - `async function syncUserToSingleServer(db, user, server, plan = {})`
  - `async function syncUserToXuiServers(db, user, plan = {})` with server-level concurrency

- [ ] **Step 1: 在订单服务顶部引入并发工具和并发常量**

把 [`server/services/shared/order-service.js`](F:\web-project\subscription-manager-v1.0.0\server\services\shared\order-service.js) 顶部 import 区调整为：

```javascript
const crypto = require('crypto');
const XuiService = require('../../integrations/xui/xui-service');
const { getServerInboundsSnapshot } = require('../../integrations/xui/xui-sync');
const xuiSyncTaskService = require('../../integrations/xui/xui-sync-task-service');
const { isTimedPlan } = require('./plan-type');
const { createLogger } = require('../../utils/logger');
const { runWithConcurrency } = require('../../utils/concurrency');
const { isValidXuiAuth, generateXuiAuth } = require('../../utils/xui-auth');
const orderRepository = require('../../repositories/order-repository');
const xuiSyncRepository = require('../../repositories/xui-sync-repository');
const referralService = require('../referral-service');
const orderActivationEmailService = require('./order-activation-email-service');

const logger = createLogger('ORDER-SERVICE');
const ORDER_XUI_SYNC_CONCURRENCY = 10;
```

这一步只引入依赖和常量，不改业务逻辑。

- [ ] **Step 2: 提取单台服务器同步函数，保留服务器内串行**

在 `syncUserToXuiServers()` 前新增单台服务器处理函数，内容直接沿用现有内层逻辑：

```javascript
/**
 * 同步用户到单台 3X-UI 服务器。
 * 职责：保留单台服务器内的串行处理顺序，返回局部统计供外层统一归并。
 * 关键参数：db 为数据库代理，user 为用户快照，server 为目标服务器，plan 为套餐/缓存上下文。
 * 核心分支：getInbounds 失败时整台服务器记为失败；单个 inbound 失败时继续处理该服务器后续 inbound。
 *
 * @param {Object} db - 数据库实例。
 * @param {Object} user - 待同步用户快照。
 * @param {Object} server - 目标 3X-UI 服务器。
 * @param {Object} [plan={}] - 套餐和缓存上下文。
 * @returns {Promise<{serverId:number|string,serverName:string,successCount:number,failureCount:number,lastError:string,success:boolean}>}
 */
async function syncUserToSingleServer(db, user, server, plan = {}) {
  let successCount = 0;
  let failureCount = 0;
  let lastError = '';

  try {
    const xuiService = await XuiService.getInstance(server.api_url, server.api_token, {
      apiVersion: server.panel_version || '3.0.2'
    });
    const inboundsResult = await getServerInboundsSnapshot(server, {
      inboundSnapshotCache: plan.inboundSnapshotCache
    });

    if (!inboundsResult.success) {
      return {
        serverId: server.id,
        serverName: server.name,
        successCount: 0,
        failureCount: 1,
        lastError: inboundsResult.message || '获取 inbounds 失败',
        success: false
      };
    }

    for (const inbound of inboundsResult.data) {
      try {
        const nodeEmail = `${user.email}-${inbound.remark || inbound.id}`;
        const expiryTime = user.expire_at ? Number(user.expire_at) * 1000 : 0;
        const totalBytes = getXuiTotalTrafficLimit(user, plan);
        const strategy = inbound.remark && inbound.remark.toLowerCase().includes('hy2')
          ? 'hy2'
          : (inbound.remark && inbound.remark.toLowerCase().includes('direct') ? 'direct' : 'cf');
        const existingClientsSnapshot = xuiService.extractClientsFromSettings(inbound.settings);
        const canUseClientsSnapshot = existingClientsSnapshot.length > 0;
        const existingClientsResult = canUseClientsSnapshot
          ? xuiService.getClientsByEmailFromSnapshot(existingClientsSnapshot, nodeEmail)
          : null;
        const existingClient = existingClientsResult?.clients?.[0] || null;
        const config = await ensureNodeConfig(db, user, server, inbound, existingClient, strategy);
        const desiredClient = {
          id: config.uuid,
          auth: config.auth,
          email: nodeEmail,
          enable: normalizeUserEnabled(user.enabled),
          expiryTime,
          totalGB: totalBytes,
          subId: config.subId,
          strategy,
          protocol: inbound.protocol
        };

        if (strategy === 'direct') {
          desiredClient.flow = 'xtls-rprx-vision';
        }

        const syncResult = await xuiService.upsertUniqueClient(db, {
          userId: user.id,
          serverId: server.id,
          inbound,
          email: nodeEmail,
          existingClientsSnapshot: canUseClientsSnapshot ? existingClientsSnapshot : undefined,
          desiredClient
        });

        if (!syncResult.success) {
          failureCount += 1;
          lastError = syncResult.message || '同步 3X-UI 用户失败';
          continue;
        }

        if (shouldResetClientTraffic(plan)) {
          const resetResult = await xuiService.resetClientTraffic(inbound.id, nodeEmail);
          if (!resetResult.success) {
            failureCount += 1;
            lastError = resetResult.message || '重置 3X-UI 用户流量失败';
            continue;
          }
        }

        successCount += 1;
      } catch (error) {
        failureCount += 1;
        lastError = error.message;
      }
    }
  } catch (error) {
    failureCount += 1;
    lastError = error.message;
  }

  return {
    serverId: server.id,
    serverName: server.name,
    successCount,
    failureCount,
    lastError,
    success: failureCount === 0 && successCount > 0
  };
}
```

这里的关键不是重写逻辑，而是把“单台服务器处理”作为独立边界保留下来。

- [ ] **Step 3: 将外层服务器循环改成 `runWithConcurrency()` 归并**

把 `syncUserToXuiServers()` 中现有的：

```javascript
for (const server of servers) {
  // ...
}
```

整体替换为下面的归并写法：

```javascript
const serverResults = await runWithConcurrency(
  servers,
  ORDER_XUI_SYNC_CONCURRENCY,
  (server) => syncUserToSingleServer(db, user, server, plan)
);

for (const settled of serverResults) {
  if (settled.status === 'fulfilled') {
    successCount += settled.value.successCount;
    failureCount += settled.value.failureCount;
    if (settled.value.lastError) {
      lastError = settled.value.lastError;
    }
    continue;
  }

  failureCount += 1;
  lastError = settled.reason?.message || String(settled.reason);
}
```

不要在 worker 中共享写外层统计变量，统一在外层归并。

- [ ] **Step 4: 保留现有 finally 收口和失败语义**

确认 `syncUserToXuiServers()` 末尾仍保持这段结构：

```javascript
if (failureCount > 0 || successCount === 0) {
  return {
    success: false,
    message: lastError || '3X-UI 同步未完成',
    successCount,
    failureCount
  };
}

return { success: true, successCount, failureCount };
```

以及：

```javascript
} finally {
  await orderRepository.updateUserSyncStatus(db, user.id, 2);
  logger.info(`用户 ${user.email} 同步状态更新为 2（等待结束）`);
}
```

这一步的目标是“改编排，不改状态机语义”。

- [ ] **Step 5: 跑订单同步测试并确认通过**

运行：

```powershell
node server/test/test-order-xui-sync.js
```

Expected:

```text
order xui sync tests passed
```

- [ ] **Step 6: 提交服务改动**

```powershell
git add -- server/services/shared/order-service.js server/test/test-order-xui-sync.js
git commit -m "优化：订单同步按服务器并发处理"
```

### Task 3: 回归验证并整理交付信息

**Files:**
- Modify: `server/test/test-order-xui-sync.js`
- Test: `server/test/test-order-xui-sync.js`

**Interfaces:**
- Consumes: `orderService.syncUserToXuiServers(db, user, plan)` new concurrency behavior
- Produces: 可交付的验证日志与人工验收说明

- [ ] **Step 1: 补一条“结果归并正确”的显式断言**

在 `testOrderSyncLimitsServerConcurrencyAndIsolatesFailures()` 末尾追加：

```javascript
assert.strictEqual(result.successCount + result.failureCount, 25);
assert.strictEqual(result.message, 'server-7 failed');
```

这一步是为了把“并发跑起来了”和“结果归并没有歪”拆开验证。

- [ ] **Step 2: 再次运行订单同步测试**

运行：

```powershell
node server/test/test-order-xui-sync.js
```

Expected:

```text
order xui sync tests passed
```

- [ ] **Step 3: 记录完整测试命令用于交付**

交付时展示以下命令和结果：

```powershell
node server/test/test-order-xui-sync.js
```

Expected:

```text
order xui sync tests passed
```

如果实现过程中额外新增了独立测试文件，也一并展示对应命令和输出。

- [ ] **Step 4: 完成后提醒重启后端**

在最终说明中明确写出：

```text
本次修改涉及 server/**/*.js，请重启后端服务使新逻辑生效。
```

- [ ] **Step 5: 提交最终验证整理**

```powershell
git add -- server/test/test-order-xui-sync.js
git commit -m "测试：确认订单同步并发回归"
```
