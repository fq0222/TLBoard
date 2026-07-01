# 订单 3X-UI 服务器级并发同步设计

## 背景

用户初次购买套餐和续费套餐后，会通过 [`server/services/shared/order-service.js`](F:\web-project\subscription-manager-v1.0.0\server\services\shared\order-service.js) 中的 `syncUserToXuiServers()` 将用户同步到在线 3X-UI 服务器。当前实现采用双层串行流程：

1. 逐台服务器获取 `inbounds`
2. 在单台服务器内逐个 `inbound` 执行 `add/update`
3. 续费需要重置流量时，再在对应 `inbound` 上串行执行 `resetClientTraffic`

当在线服务器较多时，请求总耗时会接近所有服务器处理耗时之和。由于这些操作主要由远程 HTTP 调用组成，串行执行会拉长支付完成后的同步等待时间，也会延后失败补偿任务的收敛。

项目内已经存在通用并发工具 [`server/utils/concurrency.js`](F:\web-project\subscription-manager-v1.0.0\server\utils\concurrency.js) 以及在 [`server/integrations/xui/xui-sync.js`](F:\web-project\subscription-manager-v1.0.0\server\integrations\xui\xui-sync.js) 中落地的“最大并发 10”模式，适合在订单同步链路复用。

## 目标

- 将订单同步改为“服务器级最大并发 10”。
- 保持单台服务器内部的业务顺序不变：
  `getInbounds -> inbound1 add/update -> inbound2 add/update -> resetClientTraffic`
- 单台服务器失败时不阻断其他服务器同步。
- 保持现有返回语义、日志语义和补偿任务语义不变。
- 尽量减少改动范围，优先降低一致性和回归风险。

## 非目标

- 不把单台服务器内部的多个 `inbound` 改为并发。
- 不调整 `upsertUniqueClient()` 的唯一锁实现。
- 不修改 `xui_sync_tasks` 的补偿策略。
- 不新增数据库表、迁移或配置项。
- 不顺带重构管理端用户同步链路 [`server/services/admin/users-service.js`](F:\web-project\subscription-manager-v1.0.0\server\services\admin\users-service.js)。

## 方案对比

### 方案一：服务器级并发 10，服务器内串行（采用）

外层按服务器列表并发执行，最大并发数 10。每个服务器任务内部继续沿用当前串行逻辑。

优点：

- 改动小，主要影响 `syncUserToXuiServers()` 的编排层。
- 风险低，不会同时向同一台 3X-UI 面板打出多条 `add/update/reset`。
- 更容易保持现有日志、统计和失败补偿语义。

缺点：

- 如果单台服务器 `inbound` 很多，性能提升不如全局展平任务明显。

### 方案二：全局 `(server, inbound)` 任务并发 10

先拉取所有服务器 `inbounds`，再把所有 `inbound` 展平成任务池，统一限流并发处理。

优点：

- 在“单台服务器 inbound 很多”的场景吞吐更高。

缺点：

- 同一台服务器会同时收到多个 `add/update/reset` 请求。
- 排查失败更复杂，更容易放大 3X-UI 面板压力。
- 与当前“单台服务器串行处理”的稳定性假设不一致。

### 方案三：只并发 `getInbounds`，后续 `add/update` 全局串行

优点：

- 实现简单。

缺点：

- 收益有限，因为核心耗时不只在 `getInbounds`，还在每个 `inbound` 的同步请求。

## 采用方案

采用方案一：服务器级并发 10，服务器内串行。

业务效果可以理解为：

- 多台服务器之间并发执行
- 单台服务器内部继续顺序执行

例如有 5 台服务器时，会同时启动 5 条异步任务链，每条链各自执行：

```text
getInbounds -> inbound1 add/update -> inbound2 add/update -> ...
```

如果在线服务器超过 10 台，则：

1. 先并发执行前 10 台
2. 某台执行完成后，再补入下一台
3. 直到全部服务器处理完成

## 设计

### 1. 提取单台服务器同步函数

从 `syncUserToXuiServers()` 中提取“处理单台服务器”的逻辑为独立函数，例如：

```javascript
async function syncUserToSingleServer(db, user, server, plan = {})
```

职责：

- 获取单台服务器的 `inbounds`
- 遍历该服务器全部 `inbounds`
- 对每个 `inbound` 执行：
  - `ensureNodeConfig()`
  - `xuiService.upsertUniqueClient()`
  - 必要时 `xuiService.resetClientTraffic()`
