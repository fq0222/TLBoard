# 机场面板系统需求文档

> 版本：V1.2  
> 更新日期：2026-05-05

---

## 1. 项目概述

本项目是一套订阅管理系统，分为用户端和管理端两个独立子系统：

- 用户端：套餐展示、注册登录、在线支付、订阅管理、Cloudflare IP 优选、工单支持
- 管理端：套餐管理、订单管理、用户管理、公告管理、3X-UI 服务端管理、工单管理

系统采用前后端分离架构，用户端和管理端分别运行在不同端口，通过 Nginx 统一代理对外提供服务。

---

## 2. 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 后端 | Node.js + Express | RESTful API |
| 前端 | Vue 3 + Vite | 用户端与管理端分别为独立 SPA |
| 数据库 | PostgreSQL | 核心业务数据存储 |
| 3X-UI 对接 | `3xui-api-client` | 服务端同步与用户下发 |
| 支付 | VMQ | 创建订单、支付通知、订单状态查询 |
| 部署 | Nginx + PM2 | 前后端反向代理与进程托管 |

---

## 3. 系统架构

### 3.1 端口划分

| 子系统 | 默认端口 | 说明 |
|--------|----------|------|
| 用户端 | 30000 | 对外服务 |
| 管理端 | 30001 | 管理后台 |

### 3.2 路由代理建议

- `/` -> 用户端前端
- `/api/user/*` -> 用户端后端
- `/admin/*` -> 管理端前端
- `/api/admin/*` -> 管理端后端

### 3.3 支付回调地址

VMQ 后台需要配置以下两个地址：

- 异步回调地址：`https://你的域名/api/user/payment/notify`
- 同步回调地址：`https://你的域名/api/user/payment/return`

说明：

- 异步回调用于支付结果落单、验签、激活订阅
- 同步回调用于浏览器支付完成后的回跳，再由后端重定向到前端支付结果页

---

## 4. 核心数据模型

### 4.1 `users`

用于保存用户账号、套餐、流量、到期时间、是否启用等信息。

关键字段：

- `email`
- `password_hash`
- `plan_id`
- `subscription_token`
- `traffic_used`
- `traffic_limit`
- `expire_at`：到期时间，`0` 或 `NULL` 表示无限期
- `enabled`：账号启用状态，`0` 禁用、`1` 启用
- `payment_count`：支付成功次数，用于判断僵尸用户

### 4.2 `orders`

用于保存支付订单信息。

关键字段：

- `user_id`
- `email`
- `plan_id`
- `amount`：订单金额（分），记录 VMQ 实际支付金额
- `trade_no`：VMQ 订单号
- `out_trade_no`：商户订单号（`ORD` 前缀为新购订单，`REN` 前缀为续费订单）
- `status`：`pending` / `paid` / `expired`
- `payment_url`
- `paid_at`

---

## 5. 用户端需求

### 5.1 注册、登录与支付

当前实现采用“注册并支付”一体化流程，而不是单独注册后再购买。

流程如下：

1. 用户在首页选择套餐
2. 前端跳转到登录页，并携带 `plan_id`
3. 页面进入“注册并支付”模式
4. 用户填写邮箱、密码、确认密码，并选择支付方式
5. 前端先执行本地校验：
   - 邮箱格式正确
   - 密码至少 8 位
   - 密码必须同时包含字母和数字
   - 两次密码输入一致
6. 后端创建本地用户与本地订单：
   - 新用户：创建为未启用状态
   - 已注册且仍有有效套餐的用户：直接拒绝注册支付，请先登录
   - 订单初始状态为 `pending`
7. 后端调用 VMQ 创建支付订单
8. 如果 VMQ 返回可自动带金额的支付链接，则将支付链接返回前端
9. 前端进入支付等待页，展示二维码供用户扫码
10. 前端通过公共查单接口轮询订单状态
11. VMQ 异步回调成功后，后端完成订单激活逻辑：
   - 更新订单状态为 `paid`
   - 激活用户账号
   - 设置套餐、流量和到期时间
   - 同步到 3X-UI
12. 支付成功后前端尝试自动登录并跳转到用户中心

### 5.2 支付安全要求

在线支付部分必须满足以下要求：

- 所有 VMQ 回调必须验签
- 必须同时校验订单金额 `price` 和实付金额 `reallyPrice`
- 用户少付金额时不得激活订单
- 如果 VMQ 返回 `isAuto=1`，表示用户需要手动输入金额，该通道不得下发给用户，需直接拒绝并关闭订单
- 订单状态支持通过异步通知和主动轮询双通道确认

### 5.3 首页

首页包含两个主要区域：

- 套餐展示
  - 展示已启用套餐
  - 显示名称、价格、有效期、流量、描述
  - 点击购买后跳转到带 `plan_id` 的登录页
