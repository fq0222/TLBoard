# XUI 同步任务每日清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 XUI 同步任务历史清理从每 3 分钟同步补偿 worker 中拆出，改为北京时间每天 12:00 独立执行一次且最多删除 50 条。

**Architecture:** 新建只访问 PostgreSQL 的 `node-cron` handler，复用现有仓储限量删除接口和索引；同步补偿 worker 恢复为只处理队列任务。任务中心负责注册和停止新 cron，不增加启动补偿或持久化调度状态。

**Tech Stack:** Node.js、CommonJS、`node-cron` 4.2.1、PostgreSQL、Node.js `node:test`

**Spec:** `docs/superpowers/specs/2026-10-25-xui-sync-task-retention-design.md`

## Global Constraints

- cron 固定为 `0 12 * * *`，选项固定为 `{ timezone: 'Asia/Shanghai' }`。
- 每次只调用一次仓储并最多删除 50 条，不循环清理多批。
- 只删除创建超过 15 天的 `success`、`failed`；仓储 SQL和索引接口保持不变。
- 服务错过 12:00 后不补执行，启动时不主动清理。
- 清理成功日志包含删除数量和耗时；失败日志包含原因和耗时且不得向 cron 抛错。
- 3 分钟同步 worker 不再调用历史清理，不改变其调度、分发、重试、统计与运行锁语义。
- 新 cron 直接执行数据库维护，不进入 `xuiJobScheduler`。
- 新增文件和方法必须补充职责、关键参数和核心分支语义注释。
- 未经用户明确要求，不执行 `git add`、`git commit` 或 `git push`。

## Review Focus

- 服务器系统时区不是北京时间时，cron 仍必须按 `Asia/Shanghai` 的 12:00 触发；Task 1 测试精确断言 timezone。
- cron 回调发生数据库异常时必须正常 resolve，避免未处理拒绝影响调度器；Task 1 覆盖普通 Error 与无 `message` 拒绝值。
- 一次执行只能提交一次上限 50 的仓储调用；Task 1 断言调用次数和参数。
- 从 worker 移除清理时不能破坏运行锁释放或同步摘要；Task 2 保留正常与异常同步回归。
- 新 handler 加入任务中心后，启动失败回滚和正常停止仍要停止全部 cron 句柄；Task 2 扩展任务中心替身测试。

---

### Task 1: 新增北京时间每日清理 handler

**Files:**
- Create: `server/jobs/handlers/clean-xui-sync-tasks.js`
- Create: `server/test/test-clean-xui-sync-tasks-job.js`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `xuiSyncRepository.deleteExpiredTerminalTasks(db, cutoffCreatedAt, limit): Promise<number>`。
- Produces: `runXuiSyncTaskCleanup(db): Promise<{success:boolean,deleted:number,error?:string}>`；`registerCleanXuiSyncTasksJob({db,cronTasks}): void`。

- [ ] **Step 1: 写 cron 注册失败测试**

新增测试，使用模块替身捕获 `cron.schedule(expression, callback, options)`，断言：

- 表达式为 `0 12 * * *`。
- 选项为 `{ timezone: 'Asia/Shanghai' }`。
- 返回句柄被加入 `cronTasks`。
- 注册日志包含“每天 12:00”和“北京时间”。
- 注册阶段不调用仓储，证明启动时不补执行。

- [ ] **Step 2: 写执行和异常隔离失败测试**

固定 `Date.now()` 后通过 cron 回调或导出的执行函数断言：

```javascript
test('每日任务按 15 天截止时间只清理一批 50 条并记录结果', async () => {
  // 仓储只调用一次；参数为 db、floor(now/1000)-15天、50；结果 deleted=3；INFO 含 duration。
});

test('每日清理数据库失败只记录错误且不向 cron 抛出', async () => {
  // Error 与 null 两组拒绝值均 resolve；ERROR 含 error 和 duration。
});
```

- [ ] **Step 3: 运行测试确认 RED**

Run: `node --test test/test-clean-xui-sync-tasks-job.js`

Expected: FAIL，指出 handler 模块或导出函数不存在。

- [ ] **Step 4: 实现独立 cron handler**

创建 `server/jobs/handlers/clean-xui-sync-tasks.js`：

- 内部常量分别表示 15 天、50 条、`0 12 * * *` 和 `Asia/Shanghai`。
- `runXuiSyncTaskCleanup(db)` 单次调用仓储，成功返回 `{ success: true, deleted }`；失败记录日志并返回 `{ success: false, deleted: 0, error }`，不抛错。
- `registerCleanXuiSyncTasksJob({ db, cronTasks })` 使用固定 cron 与 timezone 注册异步回调，把句柄推入 `cronTasks`，不在注册时运行清理。
- 所有新增函数按项目要求添加职责、参数、返回值和核心分支注释。

- [ ] **Step 5: 添加新测试文件的精确忽略例外并运行 GREEN**

在 `.gitignore` 的 `server/test/*` 例外区域加入：

```gitignore
!server/test/test-clean-xui-sync-tasks-job.js
```

Run: `node --test test/test-clean-xui-sync-tasks-job.js test/test-xui-sync-task-cleanup.js`

Expected: PASS；新 cron handler 测试与现有仓储清理测试全部通过。

### Task 2: 从同步 worker 解耦并注册每日任务

**Files:**
- Modify: `server/jobs/handlers/sync-xui-tasks.js`
- Modify: `server/jobs/index.js`
- Modify: `server/test/test-xui-sync-task-job.js`
- Modify: `server/test/test-xui-job-scheduler.js`
- Modify: `server/test/test-telegram-health-sync.js`

