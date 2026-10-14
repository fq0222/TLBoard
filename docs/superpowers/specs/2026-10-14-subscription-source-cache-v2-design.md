# 订阅原始模板缓存 v2 设计

## 背景

用户点击“生成订阅链接”时，系统会分别处理两类远程数据：

1. 通过 3X-UI API 获取服务器 inbound 快照；
2. 通过服务器的 `sub_url + sub_id` 获取用户原始订阅模板。

当前实现已经可以在本地 inbound 快照可信时跳过第一类请求，但原始模板缓存仍可能因为以下原因在每次生成时被批量判定失效：

- 缓存固定 24 小时过期；
- 节点指纹包含完整 `settings.clients`，其他用户或客户端数组顺序变化也会使当前用户缓存失效；
- 模板失效原因以静默模式评估，汇总日志只展示 inbound 快照拒绝原因，无法定位模板缓存为何失效。

典型日志中的 `invalidPairs=31, reusedPairs=31, remotePairs=0, reasons={}` 表示 31 个原始模板缓存失效，但 31 个本地 inbound 快照均可信，因此没有调用 `getInbounds()`；后续仍会重新访问原始订阅地址。空的 `reasons` 只表示没有 inbound 快照拒绝原因，不代表模板缓存没有失效原因。

## 目标

- 在线服务器、本地 inbound 连接配置和当前用户节点凭据均未变化时，连续点击生成订阅不产生远程请求。
- 某台服务器的有效快照发生变化时，只刷新该服务器中受影响的原始模板。
- 当前用户某个节点的凭据发生变化时，只刷新对应节点，不影响其他节点或用户。
- 本地 inbound 快照可信时，不重复调用该服务器的 `getInbounds()`。
- 本地 inbound 快照不可信时，只对不可信服务器执行定向同步。
- 不修改数据库表结构，不新增迁移脚本。
- 旧指纹缓存可按需、渐进式升级，不全表清空。
- 日志明确区分 inbound 远程同步和原始模板远程拉取，并展示模板缓存失效原因。

## 非目标

- 不改变通用订阅、Clash 订阅和 V2Ray 订阅的 URL 或内容格式。
- 不改变用户 UUID、`sub_id`、Hysteria2 `auth/password` 的生成规则。
- 不调整现有 3X-UI 定时巡检周期。
- 不在点击生成时主动探测远端是否发生了尚未进入本地 `xui_nodes` 的变化。
- 不增加跨请求锁、分布式缓存或后台消息系统。
- 不清空 `user_subscription_sources` 表。

## 当前缓存失效条件

当前每个 `server_id + inbound_id` 的来源缓存会依次检查：

1. 缓存记录是否存在；
2. 缓存 `sub_id` 是否等于当前 `user_node_configs.sub_id`；
3. 节点指纹是否一致；
4. 服务器指纹是否一致；
5. `fetched_at` 是否超过 24 小时；
6. `original_link` 是否可以解析；
7. 链接协议、端口、网络类型和安全类型是否匹配当前 inbound。

当前节点指纹包含完整 `settings`，因此整个 `settings.clients` 数组参与比较。这把其他用户的变化错误放大成当前用户的模板失效。

## 方案选择

### 方案一：无迁移的版本化精简指纹（采用）

在现有 `node_fingerprint` 和 `server_fingerprint` 字段中使用 `v2:` 前缀，并将节点指纹拆分为“inbound 连接配置”和“当前用户凭据”两部分后再统一哈希。

优点：

- 不修改数据库表；
- 旧缓存可以自动识别并渐进升级；
- 能排除其他用户变化造成的无效刷新；
- 回滚时不涉及数据库结构。

代价：上线后的每条旧缓存首次使用时需要刷新一次。

### 方案二：新增 `fingerprint_version` 字段（不采用）

语义直观，但需要生产迁移，与本次“无数据库修改”约束冲突。

### 方案三：仅取消 24 小时过期（不采用）

