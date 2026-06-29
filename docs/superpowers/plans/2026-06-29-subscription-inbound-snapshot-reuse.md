# 订阅生成复用 inbound 快照 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 来源缓存失效时优先校验并复用巡检写入的本地 inbound 快照，仅对缺少用户或 UUID、`subId` 不一致的服务器并发获取 inbound。

**Architecture:** 在用户订阅服务中增加两个纯函数，分别判断单节点快照可信度和构建按服务器去重的远程补拉计划。生成流程使用现有 `syncSelectedServers()` 并发补拉不可信服务器，完成后重新读取节点配置；日志统一使用用户 email 和服务器备注名称数组。

**Tech Stack:** Node.js、CommonJS、Express 服务层、PostgreSQL 数据访问代理、现有 `runWithConcurrency()` 并发工具、Node `assert` 测试脚本。

---

## 文件结构

- Modify: `server/services/user/subscription-service.js`
  - 增加快照可信度判断、远程补拉计划和服务器名称格式化。
  - 将增量修复中的串行 `syncServerNodes()` 替换为 `syncSelectedServers()`。
  - 调整生成汇总日志及逐 pair 缓存失效日志。
- Modify: `server/services/shared/subscription-cache-service.js`
  - 为缓存可用性判断增加可选静默模式，避免调用方汇总前逐 pair 刷屏。
- Create: `server/test/test-subscription-snapshot-reuse.js`
  - 测试纯判断、远程计划、并发补拉编排和日志脱敏。

不修改数据库结构、巡检周期、订阅接口响应或前端代码。

### Task 1: 为缓存评估增加静默模式

**Files:**
- Modify: `server/services/shared/subscription-cache-service.js:105-151`
- Test: `server/test/test-subscription-snapshot-reuse.js`

- [ ] **Step 1: 创建测试文件并写入静默模式失败测试**

创建 `server/test/test-subscription-snapshot-reuse.js`，先加入以下测试骨架：

```javascript
const assert = require('assert');
const {
  computeNodeFingerprint,
  computeServerFingerprint,
  isSourceCacheUsable
} = require('../services/shared/subscription-cache-service');

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`✓ ${name}`));
}

async function testSilentCacheEvaluation() {
  const originalLog = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.join(' '));
  try {
    const result = isSourceCacheUsable({
      source: {
        sub_id: 'sub-1',
        node_fingerprint: 'outdated',
        server_fingerprint: computeServerFingerprint({ id: 1 }),
        fetched_at: 100
      },
      node: { server_id: 1, inbound_id: 2 },
      server: { id: 1 },
      subId: 'sub-1',
      now: 100,
      maxAgeSeconds: 3600,
      silent: true
    });
    assert.strictEqual(result.reason, 'node_fingerprint_mismatch');
    assert.deepStrictEqual(logs, []);
  } finally {
    console.log = originalLog;
  }
}

async function main() {
  await test('缓存评估静默模式不输出逐节点日志', testSilentCacheEvaluation);
  console.log('subscription snapshot reuse tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
node server/test/test-subscription-snapshot-reuse.js
```

Expected: FAIL，`logs` 中仍包含“来源缓存失效：节点指纹不匹配”。

- [ ] **Step 3: 实现静默日志选项**

在 `isSourceCacheUsable()` 中读取 `silent`，并集中处理日志：

```javascript
function logCacheInvalid(message, silent) {
  if (!silent) {
    console.log(`${LOG_PREFIX} ${message}`);
  }
}

function isSourceCacheUsable({
  source,
  node,
  server,
  subId,
  now,
  maxAgeSeconds,
  silent = false
} = {}) {
  if (!source) {
    logCacheInvalid('来源缓存不存在', silent);
    return { usable: false, reason: 'missing_source' };
  }

  // 其余分支保持现有返回 reason，只把 console.log 改为 logCacheInvalid。
}
```

同步更新 JSDoc：

```javascript
 * @param {boolean} [params.silent=false] - 是否禁止输出逐节点失效日志
```

- [ ] **Step 4: 运行测试并确认通过**

Run:

```bash
node server/test/test-subscription-snapshot-reuse.js
```

Expected:

```text
✓ 缓存评估静默模式不输出逐节点日志
subscription snapshot reuse tests passed
```

- [ ] **Step 5: 提交**

