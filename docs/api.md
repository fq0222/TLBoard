# API 接口文档

> 更新日期：2026-06-15
> 依据：当前 `server/routes` 和前端 `src/api/index.js` 实际调用
> 用户端基础地址：`http://localhost:30000`
> 管理端基础地址：`http://localhost:30001`

## 1. 通用约定

### 1.1 返回格式

大多数 JSON 接口使用兼容旧版结构：

```json
{
  "code": 0,
  "message": "ok",
  "data": {}
}
```

失败示例：

```json
{
  "code": 1001,
  "message": "参数校验失败",
  "data": null
}
```

订阅文本和文件下载接口不返回 JSON。

### 1.2 认证

需要登录的接口使用：

```http
Authorization: Bearer <token>
```

| 端 | Token 来源 |
| --- | --- |
| 用户端 | `POST /api/user/login` |
| 管理端 | `POST /api/admin/login` |
| Telegram 内部接口 | `authenticateInternalTelegram` 中间件校验内部签名/密钥 |

### 1.3 常见错误码

| code | 说明 |
| --- | --- |
| `0` | 成功 |
| `1001` | 参数校验失败 |
| `1002` | 未登录、Token 无效或套餐售罄 |
| `1003` | Token 过期、续费条件不满足、跨套餐类型续费等 |
| `1004` | 无权限 |
| `2001` | 账号已存在或不允许重复注册 |
| `2002` | 邮箱或密码错误 |
| `2003` | 账号禁用或订阅不可用 |
| `2004` | 用户、订单、套餐或订阅不存在 |
| `2010` | 密码重置链接无效或过期 |
| `3001` | 生成订阅前未完成 IP 优选 |
| `4001` | 余额不足 |
| `4091` | 限时套餐续费需要确认重置权益 |
| `5002` | VMQ 创建订单失败 |
| `5003` | VMQ 通道要求手输金额，已拒绝下单 |
| `7001` | 下载链接无效或资源不存在 |
| `7002` | 资源已禁用 |
| `7003` | 下载链接已过期 |
| `7004` | 文件不存在 |
| `7005` | 暂无可用资源 |

## 2. 健康检查

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 用户端或管理端服务健康检查，返回端口和时间戳 |

## 3. 用户端 API

所有用户端业务接口默认前缀为 `/api/user`。

### 3.1 认证与资料

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| POST | `/register-and-pay` | 否 | 注册并创建新购订单 |
| POST | `/login` | 否 | 用户登录 |
| POST | `/forgot-password` | 否 | 申请密码重置邮件，响应不暴露邮箱是否存在 |
| POST | `/reset-password` | 否 | 使用一次性 token 重置密码 |
| GET | `/profile` | 是 | 获取当前用户资料、流量、状态、订阅状态 |
| POST | `/onboarding/complete` | 是 | 标记新手引导已完成 |
| GET | `/public-settings` | 否 | 获取公开设置，目前包含在线客服链接 |

`POST /register-and-pay` 请求体：

```json
{
  "email": "user@example.com",
  "password": "Abc12345",
  "plan_id": 1,
  "pay_type": 2,
  "referral_code": "optional"
}
```

说明：

- 密码至少 8 位且同时包含字母和数字。
- `pay_type` 默认使用后端 VMQ 配置，常见值为 `1` 微信、`2` 支付宝。
- `referral_code` 有效时只做首单归因，不影响正常下单。

`POST /login` 成功返回 `token`、`expires_in` 和用户摘要。

`GET /profile` 关键字段：

| 字段 | 说明 |
| --- | --- |
| `subscription_url` / `clash_url` | 完成 CF 优选后返回订阅地址 |
| `cf_optimized` | 是否已保存 CF 优选 IP |
| `subscription_ready` | 是否已优选且已有订阅缓存 |
| `plan_traffic_limit` | 套餐流量 |
| `referral_traffic_limit` | 当前服务层返回为 0，保留兼容字段 |
| `total_traffic_limit` / `traffic_limit` | 当前总流量口径 |
| `balance` / `balance_text` | 推广奖励或余额支付使用的账户余额 |
| `status` | `active`、`renew`、`disabled` |
| `disable_reason` | 管理员禁用、流量超限、到期等原因 |

### 3.2 套餐与公告

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| GET | `/plans` | 否 | 获取启用套餐列表 |
| GET | `/announcements` | 否 | 获取公告分页列表 |
| GET | `/announcements/popup/latest` | 是 | 获取当前用户需要弹出的最新公告 |
| POST | `/announcements/:id/popup-close` | 是 | 用户关闭公告弹窗后上报计数 |

`GET /plans` 返回字段包含：

- `plan_type`：`lifetime` 或 `timed`
- `show_on_home`
- `sales_limit`
- `sales_count`
- `is_soldout`

公告字段包含：

- `pinned`
- `enabled`
- `popup_show_limit`
- `node_show`

### 3.3 订单与支付

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| GET | `/orders` | 是 | 当前用户订单列表 |
| GET | `/orders/status/:id` | 可选 | 公共查单；商户订单号可未登录查询，纯数字订单 ID 需要登录 |
| GET | `/orders/:id/status` | 是 | 登录态查单 |
| GET | `/payment/notify` | 否 | VMQ 异步通知 |
| POST | `/payment/notify` | 否 | VMQ 表单异步通知 |
| GET | `/payment/return` | 否 | VMQ 同步回跳并重定向用户前端 |

VMQ 通知常见参数：

| 参数 | 说明 |
| --- | --- |
| `payId` | 商户订单号，对应 `orders.out_trade_no` |
| `orderId` | VMQ 订单号 |
| `param` | 透传参数 |
| `type` | 支付方式 |
| `price` | 订单金额 |
| `reallyPrice` | 实付金额 |
| `sign` | 签名 |

