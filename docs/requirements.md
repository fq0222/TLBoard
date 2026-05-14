# 机场面板系统需求文档

> 版本：V1.9  
> 更新日期：2026-05-13

---

## 1. 项目概述

本项目是一套订阅管理系统，分为用户端和管理端两个独立子系统：

- 用户端：套餐展示、注册登录、在线支付、订阅管理、Cloudflare IP 优选、工单支持
- 管理端：套餐管理、订单管理、用户管理、公告管理、3X-UI 服务端管理、工单管理、邮件管理

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
| 邮件 | Brevo (@getbrevo/brevo) | 邮件发送服务 |
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

### 3.3 站点配置

系统支持通过环境变量配置站点协议和域名，用于生成订阅链接等需要完整 URL 的场景：

| 环境变量 | 说明 | 默认值 |
|----------|------|--------|
| `SITE_PROTOCOL` | 站点协议 | `http` |
| `SITE_HOST` | 站点域名或 IP | 空（从请求推断） |

**生产环境配置示例**：

```bash
SITE_PROTOCOL=https
SITE_HOST=yourdomain.com
```

**PM2 配置示例**：

```javascript
env_production: {
  SITE_PROTOCOL: 'https',
  SITE_HOST: 'yourdomain.com'
}
```

### 3.4 支付回调地址

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
- `traffic_used_at`：流量用完的时间戳，用于判断是否超过 3 天未续费

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

### 4.3 `plans`

用于保存套餐信息。

关键字段：

- `name`
- `description`
- `price`：价格（分）
- `duration_days`：有效天数，`0` 表示无限期
- `traffic_limit`：流量上限（字节）
- `sort_order`：排序权重
- `enabled`：启用状态
- `sales_limit`：可销售总量，`-1` 表示不限制
- `sales_count`：已售数量
- `updated_at`：最后更新时间

### 4.4 `traffic_sync_log`

用于记录每个服务器上次同步的流量值，实现增量更新。

关键字段：

- `user_id`：用户ID
- `server_id`：服务器ID
- `last_sync_traffic`：上次同步时的流量值（字节）
- `last_sync_at`：上次同步时间戳

索引：

- `idx_traffic_sync_log_user_server`：复合索引 (user_id, server_id)
- `idx_traffic_sync_log_last_sync_at`：时间戳索引

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

### 5.2 登录安全要求

用户端登录和注册接口已实现暴力破解防护：

- **速率限制**：基于 IP+邮箱组合的固定窗口限制
- **窗口时间**：15 分钟
- **最大尝试次数**：3 次失败尝试
- **响应格式**：HTTP 429 状态码 + `Retry-After` 头
- **触发条件**：仅在登录/注册失败时计数，成功请求不计入
- **前端处理**：收到 429 响应时显示"请求过于频繁，请稍后再试"

### 5.3 支付安全要求

在线支付部分必须满足以下要求：

- 所有 VMQ 回调必须验签
- 必须同时校验订单金额 `price` 和实付金额 `reallyPrice`
- 用户少付金额时不得激活订单
- 如果 VMQ 返回 `isAuto=1`，表示用户需要手动输入金额，该通道不得下发给用户，需直接拒绝并关闭订单
- 订单状态支持通过异步通知和主动轮询双通道确认

### 5.4 首页

首页包含两个主要区域：

- 套餐展示
  - 展示已启用套餐
  - 显示名称、价格、有效期、流量、描述
  - 售罄套餐显示"已售罄"标签，购买按钮禁用
  - 点击购买后跳转到带 `plan_id` 的登录页
- 公告展示
  - 按时间倒序显示
  - 支持置顶
  - 支持 Markdown 语法渲染
  - 每页显示 3 条，支持分页

### 5.5 用户中心

展示内容：

- 邮箱
- 当前套餐
- 订阅链接（需先完成 CF IP 优选）
- 到期时间
- 已用流量 / 总流量
- 账号状态

支持操作：