```bash
git add server/services/shared/subscription-cache-service.js server/test/test-subscription-snapshot-reuse.js
git commit -m "优化：支持静默评估订阅来源缓存"
```

### Task 2: 实现本地快照可信度判断

**Files:**
- Modify: `server/services/user/subscription-service.js:45-80,396-430,1387-1398`
- Modify: `server/test/test-subscription-snapshot-reuse.js`

- [ ] **Step 1: 写入快照判断失败测试**

在测试文件中引入测试导出：

```javascript
const subscriptionService = require('../services/user/subscription-service');
const {
  inspectUserInNodeSnapshot
} = subscriptionService.__testables;

function createConfig(overrides = {}) {
  return {
    server_id: 1,
    inbound_id: 2,
    remark: 'cf',
    protocol: 'vless',
    uuid: 'uuid-1',
    sub_id: 'sub-1',
    settings: JSON.stringify({
      clients: [{
        email: 'user@example.com-cf',
        id: 'uuid-1',
        subId: 'sub-1'
      }]
    }),
    stream_settings: '{}',
    ...overrides
  };
}

async function testSnapshotInspection() {
  const user = { email: 'user@example.com' };

  assert.deepStrictEqual(
    inspectUserInNodeSnapshot(user, createConfig()).reason,
    'ok'
  );
  assert.strictEqual(
    inspectUserInNodeSnapshot(user, createConfig({
      settings: JSON.stringify({ clients: [] })
    })).reason,
    'missing_user'
  );
  assert.strictEqual(
    inspectUserInNodeSnapshot(user, createConfig({
      settings: JSON.stringify({
        clients: [{
          email: 'user@example.com-cf',
          id: 'uuid-1',
          subId: 'different'
        }]
      })
    })).reason,
    'sub_id_mismatch'
  );
  assert.strictEqual(
    inspectUserInNodeSnapshot(user, createConfig({
      settings: JSON.stringify({
        clients: [{
          email: 'user@example.com-cf',
          id: 'different',
          subId: 'sub-1'
        }]
      })
    })).reason,
    'uuid_mismatch'
  );
}
```

再补充以下断言：

- `settings: '{'` 返回 `invalid_settings`。
- `settings: '{}'` 返回 `invalid_clients`。
- 同 email 两条客户端返回 `duplicate_user`。
- 缺少 `stream_settings` 返回 `incomplete_snapshot`。
- `remark` 为空时使用 `${email}-${inbound_id}`。

把测试加入 `main()`：

```javascript
await test('本地 inbound 快照按 email、UUID 和 subId 判断可信度', testSnapshotInspection);
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
node server/test/test-subscription-snapshot-reuse.js
```

Expected: FAIL，`inspectUserInNodeSnapshot is not a function`。

- [ ] **Step 3: 实现纯判断函数**

在 `buildSourceCacheKey()` 后增加：

```javascript
/**
 * 判断本地 inbound 快照能否证明当前用户远端身份与数据库配置一致。
 *
 * @param {Object} user - 当前订阅用户，必须包含 email。
 * @param {Object} config - user_node_configs 与 xui_nodes 联查得到的节点配置。
 * @returns {{trusted:boolean,reason:string,expectedEmail:string,client:Object|null}}
 */
function inspectUserInNodeSnapshot(user, config) {
  const expectedEmail = `${user?.email || ''}-${config?.remark || config?.inbound_id || ''}`;
  const requiredFields = [
    'server_id',
    'inbound_id',
    'protocol',
    'settings',
    'stream_settings'
  ];

  if (!config) {
    return { trusted: false, reason: 'missing_snapshot', expectedEmail, client: null };
  }
  if (requiredFields.some((field) => (
    config[field] === null || config[field] === undefined || config[field] === ''
  ))) {
    return { trusted: false, reason: 'incomplete_snapshot', expectedEmail, client: null };
  }

  let settings;
  try {
    settings = typeof config.settings === 'string'
      ? JSON.parse(config.settings)
      : config.settings;
  } catch (error) {
    return { trusted: false, reason: 'invalid_settings', expectedEmail, client: null };
  }
  if (!settings || !Array.isArray(settings.clients)) {
    return { trusted: false, reason: 'invalid_clients', expectedEmail, client: null };
  }

  const matches = settings.clients.filter(
    (client) => String(client?.email || '') === expectedEmail
  );
  if (matches.length === 0) {
    return { trusted: false, reason: 'missing_user', expectedEmail, client: null };
  }
  if (matches.length > 1) {
    return { trusted: false, reason: 'duplicate_user', expectedEmail, client: null };
  }

  const client = matches[0];
  if (
    !client.subId ||
    !config.sub_id ||
    String(client.subId) !== String(config.sub_id)
  ) {
    return { trusted: false, reason: 'sub_id_mismatch', expectedEmail, client };
  }
  if (
    !client.id ||
    !config.uuid ||
    String(client.id) !== String(config.uuid)
  ) {
    return { trusted: false, reason: 'uuid_mismatch', expectedEmail, client };
  }

  return { trusted: true, reason: 'ok', expectedEmail, client };
}
```

