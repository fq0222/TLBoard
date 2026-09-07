# 用户家宽 IP Routing 绑定设计规格

## 背景

系统已经具备家宽 IP outbound 管理和家宽 IP 套餐购买能力。用户购买家宽 IP 套餐后，`users.home_plan_id` 指向家宽套餐，套餐通过 `plans.home_proxy_tag` 绑定到 `home_proxies.tag`。现在需要让用户在个人中心自助选择最多两台 3X-UI 服务器，将本人流量通过已购买的家宽 IP outbound 转发。

3X-UI 没有独立 routing rule CRUD API，本功能沿用现有完整 Xray 配置读写方式：读取完整配置，修改 `routing.rules`，再整体回写。

## 目标

- 用户端订阅工作区下方新增“家宽 IP 控制”区域。
- 用户可以把当前购买的一个家宽 IP tag 绑定到最多两台 3X-UI 服务器。
- 操作颗粒度只到服务器，不让用户选择具体节点。
- 每台服务器的 `inboundTag` 从该服务器完整 Xray 配置的 `inbounds[*].tag` 读取，不从本地快照推断。
- 修改绑定时会删除旧服务器中该用户对应的 routing rule，并在新服务器新增或更新 rule。
- 远端全部操作成功后才保存本地绑定并记录 30 分钟冷却时间。
- 删除旧服务器或写入新服务器任一步失败时，返回失败服务器给用户重试，不保存新绑定，不记录冷却。

## 非目标

- 不提供节点级 routing 选择。
- 不允许一个用户选择超过两台服务器。
- 不实现管理员端批量代用户配置 routing。
- 不新增家宽 IP outbound 同步逻辑；要求对应 `home_proxies.tag` 已由管理端同步到目标服务器。
- 不自动清理已过期家宽权益对应的远端 routing rule；过期拦截由用户再次操作时校验。

## 数据模型

新增表 `user_home_proxy_routes`：

