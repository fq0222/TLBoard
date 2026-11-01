# 家宽 routing 待清理服务器定时任务 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每天北京时间 12:00 自动重试清理 `pending_cleanup_server_ids` 中在线服务器的残留 routing，并安全保留离线或清理失败的服务器 ID。

**Architecture:** 在现有家宽 routing 服务中增加批量清理入口，由仓储负责筛选记录和短事务内的安全写回；独立 cron handler 到点后只将任务加入 `xuiJobScheduler`。队列与其他 XUI 后台任务串行执行实际清理，远端请求继续复用现有 routing 删除函数，且不在数据库事务中执行；现有按用户互斥继续保护手动绑定和解绑。

**Tech Stack:** Node.js 20、CommonJS、PostgreSQL、node-cron、node:test/assert

**Spec:** `docs/superpowers/specs/2026-10-30-home-routing-pending-cleanup-job-design.md`

## Global Constraints

- cron 表达式固定为 `0 12 * * *`，时区固定为 `Asia/Shanghai`，服务启动时不补执行。
- cron 到点后只调用 `xuiJobScheduler.schedule('home-routing-pending-cleanup', handler)`，不得绕过队列直接清理。
- 保留现有按用户互斥；接入 XUI 队列不能替代手动绑定、解绑与定时清理之间的保护。
- 不修改前端、不增加数据库字段、不改变套餐到期逻辑，不扩展历史 `home_proxy_tag` 保存机制。
- 仅更新 `pending_cleanup_server_ids`；不得修改 `last_synced_at` 或当前 `server_ids`。
- 离线或远端删除失败的服务器 ID 必须保留，单个失败不得中断后续记录。
- 新增文件和方法必须补充职责、参数、返回值及核心分支注释。
- 修改 `server/**/*.js` 后只提醒重启服务，不自行启动服务。

## Review Focus

- `pending_cleanup_server_ids` 是损坏 JSON 或非数组时跳过记录并计入异常，不得删除本地数据。
- 待清理 ID 同时出现在最新 `server_ids` 时不得调用远端删除，只从待清理集合排除重复状态。
- 服务器记录已被删除时无需调用 3X-UI，应安全移除其残留 ID。
- 某个用户远端删除失败时应保留失败 ID，并继续处理后续用户。
- 远端请求期间路由记录发生变化时，写回必须基于加锁后读取的最新值，只移除本次确认完成的 ID。
- cron 回调触发时清理服务不得立即执行，只有队列实际调用 handler 后才能开始。
- 同名 routing 清理任务已运行或排队时，调度器拒绝重复入队后不得额外执行清理服务。

---

### Task 1: 待清理记录查询与安全写回

**Files:**
- Modify: `server/repositories/user-home-routing-repository.js`
- Create: `server/test/test-home-routing-pending-cleanup-repository.js`

**Interfaces:**
- Consumes: 数据库代理的 `prepare()` 和 `transaction()` 接口。
- Produces: `listPendingCleanupRoutes(db)` 和 `removePendingCleanupServerIds(db, userId, removableServerIds)`。

- [ ] **Step 1: 编写失败测试，覆盖待清理记录查询**

在 `server/test/test-home-routing-pending-cleanup-repository.js` 使用数据库桩验证 `listPendingCleanupRoutes(db)` 只查询待清理字段非空的记录，并返回用户邮箱、`home_proxy_tag`、`server_ids`、`pending_cleanup_server_ids`。

- [ ] **Step 2: 运行测试确认 RED**

Run: `node server/test/test-home-routing-pending-cleanup-repository.js`

Expected: FAIL，提示 `listPendingCleanupRoutes` 不存在。

- [ ] **Step 3: 实现查询接口**

在 `server/repositories/user-home-routing-repository.js` 新增：

```js
async function listPendingCleanupRoutes(db)
```

查询 `user_home_proxy_routes` 并关联 `users.email`，筛选 `pending_cleanup_server_ids <> '[]'`，不在 SQL 中将 TEXT 强制转换为 JSON，确保损坏数据可由服务层识别并记录。

- [ ] **Step 4: 编写失败测试，覆盖短事务安全写回**

为以下结果增加断言：

- `removePendingCleanupServerIds(db, 1, [2])` 使用 `FOR UPDATE` 读取最新行。
- 只从最新 `pending_cleanup_server_ids` 移除指定 ID，不覆盖执行期间新增的其他 ID。
- `server_ids` 非空时只更新 pending；两个数组都为空时删除整条记录。
- 路由不存在返回 `status: 'missing'`。
- 任一 ID 字段损坏时返回 `status: 'invalid'`，不执行 UPDATE/DELETE。

- [ ] **Step 5: 运行测试确认新增用例为 RED**

Run: `node server/test/test-home-routing-pending-cleanup-repository.js`