只能解决时间驱动刷新，无法解决完整 `settings.clients` 指纹过宽的问题，也无法提供准确诊断。

## v2 指纹设计

### 格式

现有字段继续保存字符串，格式调整为：

```text
v2:<64 位 SHA-256 十六进制摘要>
```

没有 `v2:` 前缀的记录统一视为旧版缓存，失效原因为 `fingerprint_version_mismatch`。

### 服务器指纹

服务器指纹只包含会影响原始订阅访问或节点目标地址的字段：

```text
server_id
sub_url
host
client_port
```

字段继续使用稳定 JSON 序列化和规范化数字处理。任一字段变化时，该服务器关联的来源模板全部失效。

### 节点指纹

节点指纹由两部分组成。

inbound 连接投影：

```text
server_id
inbound_id
remark
protocol
port
stream_settings
```

用户凭据投影：

```text
sub_id
uuid
auth
password
flow
```

最终对两个投影组成的稳定对象计算一次 SHA-256，并增加 `v2:` 前缀。

其中 `flow` 从 `settings.clients` 中按当前配置的 `sub_id/uuid/auth/password` 唯一匹配客户端后提取，避免依赖仓储查询中不存在的独立 `flow` 列。节点指纹不得包含完整 `settings` 或完整 `settings.clients`。当前用户身份的可信度仍由已有 `inspectUserInNodeSnapshot()` 单独校验；即使指纹和原始链接均有效，也必须先通过该校验，避免取消 24 小时过期后永久复用已经删除或凭据已变化的客户端快照。

### `stream_settings` 处理

v2 首期保留完整 `stream_settings` 的稳定序列化。该字段描述 WS、gRPC、TLS、Reality 等连接参数，任意变化都可能影响最终节点链接。后续只有在生产证据表明其中存在高频、与连接无关的字段时，才进一步做协议级字段投影。

## 缓存有效性规则

模板缓存仅在以下条件全部成立时可直接复用：

1. 缓存记录存在；
2. `source.sub_id` 等于当前节点 `sub_id`；
3. `source.node_fingerprint` 为当前 v2 节点指纹；
4. `source.server_fingerprint` 为当前 v2 服务器指纹；
5. `original_link` 可以解析；
6. 链接的协议、端口、网络和安全类型与当前 inbound 匹配。

同步生成路径不再因为 `fetched_at` 超过 24 小时而强制失效。`fetched_at` 和 `updated_at` 继续写入，保留审计和未来后台维护用途。

稳定的模板失效原因枚举为：

```text
missing_source
sub_id_mismatch
fingerprint_version_mismatch
node_fingerprint_mismatch
server_fingerprint_mismatch
original_link_mismatch
```

`cache_expired` 不再出现在用户点击生成的同步评估结果中。

## 生成流程

### 第一阶段：读取本地状态

读取：

- 当前用户；
- 在线服务器；
- 当前用户的 `user_node_configs JOIN xui_nodes`；
- 当前用户的 `user_subscription_sources`。

非首次生成时，仍只为完全缺失 `xui_nodes` 快照的在线服务器执行定向补齐。

### 第二阶段：评估来源缓存

逐个 `server_id + inbound_id` 计算 v2 指纹并检查原始链接，输出：

```javascript
{
  usable,
  validPairs,
  invalidPairs,
  invalidPairKeys,
  invalidServerIds,
  reasonCounts,
  reasonsByServer
}
```

`invalidPairs` 保持原节点处理顺序。每项携带稳定的 `reason`，但不得携带完整 UUID、`sub_id`、Token 或订阅内容到日志。

### 第三阶段：判断是否需要 inbound 远程同步

只对 `invalidPairs` 调用现有 `inspectUserInNodeSnapshot()`：

- 快照可信：直接进入模板刷新计划，不调用 `getInbounds()`；
- 快照不可信：按 `server_id` 去重，只同步不可信服务器；
- 同步后重新读取这些服务器的节点配置；
- 仍不可信时最多执行一轮用户同步补偿和验证同步，保持现有上限。