- `id SERIAL PRIMARY KEY`
- `user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `home_proxy_tag VARCHAR(255) NOT NULL`
- `server_ids TEXT NOT NULL DEFAULT '[]'`：当前成功绑定的服务器 ID 数组 JSON，最多两个。
- `last_synced_at BIGINT`：最后一次完整成功同步时间，作为 30 分钟冷却依据。
- `last_sync_status VARCHAR(30) NOT NULL DEFAULT 'success'`
- `last_sync_message TEXT NOT NULL DEFAULT ''`
- `created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())`
- `updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())`
- `UNIQUE(user_id)`

索引：

- `idx_user_home_proxy_routes_user_id`
- `idx_user_home_proxy_routes_home_proxy_tag`

初始化表结构和迁移脚本都需要补齐。迁移脚本应幂等，命名为 `029-user-home-proxy-routes.js`。

## 权益校验

用户有可配置家宽 IP 的条件：

1. `users.home_plan_id` 非空。
2. `users.home_expire_at` 大于当前秒级时间戳。
3. `plans.id = users.home_plan_id` 对应套餐存在。
4. `plans.plan_type = 'home_ip'`。
5. `plans.home_proxy_tag` 非空。
6. `home_proxies.tag = plans.home_proxy_tag` 存在。

后端只允许用户配置当前权益绑定的 `home_proxy_tag`。前端第一个下拉展示该 tag，默认选中，当前阶段只有一个可选值。

## Routing Rule

写入 3X-UI 的 rule 格式：

```json
{
  "inboundTag": [
    "in-21443-tcp",
    "in-28905-udp"
  ],
  "outboundTag": "local-ip-lax",
  "type": "field",
  "user": [
    "fuqiang_2015@163.com"
  ]
}
```

字段来源：

- `outboundTag`：当前用户已购买家宽 IP 套餐的 `plans.home_proxy_tag`。
- `user`：当前登录用户邮箱。
- `inboundTag`：同步时从目标服务器完整 Xray 配置中读取所有 `inbounds[*].tag`，过滤空值并去重。

如果目标服务器没有任何有效 inbound tag，本台服务器视为同步失败，并提示入站 tag 为空。

## Rule 匹配和幂等

识别当前用户家宽 rule 的条件：

- `type === 'field'`
- `outboundTag === 当前 home_proxy_tag`
- `user` 数组包含当前用户邮箱

删除旧服务器时，移除所有匹配 rule。

写入新服务器时，先移除所有匹配 rule，再追加一条规范 rule。这样可以清理重复 rule，并保证最终只有一条当前用户、当前家宽 tag 的 rule。

其它用户、其它 outboundTag、其它类型的 rule 必须原样保留。

## 同步流程

用户提交 `server_ids` 后：

1. 归一化服务器 ID，去重。
2. 校验数量为 1 到 2。
3. 校验用户家宽权益有效，得到 `home_proxy_tag`。
4. 校验目标服务器存在且在线。
5. 读取当前本地绑定记录。
6. 如果当前记录存在且 `last_synced_at` 距现在未满 30 分钟，拒绝修改并返回剩余秒数。
7. 计算涉及服务器集合：旧服务器和新服务器的并集。
8. 对涉及服务器并发执行完整 Xray 配置读取、rule 修改和回写，最大并发 10。
9. 旧服务器中不在新选择里的服务器执行删除匹配 rule。
10. 新选择中的服务器执行 upsert 规范 rule。
11. 远端全部成功后，在事务中 upsert `user_home_proxy_routes`，写入新的 `server_ids`、`home_proxy_tag`、`last_synced_at` 和成功状态。
12. 任一服务器失败时，不更新本地绑定和 `last_synced_at`，返回失败服务器名称与原因。

远端操作成功但本地保存失败时，返回服务器内部错误。该场景可能导致远端已经变更但本地仍是旧记录，用户再次提交时会以旧记录为准重新收敛。

## 失败与重试

失败响应需要包含：

- `failed_servers`：失败服务器列表，包含 `id`、`name`、`message`。
- `retryable: true`

删除旧服务器失败或写入新服务器失败都按整体失败处理：

- 不保存新的 `server_ids`。
- 不更新 `last_synced_at`。
- 不触发 30 分钟冷却。
- 用户可立即点击确定重试。

## 后端接口

新增用户端接口：

```text
GET /api/user/subscription/home-routing/options
PUT /api/user/subscription/home-routing
```

`GET` 返回：

```json
{
  "available": true,
  "home_proxy_tag": "local-ip-lax",
  "home_plan_name": "洛杉矶家宽 IP",
  "home_expire_at": 1788710400,
  "servers": [
    { "id": 1, "name": "日本01", "status": 1 },
    { "id": 2, "name": "香港03", "status": 1 }
  ],
  "route": {
    "home_proxy_tag": "local-ip-lax",
    "server_ids": [1, 2],
    "servers": [
      { "id": 1, "name": "日本01" },
      { "id": 2, "name": "香港03" }
    ],
    "last_synced_at": 1788706800
  },
  "cooldown_remaining_seconds": 0
}
```

无有效家宽权益时：

```json
{
  "available": false,
  "message": "购买家宽 IP 套餐后可配置"
}
```

`PUT` 请求：

```json
{
  "server_ids": [1, 2]
}
```

成功返回当前绑定；失败沿用 `legacyFail`，业务错误使用 400，冷却使用 429。

## 后端模块

新增：

- `server/repositories/user-home-routing-repository.js`
- `server/services/user/home-routing-service.js`

修改：

- `server/routes/user/subscription.js`
- `server/controllers/user/subscription-controller.js`
- `server/db/schema/tables.js`
- `server/db/schema/indexes.js`

`home-routing-service` 负责：

- 权益校验。
- 服务器列表和当前绑定聚合。
- Xray 配置解析。
- routing rule 删除和 upsert。
- 远端结果聚合。
- 成功后的本地持久化。

## 前端设计

修改用户端 `Profile.vue`：

- 在订阅链接结果区下面添加“家宽 IP 控制”区域。
- 有有效家宽权益时展示添加按钮和当前绑定列表。
- 当前绑定列表列为：`IP`、`服务器`、`服务器`、`操作`。
- 没有当前绑定时展示空状态和添加按钮。
- 点击添加或修改打开同一个弹窗。
- 弹窗字段：
  - 家宽 IP：当前购买的 tag，下拉展示，默认选中。
  - 服务器 1：必选。
  - 服务器 2：可选，不能与服务器 1 重复。
- 弹窗右下角按钮为取消和确定。
- 冷却期间禁用修改按钮，并显示剩余等待时间。
- 同步失败时展示失败服务器名称和失败原因，保留弹窗选择，允许立即重试。

新增 API 方法：

- `getHomeRoutingOptions()`
- `updateHomeRouting(serverIds)`

接口超时时间使用 120 秒，因为需要读写多台 3X-UI 服务器完整配置。

## 安全与日志

- 不输出 3X-UI API Token。
- 不输出完整 Xray 配置。
- 日志只记录用户邮箱、服务器 ID、服务器名称、home proxy tag 和错误摘要。
- 前端不允许提交任意 `outboundTag`，后端始终从当前用户权益重新计算。

## 验证要求

后端新增测试脚本 `server/test/test-user-home-routing-service.js`，至少覆盖：

1. 无家宽权益时不可配置。
2. 服务器数量不能超过两台。
3. 成功时从 Xray 配置 `inbounds[*].tag` 读取 inboundTag。
4. 新服务器写入规范 routing rule。
5. 修改时旧服务器 rule 被删除。
6. 删除旧服务器失败时不保存新绑定，不记录冷却。
7. 写入新服务器失败时不保存新绑定，不记录冷却。
8. 成功后 30 分钟内再次修改返回冷却错误。
9. 重复匹配 rule 会规整为一条。

运行：

```bash
node server/test/test-user-home-routing-service.js
```

前端运行：

```bash
cd client-user
npx vite build --minify esbuild
```

修改 `server/**/*.js` 后，完成时提醒用户重启后端服务。