回调处理会校验签名和金额。少付会返回 `error_amount`，验签失败返回 `error_sign`，成功返回 `success`。

### 3.4 续费

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| GET | `/renew/plans` | 是 | 获取与当前套餐类型一致的可续费套餐 |
| POST | `/renew` | 是 | 创建续费订单 |

`POST /renew` 请求体：

```json
{
  "plan_id": 1,
  "pay_type": 2,
  "confirm_reset": false
}
```

说明：

- `pay_type=9` 表示余额支付。
- 限时套餐续费如果仍有剩余流量和时间，会返回 HTTP `409`、业务码 `4091` 和重置预览，前端确认后带 `confirm_reset=true` 再次请求。
- 不能跨 `lifetime` / `timed` 套餐类型续费。

### 3.5 订阅

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| POST | `/subscription/generate` | 是 | 生成或刷新订阅缓存，可能触发 3X-UI 同步和原始订阅拉取 |
| GET | `/subscription` | 是 | 获取订阅信息和节点展示列表 |
| GET | `/subscription/sub/:token` | 否 | 获取订阅文本 |

当前实际订阅地址：

```text
/api/user/subscription/sub/:subId
/api/user/subscription/sub/:subId?clash=1
/api/user/subscription/sub/:subId?v2ray=1
```

注意：当前代码未注册 `/api/user/sub/:token`。

`POST /subscription/generate` 成功返回：

```json
{
  "subscription_url": "https://example.com/api/user/subscription/sub/abcdef1234567890",
  "clash_url": "https://example.com/api/user/subscription/sub/abcdef1234567890?clash=1",
  "v2ray_url": "https://example.com/api/user/subscription/sub/abcdef1234567890?v2ray=1"
}
```

订阅文本说明：

- 默认和 `v2ray=1` 返回 Base64 编码节点列表。
- `clash=1` 返回 `text/yaml`。
- 响应会带 `Subscription-Userinfo`；Clash 响应额外带 `Content-Disposition` 和 `Profile-Update-Interval`。

### 3.6 Cloudflare 优选

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| GET | `/cf-ips` | 是 | 获取可用 CF IP 池和当前用户选择 |
| POST | `/cf-ips/apply` | 是 | 按 IP 池 ID 应用优选 IP |
| POST | `/cf-ips/apply-by-ip` | 是 | 按 IP 字符串应用优选 IP |

`POST /cf-ips/apply` 请求体：

```json
{
  "ip_ids": [1, 2, 3]
}
```

当前后端没有 `/api/user/cf-ips/test` 接口；前端如果做延迟测试，应视为浏览器本地能力。

### 3.7 工单

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| GET | `/tickets/unread-count` | 是 | 当前用户未读工单数量 |
| GET | `/tickets` | 是 | 工单列表 |
| POST | `/tickets` | 是 | 创建工单 |
| GET | `/tickets/:id` | 是 | 工单详情 |
| POST | `/tickets/:id/replies` | 是 | 回复工单 |
| PUT | `/tickets/:id/close` | 是 | 关闭工单 |

工单状态：`open`、`pending`、`closed`。

### 3.8 邮件

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| POST | `/email/tutorial` | 是 | 发送教程邮件，body.type 必填 |
| POST | `/email/:action` | 是 | 发送预设动作邮件，body.variables 可选 |

### 3.9 帮助中心与下载

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| GET | `/help/images/:filename` | 否 | 获取帮助文章图片 |
| GET | `/help/articles` | 是 | 获取帮助文章列表 |
| GET | `/help/categories` | 是 | 获取帮助分类 |
| GET | `/help/articles/:id` | 是 | 获取帮助文章详情 |
| GET | `/download/resources` | 是 | 获取用户端下载栏资源 |
| POST | `/download/link/:resourceId` | 是 | 获取或创建当前用户下载链接 |
| GET | `/download/:token` | 否 | 下载文件 |

`POST /download/link/:resourceId` 会复用、创建或重置同一用户的唯一分发记录。

### 3.10 推广

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| GET | `/referral` | 是 | 当前用户推广汇总 |
| POST | `/referral/click` | 否 | 记录推广码点击 |
| GET | `/referral/rewards` | 是 | 当前用户推广奖励明细 |

推广汇总返回的是余额奖励字段：

- `reward_amount`
- `reward_amount_text`
- `balance` 字段可在用户资料中查看

当前不是推广流量奖励。

### 3.11 同步状态

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| GET | `/sync-status` | 是 | 查询当前用户 3X-UI 同步等待状态 |

## 4. 管理端 API

所有管理端接口前缀为 `/api/admin`，除登录外均需要管理员 JWT。

### 4.1 认证与管理员

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/login` | 管理员登录 |
| PUT | `/password` | 修改当前管理员密码 |
| GET | `/admins` | 管理员列表，仅超级管理员 |
| POST | `/admins` | 新增管理员，仅超级管理员 |
| DELETE | `/admins/:id` | 删除管理员，仅超级管理员 |

### 4.2 仪表盘

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/dashboard/stats` | 获取用户、套餐、订单、服务器、邮件配额等统计 |

