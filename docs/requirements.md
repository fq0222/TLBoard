# 机场面板订阅管理系统需求文档

> 版本：V1.14
> 更新日期：2026-06-15
> 依据：当前仓库实际代码，重点参考 `server/routes`、`server/controllers`、`server/services`、`server/db/schema`、`client-user/src/api/index.js`、`client-admin/src/api/index.js`

## 1. 项目定位

本项目是一套面向 3X-UI 多服务器场景的订阅管理系统。系统提供用户购买、续费、订阅生成、Cloudflare 优选、资源下载、帮助中心、工单、邮件触达、推广余额奖励和后台运维能力。

项目由三个独立包组成，仓库根目录没有 `package.json`：

| 包 | 说明 | 技术栈 |
| --- | --- | --- |
| `server/` | 统一后端入口，同时启动用户端 API 和管理端 API | Node.js、Express、PostgreSQL |
| `client-user/` | 用户端单页应用 | Vue 3、Vite、Element Plus、Pinia |
| `client-admin/` | 管理端单页应用 | Vue 3、Vite、Element Plus、Pinia |

## 2. 系统架构

### 2.1 启动与端口

`server/app.js` 是唯一后端启动入口。启动后会：

- 初始化 PostgreSQL 数据库结构和默认数据。
- 注册全部后台定时任务。
- 创建用户端 Express 应用，默认监听 `30000`。
- 创建管理端 Express 应用，默认监听 `30001`。
- 在管理端 HTTP 服务上注册批量订阅生成和 3X-UI 数据库备份 WebSocket 进度通道。

默认 API 前缀：

| 子系统 | 前缀 | 默认端口 |
| --- | --- | --- |
| 用户端 API | `/api/user` | `30000` |
| 管理端 API | `/api/admin` | `30001` |
| Telegram 内部 API | `/api/internal/telegram` | `30001` |

### 2.2 后端分层

后端当前按职责分层：

```text
server/
  app.js
  bootstrap/       # Express 应用创建、路由注册、退出清理
  routes/          # 路由、中间件、参数校验
  controllers/     # 请求解析、响应兼容、日志
  services/        # 用户端、管理端、共享业务编排
  repositories/    # SQL 与数据访问
  integrations/    # 3X-UI、VMQ、Brevo 等外部系统适配
  jobs/            # 后台任务注册和具体 handler
  db/              # 初始化、迁移、表结构、默认数据
  websocket/       # 管理端长任务进度推送
```

典型共享服务：

- `services/shared/order-service.js`：订单支付成功后的权益激活、销售数量维护、3X-UI 同步任务创建。
- `services/shared/traffic-manager.js`：流量同步、超限禁用、续费解禁同步。
- `services/shared/subscription-strategy.js`：节点策略识别和订阅链接改写。
- `services/shared/subscription-service.js`：原始订阅模板抓取、解析与匹配。
- `services/shared/ticket-service.js`：工单状态、回复、已读、自动关闭规则。
- `services/referral-service.js`：推广码、点击、首单余额奖励。

外部集成：

- `integrations/xui/`：3X-UI API 客户端，支持不同面板版本适配、API Token、用户 upsert、流量重置、数据库备份。
- `integrations/vmq/vmq-service.js`：VMQ 下单、查单、关单和回调验签。
- `integrations/email/email-service.js`：Brevo 邮件发送、模板变量替换和发送日志。

## 3. 核心业务能力

### 3.1 用户端

用户端当前实现以下功能：

- 首页套餐展示，支持套餐排序、上架/下架、首页可见开关、售罄标识。
- 公告列表，支持 Markdown、置顶、分页。
- 注册并支付一体化流程，注册时直接创建 `ORD` 新购订单。
- 登录、退出、个人资料展示。
- 忘记密码和重置密码邮件流程。
- 新手引导完成状态记录。
- 续费流程，支持 VMQ 支付和余额支付。
- 订阅生成、订阅详情、通用 Base64 订阅、Clash YAML 订阅、V2Ray Base64 输出。
- Cloudflare 优选 IP 池读取、按 IP ID 应用、按 IP 地址应用。
- 帮助中心文章列表、分类、详情和图片访问。
- 下载资源列表、按资源生成用户独立下载链接、token 文件下载。
- 工单列表、创建、详情、回复、关闭和未读数量。
- 教程邮件和预设动作邮件发送。
- 推广概览、推广点击记录、奖励明细。
- 匿名公开设置读取，目前暴露在线客服链接。
- 移动端响应式布局。