Expected: FAIL，提示 `removePendingCleanupServerIds` 不存在。

- [ ] **Step 6: 实现安全写回接口**

新增：

```js
async function removePendingCleanupServerIds(db, userId, removableServerIds)
// Promise<{status:'updated'|'deleted'|'missing'|'invalid', remainingPendingServerIds?:number[]}>
```

内部开启短事务，使用 `SELECT ... FOR UPDATE` 读取最新行，严格解析两个 TEXT 数组；只移除 `removableServerIds`，不修改 `server_ids` 和 `last_synced_at`。若两个数组均为空则删除，否则仅更新 pending 字段。

- [ ] **Step 7: 运行仓储测试确认 GREEN**

Run: `node server/test/test-home-routing-pending-cleanup-repository.js`

Expected: 所有用例 PASS，事务顺序包含 `BEGIN`、`SELECT ... FOR UPDATE`、`UPDATE` 或 `DELETE`、`COMMIT`。

### Task 2: 家宽 routing 批量残留清理服务

**Files:**
- Modify: `server/services/shared/home-routing-service.js`
- Modify: `server/test/test-user-home-routing-service.js`

**Interfaces:**
- Consumes: Task 1 的 `listPendingCleanupRoutes(db)`、`removePendingCleanupServerIds(db, userId, removableServerIds)`，以及现有 `cleanupServerRoutes()`。
- Produces: `cleanupPendingHomeRoutes(db, logger)`，返回清理汇总。

- [ ] **Step 1: 扩展内存仓储并编写批量清理失败测试**

在 `server/test/test-user-home-routing-service.js` 为内存仓储补充 Task 1 接口，并增加以下用例：

- 在线服务器删除成功后移除 pending ID，routing 规则中只移除当前用户。
- 离线服务器不创建 XUI client 并保留 pending ID。
- 已不存在服务器的 ID 从 pending 中移除。
- pending 与当前 active ID 重叠时不调用远端删除，并移除重复 pending 状态。
- 在线删除失败时保留 ID，随后用户仍继续处理。
- 损坏 JSON 被计入 `invalidRoutes` 且不写回。

- [ ] **Step 2: 运行测试确认 RED**

Run: `node server/test/test-user-home-routing-service.js`

Expected: FAIL，提示 `cleanupPendingHomeRoutes` 不存在。

- [ ] **Step 3: 实现批量清理入口**

在 `server/services/shared/home-routing-service.js` 新增并导出：

```js
async function cleanupPendingHomeRoutes(db, logger = console)
// Promise<{
//   scannedUsers:number,
//   cleanedServers:number,
//   skippedOfflineServers:number,
//   failedServers:number,
//   invalidRoutes:number
// }>
```

逐条处理候选记录，每条开始时重新读取当前路由；严格解析 pending，排除与最新 active 重叠的 ID，再复用 `cleanupServerRoutes()` 清理其余服务器。成功、已不存在和 active 重叠的 ID 交给仓储安全移除；离线与失败 ID 保留。每条记录使用独立 `try/catch`，错误日志包含用户和服务器信息但不包含 token。

- [ ] **Step 4: 运行服务测试确认 GREEN**

Run: `node server/test/test-user-home-routing-service.js`

Expected: 输出新增用例“通过”，最终输出 `用户家宽 routing 服务层测试通过`。

### Task 3: 每日 12:00 cron 注册与任务中心接入

**Files:**
- Create: `server/jobs/handlers/clean-pending-home-routes.js`
- Create: `server/test/test-clean-pending-home-routes-job.js`
- Modify: `server/jobs/index.js`
- Modify: `server/test/test-xui-job-scheduler.js`
- Modify: `server/test/test-telegram-health-sync.js`

**Interfaces:**
- Consumes: Task 2 的 `cleanupPendingHomeRoutes(db, logger)`。
- Consumes: 现有 `xuiJobScheduler.schedule(name, handler)`。
- Produces: `runPendingHomeRouteCleanup(db)` 和 `registerPendingHomeRouteCleanupJob({ db, cronTasks })`；cron 回调只提交名为 `home-routing-pending-cleanup` 的队列任务。

- [ ] **Step 1: 编写 handler 调度失败测试**

在 `server/test/test-clean-pending-home-routes-job.js` 隔离 `node-cron`、服务和 logger，断言：

- 只注册 `0 12 * * *` 和 `{ timezone: 'Asia/Shanghai' }`。
- 注册时不调用调度器或清理服务。
- cron 句柄加入 `cronTasks`。
- cron 到点后只调用一次 `xuiJobScheduler.schedule('home-routing-pending-cleanup', handler)`，清理服务仍未执行。
- 手动执行队列保存的 handler 后才调用一次清理服务，并记录扫描、成功、离线和失败数量及耗时。
- 调度器返回 `false` 表示同名任务已存在时，不直接调用清理服务。
- 服务抛出 `Error` 或非 Error 值时，runner 返回失败结果并记录错误，不让 cron 回调拒绝。