- 一键优选 IP（在浏览器后台自动测试延迟，选择最优 5 个 IP）
- 生成订阅链接（优选完成后可用，会自动同步节点信息到所有 3X-UI 服务器）
- 复制订阅链接
- 查看订阅详情
- 续费套餐（在现有套餐基础上累加流量）
- 重新购买套餐
- Cloudflare IP 优选（手动选择 IP）
- 获取客户端配置教程（Android/Windows）

#### 移动端适配

用户端支持移动端访问，采用响应式设计：

- **桌面端（> 1024px）**：左侧固定侧边栏导航
- **平板端（768-1024px）**：侧边栏缩小
- **移动端（< 768px）**：
  - 顶部固定导航栏
  - 汉堡菜单展开/收起侧边栏
  - 点击遮罩层自动关闭
  - 内容区域全宽显示

#### 首次使用引导

个人中心页面提供首次使用引导：

1. **快速开始步骤引导**：显示"优选IP → 生成链接"两步操作流程
2. **教程引导**：提供 Android 和 Windows 客户端配置教程
3. **订阅链接提示**：已生成的链接持久化显示，提供重新生成提示

生成订阅链接流程：

1. 用户点击"生成订阅链接"按钮
2. 后端同步所有在线 3X-UI 服务器的节点信息（更新 `xui_nodes` 表）
3. 返回订阅链接（通用订阅、Clash 订阅）
4. 前端显示订阅链接

**说明**：同步操作放在生成订阅链接时执行，而不是每次访问订阅接口时执行，避免影响订阅链接的访问速度。

续费流程：

1. 用户在个人中心点击"续费套餐"按钮
2. 弹出续费弹窗，展示所有启用套餐
3. 默认选中当前套餐，用户可选择其他套餐
4. 用户选择支付方式（支付宝/微信）
5. 点击"立即续费"，调用续费接口
6. 创建订单并跳转到支付等待页
7. 支付成功后，流量累加到当前套餐（当前流量 + 新套餐流量）
8. 同步更新到所有 3X-UI 服务器

续费规则：

- **续费当前套餐**：流量用完后 3 天内可续费，不管套餐是否售罄
- **切换其他套餐**：需要检查新套餐是否售罄
- **超过 3 天**：需等待名额释放后重新购买
- 前端在续费对话框和个人中心页面显示续费规则说明

一键优选流程：

1. 用户点击"一键优选 IP"按钮
2. 前端从后端获取 IP 池（最多 20 个，包含 IPv6）
3. 前端并发测试各 IP 到用户浏览器的延迟（3 次取平均）
4. 按延迟排序，优先选 1 个 IPv6，其余从 IPv4 中选，共 5 个
5. 调用后端接口保存优选结果
6. 显示"生成订阅链接"按钮，用户点击后显示订阅链接

### 5.6 支付等待页

当前实现要求：

- 展示 VMQ 返回的支付链接二维码
- 提供“打开支付链接”和“复制支付链接”按钮
- 不直接在二维码下方展示长链接文本
- 自动轮询间隔为 5 秒
- 手动“重新检查支付状态”可立即触发查单
- 自动轮询时不应切回整页 loading，避免页面闪烁

### 5.7 Cloudflare IP 优选

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

### 5.8 工单支持

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
- 设置可销售总量（-1 表示不限制）
- 查看已售数量和最后更新时间

#### 可销售总量功能

每个套餐可设置最大销售数量，超过后用户端显示"已售罄"：

- `sales_limit`：可销售总量，`-1` 表示不限制
- `sales_count`：当前已售数量
- 售罄后用户端首页显示"已售罄"标签，购买按钮禁用
- 注册时检查套餐是否售罄，售罄则拒绝购买

#### 名额释放机制

- 用户流量用完后 3 天内未续费，占用的名额自动释放
- 定时任务每小时检查并释放过期名额
- 流量用完时间记录在 `users.traffic_used_at` 字段

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
- 编辑公告（支持 Markdown 语法，带实时预览）
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

### 6.9 邮件管理

管理员可通过 Brevo 平台发送邮件，支持群发和单发。

#### 6.9.1 Brevo 配置

在系统设置页面配置 Brevo 邮件服务：