### 4.3 3X-UI 服务器

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/servers` | 服务器列表 |
| POST | `/servers/backup/run` | 手动启动 3X-UI 数据库备份任务 |
| POST | `/servers` | 新增服务器 |
| PUT | `/servers/:id` | 编辑服务器 |
| DELETE | `/servers/:id` | 删除服务器 |
| GET | `/servers/:id/detail` | 服务器详情 |
| POST | `/servers/:id/sync` | 同步服务器节点和用户信息 |
| PUT | `/servers/:id/users` | 更新指定 inbound 中的 3X-UI 用户 |
| DELETE | `/servers/:id/users` | 删除指定 inbound 中的 3X-UI 用户 |

新增服务器必填：

```json
{
  "name": "server-1",
  "api_url": "https://panel.example.com",
  "api_token": "token",
  "panel_version": "3.2.5"
}
```

`host`、`client_port`、`sub_url` 等字段由服务层/仓储支持，前端表单可按页面实现提交。

### 4.4 套餐

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/plans` | 套餐列表 |
| POST | `/plans` | 创建套餐 |
| PUT | `/plans/:id` | 更新套餐 |
| DELETE | `/plans/:id` | 删除套餐 |

套餐请求字段：

| 字段 | 说明 |
| --- | --- |
| `name` | 套餐名称 |
| `description` | 描述 |
| `price` | 价格，单位分 |
| `duration_days` | 有效天数 |
| `traffic_limit` | 字节 |
| `plan_type` | `lifetime` 或 `timed` |
| `show_on_home` | 是否在用户首页展示 |
| `sort_order` | 排序权重 |
| `enabled` | 是否启用 |
| `sales_limit` | 可销售总量，`-1` 不限制 |

### 4.5 用户

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/users` | 用户列表，支持分页、关键词、状态、套餐筛选 |
| POST | `/users/batch-generate-subscriptions` | 启动批量生成订阅链接任务 |
| GET | `/users/batch-generate-subscriptions/status` | 查询最近一次批量任务状态 |
| GET | `/users/:id` | 用户详情 |
| PUT | `/users/:id` | 更新用户基础信息并同步 3X-UI |
| PUT | `/users/:id/cf-ips` | 更新用户 CF IP，最多 5 个 |
| POST | `/users/:id/generate-subscription` | 管理员为用户生成订阅链接 |

用户更新可传：

- `enabled`
- `plan_id`
- `traffic_limit`
- `expire_at`

建议前端对涉及多台 3X-UI 同步的请求设置更长超时。

### 4.6 订单

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/orders` | 订单列表，支持状态、邮箱、时间等筛选 |

### 4.7 公告

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/announcements` | 公告分页列表 |
| POST | `/announcements` | 创建公告 |
| PUT | `/announcements/:id` | 更新公告 |
| DELETE | `/announcements/:id` | 删除公告 |

公告请求字段：

- `title`
- `content`
- `pinned`
- `enabled`
- `popup_show_limit`
- `node_show`

`popup_show_limit=0` 表示不弹窗。`node_show=true` 表示订阅输出中加入虚拟公告节点。

### 4.8 CF IP 池

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/cf-ips` | IP 池列表 |
| POST | `/cf-ips` | 新增 IP |
| PUT | `/cf-ips/:id` | 编辑 IP |
| DELETE | `/cf-ips/:id` | 删除 IP |
| POST | `/cf-ips/import` | 批量导入 |

### 4.9 工单

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/tickets/stats` | 工单统计 |
| GET | `/tickets` | 工单列表 |
| GET | `/tickets/:id` | 工单详情 |
| POST | `/tickets/:id/replies` | 管理员回复 |
| PUT | `/tickets/:id/close` | 关闭工单 |
| DELETE | `/tickets/:id` | 删除工单 |

### 4.10 博客/帮助文章

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/blogs` | 文章列表 |
| GET | `/blogs/categories` | 分类列表 |
| POST | `/blogs` | 创建文章 |
| POST | `/blogs/upload-image` | 上传文章图片 |
| GET | `/blogs/:id` | 文章详情 |
| PUT | `/blogs/:id` | 更新文章 |
| DELETE | `/blogs/:id` | 删除文章并清理关联上传资源 |

文章状态：`draft`、`published`。用户端帮助中心读取已发布内容。

### 4.11 邮件

邮件配置同时存在两组入口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/email/config` | 获取 Brevo 配置 |
| PUT | `/email/config` | 保存 Brevo 配置 |
| GET | `/system-settings/email` | 获取邮件系统设置 |
| PUT | `/system-settings/email` | 保存邮件系统设置 |

其他邮件接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/email/test` | 发送测试邮件 |
| GET | `/email/templates` | 模板列表 |
| POST | `/email/templates` | 创建模板 |
| PUT | `/email/templates/:id` | 更新模板 |
| DELETE | `/email/templates/:id` | 删除模板 |
| GET | `/email/templates/:id/preview` | 预览模板，可带 `user_id` |
| POST | `/email/send` | 单发邮件 |
| GET | `/email/campaigns` | 群发任务列表 |
| POST | `/email/campaigns` | 创建群发任务 |
| GET | `/email/campaigns/:id` | 群发任务详情 |
| POST | `/email/campaigns/:id/pause` | 暂停任务 |
| POST | `/email/campaigns/:id/resume` | 恢复任务 |
| DELETE | `/email/campaigns/:id` | 删除任务 |
| GET | `/email/campaigns/:id/logs` | 指定任务日志 |
| GET | `/email/logs` | 邮件日志 |
| DELETE | `/email/logs/clear` | 清理过期日志 |
| DELETE | `/email/logs/batch` | 批量删除日志 |
| DELETE | `/email/logs/:id` | 删除单条日志 |
| GET | `/email/users/search` | 搜索用户 |

### 4.12 资源

