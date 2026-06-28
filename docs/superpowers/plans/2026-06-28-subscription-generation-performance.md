# 用户订阅生成性能优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户首次生成订阅优先复用完整的本地节点配置，只对缺口服务器获取 inbound，并用最大并发 10、明确超时和部分失败降级完成远程请求。

**Architecture:** 生成流程先比较在线服务器的 `xui_nodes` 与当前用户的 `user_node_configs`，命中完整本地状态时跳过服务器级 `getInbounds()`。缺口服务器使用限流任务池定向同步，原始订阅模板也通过同一任务池并发抓取；失败节点最多执行一轮按服务器去重的定向修复，最终只要有一个有效节点即保存成功。

**Tech Stack:** Node.js CommonJS、Express、PostgreSQL、原生 `http`/`https`、Axios、Node `assert` 测试脚本

---

## 文件结构

- Create: `server/utils/concurrency.js`
  - 提供与业务无关的限流任务池，保证结果顺序、最大并发和单任务失败隔离。
- Create: `server/test/test-concurrency.js`
  - 验证任务池并发上限、顺序和失败结果。
- Create: `server/test/test-subscription-generation-performance.js`
  - 验证本地快速路径、定向服务器选择、模板并发、部分失败和一次修复。
- Modify: `server/services/shared/subscription-service.js`
  - 允许原始订阅请求显式传入 5 秒超时，并真正销毁超时的 HTTP 请求。
- Modify: `server/integrations/xui/xui-api-client-v302.js`
  - 允许单次 Axios 请求覆盖默认 timeout。
- Modify: `server/integrations/xui/xui-service.js`
  - 将 `getInbounds({ timeout })` 传递到 API 客户端。
- Modify: `server/integrations/xui/xui-sync.js`
  - 为 inbound 请求应用 10 秒超时，并把全量同步改成最大并发 10、失败隔离。
- Modify: `server/services/shared/order-service.js`
  - 支持仅同步指定服务器，并复用生成请求已经取得的 inbound 快照，避免缺口修复重复获取。
- Modify: `server/services/user/subscription-service.js`
  - 实现本地完整性判断、定向同步、模板并发刷新和一次定向修复。
- Modify: `server/repositories/subscription-repository.js`
  - 保持节点配对查询集中在 repository，并为快速路径返回所需字段。

### Task 1: 增加通用限流并发任务池

**Files:**
- Create: `server/utils/concurrency.js`
- Create: `server/test/test-concurrency.js`

- [ ] **Step 1: 编写并发上限和失败隔离测试**

创建 `server/test/test-concurrency.js`，测试代码应包含以下核心场景：

```javascript
const assert = require('assert');
const { runWithConcurrency } = require('../utils/concurrency');

async function testConcurrencyLimitAndStableResults() {
  let active = 0;
  let maxActive = 0;
  const items = Array.from({ length: 25 }, (_, index) => index);

  const results = await runWithConcurrency(items, 10, async (item) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active -= 1;
    if (item === 7) {
      throw new Error('expected failure');
    }
    return item * 2;
  });

  assert.strictEqual(maxActive, 10);
  assert.strictEqual(results.length, 25);
  assert.deepStrictEqual(results[0], { status: 'fulfilled', value: 0 });
  assert.strictEqual(results[7].status, 'rejected');
  assert.match(results[7].reason.message, /expected failure/);
  assert.deepStrictEqual(results[24], { status: 'fulfilled', value: 48 });
}

async function run() {
  await testConcurrencyLimitAndStableResults();
  console.log('concurrency tests passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
node server/test/test-concurrency.js
```

Expected: FAIL，提示找不到 `../utils/concurrency`。

- [ ] **Step 3: 实现最小限流任务池**

创建 `server/utils/concurrency.js`：