- 公告展示
  - 按时间倒序显示
  - 支持置顶

### 5.4 用户中心

展示内容：

- 邮箱
- 当前套餐
- 订阅链接（需先完成 CF IP 优选）
- 到期时间
- 已用流量 / 总流量
- 账号状态

支持操作：

- 一键优选 IP（在浏览器后台自动测试延迟，选择最优 5 个 IP）
- 生成订阅链接（优选完成后可用）
- 复制订阅链接
- 查看订阅详情
- 续费套餐（在现有套餐基础上累加流量）
- 重新购买套餐
- Cloudflare IP 优选（手动选择 IP）

续费流程：

1. 用户在个人中心点击"续费套餐"按钮
2. 弹出续费弹窗，展示所有启用套餐
3. 默认选中当前套餐，用户可选择其他套餐
4. 用户选择支付方式（支付宝/微信）
5. 点击"立即续费"，调用续费接口
6. 创建订单并跳转到支付等待页
7. 支付成功后，流量累加到当前套餐（当前流量 + 新套餐流量）
8. 同步更新到所有 3X-UI 服务器

一键优选流程：

1. 用户点击"一键优选 IP"按钮
2. 前端从后端获取 IP 池（最多 20 个，包含 IPv6）
3. 前端并发测试各 IP 到用户浏览器的延迟（3 次取平均）
4. 按延迟排序，优先选 1 个 IPv6，其余从 IPv4 中选，共 5 个
5. 调用后端接口保存优选结果
6. 显示"生成订阅链接"按钮，用户点击后显示订阅链接

### 5.5 支付等待页

当前实现要求：

- 展示 VMQ 返回的支付链接二维码
- 提供“打开支付链接”和“复制支付链接”按钮
- 不直接在二维码下方展示长链接文本
- 自动轮询间隔为 5 秒
- 手动“重新检查支付状态”可立即触发查单
- 自动轮询时不应切回整页 loading，避免页面闪烁

### 5.6 Cloudflare IP 优选

功能目标：

- 登录用户可获取可选的 CF IP 池
- 系统随机返回最多 20 个 IP，并尽量包含 IPv6
- 用户可选择 IP 并应用到自己的订阅配置

安全说明：

- **未优选时默认使用 `8.8.8.8` 作为占位 IP，避免暴露真实服务器 IP**
- 用户必须完成 CF IP 优选后才能生成有效的订阅链接

当前后端接口只包含：

- 获取 IP 池
- 应用选中的 IP

前端延迟测试如果存在，应视为前端本地能力，而不是强依赖后端 `/test` 接口。

### 5.7 工单支持

用户在遇到问题时可通过工单系统联系管理员。

功能要求：

- 创建工单：填写标题（50字以内）和问题描述（500字以内）
- 工单列表：查看历史工单，显示状态和未读标记
- 工单详情：查看对话记录，回复管理员
- 关闭工单：用户可手动关闭自己的工单
- 未读提示：导航栏显示未读工单数量红点

状态说明：

- `open`：待处理（用户创建后）
- `pending`：处理中（管理员回复后）
- `closed`：已关闭

---

## 6. 管理端需求

### 6.1 管理员认证

- 管理员登录
- 修改密码
- 超级管理员管理管理员账号

### 6.2 套餐管理

- 新增套餐
- 编辑套餐
- 删除套餐
- 设置启用状态与排序

### 6.3 用户管理

- 查看用户列表
- 查看用户详情
- 调整套餐、流量、到期时间
- 启用 / 禁用账号

### 6.4 订单管理

- 查看订单列表
- 按状态、邮箱、时间筛选
- 查看订单的用户、套餐、金额和状态信息

### 6.5 公告管理

- 新增公告
- 编辑公告
- 删除公告
- 设置是否启用、是否置顶

### 6.6 3X-UI 服务端管理

- 服务端新增、编辑、删除
- 查看服务端详情
- 同步节点与用户信息
- 手动更新 3X-UI 用户

服务端字段说明：

- `name`：服务器名称
- `api_url`：3X-UI 面板地址
- `api_username`：API 用户名
- `api_password`：API 密码
- `host`：CF 端口转发规则中的主机名，用于生成订阅节点的 `host` 参数
- `client_port`：客户端连接端口，用于生成订阅节点的端口号（如 v2rayN 中配置的端口）

### 6.7 Cloudflare IP 池管理

- IP 池增删改查
- 批量导入

### 6.8 工单管理

管理员可处理用户提交的工单。

功能要求：

- 工单列表：查看所有工单，支持按状态筛选和关键词搜索
- 工单统计：显示待处理、处理中、今日新增数量
- 工单详情：查看对话记录，回复工单
- 关闭工单：管理员可关闭工单
- 删除工单：管理员可删除工单（同时删除回复和已读记录）
- 已读状态：显示用户是否已读管理员的回复

