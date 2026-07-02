# Telegram 服务器健康巡检并发设计

## 目标

将 Telegram 服务器健康巡检从逐台串行改为最多同时巡检 10 台服务器，缩短多服务器场景下的总耗时。

## 设计

- 保留 `checkSingleServerHealth(db, server)` 作为单台服务器巡检边界。
- `checkSingleServerHealth()` 内部逻辑不变，尤其保留 `getServerStatus()` 失败后调用 `getInbounds()` 判断面板状态的回退流程。
- `checkAllServersHealth()` 复用 `server/utils/concurrency.js` 的 `runWithConcurrency()`，以固定并发上限 `10` 调度服务器。
- 每台服务器的结果仍独立处理；单台任务抛错只计入该台失败，不中断其他服务器。
- 保留开始、单台结果和汇总日志语义。

## 测试

扩展 `server/test/test-telegram-health-sync.js`：

- 使用超过 10 台模拟服务器，验证观测到的最大并发数恰好为 10。
- 验证全部服务器均被执行。
- 验证单台异常不会阻断其他服务器。
- 继续运行已有测试，确认 `getServerStatus()` 失败后的 `getInbounds()` 回退行为不变。

## 范围约束

- 不新增依赖或配置项。
- 不修改 Xray 状态归一化、数据库写入、告警开关或失败分类逻辑。
- 不修改巡检任务的执行周期和防重入机制。