资源配置同样存在两组入口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/resources/config` | 获取资源配置 |
| PUT | `/resources/config` | 保存资源配置 |
| GET | `/system-settings/resource` | 获取资源系统设置 |
| PUT | `/system-settings/resource` | 保存资源系统设置 |

资源管理接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/resources` | 资源列表 |
| POST | `/resources/upload` | 上传资源文件 |
| PUT | `/resources/:id` | 更新名称、启用、下载栏展示、分类等 |
| DELETE | `/resources/:id` | 删除资源和文件 |
| POST | `/resources/:id/refresh-token` | 刷新资源全局下载 token |
| PUT | `/resources/:id/expire` | 设置或取消资源过期时间 |
| POST | `/resources/:id/distribute` | 分发资源给用户 |
| GET | `/resources/:id/distributions` | 获取资源分发列表 |
| PUT | `/resources/distributions/batch-expire` | 批量设置分发过期时间 |
| DELETE | `/resources/distributions/:id` | 删除分发记录 |

### 4.13 系统设置

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/system-settings/traffic` | 获取流量统计倍率和推广奖励系数 |
| PUT | `/system-settings/traffic` | 保存流量统计倍率和推广奖励系数 |
| GET | `/system-settings/email` | 获取邮件配置 |
| PUT | `/system-settings/email` | 保存邮件配置 |
| GET | `/system-settings/resource` | 获取资源配置 |
| PUT | `/system-settings/resource` | 保存资源配置 |
| GET | `/system-settings/subscription` | 获取订阅配置、Telegram 频道、在线客服链接 |
| PUT | `/system-settings/subscription` | 保存订阅配置、Telegram 频道、在线客服链接 |

`PUT /system-settings/traffic` 请求体：

```json
{
  "traffic_usage_multiplier": 1,
  "referral_reward_coefficient": 0.1
}
```

`referral_reward_coefficient` 范围为 `0` 到 `1`，表示首单奖励占订单金额比例。

`PUT /system-settings/subscription` 请求体：

```json
{
  "clash_config_name": "天涯大陆",
  "clash_profile_update_interval": 2,
  "telegram_channel_url": "https://t.me/example",
  "online_customer_service_url": "https://example.com/support"
}
```

### 4.14 推广管理

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/referrals` | 推广用户分页列表 |
| GET | `/referrals/:userId` | 指定用户推广汇总和奖励明细 |
| PUT | `/referrals/:userId/enabled` | 启用或禁用推广码 |
| POST | `/referrals/:userId/reset-code` | 重置推广码 |

筛选参数包括 `page`、`limit`、`email`、`code`、`enabled`。

### 4.15 Telegram 管理端

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/telegram/config` | 获取 Telegram 内部接口配置概览 |
| POST | `/telegram/admin-bind-codes` | 生成管理员绑定码 |
| GET | `/telegram/admin-bindings` | 获取已绑定管理员列表 |

## 5. Telegram 内部 API

这些接口挂载在管理端服务，前缀为 `/api/internal/telegram`，需要内部鉴权。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 内部服务健康检查 |
| POST | `/admin/bind/verify` | 校验管理员绑定码并绑定 chat |
| GET | `/admin/by-chat/:chatId` | 根据 chat_id 查询管理员 |
| GET | `/servers/health` | 查询服务器健康汇总，需要 `chat_id` |
| GET | `/servers/health/:serverId` | 查询单台服务器健康详情，需要 `chat_id` |
| GET | `/alerts` | 查询告警列表，需要 `chat_id` |
| GET | `/alerts/pending` | 查询待发送告警 |
| POST | `/alerts/:alertId/sent` | 标记告警发送结果 |
| GET | `/admin/users/lookup` | 按邮箱或用户 ID 查询用户，需要 `chat_id` |

## 6. WebSocket

管理端 HTTP 服务上注册了两个长任务进度 WebSocket：

- 批量生成订阅链接进度：`server/websocket/admin-batch-subscription-ws.js`
- 3X-UI 数据库备份进度：`server/websocket/admin-xui-backup-ws.js`

具体路径以对应模块实现为准，普通 HTTP API 不承载长任务实时进度。

## 7. 3X-UI 外部调用

系统通过 `server/integrations/xui` 调用 3X-UI 面板，当前以 API Token 为主：

```http
Authorization: Bearer <api_token>
X-Requested-With: XMLHttpRequest
```

内部主要使用：

| 3X-UI 路径 | 说明 |
| --- | --- |
| `/panel/api/inbounds/list` | 获取 inbound 列表 |
| `/panel/api/inbounds/get/:id` | 获取 inbound 详情 |
| `/panel/api/inbounds/addClient` | 添加客户端 |
| `/panel/api/inbounds/updateClient/:clientId` | 更新客户端 |
| `/panel/api/inbounds/:inboundId/delClient/:clientId` | 删除客户端 |
| `/panel/api/inbounds/:inboundId/resetClientTraffic/:email` | 重置客户端流量 |
| `/panel/api/server/getDb` | 下载 `x-ui.db` 数据库备份 |

不同 3X-UI 版本通过 `xui-api-client-v302.js`、`xui-api-client-v325.js` 等适配。

## 8. 请求体与响应体详表

本节按当前路由和前端调用补齐请求体、查询参数和响应 `data` 结构。表中 `无` 表示请求不需要 JSON body；所有 JSON 响应仍包裹在 `{ code, message, data }` 中。

### 8.1 用户端认证、资料和设置

| 方法 | 路径 | 请求体 / 查询参数 | 响应 `data` |
| --- | --- | --- | --- |
| POST | `/api/user/register-and-pay` | body: `email`, `password`, `plan_id`, `pay_type?`, `referral_code?` | `order_id`, `user_id`, `out_trade_no`, `vmq_order_id`, `pay_type`, `really_price`, `payment_url`, `expire_in` |
| POST | `/api/user/login` | body: `email`, `password` | `token`, `expires_in`, `user: { id, email, plan_name, expire_at, enabled }` |
| POST | `/api/user/forgot-password` | body: `email` | `{ message }`，固定模糊提示，不暴露邮箱是否存在 |
| POST | `/api/user/reset-password` | body: `token`, `password` | `{ reset: true }` |
| GET | `/api/user/profile` | 无 | `id`, `email`, `plan_id`, `plan_name`, `subscription_url`, `clash_url`, `cf_optimized`, `subscription_ready`, `telegram_channel_url`, `traffic_used`, `plan_traffic_limit`, `referral_traffic_limit`, `total_traffic_limit`, `traffic_limit`, `traffic_percent`, `balance`, `expire_at`, `enabled`, `disable_reason`, `status`, `payment_count`, `sync_status`, `onboarding_completed` |
| POST | `/api/user/onboarding/complete` | 无 | `{ onboarding_completed: true }` |
| GET | `/api/user/public-settings` | 无 | `{ online_customer_service_url }` |

注册并支付响应示例：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "order_id": 10001,
    "user_id": 88,
    "out_trade_no": "ORD1780000000000abc123",
    "vmq_order_id": "202606150001",
    "pay_type": 2,
    "really_price": "19.90",
    "payment_url": "https://pay.example.com/pay/xxx",
    "expire_in": 300
  }
}
```