- 返回该服务器自己的同步结果汇总

返回结构建议固定为：

```javascript
{
  serverId: server.id,
  serverName: server.name,
  successCount: 0,
  failureCount: 0,
  lastError: '',
  success: true
}
```

这里的 `success` 表示“该服务器是否完全无失败”；最终总结果仍由外层统一归并。

### 2. 外层使用通用并发工具

在 `syncUserToXuiServers()` 中复用 `runWithConcurrency()`：

```javascript
const settledResults = await runWithConcurrency(
  servers,
  10,
  (server) => syncUserToSingleServer(db, user, server, plan)
)
```

要求：

- 最大并发固定为 10
- 单台服务器异常不能中断其他服务器
- 返回结果顺序与输入服务器顺序保持一致，便于日志定位

### 3. 统一汇总结果

不能在并发 worker 内直接共享修改外层 `successCount`、`failureCount`、`lastError`，避免后续维护时出现统计混乱。

改为：

1. 每台服务器返回自己的局部统计
2. 外层统一遍历 `settledResults`
3. 汇总得到总 `successCount`、`failureCount`、`lastError`

总结果继续保持当前语义：

- `failureCount > 0` 或 `successCount === 0` 时返回失败
- 否则返回成功

### 4. 保持单台服务器内部串行

单台服务器内部不改成并发，继续保留：

- 一个 `getInbounds()`
- 一个 `for...of inbound`
- 必要时顺序 `resetClientTraffic()`

这样可以最大程度复用当前稳定行为，并避免对同一台服务器并发写入。

### 5. 保持 finally 收口

`orderRepository.updateUserSyncStatus(db, user.id, 2)` 仍由 `syncUserToXuiServers()` 外层 `finally` 统一执行，不下沉到单台服务器函数中。

这样可以保持用户侧“等待同步结束”的状态机语义不变。

## 错误处理

- 单台服务器 `getInbounds()` 失败：
  只记该服务器失败结果，不影响其他服务器。
- 单个 `inbound` `upsertUniqueClient()` 失败：
  记录失败，继续同服务器下一个 `inbound`。
- `resetClientTraffic()` 失败：
  记录失败，继续同服务器下一个 `inbound`。
- 单台服务器内抛异常：
  在单台服务器函数内转为失败结果返回，避免整个任务池提前中断。
- 全部服务器都失败：
  保持当前总返回失败语义。

## 日志

保留当前日志粒度，不做大规模重构，但建议补充一条外层汇总日志，明确并发处理的服务器数量与最终结果。

日志要求：

- 不输出 API Token
- 不输出完整 UUID
- 不输出完整 `sub_id`
- 不改变现有错误日志的可检索字段

## 测试与验证

### 自动化测试

在现有订单同步测试基础上补充至少以下场景：

1. 超过 10 台服务器时，最大并发数不超过 10。
2. 多台服务器并发时，单台失败不影响其他服务器继续执行。
3. 单台服务器内部 `inbound` 仍按顺序执行，不能并发 `add/update`。
4. 续费场景下 `resetClientTraffic()` 仍按原顺序执行。
5. 最终 `successCount`、`failureCount`、`message` 汇总正确。

建议新增或扩展：

- [`server/test/test-order-xui-sync.js`](F:\web-project\subscription-manager-v1.0.0\server\test\test-order-xui-sync.js)

### 项目验证

按项目规范，后端修改后运行相关测试脚本，并保留完整日志。由于会修改 `server/**/*.js`，实施完成后提醒用户重启服务器，但不自行启动。

## 风险与控制

- 并发会让日志输出交错：
  通过保留 `server.name`、`inbound.id` 等上下文降低排查难度。
- 并发会提高瞬时远程请求数：
  上限固定为 10，不使用无上限 `Promise.all()`。
- 单台服务器内部如果存在顺序依赖：
  该设计保持单机内部串行，避免破坏假设。
- 统计逻辑从共享变量改为结果归并：
  降低后续维护时误改计数逻辑的风险。

## 验收标准

- 订单同步链路在多台服务器场景下不再完全串行。
- 在线服务器数大于 10 时，最大并发不超过 10。
- 同一台服务器仍保持 `getInbounds -> 各 inbound 顺序同步`。
- 单台服务器失败不影响其他服务器完成同步。
- 返回结果与补偿任务语义保持兼容。
