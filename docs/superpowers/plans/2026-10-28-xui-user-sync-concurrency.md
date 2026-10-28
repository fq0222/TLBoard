# 3X-UI 六小时用户同步并发 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将六小时 3X-UI 巡检改为单台服务器内最多并发同步 10 个用户，同时保持服务器串行、失败隔离和现有调度语义。

**Architecture:** 复用 `server/utils/concurrency.js` 的 `runWithConcurrency()`，在 `syncUsersToServer()` 的新版、旧版面板分支分别建立用户任务池。服务器级编排仍使用顺序循环；服务器快照、人数缓存和检查时间继续在用户任务池之外每台执行一次。

**Tech Stack:** Node.js、CommonJS、PostgreSQL、3X-UI HTTP API、Node `assert` 测试脚本

**Spec:** `docs/superpowers/specs/2026-10-28-xui-user-sync-concurrency-design.md`

## Global Constraints

- 复用现有 `runWithConcurrency()`，不得新增并发依赖或使用无上限 `Promise.all()`。
- 用户并发上限固定为 `10`，不新增环境变量。
- 服务器之间保持串行；旧版面板的 inbound 之间也保持串行。
- 同时覆盖 3X-UI 3.4.2+ 和旧版面板同步分支。
- 不修改六小时周期、启动延迟、手动触发接口或统一调度器的同名任务合并行为。
- 不新增数据库迁移，不修改现有 advisory lock、唯一约束或重试队列。
- 新增内部方法必须补充职责、关键参数、返回值和核心分支语义注释。
- 不自行启动服务器；修改 `server/**/*.js` 后在交付时提醒用户重启。
- 未获得用户同意前不得 `git push`。

## Review Focus

- 用户数少于并发上限或为空时，只处理实际用户且不产生额外任务；Task 2 的新版和旧版测试均断言调用次数等于输入数。
- 某个 worker 抛异常时，其余用户仍完成；Task 2 的失败隔离测试断言全部用户都被尝试。
- 3X-UI 返回 `{ success: false }` 而非抛错时，必须计入失败而不是同步成功；Task 2 的结果汇总测试覆盖该分支。
- inbound settings 解析失败时，新版仍回退 clients API、旧版仍跳过该 inbound；Task 2 运行现有回归测试并保留对应断言。
- 同时存在多台服务器时不能形成服务器级并发；Task 2 的 `runXuiSync()` 编排测试观测最大活跃服务器数为 `1`。

---

### Task 1: 固化设计与实施计划

**Files:**
- Create: `docs/superpowers/specs/2026-10-28-xui-user-sync-concurrency-design.md`
- Create: `docs/superpowers/plans/2026-10-28-xui-user-sync-concurrency.md`

**Interfaces:**
- Consumes: 用户已批准的“服务器串行、单台服务器内用户最大并发 10”设计。
- Produces: Task 2 实施时必须遵循的设计与步骤文档。

- [ ] **Step 1: 暂存已批准的设计与计划**

```bash
git add docs/superpowers/specs/2026-10-28-xui-user-sync-concurrency-design.md docs/superpowers/plans/2026-10-28-xui-user-sync-concurrency.md
```

- [ ] **Step 2: 检查暂存文档格式**

Run: `git diff --cached --check`

Expected: 命令退出码为 `0`，无输出。

- [ ] **Step 3: 提交设计与计划文档**

```bash
git commit -m "文档：设计六小时用户并发同步方案"
```

### Task 2: 实现并验证用户级受限并发

**Files:**
- Modify: `server/jobs/handlers/sync-xui-users.js:11-13,487-680,721-765`
- Modify: `server/test/test-xui-sync-users-job.js:399-664`
- Test: `server/test/test-concurrency.js`
- Test: `server/test/test-managed-server-counts.js`
- Test: `server/test/test-admin-xui-user-sync.js`