资料响应示例：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": 1,
    "email": "user@example.com",
    "plan_id": 1,
    "plan_name": "基础套餐",
    "subscription_url": "https://example.com/api/user/subscription/sub/abcdef1234567890",
    "clash_url": "https://example.com/api/user/subscription/sub/abcdef1234567890?clash=1",
    "cf_optimized": true,
    "subscription_ready": true,
    "traffic_used": 1073741824,
    "plan_traffic_limit": 107374182400,
    "referral_traffic_limit": 0,
    "total_traffic_limit": 107374182400,
    "traffic_limit": 107374182400,
    "traffic_percent": 1,
    "balance": 120,
    "balance_text": "1.20 元",
    "expire_at": 0,
    "expire_text": "无限期",
    "enabled": 1,
    "status": "active",
    "status_text": "正常",
    "sync_status": 2,
    "onboarding_completed": true
  }
}
```

### 8.2 用户端套餐、公告、订单和续费

| 方法 | 路径 | 请求体 / 查询参数 | 响应 `data` |
| --- | --- | --- | --- |
| GET | `/api/user/plans` | 无 | 套餐数组；每项含 `id`, `name`, `description`, `price`, `price_text`, `duration_days`, `traffic_limit`, `traffic_text`, `plan_type`, `show_on_home`, `sort_order`, `sales_limit`, `sales_count`, `is_soldout` |
| GET | `/api/user/announcements` | query: `page?`, `limit?` | `{ total, page, limit, list }`，公告含 `id`, `title`, `content`, `pinned`, `enabled`, `popup_show_limit`, `node_show`, `created_at` |
| GET | `/api/user/announcements/popup/latest` | 无 | `{ announcement, shown_count, should_popup }` |
| POST | `/api/user/announcements/:id/popup-close` | 无 | `{ message }` |
| GET | `/api/user/orders` | query: `page?`, `limit?`, `status?` | `{ total, page, limit, list }`，订单含 `id`, `out_trade_no`, `trade_no`, `status`, `amount`, `payment_url`, `paid_at`, `created_at` 等 |
| GET | `/api/user/orders/status/:id` | path: 本地订单 ID 或 `out_trade_no` | `order_id`, `out_trade_no`, `vmq_order_id`, `status`, `payment_url`, `paid_at?` |
| GET | `/api/user/orders/:id/status` | path: 本地订单 ID 或 `out_trade_no` | 同公共查单 |
| GET | `/api/user/renew/plans` | 无 | `{ plans: [...] }`，套餐结构同 `/plans` |
| POST | `/api/user/renew` | body: `plan_id`, `pay_type?`, `confirm_reset?` | VMQ: `order_id`, `out_trade_no`, `vmq_order_id`, `pay_type`, `really_price`, `payment_url`, `expire_in`；余额支付: `order_id`, `out_trade_no`, `pay_type: 9`, `payment_method: "balance"`, `paid: true`, `really_price`, `payment_url: ""`, `expire_in: 0` |

限时套餐续费需要确认时返回：

```json
{
  "code": 4091,
  "message": "续费会重置当前剩余流量和时间，请确认后再续费",
  "data": {
    "plan_type": "timed",
    "requires_confirm": true,
    "remaining_traffic": 10737418240,
    "remaining_traffic_text": "10 GB",
    "remaining_seconds": 86400,
    "reset_traffic_limit": 53687091200,
    "reset_traffic_limit_text": "50 GB",
    "reset_expire_at": 1780000000
  }
}
```

### 8.3 用户端订阅、CF、工单、邮件、帮助、下载、推广

| 方法 | 路径 | 请求体 / 查询参数 | 响应 `data` |
| --- | --- | --- | --- |
| POST | `/api/user/subscription/generate` | 无 | `subscription_url`, `clash_url`, `v2ray_url` |
| GET | `/api/user/subscription` | 无 | `subscription_url`, `clash_url`, `v2ray_url`, `cf_optimized`, `expire_at`, `traffic_used`, `plan_traffic_limit`, `total_traffic_limit`, `traffic_percent`, `nodes` |
| GET | `/api/user/subscription/sub/:token` | query: `clash?`, `v2ray?` | 非 JSON；默认 Base64 文本，`clash=1` 返回 YAML |
| GET | `/api/user/cf-ips` | 无 | `{ pool, selected }` 或等价列表结构，包含可选 IP 池和当前用户选择 |
| POST | `/api/user/cf-ips/apply` | body: `ip_ids: number[]` | `applied_count`, `subscription_url?`, `nodes?`, `message` |
| POST | `/api/user/cf-ips/apply-by-ip` | body: `ips: string[]` | `applied_count`, `message` |
| GET | `/api/user/tickets/unread-count` | 无 | `{ count }` |
| GET | `/api/user/tickets` | query: `page?`, `limit?`, `status?` | `{ total, page, limit, list }` |
| POST | `/api/user/tickets` | body: `title`, `description` | 新建工单对象 |
| GET | `/api/user/tickets/:id` | path: `id` | 工单详情，包含 replies 和 read 状态 |
| POST | `/api/user/tickets/:id/replies` | body: `content` | 新回复对象 |
| PUT | `/api/user/tickets/:id/close` | 无 | `{ message }` 或关闭后的工单状态 |
| POST | `/api/user/email/tutorial` | body: `type` | `null`，message 为“教程邮件已发送，请到邮箱查看” |
| POST | `/api/user/email/:action` | body: `variables?` | `null`，message 为“邮件已发送” |
| GET | `/api/user/help/images/:filename` | path: `filename` | 图片文件流 |
| GET | `/api/user/help/articles` | query: `page?`, `limit?`, `category?`, `keyword?` | `{ total, page, limit, list }` |
| GET | `/api/user/help/categories` | 无 | 分类字符串数组 |
| GET | `/api/user/help/articles/:id` | path: `id` | 文章详情：`id`, `title`, `summary`, `category`, `content`, `created_at`, `updated_at` |
| GET | `/api/user/download/resources` | 无 | 下载资源数组；每项含 `id`, `name`, `category`, `size` 等 |
| POST | `/api/user/download/link/:resourceId` | path: `resourceId` | `download_url`, `resource_name`, `expire_at`, `action`, `removed_duplicates` |
| GET | `/api/user/download/:token` | path: 32 位 token | 文件流 |
| GET | `/api/user/referral` | 无 | `code`, `enabled`, `referral_url`, `click_count`, `reward_count`, `reward_amount`, `reward_amount_text` |
| POST | `/api/user/referral/click` | body/query: `code` | `{ recorded: true/false }` |
| GET | `/api/user/referral/rewards` | query: `page?`, `limit?` | `{ total, page, limit, list }`，奖励含 `referred_email`, `out_trade_no`, `amount`, `reward_amount`, `created_at` |
| GET | `/api/user/sync-status` | 无 | 用户同步状态摘要，包含当前 `sync_status` |

订阅信息响应示例：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "subscription_url": "https://example.com/api/user/subscription/sub/abcdef1234567890",
    "clash_url": "https://example.com/api/user/subscription/sub/abcdef1234567890?clash=1",
    "v2ray_url": "https://example.com/api/user/subscription/sub/abcdef1234567890?v2ray=1",
    "cf_optimized": true,
    "traffic_used": 1073741824,
    "total_traffic_limit": 107374182400,
    "traffic_percent": 1,
    "nodes": [
      {
        "server_name": "server-1",
        "node_name": "server-1-cf-1",
        "protocol": "vless+ws+tls",
        "strategy": "cf",
        "address": "104.16.1.1",
        "port": 443,
        "host": "node.example.com",
        "remark": "cf-1"
      }
    ]
  }
}
```

