# 3X-UI 单用户关联多入站迁移设计

## 背景

当前项目沿用旧版 3X-UI 的节点级客户端模型：同一用户在同一台 3X-UI 服务器的多个 inbound 上，会被创建为多个带后缀的客户端，例如 `user@example.com-cf`、`user@example.com-direct`。3X-UI 3.4.2 已支持客户端级模型，一个客户端可以通过 `inboundIds` 关联多个 inbound。

目标是切换到 3X-UI 3.4.2 的单用户多入站模型：每台 3X-UI 服务器只保留一个 `user.email` 客户端，关联该服务器上所有应开放的 inbound。迁移完成后，项目代码不再兼容旧后缀客户端模式。

## 用户体验目标

- 用户中心账号、登录状态、套餐权益不变。
- 用户已有公开订阅链接 `/api/user/sub/:token` 不变。
- 后台迁移后自动重建订阅缓存，用户下一次刷新订阅即可拿到新凭证。
- 迁移成功后立即删除远端旧后缀客户端，不设置宽限期；代码本身只使用新模式。

## 总体方案

代码先切到新模型，再执行一次性迁移任务。

新模型规则：

- 3X-UI 版本 `panel_version >= 3.4.2` 的服务器使用单用户模型。
- 每台服务器、每个用户只创建一个 3X-UI 全量 client，email 等于本地 `users.email`。
- 创建或更新 client 时一次性写入 UUID、密码、订阅 ID、Hysteria 认证等完整凭证，并使用 3X-UI clients API 的 `inboundIds` 关联全部目标 inbound。
- `user_node_configs` 增加 `password` 字段；同一用户同一服务器下多条 inbound 配置可复用同一组 `uuid/password/auth/sub_id`。
- 订阅生成、流量统计、禁用启用、巡检补偿、管理端编辑全部只认 `client.email === user.email`。

迁移任务规则：

- 先创建新 client 并验证，再处理本地数据和订阅缓存。
- 旧后缀 client 不保留宽限期；迁移验证成功后立即删除。
- 迁移状态仅通过脚本日志和数据库审计表追踪，不增加管理端页面。

## 需要修改的模块

### 3X-UI API 封装

修改 `server/integrations/xui/xui-api-client-v325.js` 和 `server/integrations/xui/xui-service.js`：

- 支持 `POST /panel/api/clients/add` 的 `{ client, inboundIds }` payload。
- 增加按 email 更新服务器级 client 的方法。
- 增加 attach/detach 关联 inbound 的方法。
- 增加删除旧后缀 client 的迁移专用方法。

### 订单与续费同步

修改 `server/services/shared/order-service.js`：

- `syncUserToSingleServer()` 不再循环每个 inbound 创建后缀用户。
- 改为按服务器收集 inboundIds，构建一个 `user.email` client。
- 同一服务器下的 `user_node_configs` 写入统一凭证。
- 续费、限时套餐重置流量、启用状态同步都更新同一个服务器级 client。

### 订阅生成

修改 `server/services/user/subscription-service.js`：

- `inspectUserInNodeSnapshot()` 只查找 `client.email === user.email`。
- `parseNodeConfig()` 从新 client 读取 UUID/password/auth/subId。
- 订阅源缓存失效时按新模式补拉。
- 迁移后清理并重建 `user_subscription_sources` 与 `user_subscriptions`。

### 流量统计

修改 `server/services/shared/traffic-manager.js`：

- `calculateUserTotalTraffic()` 按 `email === user.email` 读取每台服务器的总量。
- 禁止继续用 `email.startsWith(user.email + '-')` 汇总。
- 迁移完成后为每个用户、每台服务器重置 `traffic_sync_log` 当前基线，避免重复累计旧后缀客户端流量。

### 禁用与启用同步

修改 `server/services/shared/traffic-manager.js`：

- `syncDisableStatusToXui()` 只更新 `user.email` client。
- 快照判断 `isUserDisabledInXuiSnapshot()` 只认新 email。
- 到期禁用、流量超限禁用、续费解除禁用全部走新模式。