模板指纹失效本身不再被解释成“服务器快照需要重拉”。特别是 `node_fingerprint_mismatch` 和 `server_fingerprint_mismatch`，只表示本地状态相对缓存发生变化；如果当前本地快照可信，就直接基于本地状态刷新模板。

### 第四阶段：生成模板刷新计划

仅选择同时满足以下条件的节点：

- 来源缓存失效；
- 最终本地 inbound 快照可信；
- 节点仍属于在线服务器。

刷新按现有 `server_id + sub_id` 去重。一个服务器的多个 inbound 共用同一个 `sub_id` 时，只请求一次原始订阅内容，再分别选择协议和连接特征匹配的链接。

其他服务器和有效 pair 不得产生请求。

### 第五阶段：写入 v2 缓存并生成订阅

单个模板刷新成功后，覆盖对应缓存记录：

- 写入当前 `sub_id`；
- 写入匹配的 `original_link`；
- 写入带 `v2:` 前缀的节点和服务器指纹；
- 更新 `fetched_at` 和 `updated_at`。

刷新失败时保留原记录，不写入伪成功指纹；失败项继续使用现有重试队列。最终只使用通过最新缓存校验的模板生成节点。

## 旧缓存渐进升级

上线后，旧缓存没有 `v2:` 前缀：

1. 首次使用时标记为 `fingerprint_version_mismatch`；
2. 本地 inbound 快照可信则跳过 `getInbounds()`；
3. 只刷新当前用户实际使用的服务器和节点；
4. 成功后写入 v2 指纹；
5. 下一次点击直接复用。

不执行全表更新，不清空来源缓存，也不在启动时批量访问所有服务器。

如果首次升级过程中部分服务器不可用，其他服务器可以成功升级；失败项保持旧缓存并进入现有后台重试队列。

## 日志设计

### 模板缓存评估

```text
原始订阅模板缓存评估: user=fuqiang_2015@163.com, totalPairs=31, validPairs=29, invalidPairs=2, reasons={"node_fingerprint_mismatch":2}
```

### 模板刷新计划

```text
原始订阅模板刷新计划: user=fuqiang_2015@163.com, servers=[德国01], pairs=2, fetchGroups=1
```

### inbound 快照评估

保留现有日志，但将字段名明确为 `snapshotReasons`，避免与模板缓存原因混淆：

```text
本地 inbound 快照评估: user=fuqiang_2015@163.com, servers=[德国01], invalidPairs=2, reusedPairs=2, remotePairs=0, snapshotReasons={}
```

### 最终汇总

新增并区分：

```text
cacheReusedPairs
cacheInvalidPairs
sourceFetchServers
sourceFetchPairs
sourceFetchGroups
inboundRemoteServers
```

日志不得输出 API Token、完整 UUID、完整 `sub_id`、订阅 URL 或订阅内容。

## 代码边界

### `server/services/shared/subscription-cache-service.js`

- 定义 `SOURCE_FINGERPRINT_VERSION = 'v2'`；
- 提供生成带版本前缀指纹的统一方法；
- 将 `computeNodeFingerprint()` 改为只使用 inbound 连接投影和当前用户凭据投影；
- 保留 `computeServerFingerprint()` 的字段范围，但返回 v2 格式；
- `isSourceCacheUsable()` 增加版本识别，移除同步路径的时间过期判断；
- 保持纯函数性质，不访问数据库和网络。

### `server/services/user/subscription-service.js`

- 调用新的 v2 指纹函数；
- 扩展 `collectSourceCacheStatus()` 的统计结果；
- 日志分别输出模板失效原因和 inbound 快照拒绝原因；
- 模板缓存失效时继续校验本地快照，但只有快照不可信才调用 `syncSelectedServers()`；
- 仅刷新最终可信且实际失效的 pair；
- 保留模板请求的 `server_id + sub_id` 单次请求去重和并发上限。

### `server/repositories/subscription-repository.js`