```javascript
/**
 * 按指定并发上限执行任务，并以 allSettled 语义返回每一项结果。
 *
 * @param {Array} items - 待处理项目，结果顺序与输入顺序一致。
 * @param {number} limit - 最大并发数，必须为正整数。
 * @param {Function} worker - 单项异步处理函数，参数为 item 和 index。
 * @returns {Promise<Array<{status:string,value?:*,reason?:Error}>>} 全部任务结果。
 */
async function runWithConcurrency(items, limit, worker) {
  if (!Array.isArray(items)) {
    throw new TypeError('items must be an array');
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TypeError('limit must be a positive integer');
  }
  if (typeof worker !== 'function') {
    throw new TypeError('worker must be a function');
  }

  const results = new Array(items.length);
  let nextIndex = 0;

  async function consume() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = {
          status: 'fulfilled',
          value: await worker(items[index], index)
        };
      } catch (error) {
        results[index] = { status: 'rejected', reason: error };
      }
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => consume()));
  return results;
}

module.exports = { runWithConcurrency };
```

- [ ] **Step 4: 运行任务池测试**

Run:

```powershell
node server/test/test-concurrency.js
```

Expected: PASS，并输出 `concurrency tests passed`。

- [ ] **Step 5: 提交任务池**

```powershell
git add -- server/utils/concurrency.js server/test/test-concurrency.js
git commit -m "新增限流并发任务池"
```

### Task 2: 为两类远程请求增加真实的单请求超时

**Files:**
- Modify: `server/services/shared/subscription-service.js:8-65`
- Modify: `server/integrations/xui/xui-api-client-v302.js:77-123`
- Modify: `server/integrations/xui/xui-service.js:207-226`
- Modify: `server/integrations/xui/xui-sync.js:13-54`
- Create: `server/test/test-subscription-generation-performance.js`

- [ ] **Step 1: 编写原始订阅 5 秒超时和 inbound 10 秒参数传递测试**

在 `server/test/test-subscription-generation-performance.js` 中建立本地 HTTP 服务验证请求会被主动销毁，并通过可替换客户端验证 timeout 参数：

```javascript
const assert = require('assert');
const http = require('http');
const { fetchOriginalSubscription } = require('../services/shared/subscription-service');

async function testSourceFetchUsesConfiguredTimeout() {
  const server = http.createServer(() => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const startedAt = Date.now();

  try {
    await assert.rejects(
      () => fetchOriginalSubscription(
        `http://127.0.0.1:${address.port}/sub/`,
        'token',
        { timeout: 50 }
      ),
      /50ms/
    );
    assert.ok(Date.now() - startedAt < 1000);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}
```

为 `XuiService.getInbounds()` 增加一个使用伪客户端的断言：调用 `getInbounds({ timeout: 10000 })` 后，伪客户端收到 `{ timeout: 10000 }`。

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
node server/test/test-subscription-generation-performance.js
```

Expected: FAIL，因为 `fetchOriginalSubscription` 尚未接受 options，`getInbounds` 也尚未传递单次 timeout。

- [ ] **Step 3: 让原始订阅请求接受显式超时**

将共享订阅请求签名调整为：

```javascript
const DEFAULT_SUBSCRIPTION_FETCH_TIMEOUT_MS = 15000;

async function fetchOriginalSubscription(subUrl, subId, options = {}) {
  const timeout = Number.isFinite(Number(options.timeout))
    ? Number(options.timeout)
    : DEFAULT_SUBSCRIPTION_FETCH_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const fullUrl = `${subUrl}${subId}`;
    const client = fullUrl.startsWith('https') ? https : http;
    const request = client.get(fullUrl, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`获取原始订阅失败，HTTP 状态码: ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', chunk => {
        data += chunk;
      });
      res.on('end', () => resolve(data));
    });

    request.setTimeout(timeout, () => {
      request.destroy(new Error(`获取原始订阅超时: ${timeout}ms`));
    });
    request.on('error', reject);
  });
}
```

保留默认 15 秒以兼容其他调用方；用户生成流程将在 Task 4 显式传入 5000。

- [ ] **Step 4: 让 Axios 单次请求覆盖默认 timeout**

将 v3.0.2 API 客户端改为接受 request options：

```javascript
async request(method, path, data, options = {}) {
  xuiActivityTracker.beginRequest();
  try {
    const response = await this.api.request({
      method,
      url: path,
      ...(data !== undefined ? { data } : {}),
      ...(options.timeout !== undefined ? { timeout: options.timeout } : {})
    });
    return response.data;
  } finally {
    xuiActivityTracker.endRequest();
  }
}