### 巡检补偿

修改 `server/jobs/handlers/sync-xui-users.js`：

- 巡检只检查和补偿 `user.email` client。
- 不再生成或修复 `user.email-remark` 旧客户端。
- 巡检刷新 `xui_nodes` 后，按新模式同步本地 `user_node_configs`。

### 管理端用户编辑

修改 `server/services/admin/users-service.js`：

- 管理员编辑用户权益、状态、CF IP 关联后，只更新服务器级 client。
- 请求超时配置保持现有长超时策略。

## 迁移脚本设计

新增脚本建议命名为 `server/test/migrate-xui-client-model-v342.js`，职责是一次性迁移现有用户。

核心流程：

1. 读取所有在线且 `panel_version >= 3.4.2` 的服务器。
2. 拉取每台服务器所有 inbound。
3. 读取全部用户，包括历史禁用用户。
4. 对每个用户扫描该服务器上的旧后缀 client。
5. 选择新 client 凭证：
   - 新 client 是全量凭证对象，不再按 inbound 类型选择 `id` 或 `auth`。
   - 优先从现有旧后缀 client 与本地 `user_node_configs` 复用 UUID、password、auth。
   - 缺失的 UUID、password、auth 分别生成补齐，确保同一个 client 可被不同协议 inbound 使用。
   - subId 可复用第一个有效旧 subId；若缺失则生成 16 位十六进制。
6. 创建或更新 `user.email` client，并关联该服务器全部 inboundIds。
7. 更新该用户在该服务器下所有 `user_node_configs` 为同一组凭证。
8. 重新同步 `xui_nodes`。
9. 删除该用户本地订阅源缓存和最终订阅缓存。
10. 重新生成订阅缓存。
11. 写入迁移审计日志，记录新旧 email、服务器、inboundIds、凭证来源和清理计划。
12. 验证新 client 和订阅缓存可用后，立即删除旧后缀 client。

另新增可重跑的清理能力，删除满足以下条件的旧后缀 client：

- 对应 `user.email` 新 client 已存在。
- 新 client 已关联该服务器所有目标 inbound。
- 数据库审计表记录该用户该服务器迁移已完成。

## 迁移窗口要求

迁移期间需要暂停：

- 3X-UI 用户巡检补偿任务。
- 流量同步与自动禁用任务。
- xui_sync_tasks 队列处理。
- 新订单支付后的即时 3X-UI 同步。

迁移完成并验证通过后恢复任务。

## 验证项

- 每个目标用户在每台 3X-UI 3.4.2 服务器只有一个 `user.email` client。
- 该 client 的 inboundIds 覆盖目标服务器全部可用 inbound。
- `user_node_configs` 同一服务器下凭证一致。
- 用户公开订阅链接不变。
- 用户订阅内容能生成全部节点。
- 流量同步不会重复累计旧后缀客户端。
- 禁用、启用、续费、管理端编辑只更新新 client。
- 巡检任务不会重新创建旧后缀 client。

## 风险与处理

- 客户端本地订阅缓存未及时刷新：迁移完成后立即删除旧后缀 client，部分长期不刷新订阅的客户端可能短时断连；通过迁移后强制重建订阅缓存，并在迁移窗口后提示用户刷新订阅来降低影响。
- 迁移中途失败：新 client 创建成功前不删除旧 client；失败用户记录日志并可重跑。
- 流量重复统计：迁移后重置 `traffic_sync_log` 基线。
- 订阅缓存引用旧凭证：迁移后强制删除并重建缓存。
- 非 3.4.2 服务器：本方案不覆盖。实施前需要确认生产 3X-UI 均升级到 3.4.2 或更高版本；迁移脚本只处理 `panel_version >= 3.4.2` 的服务器。

## 开放问题

- 无。当前设计决策为：旧后缀 client 宽限期为 0 小时；迁移覆盖全部用户；只覆盖 3X-UI 3.4.2+；迁移状态使用脚本日志和数据库审计表。