将函数加入 `__testables`：

```javascript
__testables: {
  findServersRequiringSync,
  inspectUserInNodeSnapshot
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run:

```bash
node server/test/test-subscription-snapshot-reuse.js
```

Expected: 所有缓存静默与快照判断测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add server/services/user/subscription-service.js server/test/test-subscription-snapshot-reuse.js
git commit -m "功能：校验用户入站快照可信度"
```

### Task 3: 构建远程补拉计划和服务器名称日志

**Files:**
- Modify: `server/services/user/subscription-service.js:390-440,1387-1398`
- Modify: `server/test/test-subscription-snapshot-reuse.js`

- [ ] **Step 1: 写入计划构建失败测试**

加入测试导出：

```javascript
const {
  inspectUserInNodeSnapshot,
  buildInboundRefreshPlan,
  formatServerNames
} = subscriptionService.__testables;
```

加入测试：

```javascript
async function testRefreshPlan() {
  const user = { email: 'user@example.com' };
  const trusted = createConfig({ server_id: 1 });
  const missingUser = createConfig({
    server_id: 2,
    inbound_id: 3,
    remark: 'direct',
    settings: JSON.stringify({ clients: [] })
  });
  const duplicateServerPair = {
    ...missingUser,
    inbound_id: 4,
    remark: 'hy2'
  };
  const serversById = new Map([
    [1, { id: 1, name: '美国01-达拉斯' }],
    [2, { id: 2, name: '日本' }]
  ]);

  const plan = buildInboundRefreshPlan(user, [
    { key: '1:2', config: trusted, reason: 'node_fingerprint_mismatch' },
    { key: '2:3', config: missingUser, reason: 'node_fingerprint_mismatch' },
    { key: '2:4', config: duplicateServerPair, reason: 'node_fingerprint_mismatch' }
  ], serversById);

  assert.strictEqual(plan.reusablePairs.length, 1);
  assert.strictEqual(plan.remotePairs.length, 2);
  assert.deepStrictEqual([...plan.remoteServerIds], [2]);
  assert.deepStrictEqual(plan.remoteServers.map((server) => server.name), ['日本']);
  assert.deepStrictEqual(plan.reasonCounts, { missing_user: 2 });
  assert.strictEqual(
    formatServerNames([
      { id: 1, name: '美国01-达拉斯' },
      { id: 1, name: '美国01-达拉斯' },
      { id: 2, name: '日本' }
    ]),
    '[美国01-达拉斯, 日本]'
  );
  assert.strictEqual(formatServerNames([]), '[]');
}
```

将测试加入 `main()`。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
node server/test/test-subscription-snapshot-reuse.js
```

Expected: FAIL，`buildInboundRefreshPlan is not a function`。

- [ ] **Step 3: 实现计划函数与日志格式函数**

```javascript
/**
 * 将服务器列表格式化为去重后的备注名称数组，保留原始顺序。
 *
 * @param {Array<Object>} servers - 服务器记录。
 * @returns {string} 日志使用的服务器名称数组。
 */
function formatServerNames(servers) {
  const names = [];
  const seen = new Set();
  for (const server of servers || []) {
    const key = String(server?.id ?? server?.name ?? '');
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    names.push(server.name || `未知服务器-${server.id}`);
  }
  return `[${names.join(', ')}]`;
}