### 8.4 管理端认证、仪表盘、服务器、套餐和用户

| 方法 | 路径 | 请求体 / 查询参数 | 响应 `data` |
| --- | --- | --- | --- |
| POST | `/api/admin/login` | body: `username`, `password` | `token`, `expires_in`, `admin` |
| PUT | `/api/admin/password` | body: `old_password`, `new_password` | `null` 或 `{ message }` |
| GET | `/api/admin/admins` | 无 | 管理员数组 |
| POST | `/api/admin/admins` | body: `username`, `password`, `is_super?` | 新管理员对象 |
| DELETE | `/api/admin/admins/:id` | path: `id` | `null` 或 `{ message }` |
| GET | `/api/admin/dashboard/stats` | 无 | `userCount`, `planCount`, `orderCount`, `serverCount`, `emailTodayCount`, `emailDailyLimit`, `campaignDailyLimit` |
| GET | `/api/admin/servers` | 无 | 服务器数组；含 `id`, `name`, `api_url`, `has_api_token`, `host`, `client_port`, `sub_url`, `status`, `panel_version` |
| POST | `/api/admin/servers/backup/run` | 无 | 备份任务状态 |
| POST | `/api/admin/servers` | body: `name`, `api_url`, `api_token`, `panel_version?`, `host?`, `client_port?`, `sub_url?` | 新服务器对象 |
| PUT | `/api/admin/servers/:id` | body: `name?`, `api_url?`, `api_token?`, `panel_version?`, `host?`, `client_port?`, `sub_url?` | 更新后的服务器对象 |
| DELETE | `/api/admin/servers/:id` | path: `id` | `null` 或 `{ message }` |
| GET | `/api/admin/servers/:id/detail` | path: `id` | 服务器详情、inbound、客户端和节点快照 |
| POST | `/api/admin/servers/:id/sync` | path: `id` | 同步结果：`success`, `nodeCount`, `message` 等 |
| PUT | `/api/admin/servers/:id/users` | body: `inboundId`, `email`, `expiryTime?`, `totalGB?`, `enabled?` | 3X-UI 用户更新结果 |
| DELETE | `/api/admin/servers/:id/users` | body: `inboundId`, `email` | 3X-UI 用户删除结果 |
| GET | `/api/admin/plans` | 无 | `{ list }`，套餐含展示字段和销售字段 |
| POST | `/api/admin/plans` | body: `name`, `price`, `duration_days`, `traffic_limit`, `description?`, `plan_type?`, `show_on_home?`, `sort_order?`, `enabled?`, `sales_limit?` | 新套餐对象 |
| PUT | `/api/admin/plans/:id` | body: 上述任意可编辑字段 | 更新后的套餐对象 |
| DELETE | `/api/admin/plans/:id` | path: `id` | `{ message: "套餐已删除" }` |
| GET | `/api/admin/users` | query: `page?`, `limit?`, `keyword?`, `status?`, `plan_id?` | `{ total, page, limit, list }` |
| POST | `/api/admin/users/batch-generate-subscriptions` | body: `cf_optimized_only?` | 批量任务对象：`task_id`, `status`, `total_count` 等 |
| GET | `/api/admin/users/batch-generate-subscriptions/status` | 无 | 最近一次批量任务状态和进度 |
| GET | `/api/admin/users/:id` | path: `id` | 用户详情、CF IP、订阅状态、订单摘要等 |
| PUT | `/api/admin/users/:id` | body: `enabled?`, `plan_id?`, `traffic_limit?`, `expire_at?` | 更新后的用户对象或同步结果 |
| PUT | `/api/admin/users/:id/cf-ips` | body: `ip_pool_ids: number[]` | 用户 CF IP 更新结果 |
| POST | `/api/admin/users/:id/generate-subscription` | path: `id` | `subscription_url`, `clash_url`, `v2ray_url` |