**Interfaces:**
- Consumes: Task 1 的 `registerCleanXuiSyncTasksJob({db,cronTasks})`。
- Produces: 任务中心注册每日清理；`runXuiSyncTasks(db)` 不再产生历史清理副作用。

- [ ] **Step 1: 写解耦和任务中心失败测试**

- 在 `test-xui-sync-task-job.js` 删除原先要求每轮清理的五个测试，新增“同步补偿 worker 不调用历史清理”测试：仓储替身暴露计数方法，执行正常和同步异常两轮后计数仍为 0，同时原同步错误日志和第二轮可运行行为保持成立。
- 在 `test-xui-job-scheduler.js` 的 handler 列表加入 `clean-xui-sync-tasks/registerCleanXuiSyncTasksJob`，记录每个注册器调用名称，断言任务中心启动时调用该注册器且停止流程仍停止 cron 句柄。
- 在 `test-telegram-health-sync.js` 的任务中心依赖替身中加入新注册器，防止测试加载真实 cron handler。

- [ ] **Step 2: 运行相关测试确认 RED**

Run: `node --test test/test-xui-sync-task-job.js test/test-xui-job-scheduler.js test/test-telegram-health-sync.js`

Expected: FAIL，worker 仍调用清理且任务中心尚未注册新 handler。

- [ ] **Step 3: 移除 worker 清理并注册每日任务**

- 从 `sync-xui-tasks.js` 删除清理常量、`cleanupExpiredXuiSyncTasks()` 和 `finally` 中的清理调用；保留同步结束日志，确保 `isXuiSyncTaskRunning = false` 始终在 `finally` 执行。
- 在 `jobs/index.js` 导入并调用 `registerCleanXuiSyncTasksJob(context)`。
- 按当前 handler 代码重写任务配置表并更新任务说明，不能只追加新行。表格必须使用以下已核对值：

| 任务名称 | 启动时立即执行 | 首次延迟 | 执行间隔 |
|---|---:|---:|---:|
| 标记过期订单 | 是 | 无 | 10 分钟 |
| 删除过期订单 | 否 | 5 分钟 | 1 小时 |
| 清理僵尸用户 | 否 | 2 分钟 | 30 分钟 |
| 3X-UI 用户同步 | 否 | 1 分钟 | 6 小时 |
| 3X-UI 同步重试队列 | 否 | 30 秒 | 3 分钟 |
| 流量同步 | 否 | 10 分钟 | 30 分钟 |
| 工单自动关闭 | 否 | 3 分钟 | 1 小时 |
| 邮件群发 | 否 | 无 | 每天 9:00 |
| 清理邮件日志 | 否 | 无 | 每天 3:00 |
| 3X-UI 数据库备份 | 否 | 无 | 每天 4:00 |
| XUI 同步任务历史清理 | 否 | 无 | 每天 12:00（北京时间） |
| 批量订阅任务恢复 | 否 | 15 秒 | 无（仅启动后一次） |
| Telegram 健康巡检 | 否 | 13 分钟 | 40 分钟 |

将原列名“启动时执行”改为“启动时立即执行”，避免把启动后的延迟执行误写成“是”。任务说明补充历史清理的 15 天条件和每次 50 条。

- [ ] **Step 4: 运行相关测试确认 GREEN**

Run: `node --test test/test-xui-sync-task-job.js test/test-xui-job-scheduler.js test/test-telegram-health-sync.js`

Expected: PASS；worker 解耦、任务中心注册以及原调度器/Telegram 回归全部通过。

### Task 3: 完整回归与交付核对

**Files:**
- Verify: `server/jobs/handlers/clean-xui-sync-tasks.js`
- Verify: `server/jobs/handlers/sync-xui-tasks.js`
- Verify: `server/jobs/index.js`
- Verify: `server/repositories/xui-sync-repository.js`
- Verify: `server/test/test-clean-xui-sync-tasks-job.js`
- Verify: `server/test/test-xui-sync-task-cleanup.js`
- Verify: `server/test/test-xui-sync-task-job.js`
- Verify: `server/test/test-xui-job-scheduler.js`
- Verify: `server/test/test-telegram-health-sync.js`

**Interfaces:**
- Consumes: Tasks 1-2 的独立 cron 和解耦 worker。
- Produces: 新鲜回归日志与未暂存交付清单。

- [ ] **Step 1: 运行完整相关回归**

Run from `server/`:

```bash
node --test test/test-clean-xui-sync-tasks-job.js test/test-xui-sync-task-cleanup.js test/test-xui-sync-task-job.js test/test-xui-sync-task-service.js test/test-xui-job-scheduler.js test/test-telegram-health-sync.js
```

Expected: exit 0，汇总 `fail 0`。

- [ ] **Step 2: 检查代码和工作区**

Run: `git diff --check`

Expected: exit 0，无空白错误；允许如实记录现有行尾转换提示。

Run: `git status --short`

Expected: 只包含本计划的 handler、任务中心、测试、`.gitignore` 和已批准文档；不得有暂存文件。

- [ ] **Step 3: 向用户交付**

展示测试汇总、清理时间/时区/批量上限、worker 解耦结果和变更清单。由于修改 `server/**/*.js`，提醒用户重启服务器；不得自行启动服务器。

- [ ] **Step 4: 仅在用户明确要求时提交或推送**

如用户要求提交，遵循其指定拆分；提交信息必须使用中文。`git push` 前必须展示变更并再次获得用户同意。