getInbounds(options = {}) {
  return this.request('get', `${this.basePath}/list`, undefined, options);
}
```

将 `XuiService.getInbounds` 调整为：

```javascript
async getInbounds(options = {}) {
  try {
    if (!this.client) {
      await this.init();
    }
    const response = await this.client.getInbounds(options);
    // 保持现有 success/data/message 转换和日志语义不变
  } catch (error) {
    // 保持现有失败结果语义不变
  }
}
```

- [ ] **Step 5: 为生成链路的 inbound 快照应用 10 秒超时**

在 `server/integrations/xui/xui-sync.js` 定义并使用：

```javascript
const INBOUND_REQUEST_TIMEOUT_MS = 10000;

const inboundsResult = await xuiService.getInbounds({
  timeout: options.timeout || INBOUND_REQUEST_TIMEOUT_MS
});
```

导出 `INBOUND_REQUEST_TIMEOUT_MS` 供测试断言。其他直接调用 `xuiService.getInbounds()` 的业务保持原默认超时。

- [ ] **Step 6: 运行超时测试和既有订阅测试**

Run:

```powershell
node server/test/test-subscription-generation-performance.js
node server/test/test-user-subscription-service.js
```

Expected: 两个脚本均 PASS；分别输出对应的 `tests passed`。

- [ ] **Step 7: 提交远程请求超时支持**

```powershell
git add -- server/services/shared/subscription-service.js server/integrations/xui/xui-api-client-v302.js server/integrations/xui/xui-service.js server/integrations/xui/xui-sync.js server/test/test-subscription-generation-performance.js
git commit -m "支持订阅生成请求独立超时"
```

### Task 3: 实现本地完整性判断和缺口服务器定向同步

**Files:**
- Modify: `server/repositories/subscription-repository.js:87-115`
- Modify: `server/services/user/subscription-service.js:200-290,649-686`
- Modify: `server/services/shared/order-service.js:353-450`
- Modify: `server/integrations/xui/xui-sync.js:107-137`
- Modify: `server/test/test-subscription-generation-performance.js`

- [ ] **Step 1: 编写本地快速路径和缺口服务器选择测试**

在性能测试脚本中增加纯函数测试，构造三台服务器、四个本地节点和当前用户配置：

```javascript
const {
  findServersNeedingInboundSync
} = require('../services/user/subscription-service').__testables;

function testOnlyIncompleteServersNeedInboundSync() {
  const servers = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const snapshots = [
    { server_id: 1, inbound_id: 11 },
    { server_id: 1, inbound_id: 12 },
    { server_id: 2, inbound_id: 21 }
  ];
  const configs = [
    { server_id: 1, inbound_id: 11 },
    { server_id: 1, inbound_id: 12 }
  ];

  const result = findServersNeedingInboundSync(servers, snapshots, configs);
  assert.deepStrictEqual(result.map(server => server.id), [2, 3]);
}
```

再增加完整配置场景，断言结果为空，表示首次生成不会调用任何远程 `getInbounds()`。

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
node server/test/test-subscription-generation-performance.js
```

Expected: FAIL，提示 `findServersNeedingInboundSync` 尚不存在。

- [ ] **Step 3: 实现服务器完整性判断**

在用户订阅服务中新增带完整注释的纯函数：