### 3.2 管理端

管理端当前实现以下功能：

- 管理员登录、修改密码。
- 超级管理员管理其他管理员账号。
- 3X-UI 服务器管理：新增、编辑、删除、详情、节点同步、用户更新/删除、手动数据库备份。
- 套餐管理：创建、编辑、删除、启用、排序、销售数量、套餐类型、首页展示开关。
- 用户管理：列表筛选、详情、编辑、启用/禁用、修改套餐/流量/到期时间、维护用户 CF IP、为用户生成订阅链接。
- 批量生成订阅链接任务，支持只处理已优选 CF IP 的用户，并可查询任务状态。
- 订单列表和筛选。
- 公告管理：普通公告、弹窗次数、订阅虚拟公告节点。
- CF IP 池管理：增删改查和批量导入。
- 工单管理：统计、列表、详情、管理员回复、关闭、删除。
- 博客/帮助文章管理：文章 CRUD、分类、图片上传，用户端帮助中心读取已发布文章。
- 邮件管理：Brevo 配置、模板、预览、单发、群发任务、暂停/恢复、日志清理、用户搜索。
- 资源管理：上传、列表、编辑、删除、刷新 token、资源过期时间、用户分发、分发过期批量设置。
- 系统设置：流量统计倍率、推广奖励系数、邮件配置、资源配置、订阅配置、Telegram 频道、在线客服链接。
- 推广管理：查看用户推广码、点击、奖励余额、奖励明细、启用/禁用、重置推广码。
- Telegram 管理绑定：配置查看、生成管理员绑定码、查看绑定列表。

## 4. 套餐、订单与支付

### 4.1 套餐类型

`plans.plan_type` 当前支持：

| 类型 | 说明 | 约束 |
| --- | --- | --- |
| `lifetime` | 不限时套餐 | `duration_days` 必须为 `0` |
| `timed` | 限时套餐 | `duration_days` 必须大于 `0` |

套餐字段中还包含：

- `show_on_home`：是否在用户首页展示。
- `sales_limit`：可销售总量，`-1` 表示不限量。
- `sales_count`：已售数量。

用户端套餐列表只读取启用套餐；前端可根据 `show_on_home` 控制首页展示。

### 4.2 新购流程

新购采用“注册并支付”：

1. 用户选择套餐并提交邮箱、密码、支付方式和可选推广码。
2. 后端创建或复用待支付用户，生成 `subscription_token`、全局 `sub_id` 和 `ORD` 订单。
3. 后端调用 VMQ 创建订单。
4. 如果 VMQ 返回 `isAuto=1`，系统会关闭本地订单并拒绝继续，避免用户手动输入金额导致少付。
5. VMQ 异步通知或前端轮询确认支付后，`order-service` 在本地事务中激活订单、启用用户、写入套餐权益、累加套餐销售数量。
6. 首单如带有效推广人，会按推广奖励系数发放余额奖励。
7. 3X-UI 同步不阻塞支付落账，失败会进入 `xui_sync_tasks` 补偿队列。

### 4.3 续费流程

续费订单号以 `REN` 开头。当前续费规则：

- 续费套餐必须与当前套餐类型一致，不能跨 `lifetime` 和 `timed` 类型续费。
- `lifetime` 或历史不限时续费按旧契约累加流量。
- `timed` 续费会从支付时间重新计算有效期，并重置套餐流量；如果用户仍有剩余流量和剩余时间，接口先返回 `409` / `4091` 要求前端确认。
- 余额支付使用 `pay_type=9`，余额足够时直接扣减并完成订单，不跳转 VMQ。
- VMQ 支付仍校验 `isAuto=1` 风险通道。
- 流量超限或到期导致禁用的用户，续费成功后会触发本地恢复和 3X-UI 解禁同步。

### 4.4 推广奖励

当前代码中的推广奖励是“余额奖励”，不是流量奖励：

- 用户拥有 32 位十六进制推广码。
- 新访客可通过 `?ref=<code>` 进入用户端，前端调用接口记录点击。
- 注册并支付时提交 `referral_code`，后端只记录有效且非自推的推广人。
- 仅新购首单、支付前 `payment_count=0`、订单有推广人时发奖。
- 奖励金额 = 订单金额（分） × `referral_reward_coefficient`，向下取整。
- 奖励写入 `referral_rewards.reward_amount`，同时累加到推广人的 `users.balance`。
- `referral_rewards` 对 `referred_user_id` 和 `order_id` 有唯一约束，避免重复回调重复发奖。

