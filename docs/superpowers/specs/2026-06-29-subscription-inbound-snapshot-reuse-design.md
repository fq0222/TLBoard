# 订阅生成复用 inbound 快照设计

## 背景

用户点击“生成订阅链接”时，原始订阅来源缓存会校验节点指纹。节点指纹包含完整的 `xui_nodes.settings`，其中又包含 inbound 的全部客户端。四小时 3X-UI 用户同步巡检刷新 inbound 快照后，只要任一客户端发生变化，相关节点的来源缓存就会因节点指纹不匹配而失效。

当前增量修复流程会把指纹不匹配的服务器逐台执行 `getInbounds()`。生产日志显示，6 台服务器串行同步约耗时 17 秒，随后 7 个原始订阅模板并发刷新约耗时 4 秒，整个生成请求约耗时 21 秒。主要性能损耗来自重复且串行的 inbound 请求。

四小时巡检已经把完整 inbound 数据写入 `xui_nodes`。如果本地快照能够证明当前用户的远端身份仍与 `user_node_configs` 一致，生成请求无需再次获取 inbound。但新用户首次付款后，巡检可能尚未运行；此时旧快照没有该用户，生成请求仍必须访问对应 3X-UI。

## 目标

- 来源缓存失效后，优先使用四小时巡检写入的本地 inbound 快照。
- 本地快照包含当前用户且 UUID、`subId` 一致时，不访问对应服务器的 `getInbounds()`。
- 快照缺少用户、无法解析、出现重复用户或关键凭据不一致时，远程获取对应服务器的 inbound。
- 按 `server_id` 去重需要远程获取的服务器，并保持限流并发，最大并发数为 10。
- 保持原始订阅模板限流并发，最大并发数为 10。
- 单台服务器失败不阻断其他服务器和节点。
- 新用户首次付款、四小时巡检尚未更新快照时，仍能在当前生成请求内完成远端确认和必要修复。
- 不改变订阅链接格式、节点策略、缓存有效期或四小时巡检频率。

## 非目标

- 不从节点指纹中删除 `settings`。
- 不新增数据库表或数据库迁移。
- 不引入跨请求的全局锁或 server-id 级 single-flight。
- 不改变 `user_subscription_sources` 的缓存结构。
- 不把订阅生成改成异步后台任务。
- 不自行调整 3X-UI 用户同步巡检的执行周期。

## 方案选择

### 方案一：逐用户校验本地快照（采用）

解析当前节点的 `xui_nodes.settings.clients`，按预期 email 查找用户，并核对 UUID 与 `subId`。校验通过时直接复用本地快照；校验失败时才把服务器加入远程同步集合。

优点是无需迁移、判断准确，并能覆盖新用户首次付款。缺点是生成流程需要增加明确的快照可信度判断。

### 方案二：仅依据快照更新时间

给快照增加更新时间或依据巡检时间决定是否复用。实现较简单，但“快照较新”不能证明其包含刚付款用户，也不能发现 UUID、`subId` 不一致，因此不采用。

### 方案三：新增用户级远端状态表

为每个用户、服务器和 inbound 保存巡检确认状态。长期边界清晰，但需要数据库迁移、巡检写入和额外一致性维护，超出本次优化范围，因此不采用。

## 快照可信度规则

以 `user_node_configs` 与其关联的 `xui_nodes` 数据作为单个节点的判断输入。预期客户端 email 为：

```javascript
`${user.email}-${config.remark || config.inbound_id}`
```

只有以下条件全部满足，快照才可信：

1. 当前节点快照存在。
2. `settings` 可以解析为对象。
3. `settings.clients` 是数组。
4. 按预期 email 恰好找到一个客户端。
5. `String(client.subId || '') === String(config.sub_id || '')`。
6. `String(client.id || '') === String(config.uuid || '')`。
7. `server_id`、`inbound_id`、`protocol`、`settings` 和 `stream_settings` 等生成所需字段存在。

快照拒绝原因使用固定枚举，便于日志汇总和自动化测试：

- `missing_snapshot`
- `invalid_settings`
- `invalid_clients`
- `missing_user`
- `duplicate_user`
- `sub_id_mismatch`
- `uuid_mismatch`
- `incomplete_snapshot`

UUID 或 `subId` 任一侧为空也按不一致处理，不进行宽松等价。

## 总体流程

```text
读取用户、在线服务器、用户节点配置、节点快照和来源缓存
  -> 评估每个来源缓存
  -> 缓存全部可用：直接本地拼装
  -> 存在失效 pair：校验对应本地 inbound 快照
  -> 快照可信的 pair：跳过 getInbounds
  -> 快照不可信的 pair：按 server_id 去重
  -> 并发获取不可信服务器的 inbound 并更新 xui_nodes
  -> 重新读取用户节点配置和节点快照
  -> 必要时仅对仍异常的服务器执行一轮用户补偿同步
  -> 并发刷新失效的原始订阅模板
  -> 最终校验、拼装并保存订阅
```

