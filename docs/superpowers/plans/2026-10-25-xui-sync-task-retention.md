# XUI 同步任务历史清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每轮 XUI 同步补偿 worker 结束后，独立清理最多 50 条创建超过 15 天的 `success`、`failed` 历史任务。

**Architecture:** 仓储层用一条 PostgreSQL CTE 完成“筛选最旧 50 条并删除”，worker 在同步处理的 `finally` 收尾阶段调用它。清理拥有独立错误边界和日志，索引覆盖状态、创建时间与稳定排序字段，确保数据量增长后仍能小批量推进。

**Tech Stack:** Node.js、CommonJS、Express 后台任务、PostgreSQL、Node.js `node:test`

**Spec:** `docs/superpowers/specs/2026-10-25-xui-sync-task-retention-design.md`

## Global Constraints

- 只删除 `status IN ('success', 'failed')` 且 `created_at < now - 15 * 24 * 60 * 60` 的记录。
- 每轮最多删除 50 条，按 `created_at ASC, id ASC` 选择。
- `pending`、`processing` 永不因本规则删除；刚好创建满 15 天的记录不删除。
- 清理在每轮 `runXuiSyncTasks()` 的同步处理结束后执行一次，包括无待处理任务和同步阶段异常路径。
- 清理成功或失败不得影响同步补偿任务、统计结果或调度器。
- 成功日志包含删除数量和耗时；失败日志包含错误原因和耗时。
- 新增方法必须补充职责、关键参数和核心分支语义注释，并保持现有代码风格。
- 不改变现有轮询周期、同步批量、重试次数和退避策略。
- 功能实现与测试整理为一笔中文提交；未收到明确提交指示时不执行 `git add` 或 `git commit`。

## Review Focus

- `created_at` 恰好等于截止时间时必须保留，测试使用严格小于边界断言。
- 历史 `pending`、`processing` 即使远早于截止时间也必须保留，测试覆盖两种状态。
- 超过 50 条候选时只删除最旧 50 条，相同创建时间用 `id` 保证稳定顺序。
- 同步阶段抛错后仍执行清理，且原有 worker 错误日志与状态不受影响。
- 清理仓储抛错时 worker 不向外抛出，并在释放运行锁前记录包含原因和耗时的失败日志。

---

### Task 1: 增加终态历史任务的限量删除仓储与索引

**Files:**
- Modify: `server/repositories/xui-sync-repository.js`
- Modify: `server/db/schema/indexes.js`
- Create: `server/test/test-xui-sync-task-cleanup.js`

**Interfaces:**
- Consumes: 数据库代理 `db.prepare(sql).run(...params)`；Unix 秒级时间戳。
- Produces: `deleteExpiredTerminalTasks(db, cutoffCreatedAt, limit): Promise<number>`，返回实际删除数量。

- [ ] **Step 1: 写仓储失败测试，锁定 SQL 契约和边界语义**

在 `server/test/test-xui-sync-task-cleanup.js` 创建带注释的数据库替身，记录 SQL 与参数，并用内存任务集模拟 SQL 的筛选/删除结果。测试至少断言：

```javascript
test('只删除严格超过保留期的 success 和 failed 任务', async () => {
  // success/failed 且 created_at < cutoff 被删除；等于 cutoff、较新及 pending/processing 均保留。
});

test('单批最多删除最旧 50 条并用 id 稳定排序', async () => {
  // 构造超过 50 个候选，断言删除数为 50，剩余的是较新记录。
});

test('清理仓储使用终态、创建时间、稳定排序和 limit 参数', async () => {
  // SQL 包含 status IN、created_at <、ORDER BY created_at ASC, id ASC、LIMIT；参数为 cutoff、limit。
});
```

- [ ] **Step 2: 运行新测试并确认因接口缺失而失败**

Run: `node --test test/test-xui-sync-task-cleanup.js`

Expected: FAIL，指出 `deleteExpiredTerminalTasks` 不存在或不是函数。

- [ ] **Step 3: 实现 `deleteExpiredTerminalTasks(db, cutoffCreatedAt, limit)`**

在 `server/repositories/xui-sync-repository.js` 增加并导出方法。使用单条 CTE：先从 `xui_sync_tasks` 筛选 `success`、`failed` 且 `created_at < ?` 的 ID，按 `created_at ASC, id ASC` 排序并 `LIMIT ?`；再删除选中 ID。返回 `Number(result.changes || 0)`。方法注释说明职责、时间参数、批量参数和只处理终态的核心分支。

- [ ] **Step 4: 增加清理索引定义**

在 `server/db/schema/indexes.js` 的 XUI 任务索引附近加入：

```sql
CREATE INDEX IF NOT EXISTS idx_xui_sync_tasks_status_created_at_id
ON xui_sync_tasks(status, created_at, id)
```

在新测试中读取索引定义源文件或通过 `createIndexes` 查询记录，断言索引名称及字段顺序存在。

- [ ] **Step 5: 运行仓储与索引测试**

Run: `node --test test/test-xui-sync-task-cleanup.js`

Expected: PASS，3 个清理契约测试和索引断言全部通过。

### Task 2: 在 worker 末尾执行隔离清理并记录日志

**Files:**
- Modify: `server/jobs/handlers/sync-xui-tasks.js`
- Modify: `server/test/test-xui-sync-task-job.js`