## 5. 订阅与 3X-UI 同步

### 5.1 订阅 URL

当前代码生成的订阅地址为：

- 通用订阅：`/api/user/subscription/sub/:subId`
- Clash 订阅：`/api/user/subscription/sub/:subId?clash=1`
- V2Ray Base64：`/api/user/subscription/sub/:subId?v2ray=1`

注意：当前路由并未注册 `/api/user/sub/:token`。

### 5.2 订阅生成条件

用户生成订阅前必须：

- 账号存在且可用。
- 限时套餐未过期。
- 已配置至少一个 CF 优选 IP。
- 至少存在一台在线 3X-UI 服务器。

首次生成订阅会触发全量服务器节点同步；后续生成会优先复用本地快照和原始订阅模板缓存，只修复缺失或失效的节点。

### 5.3 节点凭据

每个用户在每台服务器每个 inbound 上有独立配置，存储于 `user_node_configs`：

- `uuid`：VLESS、VMess、Trojan 等 UUID 型协议使用。
- `auth`：Hysteria2 使用。
- `sub_id`：16 位十六进制，用于从 3X-UI 原始订阅拉取单节点模板。
- 唯一键：`user_id + server_id + inbound_id`。

### 5.4 节点策略

节点策略由 inbound `remark` 识别：

| 策略 | 识别方式 | 行为 |
| --- | --- | --- |
| `cf` | `remark` 包含 `cf` | 用用户 CF 优选 IP 改写地址，用服务器 `client_port` 和 `host` 改写端口/Host；多个 IP 生成多个节点 |
| `direct` | 默认策略 | 尽量保留原始订阅链接；同步到 3X-UI 时自动写入 `flow: xtls-rprx-vision` |
| `hy2` | `remark` 包含 `hy2` | 3X-UI inbound 通常为 `protocol=hysteria`，订阅输出为 `hysteria2://`，使用 `auth` 凭据 |

Clash 输出支持 `vless`、`vmess`、`trojan`、`hysteria2`。IPv6 地址输出到 Clash 时会去掉方括号。

### 5.5 原始订阅模板缓存

`user_subscription_sources` 以 `user_id + server_id + inbound_id` 缓存原始订阅模板，包含：

- `sub_id`
- `remark`
- `protocol`
- `original_link`
- `node_fingerprint`
- `server_fingerprint`
- `fetched_at`

缓存有效期为 24 小时。节点或服务器指纹变化时，仅对失效节点增量刷新。

### 5.6 订阅虚拟公告节点

公告支持 `node_show` 字段。订阅输出阶段会把启用且 `node_show=1` 的公告标题插入为虚拟节点，用于在客户端节点列表中展示简短公告。虚拟节点只使用标题，不携带公告正文。

## 6. 流量、禁用与同步状态

### 6.1 流量同步

系统从所有在线 3X-UI 服务器获取用户流量，使用 `traffic_sync_log` 记录上次同步值，并按增量累加到本地 `users.traffic_used`。

管理端系统设置中的 `traffic_usage_multiplier` 会影响本地统计口径。

### 6.2 自动禁用和恢复

- 用户流量达到套餐上限后，系统会禁用本地用户并同步到 3X-UI。
- 限时套餐到期会按到期状态处理。
- 管理员禁用、流量超限禁用和到期禁用通过 `disable_reason` 区分。
- 登录入口允许流量超限或到期用户登录以便续费，但会拒绝管理员禁用用户。
- 续费成功后会恢复流量超限或到期导致的禁用，并异步同步到 3X-UI。

### 6.3 3X-UI 同步补偿

同步失败会写入 `xui_sync_tasks`：

- 任务类型：`initial_user_sync`、`renew_sync`、`user_sync`、`enable_sync`、`disable_sync`。
- 状态：`pending`、`processing`、`success`、`failed`。
- 默认最多重试 10 次。
- 退避间隔：1 分钟、5 分钟、15 分钟、1 小时、4 小时。
- 同一用户的新同步任务会取代旧的 pending 用户同步任务，避免旧快照覆盖新权益。

`users.sync_status` 用于用户端等待流程展示，不等同于所有 3X-UI 节点最终同步成功。

## 7. 公告、帮助中心和资源

### 7.1 公告

公告字段：

- `pinned`：列表置顶。
- `enabled`：是否展示。
- `popup_show_limit`：每个用户最多弹窗次数，`0` 表示不弹窗。
- `node_show`：是否加入订阅虚拟公告节点。