---

## 7. 当前接口总览

### 7.1 用户端

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/user/register-and-pay` | 注册并创建支付订单 |
| POST | `/api/user/login` | 用户登录 |
| GET | `/api/user/profile` | 获取个人信息（包含 `cf_optimized` 状态） |
| GET | `/api/user/plans` | 获取套餐列表 |
| GET | `/api/user/announcements` | 获取公告列表 |
| GET | `/api/user/orders` | 获取当前用户订单列表 |
| GET | `/api/user/orders/status/:id` | 公共查单 |
| GET | `/api/user/orders/:id/status` | 登录态查单 |
| POST | `/api/user/renew` | 用户续费（累加流量） |
| GET | `/api/user/subscription` | 获取订阅信息 |
| GET | `/api/user/sub/:token` | 获取订阅内容 |
| GET | `/api/user/cf-ips` | 获取 CF IP 池 |
| POST | `/api/user/cf-ips/apply` | 应用 CF IP（通过 IP ID） |
| GET | `/api/user/payment/notify` | VMQ 异步通知 |
| POST | `/api/user/payment/notify` | VMQ 异步通知 |
| GET | `/api/user/payment/return` | VMQ 同步回跳 |
| GET | `/api/user/tickets/unread-count` | 获取未读工单数量 |
| GET | `/api/user/tickets` | 获取工单列表 |
| POST | `/api/user/tickets` | 创建工单 |
| GET | `/api/user/tickets/:id` | 获取工单详情 |
| POST | `/api/user/tickets/:id/replies` | 回复工单 |
| PUT | `/api/user/tickets/:id/close` | 关闭工单 |

### 7.2 管理端

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/admin/login` | 管理员登录 |
| PUT | `/api/admin/password` | 修改密码 |
| GET | `/api/admin/admins` | 管理员列表 |
| POST | `/api/admin/admins` | 新增管理员 |
| DELETE | `/api/admin/admins/:id` | 删除管理员 |
| GET | `/api/admin/servers` | 服务端列表 |
| POST | `/api/admin/servers` | 新增服务端（支持 `host`、`client_port`） |
| PUT | `/api/admin/servers/:id` | 编辑服务端（支持 `host`、`client_port`） |
| DELETE | `/api/admin/servers/:id` | 删除服务端 |
| GET | `/api/admin/servers/:id/detail` | 服务端详情 |
| POST | `/api/admin/servers/:id/sync` | 同步服务端 |
| PUT | `/api/admin/servers/:id/users` | 更新 3X-UI 用户 |
| DELETE | `/api/admin/servers/:id/users` | 删除 3X-UI 用户 |
| GET | `/api/admin/users` | 用户列表 |
| GET | `/api/admin/users/:id` | 用户详情 |
| PUT | `/api/admin/users/:id` | 更新用户 |
| GET | `/api/admin/plans` | 套餐列表 |
| POST | `/api/admin/plans` | 新增套餐 |
| PUT | `/api/admin/plans/:id` | 编辑套餐 |
| DELETE | `/api/admin/plans/:id` | 删除套餐 |
| GET | `/api/admin/announcements` | 公告列表 |
| POST | `/api/admin/announcements` | 新增公告 |
| PUT | `/api/admin/announcements/:id` | 编辑公告 |
| DELETE | `/api/admin/announcements/:id` | 删除公告 |
| GET | `/api/admin/orders` | 订单列表 |
| GET | `/api/admin/cf-ips` | CF IP 池列表 |
| POST | `/api/admin/cf-ips` | 新增 IP |
| PUT | `/api/admin/cf-ips/:id` | 编辑 IP |
| DELETE | `/api/admin/cf-ips/:id` | 删除 IP |
| POST | `/api/admin/cf-ips/import` | 批量导入 IP |
| GET | `/api/admin/dashboard/stats` | 仪表盘统计数据 |
| GET | `/api/admin/tickets/stats` | 工单统计 |
| GET | `/api/admin/tickets` | 工单列表 |
| GET | `/api/admin/tickets/:id` | 工单详情 |
| POST | `/api/admin/tickets/:id/replies` | 回复工单 |
| PUT | `/api/admin/tickets/:id/close` | 关闭工单 |
| DELETE | `/api/admin/tickets/:id` | 删除工单 |

---

## 8. 项目目录