- API Key：Brevo API 密钥
- 发件人邮箱：显示的发件人地址
- 发件人名称：显示的发件人名称
- 每日发送配额：所有邮件发送的总上限（默认 200）
- 每日群发配额：群发任务专用配额（默认 100）

#### 6.9.2 邮件模板管理

支持创建和管理邮件模板：

- 模板名称
- 邮件主题（支持变量）
- HTML 邮件内容（支持变量）
- 可用变量列表

模板变量：

| 变量名 | 说明 | 示例值 |
|--------|------|--------|
| `{{username}}` | 用户邮箱前缀 | `fuqiang` |
| `{{email}}` | 用户邮箱 | `fuqiang@example.com` |
| `{{user_id}}` | 用户 ID | `123` |
| `{{plan_name}}` | 套餐名称 | `基础套餐` |
| `{{expire_date}}` | 到期时间 | `2026/6/12` |
| `{{traffic_used}}` | 已用流量 | `1.5 GB` |
| `{{traffic_limit}}` | 流量上限 | `100 GB` |
| `{{download_url}}` | 下载链接 | `https://example.com/api/user/download/xxx` |

#### 6.9.3 邮件发送

支持多种发送方式：

- 单发：选择用户发送邮件
- 群发所有用户
- 群发禁用用户
- 自定义收件人列表

**收件人支持**：

- 系统内用户：通过搜索框选择
- 系统外邮箱：手动输入任意邮箱地址
- 两种方式可混合使用
- 系统外邮箱显示"外部"标签

发送特性：

- HTML 邮件支持
- 邮件预览
- 模板变量自动替换
- 发送日志记录

#### 6.9.4 群发任务管理

群发任务采用队列机制：

- 每日群发配额限制（默认 100 封/天）
- 断点续发：未完成的任务第二天继续发送
- 任务状态：待发送、发送中、已完成、已暂停
- 支持暂停/恢复任务
- 查看发送日志

#### 6.9.5 发送日志

记录每封邮件的发送状态：

- 收件人邮箱
- 邮件主题
- 发送状态（成功/失败）
- 错误信息
- 发送时间
- 支持删除过期日志（默认 30 天）
- 分页显示，每页 10 条

#### 6.9.6 用户端邮件触发

用户可通过预设场景触发邮件发送：

- 发送教程邮件
- 发送账单邮件

使用白名单机制，只能调用预设的模板。

#### 6.9.7 用户端教程邮件

用户可在个人中心请求教程邮件：

- Android-App 教程：匹配模板名称包含 `v2rayNg-App` 的模板
- Windows 教程：匹配模板名称包含 `v2rayN-windows` 的模板
- 每个用户每天只能收到 1 封教程邮件
- 点击"获得"按钮后，教程邮件会发送到用户注册邮箱

---

## 7. 当前接口总览