**Interfaces:**
- Consumes: `runWithConcurrency(items, limit, worker) -> Promise<Array<{status, value?, reason?}>>`。
- Produces: `XUI_USER_SYNC_CONCURRENCY = 10`；内部方法 `syncModernUserToServer(db, server, user, context) -> Promise<'synced'|'skipped'|'failed'>`；内部方法 `syncLegacyInboundUser(db, server, inbound, user, context) -> Promise<'synced'|'failed'>`；支持依赖注入的 `runXuiSync(db, dependencies = {}) -> Promise<void>`。

- [ ] **Step 1: 编写 3.4.2+ 用户并发上限测试**

在 `server/test/test-xui-sync-users-job.js` 新增 `testModernSyncShouldLimitUserConcurrencyToTen()`：构造 25 个状态不一致用户，用 stub `upsertServerClient()` 统计 `active`、`maxActive` 和已处理邮箱；每次调用短暂异步等待后成功。

精确断言：

- `maxActive === 10`
- 已处理邮箱数量为 `25`
- 25 个邮箱各出现一次
- `getInbounds()`、节点快照刷新和 `updateServerLastCheckAt()` 各调用一次

- [ ] **Step 2: 运行新版并发测试并确认失败**

Run: `node server/test/test-xui-sync-users-job.js`

Expected: FAIL，`maxActive` 实际为 `1`。

- [ ] **Step 3: 实现 3.4.2+ 单用户方法和任务池**

在 `server/jobs/handlers/sync-xui-users.js`：

- 引入 `runWithConcurrency`，定义 `XUI_USER_SYNC_CONCURRENCY = 10`。
- 新增并注释 `syncModernUserToServer(db, server, user, context)`；`context` 明确包含 `inbounds`、`inboundIds`、`requiresFlow`、`xuiService`、`repository`、`logger`。
- 将现有 3.4.2+ `for (const user of users)` 的单用户逻辑原样迁入该方法，保持本地凭证优先、快照回退、节点配置保存和强制修复语义。
- 用 `runWithConcurrency(users, XUI_USER_SYNC_CONCURRENCY, worker)` 取代串行循环；worker 捕获单用户异常、记录原有上下文并返回 `'failed'`。
- 根据 settled results 汇总 `synced`、`skipped`、`failed`，输出单台服务器汇总日志。
- 将常量和新方法加入 `__testables`，便于精确测试。

- [ ] **Step 4: 运行新版并发与现有凭证回归测试**

Run: `node server/test/test-xui-sync-users-job.js`

Expected: PASS，末行包含 `test-xui-sync-users-job: PASS`。

- [ ] **Step 5: 编写新版失败隔离与业务失败统计测试**

在同一测试文件新增 `testModernSyncShouldIsolateUserFailures()`，使用 12 个用户：

- 一个 `upsertServerClient()` 抛出 `network peak`。
- 另一个返回 `{ success: false, message: 'remote rejected' }`。
- 其余返回成功。

精确断言：12 个用户都进入 upsert；日志汇总为成功 `10`、失败 `2`；异常与业务失败用户的日志都包含邮箱和服务器名。

- [ ] **Step 6: 运行失败隔离测试并确认通过**

Run: `node server/test/test-xui-sync-users-job.js`

Expected: PASS；若失败，修正结果分类或日志汇总，不改变远端同步逻辑。

- [ ] **Step 7: 编写旧版面板用户并发上限与失败隔离测试**

新增 `testLegacySyncShouldLimitEachInboundUserConcurrencyToTen()`：构造一个旧版 inbound 和 25 个用户，通过 stub `upsertUniqueClient()` 统计并发及调用邮箱，其中一个用户抛错。

精确断言：

- `maxActive === 10`
- 25 个用户全部被尝试且各一次
- 单用户异常不阻断其他 24 个用户
- `getInbounds()`、快照刷新和检查时间更新仍各一次

再构造两个 inbound，记录第二个 inbound 的首个调用发生时间，断言第一个 inbound 的 25 个任务全部结束后才开始第二个 inbound。