- [ ] **Step 2: 运行 handler 测试确认 RED**

Run: `node server/test/test-clean-pending-home-routes-job.js`

Expected: FAIL，cron 回调直接执行清理服务，或没有调用 `xuiJobScheduler.schedule`。

- [ ] **Step 3: 实现独立 cron handler**

创建 `server/jobs/handlers/clean-pending-home-routes.js`，导出：

```js
async function runPendingHomeRouteCleanup(db)
function registerPendingHomeRouteCleanupJob({ db, cronTasks })
```

runner 调用服务并输出汇总；顶层异常转换成 `{ success: false, error }`。注册器只创建北京时间每天 12:00 的 cron；cron 回调将 `runPendingHomeRouteCleanup(db)` 包装为队列 handler，并以 `home-routing-pending-cleanup` 名称提交给 `xuiJobScheduler`，不启动补执行、不直接调用 runner。

- [ ] **Step 4: 运行 handler 测试确认 GREEN**

Run: `node server/test/test-clean-pending-home-routes-job.js`

Expected: 所有用例 PASS；cron 到点只入队，执行保存的队列 handler 后才产生清理汇总。

- [ ] **Step 5: 编写任务中心接入失败测试**

更新 `server/test/test-xui-job-scheduler.js` 的 handler 替身列表和句柄断言，验证新 cron 只注册一次并由 `stopAllJobs()` 停止，同时 handler 源码被识别为接入统一 XUI 调度器；更新 `server/test/test-telegram-health-sync.js` 的任务中心依赖替身，避免新增 import 泄漏真实任务。

- [ ] **Step 6: 运行任务中心测试确认 RED**

Run: `node server/test/test-xui-job-scheduler.js && node server/test/test-telegram-health-sync.js`

Expected: 至少一个断言因新任务尚未接入而 FAIL。

- [ ] **Step 7: 接入任务中心**

在 `server/jobs/index.js` 引入并调用 `registerPendingHomeRouteCleanupJob(context)`，同时在任务配置表和说明中增加“家宽 routing 残留清理：每天北京时间 12:00 入 XUI 队列执行”。

- [ ] **Step 8: 运行任务中心测试确认 GREEN**

Run: `node server/test/test-xui-job-scheduler.js && node server/test/test-telegram-health-sync.js`

Expected: 两个脚本均 PASS，新 cron 句柄被统一停止，统一调度器接入列表包含 routing 清理 handler。

### Task 4: 完整验证与提交整理

**Files:**
- Verify: `docs/superpowers/specs/2026-10-30-home-routing-pending-cleanup-job-design.md`
- Verify: `docs/superpowers/plans/2026-10-30-home-routing-pending-cleanup-job.md`
- Verify: Task 1-3 的所有逻辑与测试文件

**Interfaces:**
- Consumes: Task 1-3 的全部产出。
- Produces: 可部署的定时清理功能和可追溯提交。

- [ ] **Step 1: 运行全部相关测试**

Run:

```bash
node server/test/test-home-routing-pending-cleanup-repository.js
node server/test/test-user-home-routing-service.js
node server/test/test-clean-pending-home-routes-job.js
node server/test/test-xui-job-scheduler.js
node server/test/test-telegram-health-sync.js
node server/test/test-home-ip-expiration.js
node server/test/test-xui-server-cascade-cleanup.js
```

Expected: 所有脚本退出码为 0，且无失败用例。

- [ ] **Step 2: 检查差异质量**

Run: `git diff --check && git status --short`

Expected: `git diff --check` 无错误；状态中只包含本计划列出的文件。

- [ ] **Step 3: 按用户确认的提交边界整理提交**

仅在用户明确要求提交后执行，并保持中文提交信息：

```bash
git add docs/superpowers/specs/2026-10-30-home-routing-pending-cleanup-job-design.md docs/superpowers/plans/2026-10-30-home-routing-pending-cleanup-job.md
git commit -m "文档：记录家宽路由残留定时清理方案"

git add -f server/test/test-home-routing-pending-cleanup-repository.js server/test/test-clean-pending-home-routes-job.js
git add server/repositories/user-home-routing-repository.js server/services/shared/home-routing-service.js server/jobs/handlers/clean-pending-home-routes.js server/jobs/index.js server/test/test-user-home-routing-service.js server/test/test-xui-job-scheduler.js server/test/test-telegram-health-sync.js
git commit -m "功能：增加家宽路由残留队列清理"
```

- [ ] **Step 4: 交付提醒**

向用户展示测试日志摘要、提交号和工作区状态；提醒部署后重启后端服务使新 cron 生效，不自行启动或推送。