节点指纹变化不再直接等价于必须远程获取 inbound。其新语义是：来源模板必须重新验证或刷新；是否访问 3X-UI 由当前用户的本地 inbound 快照可信度决定。

## 组件设计

### 快照检查函数

在 `server/services/user/subscription-service.js` 增加纯函数：

```javascript
inspectUserInNodeSnapshot(user, config)
```

返回值：

```javascript
{
  trusted: true,
  reason: 'ok',
  expectedEmail: 'fuqiang_2015@163.com-cf',
  client: {}
}
```

该函数只解析和比较输入，不访问数据库、不调用网络。失败时 `client` 可以为空，`reason` 必须是固定枚举之一。日志不得输出完整 UUID 或完整 `subId`。

### 远程补拉计划

增加纯函数：

```javascript
buildInboundRefreshPlan(user, invalidPairs)
```

返回值：

```javascript
{
  reusablePairs: [],
  remotePairs: [],
  remoteServerIds: new Set(),
  reasonCounts: {}
}
```

函数逐个检查失效 pair，将快照可信的 pair 放入 `reusablePairs`，将不可信的 pair 放入 `remotePairs`，并按服务器去重远程请求。

### 并发获取 inbound

当前增量修复中的 `for...of + await syncServerNodes()` 改为一次调用现有的：

```javascript
syncSelectedServers(db, remoteServers, {
  inboundSnapshotCache: options.inboundSnapshotCache
})
```

`syncSelectedServers()` 已使用 `runWithConcurrency()`，并发上限为 10。一个服务器存在多个异常 inbound 时仍只执行一次 `getInbounds()`。

### 同步后重新读取

远程获取完成后必须重新读取 `xui_nodes` 与 `user_node_configs`，不能继续使用获取前的 `config.settings`。随后重新评估远程服务器上的异常 pair。

如果补拉后仍缺少当前用户，或 UUID、`subId` 仍不一致，则仅对这些服务器调用现有 `syncUserToXuiServers()` 执行一次补偿。补偿后重新读取配置并进入模板刷新，不允许循环补偿。

## 并发模型

两类远程操作分阶段执行：

1. inbound 获取按服务器并发，最大并发数 10。
2. inbound 阶段全部结束并重新读取本地状态后，原始订阅模板按节点并发刷新，最大并发数 10。

不采用每台服务器独立执行“获取 inbound、写库、刷新模板”的流水线，以免同一次生成过程中混用部分新状态与部分旧状态，也便于生成准确的阶段汇总日志。

## 来源缓存策略

保留 `computeNodeFingerprint()` 的现有规则，包括完整 `settings`。原因是用户增删、UUID、远端客户端字段和 inbound 配置变化都可能影响原始模板。

快照可信时可以跳过 `getInbounds()`，但来源缓存已经失效时仍需刷新对应原始订阅模板。模板请求使用当前 `user_node_configs.sub_id`，单请求超时保持 5 秒，最大并发数保持 10。

## 新用户首次付款

付款完成后、四小时巡检尚未运行时，旧 `xui_nodes.settings.clients` 通常没有新用户：

1. 快照检查返回 `missing_user`。
2. 对应服务器进入远程 inbound 集合。
3. 多台服务器并发调用 `getInbounds()`。
4. 获取成功后更新 `xui_nodes` 并重新读取状态。
5. 如果远端已存在用户且 UUID、`subId` 一致，直接刷新原始模板。
6. 如果远端仍不存在用户或凭据不一致，对该服务器执行一次 `syncUserToXuiServers()` 补偿。
7. 补偿后重新读取配置并刷新模板，不进行第二轮补偿。

## 错误处理

- 单台服务器 inbound 获取失败：记录失败，继续处理其他服务器。
- 快照 JSON 无法解析：按不可信处理，不因解析异常终止整次生成。
- 同 email 出现多个客户端：按不可信处理，交给既有唯一客户端同步逻辑修复。
- 补拉后仍不一致：最多执行一轮用户补偿。
- 原始模板单节点刷新失败：记录失败，继续其他节点。
- 最终至少存在一个有效节点：保持现有降级成功语义。
- 最终没有任何有效节点：保持现有接口失败语义。

## 日志设计

所有本次新增或调整的用户级日志必须使用用户 email，不使用数字用户 ID。服务器集合必须输出具体服务器备注名称，不只输出服务器数量或 ID。