原则上不需要修改 SQL 或表结构。只有在实现中需要更明确的字段别名或查询顺序来保证稳定日志时才做最小调整。

### 数据库

- 不新增迁移文件；
- 不执行 `ALTER TABLE`；
- 不删除或批量更新现有缓存；
- 复用现有 `node_fingerprint VARCHAR(255)` 与 `server_fingerprint VARCHAR(255)`。

## 错误处理

- 单台服务器 inbound 同步失败：记录该服务器失败，继续其他服务器。
- 单个原始模板请求失败：保留旧缓存记录但不得把它视为有效 v2 缓存，继续其他节点。
- 原始订阅返回内容中找不到匹配节点：记录 `original_link_mismatch` 或现有刷新失败类型，加入重试队列。
- 最终存在至少一个有效节点：保持现有降级成功语义。
- 最终没有有效节点：保持现有业务错误。
- 每次生成最多执行一轮用户补偿，禁止循环刷新。

## 测试方案

### 指纹单元测试

1. 相同输入生成稳定的 `v2:` 指纹。
2. JSON 对象键顺序不同不改变指纹。
3. `settings.clients` 中其他用户增删或顺序变化不改变当前用户节点指纹。
4. 当前用户 `sub_id` 变化会改变节点指纹。
5. 当前用户 UUID 变化会改变节点指纹。
6. Hysteria2 `auth/password` 变化会改变节点指纹。
7. inbound 端口、协议、remark 或 `stream_settings` 变化会改变节点指纹。
8. `sub_url`、host 或 `client_port` 变化会改变服务器指纹。
9. 无版本前缀的旧指纹返回 `fingerprint_version_mismatch`。
10. `fetched_at` 超过 24 小时但其他条件一致时仍可复用。

### 生成流程测试

1. 连续两次生成且本地状态不变，第二次不调用 `syncSelectedServers()` 和 `fetchOriginalSubscription()`。
2. 一台服务器的 inbound 连接配置变化，只刷新该服务器的受影响 pair。
3. 其他用户客户端变化，不刷新当前用户模板。
4. 当前用户某个节点凭据变化，只刷新对应 pair。
5. 一台服务器连接信息变化，只刷新该服务器全部相关 pair。
6. 多个失效 pair 共用 `server_id + sub_id` 时只调用一次原始订阅请求。
7. 模板失效但本地快照可信时，不调用 `getInbounds()`。
8. 本地快照缺用户或凭据不一致时，只同步对应服务器。
9. 旧版指纹第一次生成执行渐进升级，第二次生成完全复用。
10. 单台刷新失败不影响其他服务器生成成功。
11. 日志分别包含模板 `reasonCounts` 和 inbound `snapshotReasons`。
12. 日志不包含完整 UUID、完整 `sub_id`、Token 或订阅内容。

### 项目验证

至少运行：

```bash
node server/test/test-user-subscription-service.js
node server/test/test-subscription-snapshot-reuse.js
```

如果仓库中存在独立的来源缓存或 XUI 同步测试，也一并运行。完成实施时保留完整测试日志。因为会修改 `server/**/*.js`，交付时提醒用户重启服务器，但不自行启动。

## 验收标准

- 同一用户在状态不变时连续点击生成，第二次远程 inbound 请求数为 0，原始订阅请求数为 0。
- 一台服务器快照更新后，未变化服务器的原始订阅请求数为 0。
- 其他用户发生变化不会导致当前用户模板缓存失效。
- 当前用户凭据或 inbound 有效连接配置变化能够触发准确的局部刷新。
- 旧缓存不需要数据库迁移即可逐条升级为 v2。
- 日志能直接解释每个失效 pair 的原因和实际访问了哪些服务器。
- 最终订阅节点内容与优化前保持兼容。

## 回滚策略

代码回滚不需要回滚数据库。旧代码读取到 `v2:` 指纹时会将其视为指纹不匹配并重新刷新，功能仍可恢复，只会产生一次额外请求。现有缓存数据、用户凭据和订阅 URL 均不需要修改。