/**
 * 按快照可信度划分可本地复用节点与需要远程补拉的服务器。
 *
 * @param {Object} user - 当前用户。
 * @param {Array<Object>} invalidPairs - 来源缓存失效节点。
 * @param {Map<number,Object>} serversById - 在线服务器映射。
 * @returns {Object} 快照复用与远程补拉计划。
 */
function buildInboundRefreshPlan(user, invalidPairs, serversById) {
  const reusablePairs = [];
  const remotePairs = [];
  const remoteServerIds = new Set();
  const reasonCounts = {};

  for (const pair of invalidPairs) {
    const inspection = inspectUserInNodeSnapshot(user, pair.config);
    if (inspection.trusted) {
      reusablePairs.push({ ...pair, inspection });
      continue;
    }
    remotePairs.push({ ...pair, inspection });
    remoteServerIds.add(pair.config.server_id);
    reasonCounts[inspection.reason] = (reasonCounts[inspection.reason] || 0) + 1;
  }

  const remoteServers = [];
  for (const serverId of remoteServerIds) {
    const server = serversById.get(serverId);
    if (server) {
      remoteServers.push(server);
    }
  }

  return {
    reusablePairs,
    remotePairs,
    remoteServerIds,
    remoteServers,
    reasonCounts
  };
}
```

将两个函数加入 `__testables`。

- [ ] **Step 4: 让来源缓存评估使用静默模式**

在 `collectSourceCacheStatus()` 调用 `isSourceCacheUsable()` 时增加：

```javascript
silent: true
```

保留 `reason` 到 `invalidPairs`，由生成服务输出一次汇总日志。

- [ ] **Step 5: 运行测试并确认通过**

Run:

```bash
node server/test/test-subscription-snapshot-reuse.js
```

Expected: 所有测试 PASS，并且测试日志不出现逐 pair “节点指纹不匹配”。

- [ ] **Step 6: 提交**

```bash
git add server/services/user/subscription-service.js server/test/test-subscription-snapshot-reuse.js
git commit -m "功能：规划订阅入站快照远程补拉"
```

### Task 4: 将增量修复改为按服务器并发补拉

**Files:**
- Modify: `server/services/user/subscription-service.js:790-1015`
- Modify: `server/test/test-subscription-snapshot-reuse.js`

- [ ] **Step 1: 写入并发编排失败测试**

为了直接验证生成流程，在测试文件中加入可复用的仓储 mock 恢复函数：

```javascript
const subscriptionRepository = require('../repositories/subscription-repository');

async function withRepositoryMocks(mocks, fn) {
  const originals = {};
  for (const [key, value] of Object.entries(mocks)) {
    originals[key] = subscriptionRepository[key];
    subscriptionRepository[key] = value;
  }
  try {
    return await fn();
  } finally {
    Object.assign(subscriptionRepository, originals);
  }
}
```

构造两台服务器、两个指纹失效来源缓存和两个缺少用户的快照，通过 `generateSubscription()` 的 `options.dependencies.syncSelectedServers` 注入并发桩：

```javascript
let active = 0;
let maxActive = 0;
const syncCalls = [];
const syncSelectedServers = async (db, servers) => {
  syncCalls.push(servers.map((server) => server.name));
  const results = await Promise.all(servers.map(async (server) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return { success: true, serverId: server.id, nodeCount: 1 };
  }));
  return { success: true, results };
};
```

断言：

```javascript
assert.deepStrictEqual(syncCalls, [['美国01-达拉斯', '日本']]);
assert.strictEqual(maxActive, 2);
```

仓储 mock 还必须：

- 返回启用用户及 CF IP。
- 返回两台在线服务器。
- 返回两条 `user_node_configs`。
- 首次来源缓存查询返回指纹失效记录。
- 同步后的查询返回可供模板刷新与最终拼装的相同节点配置。
- `upsertSubscriptionSource()` 在内存 Map 写入新来源缓存。
- `saveUserSubscriptionCache()` 记录最终节点。
- `fetchOriginalSubscription()` 返回与协议匹配的单节点订阅内容。

日志 mock 收集 `info()`、`warn()`、`error()` 字符串，用于后续日志断言。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
node server/test/test-subscription-snapshot-reuse.js
```

Expected: FAIL；现有流程不会调用注入的 `syncSelectedServers`，或两台服务器仍按 `syncServerNodes` 串行处理。

- [ ] **Step 3: 替换增量修复编排**

在来源缓存不可用分支中：