本地快照评估示例：

```text
[USER-SUB] [INFO] 本地 inbound 快照评估: user=fuqiang_2015@163.com, servers=[美国01-达拉斯, 日本], invalidPairs=3, reusedPairs=1, remotePairs=2, reasons={"missing_user":1,"sub_id_mismatch":1}
```

并发补拉完成示例：

```text
[USER-SUB] [INFO] inbound 并发补拉完成: user=fuqiang_2015@163.com, servers=[美国01-达拉斯, 日本], success=2, failed=0, duration=2180ms
```

无需远程补拉时：

```text
[USER-SUB] [INFO] 复用本地 inbound 快照: user=fuqiang_2015@163.com, servers=[美国01-达拉斯, 美国02-达拉斯, 日本], pairs=7
```

最终汇总示例：

```text
[USER-SUB] [INFO] 订阅生成汇总: user=fuqiang_2015@163.com, localServers=[美国01-达拉斯, 美国02-达拉斯, 日本], remoteServers=[], snapshotReused=7, snapshotRejected=0, inboundSuccess=0, inboundFailed=0, sourceSuccess=7, sourceFailed=0, nodes=28, duration=4300ms
```

约束：

- `user=` 后始终是 email。
- `servers=`、`localServers=`、`remoteServers=` 后始终是服务器备注名称数组。
- 没有服务器时输出 `[]`。
- 服务器名称按本次在线服务器原始顺序输出，去重但不排序，便于与处理顺序对应。
- 不输出 API Token、完整 UUID、完整 `subId` 或订阅内容。
- `subscription-cache-service` 的逐 pair 失效日志应由调用方汇总日志替代或支持静默评估，避免节点较多时重复刷屏。

## 自动化测试

新增 `server/test/test-subscription-snapshot-reuse.js`，至少覆盖：

1. 快照包含用户且 UUID、`subId` 一致，不调用 `syncSelectedServers()`。
2. 快照缺少用户，对应服务器进入远程集合。
3. `subId` 不一致，对应服务器进入远程集合。
4. UUID 不一致，对应服务器进入远程集合。
5. `settings` 为非法 JSON，对应服务器进入远程集合。
6. 同 email 存在多个客户端，对应服务器进入远程集合。
7. 同一服务器多个 inbound 异常，只远程获取一次。
8. 两台服务器异常时并发开始，不串行等待。
9. 一台快照可信、一台不可信，只获取不可信服务器。
10. 单台补拉失败时，其他服务器继续处理。
11. 补拉后仍缺少用户，只执行一轮用户补偿。
12. 来源缓存仅因过期失效，快照可信时不获取 inbound，只刷新模板。
13. 服务器指纹变化但节点快照可信时，不获取 inbound，只刷新模板。
14. 日志中的 `user` 为 email，服务器集合为备注名称数组。
15. 日志不包含完整 UUID、完整 `subId` 或 API Token。

执行：

```bash
node server/test/test-subscription-snapshot-reuse.js
```

同时运行 `server/test/` 下现有订阅缓存、订阅生成和 XUI 同步相关脚本，保留完整测试日志。

## 验收标准

- 四小时巡检后的快照包含用户且 UUID、`subId` 一致时，点击生成不出现对应服务器的 `getInbounds()` 请求。
- 新用户首次付款且快照没有该用户时，点击生成会并发访问对应服务器。
- UUID 或 `subId` 不一致时，对应服务器会进入远程确认和一轮补偿流程。
- 多台服务器需要获取 inbound 时并发执行，同一服务器只请求一次。
- 单台服务器失败不影响其他服务器和节点。
- 最终订阅节点数量与优化前一致。
- 全部快照可信时，示例请求耗时由约 21 秒降低到主要由原始模板刷新决定，预期约 4 至 6 秒。
- 仅一台服务器快照不可信时，总耗时接近最慢单台 inbound 请求加模板刷新耗时，而不是所有服务器请求耗时之和。
- 新增和调整的日志使用用户 email，并列出具体服务器备注名称。

## 风险与控制

- **本地快照陈旧**：通过用户 email、UUID、`subId` 三项一致性校验降低误用风险；任一异常即远程确认。
- **并发增加 3X-UI 压力**：复用现有最大并发 10，不使用无上限 `Promise.all()`。
- **重复点击产生重复请求**：本次在单次请求内按服务器去重；跨请求合并留作有实际压力时的后续优化。
- **补偿循环拉长请求**：每次生成最多执行一轮用户补偿。
- **日志暴露凭据**：日志只记录 email、服务器备注、原因枚举和计数，不记录完整 UUID、`subId`、Token 或订阅内容。