管理端创建套餐请求示例：

```json
{
  "name": "基础套餐",
  "description": "100GB 不限时",
  "price": 1990,
  "duration_days": 0,
  "traffic_limit": 107374182400,
  "plan_type": "lifetime",
  "show_on_home": true,
  "sort_order": 0,
  "enabled": true,
  "sales_limit": -1
}
```

### 8.5 管理端订单、公告、CF、工单、博客

| 方法 | 路径 | 请求体 / 查询参数 | 响应 `data` |
| --- | --- | --- | --- |
| GET | `/api/admin/orders` | query: `page?`, `limit?`, `status?`, `keyword?`, `start_time?`, `end_time?` | `{ total, page, limit, list }` |
| GET | `/api/admin/announcements` | query: `page?`, `limit?` | `{ total, page, limit, list }` |
| POST | `/api/admin/announcements` | body: `title`, `content?`, `pinned?`, `enabled?`, `popup_show_limit?`, `node_show?` | 新公告对象 |
| PUT | `/api/admin/announcements/:id` | body: 上述任意可编辑字段 | 更新后的公告对象 |
| DELETE | `/api/admin/announcements/:id` | path: `id` | `null` 或 `{ message }` |
| GET | `/api/admin/cf-ips` | query: `page?`, `limit?`, `keyword?` | CF IP 池列表 |
| POST | `/api/admin/cf-ips` | body: `ip`, `enabled?` | 新 IP 记录 |
| PUT | `/api/admin/cf-ips/:id` | body: `ip?`, `enabled?` | 更新后的 IP 记录 |
| DELETE | `/api/admin/cf-ips/:id` | path: `id` | `null` 或 `{ message }` |
| POST | `/api/admin/cf-ips/import` | body: `ips` 或 `text`，按路由/页面提交批量 IP | 导入统计：成功数、失败数等 |
| GET | `/api/admin/tickets/stats` | 无 | `open_count`, `pending_count`, `today_count` 等 |
| GET | `/api/admin/tickets` | query: `page?`, `limit?`, `status?`, `keyword?` | `{ total, page, limit, list }` |
| GET | `/api/admin/tickets/:id` | path: `id` | 工单详情和回复 |
| POST | `/api/admin/tickets/:id/replies` | body: `content` | 新回复对象 |
| PUT | `/api/admin/tickets/:id/close` | 无 | 关闭结果 |
| DELETE | `/api/admin/tickets/:id` | path: `id` | 删除结果 |
| GET | `/api/admin/blogs` | query: `page?`, `limit?`, `status?`, `category?`, `keyword?` | `{ total, page, limit, list }` |
| GET | `/api/admin/blogs/categories` | 无 | 分类数组 |
| POST | `/api/admin/blogs` | body: `title`, `summary`, `category?`, `content`, `status?` | 新文章对象 |
| POST | `/api/admin/blogs/upload-image` | multipart: 图片文件 | `{ url, filename }` |
| GET | `/api/admin/blogs/:id` | path: `id` | 文章详情 |
| PUT | `/api/admin/blogs/:id` | body: `title`, `summary`, `category?`, `content`, `status?` | 更新后的文章对象 |
| DELETE | `/api/admin/blogs/:id` | path: `id` | 删除结果 |

### 8.6 管理端邮件、资源、系统设置、推广和 Telegram