用户端弹窗只在用户关闭后写入 `user_announcement_popup_stats`，刷新页面但未关闭不会计数。

### 7.2 帮助中心

帮助中心读取后台博客文章：

- 后台管理 `blog_articles`。
- 用户端只读取已发布文章。
- 支持分类、关键词、详情。
- 图片上传到 `server/uploads/blog-images`，用户端通过帮助图片接口读取。

### 7.3 资源下载

资源管理使用两个表：

- `resources`：资源文件、全局 token、过期时间、下载分类、是否展示到用户端。
- `resource_distributions`：用户独立下载 token。

当前分发规则：

- 用户端下载栏只展示 `is_download_resource=1`、启用且未过期的资源。
- 用户按资源 ID 申请下载链接。
- 同一用户只保留一条分发记录；切换资源或过期后会重置 token。
- 下载时优先匹配用户独立 token，其次匹配资源全局 token。
- 资源上传大小由系统设置控制；部署在 Nginx/OpenResty 后方时，反向代理 `client_max_body_size` 也必须足够大。

## 8. 工单

工单状态：

| 状态 | 说明 |
| --- | --- |
| `open` | 用户创建，等待处理 |
| `pending` | 管理员已回复，等待用户 |
| `closed` | 用户或管理员关闭，或自动关闭 |

规则：

- 用户可创建、查看、回复、关闭自己的工单。
- 管理员可查看全部工单、回复、关闭、删除。
- 删除工单会同时删除回复和已读记录。
- 已读通过 `ticket_reads` 和 `tickets.last_read_at` 记录。
- 管理员回复且用户已读后 24 小时无新回复，定时任务会自动关闭。

## 9. 邮件

邮件使用 Brevo：

- 系统设置维护 API Key、发件邮箱、发件名称、每日总配额、每日群发配额。
- 支持邮件模板变量替换。
- 管理员可单发、群发、预览模板、查看日志。
- 群发任务支持暂停、恢复、每日配额和日志。
- 用户端可请求教程邮件和预设动作邮件。
- 忘记密码邮件也计入每日总邮件配额。

常见模板变量：

| 变量 | 说明 |
| --- | --- |
| `{{username}}` | 邮箱前缀 |
| `{{email}}` | 邮箱 |
| `{{user_id}}` | 用户 ID |
| `{{plan_name}}` | 套餐名称 |
| `{{expire_date}}` | 到期时间 |
| `{{traffic_used}}` | 已用流量 |
| `{{traffic_limit}}` | 流量上限 |
| `{{download_url}}` | 当前用户下载链接 |

## 10. Telegram 内部能力

当前代码包含 Telegram 内部 API 和管理端绑定能力：

- 管理端可查看 Telegram 配置、生成管理员绑定码、查看绑定列表。
- 内部接口通过 `authenticateInternalTelegram` 鉴权。
- 内部接口可验证绑定码、按 chat_id 查询管理员、查询服务器健康状态、列出告警、标记告警发送结果、按邮箱或用户 ID 查询用户。
- 后台任务会定期巡检服务器健康并写入告警记录。

## 11. 数据模型概览

核心表包括：

| 表 | 说明 |
| --- | --- |
| `users` | 用户账号、套餐、流量、余额、状态、同步状态 |
| `plans` | 套餐配置、类型、展示、销售限制 |
| `orders` | 新购和续费订单，`ORD` / `REN` 区分业务类型 |
| `admins` | 管理员账号 |
| `xui_servers` | 3X-UI 服务器配置、API Token、订阅地址、面板版本 |
| `xui_nodes` | 3X-UI inbound 快照 |
| `user_node_configs` | 用户在每个节点上的 UUID/auth/sub_id |
| `user_subscriptions` | 聚合订阅缓存 |
| `user_subscription_sources` | 原始订阅模板缓存 |
| `xui_sync_tasks` | 3X-UI 同步补偿队列 |
| `traffic_sync_log` | 跨服务器流量增量同步日志 |
| `cf_ip_pool` / `user_cf_ips` | CF IP 池和用户优选记录 |
| `announcements` / `user_announcement_popup_stats` | 公告和弹窗计数 |
| `blog_articles` | 帮助中心文章 |
| `tickets` / `ticket_replies` / `ticket_reads` | 工单系统 |
| `email_templates` / `email_campaigns` / `email_logs` | 邮件模板、群发、日志 |
| `resources` / `resource_distributions` | 文件资源和用户下载链接 |
| `referral_codes` / `referral_clicks` / `referral_rewards` | 推广码、点击、余额奖励 |
| `telegram_*` | Telegram 绑定、健康检查、告警和命令日志 |
| `password_reset_tokens` | 一次性密码重置 token |
| `system_settings` | 系统设置 |