```javascript
const refreshPlan = buildInboundRefreshPlan(
  user,
  cacheStatus.invalidPairs,
  serversById
);
const affectedServers = cacheStatus.invalidPairs
  .map((pair) => serversById.get(pair.config.server_id))
  .filter(Boolean);

logger.info(
  `本地 inbound 快照评估: user=${user.email}, `
  + `servers=${formatServerNames(affectedServers)}, `
  + `invalidPairs=${cacheStatus.invalidPairs.length}, `
  + `reusedPairs=${refreshPlan.reusablePairs.length}, `
  + `remotePairs=${refreshPlan.remotePairs.length}, `
  + `reasons=${JSON.stringify(refreshPlan.reasonCounts)}`
);

if (refreshPlan.remoteServers.length > 0) {
  const inboundStartedAt = Date.now();
  const syncServers = options.dependencies?.syncSelectedServers || syncSelectedServers;
  const syncResult = await syncServers(db, refreshPlan.remoteServers, {
    inboundSnapshotCache: options.inboundSnapshotCache
  });

  refreshPlan.remoteServers.forEach((server, index) => {
    recordInboundResult(server, syncResult.results?.[index]);
  });

  logger.info(
    `inbound 并发补拉完成: user=${user.email}, `
    + `servers=${formatServerNames(refreshPlan.remoteServers)}, `
    + `success=${syncResult.syncedCount ?? syncResult.results?.filter((item) => item?.success).length ?? 0}, `
    + `failed=${syncResult.failedCount ?? syncResult.results?.filter((item) => !item?.success).length ?? 0}, `
    + `duration=${Date.now() - inboundStartedAt}ms`
  );

  nodeConfigs = await ensureUserNodeConfigsComplete(db, user, servers, logger, options);
} else {
  logger.info(
    `复用本地 inbound 快照: user=${user.email}, `
    + `servers=${formatServerNames(affectedServers)}, `
    + `pairs=${refreshPlan.reusablePairs.length}`
  );
}
```

删除增量修复分支里的逐服务器 `syncServerNodes()` 循环。保留其他首次生成、模板失败定向修复路径，避免扩大本次改动范围。

- [ ] **Step 4: 远程补拉后重新读取并重算刷新节点**

远程补拉后重新调用：

```javascript
nodeConfigs = filterOnlineNodeConfigs(
  await subscriptionRepository.listUserNodeConfigs(db, user.id),
  serversById
);
```

重新按 key 构造 `repairConfigs`。只刷新最初失效的 pair，不刷新本轮未失效来源：

```javascript
const repairConfigs = nodeConfigs.filter((config) => (
  cacheStatus.invalidPairKeys.has(
    buildSourceCacheKey(config.server_id, config.inbound_id)
  )
));
```

如果补拉后的配置仍不可信，调用现有 `reloadRepairNodeConfigs()` 对对应服务器执行一次用户补偿，再用返回的新配置替换这些服务器的旧配置。不得使用循环。

- [ ] **Step 5: 运行并发编排测试**

Run:

```bash
node server/test/test-subscription-snapshot-reuse.js
```

Expected:

- `syncSelectedServers` 只调用一次。
- 参数包含两台具体服务器。
- `maxActive === 2`。
- 模板刷新成功，最终生成节点不为空。

- [ ] **Step 6: 提交**

```bash
git add server/services/user/subscription-service.js server/test/test-subscription-snapshot-reuse.js
git commit -m "优化：并发补拉不可信入站快照"
```

### Task 5: 完成日志语义和安全测试

**Files:**
- Modify: `server/services/user/subscription-service.js:790-1030`
- Modify: `server/test/test-subscription-snapshot-reuse.js`

- [ ] **Step 1: 写入日志失败测试**

对 Task 4 收集的日志增加断言：

```javascript
const joinedLogs = logMessages.join('\n');
assert.match(joinedLogs, /user=user@example\.com/);
assert.match(joinedLogs, /servers=\[美国01-达拉斯, 日本\]/);
assert.doesNotMatch(joinedLogs, /user=19(?:,|\\s|$)/);
assert.doesNotMatch(joinedLogs, /uuid-1/);
assert.doesNotMatch(joinedLogs, /sub-1/);
assert.doesNotMatch(joinedLogs, /api_token/i);
```

增加无需远程补拉的场景，断言：