- [ ] **Step 8: 运行旧版并发测试并确认失败**

Run: `node server/test/test-xui-sync-users-job.js`

Expected: FAIL，首个场景的 `maxActive` 实际为 `1`。

- [ ] **Step 9: 实现旧版单用户方法和每 inbound 任务池**

在 `server/jobs/handlers/sync-xui-users.js`：

- 新增并注释 `syncLegacyInboundUser(db, server, inbound, user, context)`；`context` 包含 `existingClientsSnapshot`、`xuiService`、`repository`、`logger`。
- 将旧版内层 `for (const user of users)` 逻辑迁入该方法，保持节点邮件名、hy2 auth、direct flow、凭证生成和 `upsertUniqueClient()` 参数不变。
- 保留 inbound 外层 `for...of`；每个 inbound 内调用 `runWithConcurrency(users, 10, worker)` 并等待完成后才进入下一个 inbound。
- worker 捕获并记录单用户异常；按 settled results 累加该服务器成功与失败数量。
- 将新方法加入 `__testables`。

- [ ] **Step 10: 运行新旧面板同步测试**

Run: `node server/test/test-xui-sync-users-job.js`

Expected: PASS，末行包含 `test-xui-sync-users-job: PASS`。

- [ ] **Step 11: 编写服务器仍串行的编排测试**

新增 `testRunXuiSyncShouldKeepServersSequential()`：为 `runXuiSync()` 注入返回 2 台服务器的 repository 和可观测 `syncServer`；`syncServer` 统计活跃服务器数并短暂异步等待。

精确断言：

- 两台服务器按输入顺序执行
- `maxActiveServers === 1`
- 用户列表和服务器列表各查询一次

- [ ] **Step 12: 运行服务器串行测试并确认失败**

Run: `node server/test/test-xui-sync-users-job.js`

Expected: FAIL，因为当前 `runXuiSync()` 不接受依赖注入。

- [ ] **Step 13: 为 `runXuiSync()` 增加最小依赖注入**

将签名改为 `runXuiSync(db, dependencies = {})`，仅允许注入：

- `repository`，默认 `xuiSyncRepository`
- `serverRepository`，默认 `serversRepository`
- `syncServer`，默认 `syncUsersToServer`
- `logger`，默认模块 logger

保留服务器 `for...of + await syncServer(...)`，不将服务器放入任务池；生产调用 `runXuiSync(db)` 的行为不变。

- [ ] **Step 14: 运行任务级测试并确认通过**

Run: `node server/test/test-xui-sync-users-job.js`

Expected: PASS，末行包含 `test-xui-sync-users-job: PASS`。

- [ ] **Step 15: 运行相关后端回归测试**

依次运行：

```bash
node server/test/test-concurrency.js
node server/test/test-xui-sync-users-job.js
node server/test/test-managed-server-counts.js
node server/test/test-admin-xui-user-sync.js
```

Expected:

- `concurrency tests passed`
- `test-xui-sync-users-job: PASS`
- `test-managed-server-counts.js` 所有 Node test 子项通过、失败数为 0
- `test-admin-xui-user-sync.js` 所有 Node test 子项通过、失败数为 0

- [ ] **Step 16: 检查差异和敏感信息**

Run: `git diff --check && git diff -- server/jobs/handlers/sync-xui-users.js server/test/test-xui-sync-users-job.js`

Expected: `git diff --check` 退出码为 `0`；差异仅包含受限并发、依赖注入、注释和测试，不包含 API Token、用户密码或其他真实敏感信息。

- [ ] **Step 17: 提交实现与测试**

```bash
git add server/jobs/handlers/sync-xui-users.js server/test/test-xui-sync-users-job.js
git commit -m "优化：并发执行六小时用户同步"
```

- [ ] **Step 18: 提交后复验并保存交付日志**

再次运行 Step 15 的四条命令。

Expected: 四条命令全部以退出码 `0` 完成；交付信息展示完整测试日志，并提醒用户重启后端服务器。
