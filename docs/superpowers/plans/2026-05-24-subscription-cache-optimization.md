# 订阅生成缓存优化实施方案

## 背景

当前用户点击“生成订阅链接”时，后端会执行两类重操作：

1. 调用 `syncAllServers()` 同步所有在线 3X-UI 服务器的 `inbounds`
2. 按 `user_node_configs` 逐个请求 `sub_url + sub_id`，拉取每个节点的原始订阅内容

这样做虽然能保证结果新鲜，但代价也很明显：

- 每次生成都依赖全部在线 3X-UI 服务器
- 用户重复生成订阅时延高
- 节点数量增多后，原始订阅拉取成本线性上升

## 目标

把生成订阅的主流程优化成：

- 用户首次生成时，完整同步并落库原始订阅模板
- 用户再次生成时，优先复用本地缓存
- 只有缓存缺失或失效时，才对异常服务器或异常节点做增量修复

最终目标不是完全不访问 3X-UI，而是让“绝大多数生成请求”只做本地拼装。

## 数据职责

本次方案明确保留 4 层数据职责：

- `xui_nodes`
  服务器级 inbound 快照，描述“当前服务器有哪些 inbound 以及它们的配置”
- `user_node_configs`
  用户在每个 `server_id + inbound_id` 上的 `uuid/sub_id` 映射
- `user_subscription_sources`
  用户在每个 `server_id + inbound_id` 上最近一次成功拉到的原始订阅模板缓存
- `user_subscriptions`
  最终聚合后的订阅结果缓存，供 `/api/user/sub/:token` 直接返回

## 新增表设计

新增表：`user_subscription_sources`

建议字段：