## 12. 后台任务

当前 `server/jobs/index.js` 注册任务如下：

| 任务 | 启动时执行 | 首次延迟 | 周期 |
| --- | --- | --- | --- |
| 标记过期订单 | 是 | 无 | 10 分钟 |
| 删除过期订单 | 是 | 5 分钟 | 1 小时 |
| 清理僵尸用户 | 是 | 2 分钟 | 30 分钟 |
| 3X-UI 用户同步 | 是 | 1 分钟 | 4 小时 |
| 3X-UI 同步重试队列 | 是 | 30 秒 | 1 分钟 |
| 流量同步 | 是 | 10 分钟 | 30 分钟 |
| 工单自动关闭 | 是 | 3 分钟 | 1 小时 |
| 释放过期名额 | 否 | 无 | 每天 05:00 |
| 邮件群发 | 否 | 无 | 每天 09:00 |
| 清理邮件日志 | 否 | 无 | 每天 03:00 |
| 3X-UI 数据库备份 | 否 | 无 | 每天 04:00 |
| 批量订阅任务恢复 | 否 | 15 秒 | 仅启动后一次 |
| Telegram 健康巡检 | 否 | 13 分钟 | 40 分钟 |

## 13. 安全与配置

### 13.1 认证

- 用户端使用用户 JWT，默认有效期 7 天。
- 管理端使用管理 JWT，配置注释写 24 小时。
- 管理端登录接口有 Express 全局限流。
- 用户端登录和注册接口有基于 IP + 邮箱的失败次数限制。

### 13.2 密码和重置

- 密码要求至少 8 位且同时包含字母和数字。
- 密码使用 bcrypt。
- 重置密码 token 为 32 字节随机十六进制，有效期 15 分钟，只能使用一次。
- 同一用户 24 小时内最多申请一次密码重置邮件。
- 密码重置申请始终返回模糊提示，不暴露邮箱是否存在。

### 13.3 站点 URL

订阅链接、推广链接、密码重置链接依赖站点配置：

```javascript
site: {
  protocol: process.env.SITE_PROTOCOL || 'http',
  userAppUrl: process.env.USER_APP_URL || '...',
  host: process.env.SITE_HOST || '...'
}
```

生产环境建议显式设置：

```bash
SITE_PROTOCOL=https
SITE_HOST=yourdomain.com
USER_APP_URL=https://yourdomain.com
```

### 13.4 支付配置

VMQ 回调地址必须是 VMQ 服务可访问的地址，不能使用只对后端本机有效的 `127.0.0.1`。

核心环境变量：

- `VMQ_API_URL`
- `VMQ_KEY`
- `VMQ_DEFAULT_TYPE`
- `PAY_NOTIFY_URL`
- `PAY_RETURN_URL`

### 13.5 生产敏感信息

- `server/config.js` 是本地开发配置，可包含真实本地数据，但严禁提交到远程公开仓库。
- `server/ecosystem.config.js` 是 PM2 生产配置模板，禁止写入真实敏感信息。

## 14. 迁移与初始化

新环境运行：

```bash
cd server
npm install
npm run init-db
```

`server/db/schema/tables.js` 已包含当前主要表结构。已有环境升级时，根据缺失功能执行 `server/db/migrations/` 下对应迁移脚本。迁移脚本设计为尽量幂等。

## 15. 与旧文档相比的关键修正

本版按当前代码修正以下易错点：

- 订阅文本实际路径为 `/api/user/subscription/sub/:subId`。
- 推广奖励当前是账户余额奖励，配置项为 `referral_reward_coefficient`，不是奖励流量。
- 续费现在区分 `lifetime` 和 `timed` 套餐，限时套餐续费会重置权益并可能要求二次确认。
- 用户端存在 `apply-by-ip`，但后端没有 `/api/user/cf-ips/test`。
- 系统设置实际包含 `traffic`、`email`、`resource`、`subscription` 四组。
- 后台任务中流量同步实际周期为 30 分钟。
- 公告除弹窗外，还支持 `node_show` 订阅虚拟节点。
- 管理端已包含 Telegram 绑定和内部接口配套能力。