```javascript
assert.match(
  joinedLogs,
  /复用本地 inbound 快照: user=user@example\.com, servers=\[美国01-达拉斯, 日本\]/
);
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
node server/test/test-subscription-snapshot-reuse.js
```

Expected: FAIL，最终汇总仍使用数字 `user.id`，且服务器字段仍为数量。

- [ ] **Step 3: 调整最终生成汇总**

生成流程维护两组服务器对象：

```javascript
const remoteServers = [];
const remoteServerIds = new Set();

function recordInboundResult(server, result) {
  if (!remoteServerIds.has(server.id)) {
    remoteServerIds.add(server.id);
    remoteServers.push(server);
  }
  inboundOutcomes.set(server.id, !!result?.success);
}
```

最终汇总改为：

```javascript
const localServers = servers.filter((server) => !remoteServerIds.has(server.id));
logger.info(
  `订阅生成汇总: user=${user.email}, `
  + `localServers=${formatServerNames(localServers)}, `
  + `remoteServers=${formatServerNames(remoteServers)}, `
  + `snapshotReused=${summary.snapshotReused || 0}, `
  + `snapshotRejected=${summary.snapshotRejected || 0}, `
  + `inboundSuccess=${summary.inboundSuccess}, `
  + `inboundFailed=${summary.inboundFailed}, `
  + `sourceSuccess=${summary.sourceSuccess}, `
  + `sourceFailed=${summary.sourceFailed}, `
  + `nodes=${summary.nodes}, duration=${Date.now() - generationStartedAt}ms`
);
```

在快照计划产生后设置：

```javascript
summary.snapshotReused = refreshPlan.reusablePairs.length;
summary.snapshotRejected = refreshPlan.remotePairs.length;
```

首次生成没有来源缓存时保持两个值为 `0`。

- [ ] **Step 4: 运行日志测试并确认通过**

Run:

```bash
node server/test/test-subscription-snapshot-reuse.js
```

Expected: 所有测试 PASS；日志断言确认 email、服务器备注名称与凭据脱敏。

- [ ] **Step 5: 提交**

```bash
git add server/services/user/subscription-service.js server/test/test-subscription-snapshot-reuse.js
git commit -m "优化：完善订阅生成快照日志"
```

### Task 6: 回归验证和交付

**Files:**
- Verify: `server/services/user/subscription-service.js`
- Verify: `server/services/shared/subscription-cache-service.js`
- Verify: `server/test/test-subscription-snapshot-reuse.js`
- Verify: `server/test/test-user-subscription-service.js`

- [ ] **Step 1: 运行专项测试**

Run:

```bash
node server/test/test-subscription-snapshot-reuse.js
```

Expected:

```text
subscription snapshot reuse tests passed
```

- [ ] **Step 2: 运行用户订阅服务回归测试**

Run:

```bash
node server/test/test-user-subscription-service.js
```

Expected:

```text
user subscription service tests passed
```

- [ ] **Step 3: 运行现有订阅与 XUI 相关测试**

先列出实际存在的测试文件：

```powershell
Get-ChildItem server/test -File |
  Where-Object { $_.Name -match 'subscription|xui' } |
  Select-Object -ExpandProperty FullName
```

对列表中不需要真实生产服务器、不会修改真实数据的自动化测试逐个执行。至少执行已有的缓存、用户订阅服务和 XUI 同步单元测试；需要真实 3X-UI 或数据库写入的脚本只列出并说明未执行原因，不使用测试账号或真实凭据自行连接。

Expected: 所有安全可运行的自动化测试退出码均为 0。

- [ ] **Step 4: 检查变更质量**

Run:

```bash
git diff --check
git status --short
```

Expected:

- `git diff --check` 无输出。
- `git status --short` 只包含本计划涉及且尚未提交的预期文件；若各任务均已提交则为空。

- [ ] **Step 5: 展示测试日志并提醒重启**

最终回复必须包含：

- 专项测试完整结论。
- 用户订阅服务回归测试结论。
- 其他已执行脚本名称及退出状态。
- 未执行的真实外部依赖脚本及原因。
- 性能行为预期：可信快照不请求 inbound；不可信服务器按服务器并发。
- 因修改了 `server/**/*.js`，提醒用户重启后端服务器。
- 不自行启动服务器。