**Interfaces:**
- Consumes: Task 1 的 `xuiSyncRepository.deleteExpiredTerminalTasks(db, cutoffCreatedAt, limit)`。
- Produces: `cleanupExpiredXuiSyncTasks(db): Promise<{deleted:number, success:boolean}>`；常量 `XUI_SYNC_TASK_RETENTION_SECONDS = 15 * 24 * 60 * 60` 和 `XUI_SYNC_TASK_CLEANUP_LIMIT = 50` 仅供 handler 内部使用。

- [ ] **Step 1: 写 worker 失败测试，验证正常和空队列路径的调用顺序**

扩展 `loadHandlerForTest()`，让替身 logger 同时捕获 `info`、`warn`、`error`，并新增测试：

```javascript
test('同步批次结束后按 15 天截止时间清理最多 50 条', async () => {
  // 记录 processDueTasks 与 deleteExpiredTerminalTasks 调用顺序；断言先同步后清理。
  // 断言 cutoff 接近固定 now - 15 天、limit === 50，并存在 deleted 与 duration 日志。
});

test('没有到期同步任务时仍执行历史清理', async () => {
  // processDueTasks 返回全 0，清理仍调用一次并记录 deleted=0。
});
```

测试中临时固定 `Date.now()`，结束后恢复，避免截止时间和耗时断言抖动。

- [ ] **Step 2: 写异常隔离失败测试**

```javascript
test('同步处理抛错后仍执行历史清理', async () => {
  // processDueTasks 抛错；断言清理调用一次，runXuiSyncTasks 正常 resolve。
});

test('历史清理失败只写错误日志且不影响下一轮执行', async () => {
  // 仓储清理抛错；断言 runXuiSyncTasks 正常 resolve、错误日志含原因和 duration。
  // 再执行一轮，断言运行锁已释放且 processDueTasks 再次被调用。
});
```

- [ ] **Step 3: 运行 job 测试并确认新断言失败**

Run: `node --test test/test-xui-sync-task-job.js`

Expected: FAIL，清理方法尚未调用或缺少清理日志。

- [ ] **Step 4: 实现 worker 末尾的隔离清理**

在 `server/jobs/handlers/sync-xui-tasks.js`：

- 定义 15 天秒数和 50 条批量常量。
- 新增 `cleanupExpiredXuiSyncTasks(db)`，计算 `Math.floor(Date.now() / 1000) - XUI_SYNC_TASK_RETENTION_SECONDS`，调用仓储方法。
- 方法内部单独计时并捕获所有错误；成功日志包含 `deleted=<数量>, duration=<毫秒>ms`，失败日志包含 `error=<信息>, duration=<毫秒>ms`。
- 在 `runXuiSyncTasks()` 外层 `finally` 中，先保留现有同步结束日志，再 `await cleanupExpiredXuiSyncTasks(db)`，最后释放 `isXuiSyncTaskRunning`；使用嵌套 `try/finally` 保证即使清理函数出现未预期异常也释放运行锁。
- 为新增函数补充职责、参数、返回值及“成功失败均不影响同步流程”的分支注释。

- [ ] **Step 5: 运行 job 测试**

Run: `node --test test/test-xui-sync-task-job.js`

Expected: PASS，原有调度/分发测试及新增清理时序、空队列、同步异常、清理异常测试全部通过。

### Task 3: 完整回归验证与单笔提交准备

**Files:**
- Verify: `server/repositories/xui-sync-repository.js`
- Verify: `server/db/schema/indexes.js`
- Verify: `server/jobs/handlers/sync-xui-tasks.js`
- Verify: `server/test/test-xui-sync-task-cleanup.js`
- Verify: `server/test/test-xui-sync-task-job.js`
- Verify: `server/test/test-xui-sync-task-service.js`

**Interfaces:**
- Consumes: Task 1 的限量删除接口和 Task 2 的 worker 收尾调用。
- Produces: 通过的 XUI 同步队列回归日志，以及供用户审阅的未暂存变更。

- [ ] **Step 1: 运行 XUI 同步任务相关回归测试**

Run: `node --test test/test-xui-sync-task-cleanup.js test/test-xui-sync-task-job.js test/test-xui-sync-task-service.js`

Expected: PASS；输出汇总中 `fail 0`，并保留 `xui sync task service tests passed`（若该脚本继续使用自定义完成日志）。

- [ ] **Step 2: 检查变更范围和工作区状态**

Run: `git diff --check`

Expected: 无输出，退出码 0。

Run: `git status --short`

Expected: 只出现本计划列出的实现、测试和已批准的设计/计划文档；不得暂存文件。

- [ ] **Step 3: 向用户展示测试日志和变更摘要**

报告删除条件、每轮上限、日志形式、异常隔离结果，以及三份测试脚本的实际通过输出。由于修改了 `server/**/*.js`，同时提醒用户部署后重启服务器。

- [ ] **Step 4: 仅在用户明确要求提交时创建三笔中文提交**

第一笔合并设计和计划文档：

```bash
git add docs/superpowers/specs/2026-10-25-xui-sync-task-retention-design.md docs/superpowers/plans/2026-10-25-xui-sync-task-retention.md
git commit -m "文档：制定同步任务历史清理方案"
```

第二笔提交功能逻辑：

```bash
git add server/repositories/xui-sync-repository.js server/db/schema/indexes.js server/jobs/handlers/sync-xui-tasks.js
git commit -m "功能：清理过期同步任务记录"
```

第三笔提交测试代码和测试文件忽略例外：

```bash
git add .gitignore server/test/test-xui-sync-task-cleanup.js server/test/test-xui-sync-task-job.js
git commit -m "测试：覆盖同步任务历史清理"
```

提交前重新展示 `git diff --cached --stat`；未经用户明确同意不得推送。