```javascript
function findServersNeedingInboundSync(servers, snapshots, nodeConfigs) {
  const snapshotKeysByServer = new Map();
  const configKeys = new Set(
    nodeConfigs.map(config => buildSourceCacheKey(config.server_id, config.inbound_id))
  );

  for (const snapshot of snapshots) {
    if (!snapshotKeysByServer.has(snapshot.server_id)) {
      snapshotKeysByServer.set(snapshot.server_id, []);
    }
    snapshotKeysByServer.get(snapshot.server_id).push(
      buildSourceCacheKey(snapshot.server_id, snapshot.inbound_id)
    );
  }

  return servers.filter(server => {
    const keys = snapshotKeysByServer.get(server.id) || [];
    return keys.length === 0 || keys.some(key => !configKeys.has(key));
  });
}
```

通过 `module.exports.__testables` 只暴露纯函数给脚本测试，不改变公开业务 API。

- [ ] **Step 4: 将首次全量同步改成仅同步缺口服务器**

在 `generateSubscription()` 中取消首次生成无条件 `syncAllServers()`，改为：

```javascript
const snapshots = filterOnlineSnapshots(
  await subscriptionRepository.listNodeSnapshots(db),
  serversById
);
const existingNodeConfigs = filterOnlineNodeConfigs(
  await subscriptionRepository.listUserNodeConfigs(db, user.id),
  serversById
);
const serversToSync = findServersNeedingInboundSync(
  servers,
  snapshots,
  existingNodeConfigs
);

logger.info(
  `首次生成本地快照检查完成: local=${servers.length - serversToSync.length}, ` +
  `remote=${serversToSync.length}`
);
```

当 `serversToSync` 非空时，通过新 helper `syncSelectedServers()` 执行定向同步；为空时直接进入模板拉取。

- [ ] **Step 5: 为 xui-sync 增加最大并发 10 的指定服务器同步**

在 `server/integrations/xui/xui-sync.js` 新增：

```javascript
const { runWithConcurrency } = require('../../utils/concurrency');
const INBOUND_SYNC_CONCURRENCY = 10;

async function syncSelectedServers(db, servers, options = {}) {
  const startedAt = Date.now();
  const results = await runWithConcurrency(
    servers,
    options.concurrency || INBOUND_SYNC_CONCURRENCY,
    server => syncServerNodes(db, server, options)
  );
  const successful = results.filter(
    result => result.status === 'fulfilled' && result.value.success
  );
  const failed = results.length - successful.length;

  logger.info(
    `指定服务器同步完成: success=${successful.length}, failed=${failed}, ` +
    `duration=${Date.now() - startedAt}ms`
  );

  return {
    success: successful.length > 0 || servers.length === 0,
    syncedCount: successful.length,
    failedCount: failed,
    totalCount: servers.length,
    results
  };
}
```

让 `syncAllServers()` 查询服务器后复用 `syncSelectedServers()`，保持旧返回字段兼容。

- [ ] **Step 6: 让用户同步支持目标服务器和 inbound 快照复用**

在 `syncUserToXuiServers(db, user, plan)` 中支持：

```javascript
const targetServerIds = Array.isArray(plan.serverIds)
  ? new Set(plan.serverIds.map(Number))
  : null;
const targetServers = targetServerIds
  ? servers.filter(server => targetServerIds.has(Number(server.id)))
  : servers;
```

获取 inbound 时优先读取 `plan.inboundSnapshotCache` 中对应服务器、15 分钟内的成功结果；没有缓存才调用 `getInbounds({ timeout: 10000 })`。该分支必须保留现有 UUID、`sub_id`、direct flow 和流量配置逻辑。

订阅服务只把 `serversToSync.map(server => server.id)` 传入 `serverIds`，禁止缺口修复再次遍历所有在线服务器。

- [ ] **Step 7: 运行定向同步测试**

Run:

```powershell
node server/test/test-subscription-generation-performance.js
node server/test/test-user-subscription-service.js
```

Expected: PASS；完整本地配置场景的远程 inbound 调用次数为 0，缺口场景只包含服务器 2 和 3，并发峰值不超过 10。

- [ ] **Step 8: 提交本地快速路径**