- `id SERIAL PRIMARY KEY`
- `user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `server_id INTEGER NOT NULL`
- `inbound_id INTEGER NOT NULL`
- `sub_id VARCHAR(50) NOT NULL`
- `remark VARCHAR(255) NOT NULL DEFAULT ''`
- `protocol VARCHAR(50) NOT NULL DEFAULT ''`
- `original_link TEXT NOT NULL DEFAULT ''`
- `node_fingerprint VARCHAR(255) NOT NULL DEFAULT ''`
- `server_fingerprint VARCHAR(255) NOT NULL DEFAULT ''`
- `fetched_at BIGINT`
- `updated_at BIGINT`
- `UNIQUE(user_id, server_id, inbound_id)`

索引：

- `idx_user_subscription_sources_user_id`
- `idx_user_subscription_sources_server_id`

说明：

- 唯一约束已经覆盖 `(user_id, server_id, inbound_id)` 的查找路径，不再额外重复建复合索引

## 指纹定义

为了避免“数量没变，但节点配置已经变了”的误判，方案引入两层指纹。

### 节点指纹 `node_fingerprint`

基于以下字段计算：

- `server_id`
- `inbound_id`
- `remark`
- `protocol`
- `port`
- `settings`
- `stream_settings`

用途：

- 判断某个 inbound 的关键配置是否发生变化

### 服务器指纹 `server_fingerprint`

基于以下字段计算：

- `server_id`
- `sub_url`
- `host`
- `client_port`

用途：

- 判断订阅访问入口是否变化

### 标准化规则

计算指纹前，需要先做稳定化处理：

- JSON 字段统一排序后再序列化
- `null`、`undefined`、空字符串统一视为空值
- 字符串去首尾空白

## 生成订阅主流程

### 规则总览

- 用户没有 `user_subscriptions` 记录：直接走首次生成
- 用户已有 `user_subscriptions` 记录：优先判断原始订阅缓存是否可用
- 缓存可用：直接本地拼装
- 缓存不可用：只对异常部分做同步和补拉

### 首次生成流程

1. 查询在线服务器
2. 同步所有在线服务器的 `xui_nodes`
3. 读取该用户的 `user_node_configs`
4. 如果用户节点配置不完整，则调用 `syncUserToXuiServers()` 修复
5. 按每个 `server_id + inbound_id` 拉取原始订阅模板
6. 将模板写入 `user_subscription_sources`
7. 结合用户优选 IP 生成最终节点
8. 回写 `user_subscriptions.nodes_data`

### 缓存命中流程

对每个 `server_id + inbound_id` 判断：

1. 本地是否存在对应的 `user_subscription_sources`
2. `source.sub_id` 是否等于当前 `user_node_configs.sub_id`
3. `source.node_fingerprint` 是否等于当前 `xui_nodes` 计算值
4. `source.server_fingerprint` 是否等于当前服务器配置计算值
5. `fetched_at` 是否未超过最大缓存时长

全部通过后，直接复用 `original_link` 做本地拼装，不再全量访问 3X-UI。

### 增量修复流程

当缓存不可用时：

1. 找出缺快照或指纹异常的服务器
2. 仅对这些服务器执行 `syncServerNodes()`
3. 重新读取 `xui_nodes` 和 `user_node_configs`
4. 仅对缺失或失效的 `server_id + inbound_id` 重新拉取原始订阅模板
5. 更新 `user_subscription_sources`
6. 再次执行最终拼装

## 订阅拼装策略

复用现有 `subscription-strategy` 规则：

- `remark` 中包含 `cf`：走 CF 策略
- 其他：走 direct 策略

拼装规则：

- CF 节点：用缓存中的 `original_link` 作为模板，再结合用户当前优选 IP 生成节点
- direct 节点：保留原始链接，只补充格式化后的备注

## 缓存失效时机

以下场景需要让来源缓存失效或进入待刷新状态：

- 新建 `user_node_configs`
- 某个节点的 `sub_id` 被重建
- 某个 inbound 的 `remark/protocol/port/settings/stream_settings` 发生变化
- 服务器的 `sub_url/host/client_port` 发生变化
- 缓存超过最大保留时长

当前实现采用保守策略：

- 当 `ensureNodeConfig()` 新建用户节点映射时，删除对应 `user_subscription_sources` 记录
- 下次生成订阅时再按需补拉

## 代码改动范围

### 新增

- `server/db/migrations/007-user-subscription-sources.js`
- `server/services/subscription-cache-service.js`
- `server/test/test-subscription-cache-service.js`
- `docs/superpowers/plans/2026-05-24-subscription-cache-optimization.md`

### 修改

- `server/routes/user/subscription.js`
- `server/services/subscription-service.js`
- `server/services/xui-sync.js`
- `server/services/order-service.js`
- `server/db/init.js`

## 验收场景

### 场景 1：首次生成

- 用户没有 `user_subscriptions`
- 预期：会同步节点、拉取原始模板、生成最终订阅，并写入两层缓存

### 场景 2：缓存命中

- 用户已存在 `user_subscriptions` 和完整 `user_subscription_sources`
- 预期：直接本地拼装，不再全量同步所有服务器

### 场景 3：单节点失效

- 删除某一条 `user_subscription_sources`
- 预期：只补拉对应 `server_id + inbound_id`

### 场景 4：服务器快照缺失

- 删除某台在线服务器对应的 `xui_nodes`
- 预期：只对缺失服务器执行 `syncServerNodes()`

### 场景 5：`sub_id` 变化

- 修改某条 `user_node_configs.sub_id`
- 预期：仅对应来源缓存失效，并在下次生成时补拉

## 风险与控制

- 风险：只看数量会误判缓存可用
  控制：校验粒度下沉到 `server_id + inbound_id`，并引入双指纹校验

- 风险：服务器订阅入口变化导致旧模板不可用
  控制：增加 `server_fingerprint`

- 风险：用户节点配置重建后仍复用旧模板
  控制：校验 `sub_id`，并在新建节点映射时删除对应来源缓存

## 实施结果

本方案已经按以下方向落地：

- 新增用户维度原始订阅模板缓存表
- 新增缓存指纹与可用性判断服务
- 重写 `POST /api/user/subscription/generate` 的主流程
- 支持首次生成、缓存命中、本地拼装、增量修复
- 在全新环境初始化时由 `server/db/init.js` 兜底建表

## 后续可选增强

- 增加后台预热任务，提前刷新 `user_subscription_sources`
- 为生成接口补充缓存命中率和耗时日志
- 在管理端增加缓存状态观测能力