```text
project/
├─ server/
│  ├─ app.js
│  ├─ app-user.js
│  ├─ app-admin.js
│  ├─ routes/
│  │  ├─ user/
│  │  │  ├─ auth.js
│  │  │  ├─ plans.js
│  │  │  ├─ orders.js
│  │  │  ├─ payment.js
│  │  │  ├─ subscription.js
│  │  │  ├─ announcements.js
│  │  │  ├─ cf-optimize.js
│  │  │  ├─ renew.js
│  │  │  └─ tickets.js
│  │  └─ admin/
│  │     ├─ tickets.js
│  │     └─ ...
│  ├─ services/
│  │  ├─ vmq-service.js
│  │  ├─ order-service.js
│  │  ├─ xui-service.js
│  │  └─ ticket-service.js
│  └─ config.js
├─ client-user/
│  └─ src/
│     ├─ views/
│     │  ├─ Home.vue
│     │  ├─ Login.vue
│     │  ├─ PaymentCallback.vue
│     │  └─ user/
│     │     ├─ Tickets.vue
│     │     ├─ TicketDetail.vue
│     │     └─ CreateTicket.vue
│     ├─ api/
│     └─ stores/
├─ client-admin/
│  └─ src/
│     ├─ views/
│     │  ├─ Tickets.vue
│     │  ├─ TicketDetail.vue
│     │  └─ ...
│     ├─ api/
│     └─ stores/
└─ docs/
   ├─ requirements.md
   └─ api.md
```

说明：

- `vmq-service.js`：VMQ 下单、查单、关单、回调验签
- `order-service.js`：订单完成后的统一激活逻辑（含同步到 3X-UI）
- 不再使用旧的 `payment-service.js`

---

## 10. 定时任务

系统包含以下定时任务（`server/jobs/index.js`）：

| 任务名称 | 启动时执行 | 首次延迟 | 执行间隔 | 说明 |
|---------|-----------|---------|---------|------|
| 标记过期订单 | 是 | 无 | 10 分钟 | 将超时订单标记为 expired |
| 删除过期订单 | 是 | 5 分钟 | 1 小时 | 删除超过 1 小时的 expired 订单 |
| 清理僵尸用户 | 是 | 2 分钟 | 30 分钟 | 删除未支付的超时用户 |
| 3X-UI 用户同步 | 是 | 7 分钟 | 4 小时 | 同步用户到 3X-UI 节点 |
| 流量同步 | 是 | 10 分钟 | 3 小时 | 同步用户流量数据 |
| 工单自动关闭 | 是 | 3 分钟 | 1 小时 | 关闭超时未回复的工单 |

### 10.1 标记过期订单

- 执行频率：每 10 分钟（启动时立即执行）
- 逻辑：将超过 30 分钟未支付的 `pending` 订单标记为 `expired`

### 10.2 删除过期订单

- 执行频率：每 1 小时（首次延迟 5 分钟）
- 逻辑：删除超过 1 小时的 `expired` 订单

### 10.3 清理僵尸用户

- 执行频率：每 30 分钟（首次延迟 2 分钟）
- 逻辑：删除满足以下条件的用户
  - `enabled = 0`（未启用）
  - `payment_count = 0`（从未支付）
  - 创建时间超过 30 分钟

### 10.4 3X-UI 用户同步

- 执行频率：每 4 小时（首次延迟 7 分钟）
- 逻辑：
  1. 查询所有已启用且未过期的用户
  2. 遍历所有在线的 3X-UI 服务器
  3. 检查用户是否在每个 inbound 的客户端列表中
  4. 如果不存在，则添加用户到 3X-UI 节点

### 10.5 流量同步

- 执行频率：每 3 小时（首次延迟 10 分钟）
- 逻辑：
  1. 查询所有已启用的用户
  2. 遍历所有在线的 3X-UI 服务器
  3. 从 3X-UI 的 `clientStats` 中获取用户流量数据（上行 + 下行）
  4. 更新本地数据库中的 `traffic_used` 字段

### 10.6 工单自动关闭

- 执行频率：每 1 小时（首次延迟 3 分钟）
- 逻辑：关闭满足以下条件的工单
  - 状态为 `pending`（管理员已回复）
  - 用户已读最后一条管理员回复
  - 用户已读后超过 24 小时无新回复

---

## 11. 与旧文档相比的关键修正

本次已按当前代码实现修正文档中的以下不一致项：

- 支付网关从旧描述调整为 VMQ
- 用户购买流程调整为"注册并支付"一体化流程
- 新增公共查单接口 `/api/user/orders/status/:id`
- 增加 VMQ 回调接口 `/api/user/payment/notify`
- 增加同步回跳接口 `/api/user/payment/return`
- 支付结果页调整为二维码支付等待页
- 删除用户端不存在的 `/api/user/cf-ips/test` 接口描述
- 服务层说明调整为 `vmq-service.js` 与 `order-service.js`
- 增加对 `isAuto=1` 风险通道的拒绝规则
- 增加少付金额不得激活订单的要求
- 新增工单系统功能（用户端和管理端）
- 新增工单自动关闭定时任务