```powershell
git add -- server/repositories/subscription-repository.js server/services/user/subscription-service.js server/services/shared/order-service.js server/integrations/xui/xui-sync.js server/test/test-subscription-generation-performance.js
git commit -m "优化订阅生成节点同步路径"
```

### Task 4: 并发拉取原始模板并隔离部分失败

**Files:**
- Modify: `server/services/user/subscription-service.js:352-470,683-730`
- Modify: `server/test/test-subscription-generation-performance.js`

- [ ] **Step 1: 编写模板并发、5 秒超时和部分失败测试**

通过 `refreshSubscriptionSources` 的依赖注入选项传入伪抓取函数，构造 25 个节点：

```javascript
let active = 0;
let maxActive = 0;
const failedInboundIds = new Set([4, 19]);

const result = await refreshSubscriptionSources(
  db,
  user,
  nodeConfigs,
  serversById,
  logger,
  {
    concurrency: 10,
    timeout: 5000,
    fetchSource: async (subUrl, subId, options) => {
      assert.strictEqual(options.timeout, 5000);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      const inboundId = Number(subId.replace('sub-', ''));
      if (failedInboundIds.has(inboundId)) {
        throw new Error('network failure');
      }
      return Buffer.from('vless://uuid@example.com:443').toString('base64');
    }
  }
);

assert.strictEqual(maxActive, 10);
assert.strictEqual(result.successfulConfigs.length, 23);
assert.strictEqual(result.failedConfigs.length, 2);
```

增加生成结果测试：两项失败但至少一项成功时保存缓存；全部失败且没有可复用缓存时抛出“未生成任何可用节点”业务错误。

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
node server/test/test-subscription-generation-performance.js
```

Expected: FAIL，因为当前 `refreshSubscriptionSources()` 串行执行且不返回成功、失败集合。

- [ ] **Step 3: 将模板刷新改为限流并发**

定义：

```javascript
const SOURCE_FETCH_CONCURRENCY = 10;
const SOURCE_FETCH_TIMEOUT_MS = 5000;
```

将刷新函数调整为：

```javascript
async function refreshSubscriptionSources(
  db,
  user,
  nodeConfigs,
  serversById,
  logger,
  options = {}
) {
  const startedAt = Date.now();
  const fetchSource = options.fetchSource || fetchOriginalSubscription;
  const results = await runWithConcurrency(
    nodeConfigs,
    options.concurrency || SOURCE_FETCH_CONCURRENCY,
    async (config) => {
      const server = serversById.get(config.server_id);
      if (!server || !server.sub_url) {
        throw new Error('服务器缺少原始订阅地址');
      }

      const originalContent = await fetchSource(
        server.sub_url,
        config.sub_id,
        { timeout: options.timeout || SOURCE_FETCH_TIMEOUT_MS }
      );
      const originalLink = pickSingleNodeLink(
        parseSubscriptionContent(originalContent),
        config.protocol
      );
      if (!originalLink) {
        throw new Error('未找到匹配协议的原始节点链接');
      }

      await subscriptionRepository.upsertSubscriptionSource(db, {
        user_id: user.id,
        server_id: config.server_id,
        inbound_id: config.inbound_id,
        sub_id: config.sub_id,
        remark: config.remark || '',
        protocol: config.protocol || '',
        original_link: originalLink,
        node_fingerprint: computeNodeFingerprint(config),
        server_fingerprint: computeServerFingerprint(server),
        fetched_at: now,
        updated_at: now
      });
      return config;
    }
  );

  const successfulConfigs = [];
  const failedConfigs = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      successfulConfigs.push(nodeConfigs[index]);
    } else {
      failedConfigs.push(nodeConfigs[index]);
      const config = nodeConfigs[index];
      logger.warn(
        `刷新原始订阅模板失败: user=${user.email}, ` +
        `server=${config.server_id}, inbound=${config.inbound_id}, ` +
        `error=${result.reason.message}`
      );
    }
  });

  logger.info(
    `原始订阅模板刷新完成: success=${successfulConfigs.length}, ` +
    `failed=${failedConfigs.length}, duration=${Date.now() - startedAt}ms`
  );
  return { successfulConfigs, failedConfigs };
}
```

函数开始处定义 `const now = Math.floor(Date.now() / 1000)`，确保同一轮模板使用一致时间戳。

- [ ] **Step 4: 保持缓存复用和部分成功语义**

刷新结束后重新读取 `user_subscription_sources`，继续由 `isSourceCacheUsable()` 校验：

- 当前抓取成功的模板直接使用；
- 当前抓取失败但旧缓存仍匹配 `sub_id`、节点指纹、服务器指纹且未过期时复用；
- 不匹配缓存不参与拼装；
- `composeSubscriptionNodes()` 最终非空即保存成功；
- 最终为空才抛出原有业务错误。

- [ ] **Step 5: 运行模板并发测试**

Run:

```powershell
node server/test/test-subscription-generation-performance.js
node server/test/test-user-subscription-service.js
```

Expected: PASS；25 个任务最大并发为 10，2 个失败不会阻止其余 23 个模板写入。

- [ ] **Step 6: 提交模板并发优化**

```powershell
git add -- server/services/user/subscription-service.js server/test/test-subscription-generation-performance.js
git commit -m "并发刷新原始订阅模板"
```

### Task 5: 增加一次失败节点定向修复与汇总日志

**Files:**
- Modify: `server/services/user/subscription-service.js:649-735`
- Modify: `server/test/test-subscription-generation-performance.js`

- [ ] **Step 1: 编写单轮定向修复测试**

构造服务器 1、2、3，其中服务器 2 的模板首次失败：

```javascript
assert.deepStrictEqual(repairServerIds, [2]);
assert.strictEqual(syncCallsByServer.get(1) || 0, 0);
assert.strictEqual(syncCallsByServer.get(2), 1);
assert.strictEqual(syncCallsByServer.get(3) || 0, 0);
assert.strictEqual(sourceFetchCallsByInbound.get(21), 2);
assert.strictEqual(sourceFetchCallsByInbound.get(11), 1);
assert.strictEqual(sourceFetchCallsByInbound.get(31), 1);
```

再构造服务器 2 修复后仍失败的场景，断言不会进行第三次模板请求，也不会进行第二轮 inbound 修复。

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
node server/test/test-subscription-generation-performance.js
```

