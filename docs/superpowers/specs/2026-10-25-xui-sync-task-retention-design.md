# XUI 同步任务历史清理设计

## 意图

`xui_sync_tasks` 会持续积累已结束任务，但历史清理不属于每 3 分钟运行的同步补偿职责。将清理拆为每天固定时间执行的独立数据库维护任务，减少无意义查询和 `deleted=0` 日志，同时保持同步补偿频率和可靠性不变。

## 目标

- 每天北京时间 12:00 独立清理一次历史任务。
- 每次最多删除 50 条创建时间严格超过 15 天的 `success`、`failed` 记录。
- 按 `created_at ASC, id ASC` 优先删除最旧记录。
- 清理成功记录删除数量和耗时；清理失败记录原因和耗时。
- 清理失败不得影响其他定时任务或同步补偿 worker。
- 3 分钟同步补偿 worker 不再执行任何历史清理。

## 非目标与反目标

- 不删除 `pending`、`processing` 任务。
- 不改变同步补偿 worker 的首次延迟、3 分钟周期、单批任务数、重试次数或退避策略。
- 每日清理不循环处理多批；即使积压很多，每天仍只删除最多 50 条。
- 服务在 12:00 未运行时不补执行，不增加持久化调度状态。
- 清理不进入 `xuiJobScheduler`，因为它只访问 PostgreSQL，不访问 3X-UI。
- 不改变现有仓储删除 SQL和清理索引。

## 约束与边界

- cron 表达式固定为 `0 12 * * *`。
- cron 时区显式固定为 `Asia/Shanghai`，不依赖服务器系统时区。
- 过期判断继续使用 `created_at < now - 15 * 24 * 60 * 60`；刚好满 15 天的记录保留到下一次执行。
- 单次清理只调用一次 `deleteExpiredTerminalTasks(db, cutoffCreatedAt, 50)`。
- 仓储继续使用不自动重放的直接连接池查询，避免响应丢失时突破单次 50 条上限。
- 新 cron 句柄加入任务中心的 `cronTasks`，由 `stopAllJobs()` 统一停止。

## 方案比较

### 采用：独立每日 cron，不补执行

新增独立 handler，按北京时间每天 12:00 执行一批清理。该方案与现有邮件日志清理、邮件群发和数据库备份任务结构一致，职责清晰、执行频率低，也不需要增加数据库状态。

### 未采用：独立每日 cron，并在启动时补执行

需要持久化“当天是否已经执行”的状态并处理重启并发，复杂度明显高于每天最多清理 50 条的维护需求。

### 未采用：继续依附 3 分钟同步 worker

会持续产生无意义数据库查询和零删除日志，并把数据库维护与远端同步补偿耦合在一起。

## 代码设计

- `server/jobs/handlers/clean-xui-sync-tasks.js`
  - 定义 15 天保留期、50 条上限、北京时间时区和每日 12:00 cron。
  - `runXuiSyncTaskCleanup(db)` 负责计算截止时间、调用仓储、记录成功或失败日志并隔离异常。
  - `registerCleanXuiSyncTasksJob({ db, cronTasks })` 负责注册 cron、保存句柄并记录注册日志。
- `server/jobs/handlers/sync-xui-tasks.js`
  - 删除清理常量、helper 和 `finally` 中的清理调用。
  - 保留同步统计日志和运行锁释放逻辑。
- `server/jobs/index.js`
  - 在任务配置表、说明、依赖导入和 `startAllJobs()` 注册序列中加入每日清理任务。
  - 按各 handler 的真实注册参数重写任务配置表：只有“标记过期订单”是启动时立即执行，其余延迟、周期和仅启动一次语义逐项对齐当前代码。
- `server/repositories/xui-sync-repository.js`、`server/db/schema/indexes.js`
  - 继续复用现有安全限量删除和 `(status, created_at, id)` 索引，不修改接口。

## 验证

- 新 handler 测试验证 cron 表达式、`Asia/Shanghai` 时区、句柄注册及注册日志。
- 执行测试验证截止时间、固定 50 条、成功日志、失败隔离，以及每次只调用一次仓储。
- 同步 worker 测试验证不再调用历史清理，并保持原有补偿分发与运行锁行为。
- 任务中心测试验证新 handler 被注册且 cron 句柄仍能统一停止。
- 人工逐项核对 `jobs/index.js` 的任务配置表与各 handler 的 `registerTimeout`、`setInterval`、`cron.schedule` 参数一致。
- 继续运行仓储边界、连接响应丢失和 XUI 同步任务回归测试。