### 7.1 用户端

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/user/register-and-pay` | 注册并创建支付订单 |
| POST | `/api/user/login` | 用户登录 |
| GET | `/api/user/profile` | 获取个人信息（包含 `cf_optimized` 状态） |
| POST | `/api/user/subscription/generate` | 生成订阅链接（同步节点信息） |
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
| POST | `/api/user/email/tutorial` | 请求教程邮件 |
| POST | `/api/user/email/download` | 请求下载链接邮件 |
| GET | `/api/user/download/:token` | 下载文件 |

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
| GET | `/api/admin/email/config` | 获取 Brevo 配置 |
| PUT | `/api/admin/email/config` | 更新 Brevo 配置 |
| POST | `/api/admin/email/test` | 发送测试邮件 |
| GET | `/api/admin/email/templates` | 邮件模板列表 |
| POST | `/api/admin/email/templates` | 创建邮件模板 |
| PUT | `/api/admin/email/templates/:id` | 编辑邮件模板 |
| DELETE | `/api/admin/email/templates/:id` | 删除邮件模板 |
| GET | `/api/admin/email/templates/:id/preview` | 预览邮件模板 |
| POST | `/api/admin/email/send` | 发送单封邮件 |
| GET | `/api/admin/email/campaigns` | 群发任务列表 |
| POST | `/api/admin/email/campaigns` | 创建群发任务 |
| GET | `/api/admin/email/campaigns/:id` | 群发任务详情 |
| POST | `/api/admin/email/campaigns/:id/pause` | 暂停群发任务 |
| POST | `/api/admin/email/campaigns/:id/resume` | 恢复群发任务 |
| DELETE | `/api/admin/email/campaigns/:id` | 删除群发任务 |
| GET | `/api/admin/email/campaigns/:id/logs` | 群发任务日志 |
| DELETE | `/api/admin/email/logs/:id` | 删除单条日志 |
| DELETE | `/api/admin/email/logs/batch` | 批量删除日志 |
| DELETE | `/api/admin/email/logs/clear` | 清空过期日志 |
| GET | `/api/admin/email/users/search` | 搜索用户 |
| POST | `/api/user/email/:action` | 用户端触发邮件发送 |
| GET | `/api/admin/resources/config` | 获取资源配置 |
| PUT | `/api/admin/resources/config` | 保存资源配置 |
| GET | `/api/admin/resources` | 资源列表 |
| POST | `/api/admin/resources/upload` | 上传文件 |
| PUT | `/api/admin/resources/:id` | 更新资源 |
| DELETE | `/api/admin/resources/:id` | 删除资源 |
| POST | `/api/admin/resources/:id/distribute` | 分发资源给用户 |
| GET | `/api/admin/resources/:id/distributions` | 获取分发列表 |
| PUT | `/api/admin/resources/distributions/batch-expire` | 批量设置过期时间 |
| DELETE | `/api/admin/resources/distributions/:id` | 删除分发记录 |

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
│  │  │  ├─ tickets.js
│  │  │  ├─ email.js
│  │  │  └─ download.js
│  │  └─ admin/
│  │     ├─ tickets.js
│  │     ├─ email.js
│  │     ├─ resources.js
│  │     └─ ...
│  ├─ services/
│  │  ├─ vmq-service.js
│  │  ├─ order-service.js
│  │  ├─ xui-service.js
│  │  ├─ xui-sync.js
│  │  ├─ traffic-manager.js
│  │  ├─ ticket-service.js
│  │  └─ email-service.js
│  ├─ jobs/
│  │  ├─ index.js
│  │  └─ email-campaign.js
│  ├─ db/
│  │  ├─ init.js
│  │  └─ migrations/
│  │     ├─ 001-node-subscription-strategy.js
│  │     ├─ 002-resources-table.js
│  │     └─ 003-resource-distributions.js
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
│     │  ├─ Email.vue
│     │  ├─ Resources.vue
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
| 流量同步与禁用检查 | 是 | 10 分钟 | 1 小时 | 同步用户流量数据并自动禁用超量用户 |
| 工单自动关闭 | 是 | 3 分钟 | 1 小时 | 关闭超时未回复的工单 |
| 释放过期名额 | 是 | 15 分钟 | 1 小时 | 释放流量用完超3天的用户名额 |
| 邮件群发任务 | 是 | 5 分钟 | 每天 9:00 | 处理待发送的群发任务 |
| 清理邮件日志 | 是 | 20 分钟 | 每天 3:00 | 删除 30 天前的邮件日志 |

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

### 10.5 流量同步与禁用检查

- 执行频率：每 1 小时（首次延迟 10 分钟）
- 逻辑：
  1. 获取所有在线 3X-UI 服务器的流量数据
  2. 使用增量更新计算用户总流量（汇总所有服务器）
  3. 更新本地数据库中的 `traffic_used` 字段
  4. 检查流量超限用户并自动禁用：
     - 先同步禁用状态到所有 3X-UI 服务器
     - 再更新本地数据库 `enabled = 0`
     - 记录 `traffic_used_at` 时间戳

- 增量更新机制：
  - 使用 `traffic_sync_log` 表记录每个服务器上次同步的流量值
  - 本次流量 - 上次流量 = 增量
  - 用户总流量 = 原有流量 + 增量
  - 服务器流量重置时，增量 = 当前流量

- 续费后自动解除禁用：
  - 用户续费后，检查是否需要解除禁用
  - 更新本地数据库 `enabled = 1, traffic_used_at = NULL`
  - 异步同步到所有 3X-UI 服务器

### 10.6 工单自动关闭

- 执行频率：每 1 小时（首次延迟 3 分钟）
- 逻辑：关闭满足以下条件的工单
  - 状态为 `pending`（管理员已回复）
  - 用户已读最后一条管理员回复
  - 用户已读后超过 24 小时无新回复

### 10.7 释放过期名额

- 执行频率：每 1 小时（首次延迟 15 分钟）
- 逻辑：释放满足以下条件的用户名额
  - 用户有套餐且流量已用完
  - 流量用完时间 (`traffic_used_at`) 超过 3 天
  - 3 天内没有续费订单
- 效果：对应套餐的 `sales_count` 减少

### 10.8 邮件群发任务

- 执行频率：每天 9:00（首次延迟 5 分钟）
- 逻辑：
  1. 查询状态为 `pending` 或 `sending` 的群发任务
  2. 从数据库读取每日群发配额（默认 100）
  3. 检查今日已发送数量
  4. 计算剩余配额（取总配额和群发配额的较小值）
  5. 获取待发送用户列表（排除已发送的用户）
  6. 逐个发送邮件，替换模板变量
  7. 记录发送日志
  8. 更新任务状态（完成或等待明天继续）

### 10.9 清理邮件日志

- 执行频率：每天 3:00（首次延迟 20 分钟）
- 逻辑：删除 30 天前的邮件发送日志

---

## 11. 订阅策略功能

### 11.1 功能概述

系统支持为每个节点配置订阅信息处理策略，支持两种策略类型：

- **cf 策略**：替换地址为 CF 优选 IP，端口为 `client_port`，host 为 `host`
- **direct 策略**：完全不修改，直接使用 3X-UI 返回的原始节点信息

### 11.2 策略判断规则

通过节点备注（remark）判断策略类型：
- 备注包含 "cf"：使用 cf 策略
- 其他格式：使用 direct 策略

### 11.3 数据库设计

- `user_node_configs` 表：存储每个用户在每个节点上的独立配置（UUID 和 sub_id）
  - 使用 `server_id` + `inbound_id` 关联节点，不依赖 `xui_nodes` 表的外键
  - `UNIQUE(user_id, server_id, inbound_id)` 唯一约束
- `user_subscriptions` 表：存储聚合后的订阅信息，用于快速响应订阅请求
- `xui_servers.sub_url` 字段：存储服务器的订阅链接地址

### 11.4 工作流程

1. 用户支付成功后，系统为每个节点生成独立的 UUID 和 sub_id（16 位十六进制）
2. 同步用户到 3X-UI 时，为 direct 节点设置 `flow: 'xtls-rprx-vision'`
3. 用户点击"生成订阅链接"时，系统：
   - 同步所有服务器节点信息
   - 为每个节点独立从 3X-UI 获取原始订阅（使用各自的 sub_id）
   - CF 节点为每个优选 IP 生成独立节点
   - 根据策略处理节点信息（CF 策略无条件替换 host）
   - 聚合所有节点并缓存
4. 用户访问订阅链接时，直接返回缓存的节点信息
5. 定时任务每 4 小时检查并同步 sub_id 和 flow 到 3X-UI

### 11.5 sub_id 同步机制

- **数据库为主**：`user_node_configs` 表中的 sub_id 是权威数据
- **同步方向**：数据库 → 3X-UI（用数据库值覆盖 3X-UI）
- **触发时机**：
  - 用户购买/续费时生成并同步
  - 定时任务检查一致性并补充缺失值
  - 生成订阅链接时确保数据一致

### 11.6 CF 优选 IP 处理

- 用户选择多个 CF 优选 IP 时，每个 IP 生成独立的节点
- 节点名添加序号后缀（如 `cf-1`、`cf-2`）
- 替换内容：地址 → CF IP，端口 → `client_port`，host → `host`

---

## 12. 数据库迁移

### 迁移脚本

数据库结构变更通过迁移脚本执行，支持幂等运行：

```bash
node server/db/migrations/001-node-subscription-strategy.js
```

迁移内容：
- `xui_servers` 表添加 `sub_url` 字段
- `user_node_configs` 表从 `node_id` 改为 `server_id` + `inbound_id`
- `users` 和 `user_node_configs` 表的 `sub_id` 更新为 16 位

---

## 13. 资源下载功能

### 13.1 功能概述

系统支持管理员上传文件资源，并为不同用户分配独立的下载链接，支持设置有效期。用户可通过帮助弹窗获取下载链接邮件。

### 13.2 数据库设计

**`resources` 表**：存储资源文件信息

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL | 主键 |
| name | VARCHAR(255) | 资源显示名称 |
| filename | VARCHAR(255) | 存储文件名（UUID） |
| original_name | VARCHAR(255) | 原始文件名 |
| size | BIGINT | 文件大小（字节） |
| mimetype | VARCHAR(100) | MIME 类型 |
| path | VARCHAR(500) | 存储路径 |
| download_token | VARCHAR(32) | 全局下载 token |
| expire_at | BIGINT | 过期时间戳 |
| download_count | INTEGER | 下载次数 |
| enabled | INTEGER | 是否启用 |
| created_at | BIGINT | 创建时间 |
| updated_at | BIGINT | 更新时间 |

**`resource_distributions` 表**：存储用户独立下载链接

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL | 主键 |
| resource_id | INTEGER | 关联资源 ID |
| user_id | INTEGER | 关联用户 ID |
| download_token | VARCHAR(32) | 独立下载 token |
| expire_at | BIGINT | 过期时间戳 |
| download_count | INTEGER | 下载次数 |
| enabled | INTEGER | 是否启用 |
| created_at | BIGINT | 创建时间 |

### 13.3 资源配置

在系统设置页面可配置：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| 最大文件大小 | 单个文件最大允许上传大小 | 100MB |
| 总下载流量限制 | 所有用户共享的总下载速度 | 0（不限速） |

配置存储在 `system_settings` 表，key 为 `resource_config`。

### 13.4 管理端功能

**资源管理页面**：
- 上传文件（支持拖拽，最多 5 个文件）
- 资源列表展示（名称、大小、下载次数、状态、过期时间）
- 重命名资源
- 删除资源（同时删除文件）
- 分发资源给用户（支持批量选择用户、设置有效期）
- 查看分发列表
- 批量设置分发有效期

### 13.5 用户端功能

**帮助弹窗**：
- 新增"Android-App下载"按钮
- 点击后系统自动：
  1. 检查用户是否已有有效分发记录
  2. 如果没有，自动创建分发记录（关联最新资源，默认 60 分钟有效期）
  3. 模糊匹配模板名称包含 "Android-App" 的邮件模板
  4. 发送包含下载链接的邮件给用户

**下载文件**：
- 通过分发链接下载（用户独立 token，优先验证）
- 通过全局链接下载（资源全局 token）
- 全局限速：所有用户共享总下载速度限制

### 13.6 邮件模板变量

邮件模板支持以下变量：

| 变量名 | 说明 |
|--------|------|
| `{{username}}` | 用户邮箱前缀 |
| `{{email}}` | 用户邮箱 |
| `{{user_id}}` | 用户 ID |
| `{{plan_name}}` | 套餐名称 |
| `{{expire_date}}` | 到期时间 |
| `{{traffic_used}}` | 已用流量 |
| `{{traffic_limit}}` | 流量上限 |
| `{{download_url}}` | 下载链接（根据用户自动匹配） |

### 13.7 工作流程

1. 管理员上传资源文件
2. 管理员可选择分发给指定用户（设置有效期）
3. 用户在帮助弹窗中点击"获取"
4. 系统自动创建分发记录（如果没有）
5. 系统发送包含下载链接的邮件
6. 用户点击链接下载文件

---

## 14. 与旧文档相比的关键修正

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