Expected: FAIL，因为当前生成流程没有按失败服务器去重的一次修复编排。

- [ ] **Step 3: 实现一次定向修复**

首次模板刷新返回失败配置后：

```javascript
const repairServerIds = [...new Set(
  firstRefresh.failedConfigs.map(config => config.server_id)
)];
const repairServers = repairServerIds
  .map(serverId => serversById.get(serverId))
  .filter(Boolean);

if (repairServers.length > 0) {
  logger.info(
    `开始定向修复原始订阅失败节点: ` +
    `servers=${repairServers.length}, nodes=${firstRefresh.failedConfigs.length}`
  );
  await syncSelectedServers(db, repairServers, {
    concurrency: INBOUND_SYNC_CONCURRENCY,
    timeout: INBOUND_REQUEST_TIMEOUT_MS,
    inboundSnapshotCache: options.inboundSnapshotCache
  });
  nodeConfigs = await ensureUserNodeConfigsComplete(
    db,
    user,
    servers,
    logger,
    {
      ...options,
      targetServerIds: repairServerIds
    }
  );
  const retryConfigs = nodeConfigs.filter(
    config => repairServerIds.includes(config.server_id)
  );
  await refreshSubscriptionSources(
    db,
    user,
    retryConfigs,
    serversById,
    logger,
    {
      concurrency: SOURCE_FETCH_CONCURRENCY,
      timeout: SOURCE_FETCH_TIMEOUT_MS
    }
  );
}
```

修复分支只出现一次，不使用循环。实际实现应确保 `ensureUserNodeConfigsComplete` 只同步 `targetServerIds`，并复用本轮 inbound 快照。