| 方法 | 路径 | 请求体 / 查询参数 | 响应 `data` |
| --- | --- | --- | --- |
| GET | `/api/admin/email/config` | 无 | `api_key`, `sender_email`, `sender_name`, `daily_limit`, `campaign_daily_limit` |
| PUT | `/api/admin/email/config` | body: 上述配置字段 | 保存后的配置 |
| POST | `/api/admin/email/test` | body: `email` | `null`，message 表示发送结果 |
| GET | `/api/admin/email/templates` | 无 | 模板数组 |
| POST | `/api/admin/email/templates` | body: `name`, `subject`, `content`, `variables?` | 新模板 |
| PUT | `/api/admin/email/templates/:id` | body: `name`, `subject`, `content`, `variables?` | 更新后的模板 |
| DELETE | `/api/admin/email/templates/:id` | path: `id` | 删除结果 |
| GET | `/api/admin/email/templates/:id/preview` | query: `user_id?` | `subject`, `content`, `variables` 的渲染结果 |
| POST | `/api/admin/email/send` | body: `to`, `subject`, `content`, `user_id?` | `null`，message 表示发送结果 |
| GET | `/api/admin/email/campaigns` | 无 | 群发任务数组 |
| POST | `/api/admin/email/campaigns` | body: `name`, `template_id`, `target_type`, `target_users?`, `subject?`, `content?` | 新群发任务 |
| GET | `/api/admin/email/campaigns/:id` | path: `id` | 群发任务详情 |
| POST | `/api/admin/email/campaigns/:id/pause` | 无 | 暂停结果 |
| POST | `/api/admin/email/campaigns/:id/resume` | 无 | 恢复结果 |
| DELETE | `/api/admin/email/campaigns/:id` | path: `id` | 删除结果 |
| GET | `/api/admin/email/campaigns/:id/logs` | query: `page?`, `limit?` | `{ total, page, limit, list }` |
| GET | `/api/admin/email/logs` | query: `page?`, `limit?` | `{ total, page, limit, list }` |
| DELETE | `/api/admin/email/logs/clear` | body: `before_days?` | 清理结果 |
| DELETE | `/api/admin/email/logs/batch` | body: `ids: number[]` | 批量删除结果 |
| DELETE | `/api/admin/email/logs/:id` | path: `id` | 删除结果 |
| GET | `/api/admin/email/users/search` | query: `keyword?` | 用户搜索数组 |
| GET | `/api/admin/resources/config` | 无 | `max_file_size`, `download_speed_limit` |
| PUT | `/api/admin/resources/config` | body: `max_file_size`, `download_speed_limit` | 保存后的配置 |
| GET | `/api/admin/resources` | query: `page?`, `limit?` | `{ total, page, limit, list }` |
| POST | `/api/admin/resources/upload` | multipart: 最多 5 个文件 | 上传后的资源对象数组 |
| PUT | `/api/admin/resources/:id` | body: `name?`, `enabled?`, `is_download_resource?`, `download_category?` | 更新后的资源 |
| DELETE | `/api/admin/resources/:id` | path: `id` | 删除结果 |
| POST | `/api/admin/resources/:id/refresh-token` | 无 | `id`, `download_token` |
| PUT | `/api/admin/resources/:id/expire` | body: `expire_at`，可为 `null` | 更新后的资源过期时间 |
| POST | `/api/admin/resources/:id/distribute` | body: `user_ids: number[]`, `expire_minutes?` | `resource_id`, `distributions` |
| GET | `/api/admin/resources/:id/distributions` | path: `id` | 分发记录数组 |
| PUT | `/api/admin/resources/distributions/batch-expire` | body: `ids: number[]`, `expire_minutes` | 批量更新结果 |
| DELETE | `/api/admin/resources/distributions/:id` | path: `id` | 删除结果 |
| GET | `/api/admin/system-settings/traffic` | 无 | `traffic_usage_multiplier`, `referral_reward_coefficient` |
| PUT | `/api/admin/system-settings/traffic` | body: `traffic_usage_multiplier`, `referral_reward_coefficient` | 保存后的配置 |
| GET | `/api/admin/system-settings/email` | 无 | 邮件配置 |
| PUT | `/api/admin/system-settings/email` | body: 邮件配置字段 | 保存后的配置 |
| GET | `/api/admin/system-settings/resource` | 无 | 资源配置 |
| PUT | `/api/admin/system-settings/resource` | body: 资源配置字段 | 保存后的配置 |
| GET | `/api/admin/system-settings/subscription` | 无 | `clash_config_name`, `clash_profile_update_interval`, `telegram_channel_url`, `online_customer_service_url` |
| PUT | `/api/admin/system-settings/subscription` | body: 上述订阅配置字段 | 保存后的配置 |
| GET | `/api/admin/referrals` | query: `page?`, `limit?`, `email?`, `code?`, `enabled?` | `{ total, page, limit, list }` |
| GET | `/api/admin/referrals/:userId` | query: `page?`, `limit?` | `{ summary, rewards }` |
| PUT | `/api/admin/referrals/:userId/enabled` | body: `enabled` | 更新结果 |
| POST | `/api/admin/referrals/:userId/reset-code` | 无 | 新推广码记录 |
| GET | `/api/admin/telegram/config` | 无 | Telegram 内部接口配置概览 |
| POST | `/api/admin/telegram/admin-bind-codes` | body: `admin_id?`, `expires_in_seconds?` | 绑定码、过期时间等 |
| GET | `/api/admin/telegram/admin-bindings` | 无 | 已绑定管理员数组 |

资源分发响应示例：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "resource_id": 1,
    "distributions": [
      {
        "user_id": 1,
        "distribution_id": 10,
        "action": "created"
      }
    ]
  }
}
```

### 8.7 Telegram 内部接口

| 方法 | 路径 | 请求体 / 查询参数 | 响应 `data` |
| --- | --- | --- | --- |
| GET | `/api/internal/telegram/health` | 内部鉴权头 | 健康状态、时间戳 |
| POST | `/api/internal/telegram/admin/bind/verify` | body: `bind_code`, `chat_id` | 绑定结果和管理员信息 |
| GET | `/api/internal/telegram/admin/by-chat/:chatId` | path: `chatId` | 管理员绑定信息 |
| GET | `/api/internal/telegram/servers/health` | query: `chat_id` | 服务器健康汇总 |
| GET | `/api/internal/telegram/servers/health/:serverId` | query: `chat_id` | 单服务器健康详情 |
| GET | `/api/internal/telegram/alerts` | query: `chat_id`, `limit?` | 告警列表 |
| GET | `/api/internal/telegram/alerts/pending` | query: `limit?` | 待发送告警列表 |
| POST | `/api/internal/telegram/alerts/:alertId/sent` | body: `result_status`, `message_id?`, `error?` | 标记发送结果 |
| GET | `/api/internal/telegram/admin/users/lookup` | query: `chat_id`, `email?` 或 `user_id?` | 用户查询结果 |