- [ ] **Step 4: 增加生成请求汇总日志**

在 `generateSubscription()` 开始记录时间，并在成功或最终失败前输出：

```javascript
logger.info(
  `订阅生成汇总: user=${user.email}, localServers=${localServerCount}, ` +
  `remoteServers=${serversToSync.length}, inboundSuccess=${inboundSuccessCount}, ` +
  `inboundFailed=${inboundFailedCount}, sourceSuccess=${sourceSuccessCount}, ` +
  `sourceFailed=${sourceFailedCount}, repairServers=${repairServerIds.length}, ` +
  `nodes=${allNodes.length}, duration=${Date.now() - startedAt}ms`
);
```

失败详情不得打印 API Token、完整 UUID、完整 `sub_id` 或原始订阅内容。

- [ ] **Step 5: 运行性能行为测试**

Run:

```powershell
node server/test/test-subscription-generation-performance.js
```

Expected: PASS，并输出 `subscription generation performance tests passed`。

- [ ] **Step 6: 提交定向修复**

```powershell
git add -- server/services/user/subscription-service.js server/test/test-subscription-generation-performance.js
git commit -m "增加订阅失败节点定向修复"
```

### Task 6: 完整回归验证与交付检查

**Files:**
- Verify: `server/test/test-concurrency.js`
- Verify: `server/test/test-subscription-generation-performance.js`
- Verify: `server/test/test-user-subscription-service.js`
- Verify: `server/test/test-xui-sync.js`（如果仓库中存在）

- [ ] **Step 1: 运行新增测试**

Run:

```powershell
node server/test/test-concurrency.js
node server/test/test-subscription-generation-performance.js
```

Expected:

```text
concurrency tests passed
subscription generation performance tests passed
```

- [ ] **Step 2: 运行订阅服务回归测试**

Run:

```powershell
node server/test/test-user-subscription-service.js
```

Expected:

```text
user subscription service tests passed
```

- [ ] **Step 3: 检查实际存在的 3X-UI 相关测试并运行**

Run:

```powershell
Get-ChildItem server/test/test-*xui*.js | Select-Object -ExpandProperty FullName
```

对输出中不依赖真实生产服务器、不会修改真实数据的单元测试逐个运行。不得运行 `migrate-xui-traffic.js` 等迁移或真实服务器操作脚本。

Expected: 所有安全单元测试退出码为 0。

- [ ] **Step 4: 做静态和工作区检查**

Run:

```powershell
node --check server/utils/concurrency.js
node --check server/services/shared/subscription-service.js
node --check server/integrations/xui/xui-api-client-v302.js
node --check server/integrations/xui/xui-service.js
node --check server/integrations/xui/xui-sync.js
node --check server/services/shared/order-service.js
node --check server/services/user/subscription-service.js
node --check server/repositories/subscription-repository.js
git diff --check
git status --short
```

Expected: 所有 `node --check` 和 `git diff --check` 退出码为 0；`git status --short` 只显示本计划范围内尚未提交的文件，或为空。

- [ ] **Step 5: 如有最终整理改动则提交**

只有验证过程中确实产生修复时执行：

```powershell
git add -- server/utils/concurrency.js server/test/test-concurrency.js server/test/test-subscription-generation-performance.js server/services/shared/subscription-service.js server/integrations/xui/xui-api-client-v302.js server/integrations/xui/xui-service.js server/integrations/xui/xui-sync.js server/services/shared/order-service.js server/services/user/subscription-service.js server/repositories/subscription-repository.js
git commit -m "完善订阅生成性能优化验证"
```

- [ ] **Step 6: 交付**

最终回复必须：

- 展示每条测试命令及关键日志；
- 汇总本地快速路径、并发 10、10 秒/5 秒超时、部分失败和一次定向修复已经覆盖；
- 提醒用户修改了 `server/**/*.js`，需要自行重启服务器；
- 不自行启动服务器；
- 不执行 `git push`，除非先展示变更并获得用户明确同意。
