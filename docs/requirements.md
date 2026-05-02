# 机场面板系统 — 需求文档

> 版本：v1.0 | 日期：2026-04-29

---

## 一、系统概述

一套机场（VPN/代理）订阅管理面板，分为**用户端**和**管理端**两个独立子系统，运行在不同端口，实现物理隔离。

---

## 二、技术栈

| 层级 | 技术 | 备注 |
|------|------|------|
| 后端 | Node.js + Express | RESTful API |
| 前端 | Vue 3 + Vite | 用户端与管理端各自独立 SPA |
| 数据库 | PostgreSQL | 关系型数据库，支持高并发 |
| 3X-UI 通信 | 3xui-api-client (npm) | 开源库，不自行封装 |
| 支付 | 易支付 (支付宝) | 通过易支付网关对接 |
| 部署 | 前后端分离，反向代理(Nginx) | 管理端与用户端不同端口 |

---

## 三、系统架构

```
┌─────────────────────────────────────────────┐
│                  Nginx (443)                 │
├────────────────┬────────────────────────────┤
│  /admin/*      │  /* (用户端)                │
│  → :30001      │  → :30000                  │
│  管理端 API     │  用户端 API                 │
│  管理端 SPA     │  用户端 SPA                 │
└────────────────┴────────────────────────────┘
        │                    │
        └──────┬─────────────┘
               │
         ┌─────▼─────┐
         │ PostgreSQL │
         └───────────┘
```

### 端口分离策略

| 子系统 | 默认端口 | 说明 |
|--------|----------|------|
| 用户端 | 30000 | 对外暴露，面向用户 |
| 管理端 | 30001 | 仅内网/管理员访问，独立 Express 实例 |

两个端口共用同一个 PostgreSQL 数据库，但各自拥有独立的 Express 应用、路由、中间件和认证体系。

---

## 四、数据库设计（PostgreSQL）

### 4.1 用户表 `users`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PK | 自增主键 |
| email | VARCHAR(255) UNIQUE | 邮箱，兼做用户名 |
| password_hash | VARCHAR(255) | bcrypt 哈希 |
| plan_id | INTEGER FK | 当前订阅套餐 ID |
| subscription_token | VARCHAR(255) UNIQUE | 订阅链接唯一 token |
| traffic_used | BIGINT | 已用流量(bytes) |
| traffic_limit | BIGINT | 流量上限(bytes) |
| expire_at | BIGINT | 到期时间(unix timestamp) |
| enabled | INTEGER | 是否启用 (0/1) |
| created_at | BIGINT | 注册时间 |
| updated_at | BIGINT | 更新时间 |

### 4.2 管理员表 `admins`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PK | 自增主键 |
| username | VARCHAR(255) UNIQUE | 管理员用户名 |
| password_hash | VARCHAR(255) | bcrypt 哈希 |
| is_super | INTEGER | 是否超级管理员 (0/1) |
| created_at | BIGINT | 创建时间 |

### 4.3 套餐表 `plans`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PK | 自增主键 |
| name | VARCHAR(255) | 套餐名称 |
| description | TEXT | 套餐描述 |
| price | INTEGER | 价格(分) |
| duration_days | INTEGER | 有效天数 |
| traffic_limit | BIGINT | 流量上限(bytes) |
| sort_order | INTEGER | 排序权重 |
| enabled | INTEGER | 是否上架 (0/1) |
| created_at | BIGINT | 创建时间 |

### 4.4 订单表 `orders`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PK | 自增主键 |
| user_id | INTEGER FK | 用户 ID（注册前可为 null） |
| email | VARCHAR(255) | 下单邮箱 |
| plan_id | INTEGER FK | 套餐 ID |
| amount | INTEGER | 金额(分) |
| trade_no | VARCHAR(255) UNIQUE | 易支付交易号 |
| out_trade_no | VARCHAR(255) UNIQUE | 商户订单号 |
| status | VARCHAR(50) | pending / paid / expired |
| payment_url | TEXT | 支付链接 |
| paid_at | BIGINT | 支付时间 |
| created_at | BIGINT | 创建时间 |

### 4.5 3X-UI 服务器表 `xui_servers`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PK | 自增主键 |
| name | VARCHAR(255) | 服务器名称 |
| api_url | VARCHAR(500) | 3X-UI 面板地址 |
| api_username | VARCHAR(255) | API 用户名 |
| api_password | VARCHAR(255) | API 密码 |
| status | INTEGER | 在线状态 (0/1) |
| last_check_at | BIGINT | 最后检测时间 |
| created_at | BIGINT | 创建时间 |

### 4.6 3X-UI 节点快照表 `xui_nodes`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PK | 自增主键 |
| server_id | INTEGER FK | 关联服务器 |
| inbound_id | INTEGER | 3X-UI inbound ID |
| remark | VARCHAR(255) | 节点备注 |
| port | INTEGER | 端口 |
| protocol | VARCHAR(50) | 协议 |
| user_count | INTEGER | 用户数 |
| online_count | INTEGER | 在线数 |
| updated_at | BIGINT | 更新时间 |

### 4.7 公告表 `announcements`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PK | 自增主键 |
| title | VARCHAR(500) | 公告标题 |
| content | TEXT | 公告内容 (支持 Markdown/HTML) |
| pinned | INTEGER | 是否置顶 (0/1) |
| enabled | INTEGER | 是否显示 (0/1) |
| created_at | BIGINT | 创建时间 |
| updated_at | BIGINT | 更新时间 |

### 4.8 Cloudflare 优选 IP 池 `cf_ip_pool`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PK | 自增主键 |
| ip | VARCHAR(50) | IP 地址（支持 IPv4 和 IPv6，使用标准 443 端口） |
| enabled | INTEGER | 是否启用 (0/1) |
| created_at | BIGINT | 创建时间 |

### 4.9 用户 CF 优选记录 `user_cf_ips`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PK | 自增主键 |
| user_id | INTEGER FK | 用户 ID |
| ip_pool_id | INTEGER FK | 优选 IP 池 ID |
| created_at | BIGINT | 创建时间 |

---

## 五、用户端功能详细设计

### 5.1 登录注册

**流程：用户不单独注册，通过支付套餐完成注册。**

```
用户访问首页 → 选择套餐 → 填写邮箱+密码 → 发起支付
    → 支付成功 → 系统自动创建账号 → 跳转用户中心
    → 支付失败/超时 → 提示失败，不创建账号
```

- 登录方式：邮箱 + 密码
- 认证方式：JWT Token
- 密码强度要求：最少 8 位，包含字母和数字

### 5.2 首页

**上半部分：套餐展示**
- 以卡片形式展示所有已上架套餐
- 每张卡片显示：套餐名、价格、有效期、流量上限、描述
- 点击购买 → 弹出登录/注册表单（邮箱+密码）→ 发起支付

**下半部分：系统公告**
- 按时间倒序展示公告列表
- 置顶公告置顶显示
- 支持 Markdown 渲染

### 5.3 用户个人中心

**信息展示：**
- 邮箱
- 当前套餐名称
- 订阅链接（可复制，格式支持 Clash/V2Ray/SS 等通用订阅格式）
- 到期时间
- 已用流量 / 总流量（带进度条）
- 账号状态

**操作：**
- 复制订阅链接
- 重新购买套餐（续费/升级）

### 5.4 Cloudflare IP 优选工具

**功能描述：**
类似 http://ip.flares.cloud/ 的在线工具，用户可在浏览器端测试 Cloudflare IP 延迟。

**核心流程：**
1. 从管理员配置的 IP 池中加载可用 IP 列表
2. 用户点击"开始测试"→ 前端并发对各 IP 发起延迟测试（HTTP ping）
3. 以表格形式展示结果：IP、端口、地区、延迟(ms)
4. 用户可勾选最多 **5 个** IP
5. 点击"应用"→ 调用后端 API → 将选中 IP 替换到用户订阅的节点信息中
6. 替换后用户需重新获取订阅链接

**前端延迟测试实现：**
- 使用 `fetch` + `AbortController` + `performance.now()` 测量延迟
- 对每个 IP 发送 HEAD 请求到 Cloudflare CDN 端口
- 支持并发数控制（避免浏览器连接数限制）
- 每个 IP 测试 3 次取平均值

**后端替换逻辑：**
1. 获取用户关联的所有 3X-UI 服务器
2. 通过 3xui-api-client 获取用户的 inbound 配置
3. 将节点中的 IP 替换为用户选择的优选 IP
4. 更新用户的订阅内容

---

## 六、管理端功能详细设计

### 6.1 管理员登录

- 默认超级管理员账号：首次启动时自动创建（`admin` / `admin123`，强制修改密码）
- 认证方式：JWT Token（与用户端 JWT 使用不同密钥）
- 支持修改密码、添加新管理员

### 6.2 3X-UI 服务器管理

**添加服务器：**
- 表单字段：服务器名称、面板地址(http(s)://ip:port)、用户名、密码
- 保存后自动测试连接

**服务器卡片展示：**
每张卡片显示：
- 服务器名称
- 连接状态（绿/红指示灯）
- 面板地址（超长URL自动省略，鼠标悬停显示完整地址）
- 节点总数
- 用户总数
- 在线用户数

**服务器详情页（点击卡片进入）：**
- 返回按钮：可返回服务器管理页面
- 服务器信息：名称、面板地址、状态、最后检测时间
- 节点列表：每个节点的名称、协议、端口、用户数、在线数
- 每个节点下的用户列表：
  - 用户标识（email）
  - 状态（启用/禁用）
  - 到期时间
  - 已用流量 / 流量上限
  - 操作按钮：
    - 编辑：修改到期时间、流量上限
    - 启用/禁用：切换用户状态
    - 删除：删除用户（需二次确认）

**同步逻辑：**
- 点击同步按钮，从 3X-UI 拉取最新的节点和用户信息
- 同步后更新数据库中的节点快照信息
- 更新服务器在线状态

### 6.3 套餐管理

- 套餐列表：增删改查
- 字段：名称、描述、价格（元，存储为分）、有效天数、流量上限、是否上架、排序

### 6.4 公告管理

- 公告列表：增删改查
- 字段：标题、内容（富文本编辑器）、是否置顶、是否显示

### 6.5 用户管理

- 用户列表：搜索、筛选
- 操作：启用/禁用、修改套餐、修改流量、修改到期时间
- 用户详情：订单历史、订阅信息

### 6.6 订单管理

- 订单列表：搜索、筛选（按状态、时间）
- 订单详情：用户信息、套餐信息、支付信息

### 6.7 Cloudflare 优选 IP 池管理

- IP 列表：增删改查
- 字段：IP 地址、端口、地区、是否启用
- 支持批量导入

---

## 七、API 设计概览

### 7.1 用户端 API (`/api/user/`)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/user/register | 注册（支付时触发） |
| POST | /api/user/login | 登录 |
| GET | /api/user/profile | 获取个人信息 |
| GET | /api/user/plans | 获取套餐列表 |
| GET | /api/user/announcements | 获取公告列表 |
| POST | /api/user/order/create | 创建订单 |
| GET | /api/user/orders | 订单列表 |
| GET | /api/user/subscription | 获取订阅链接 |
| GET | /api/user/cf-ips | 获取优选 IP 池 |
| POST | /api/user/cf-ips/test | 延迟测试（透传 IP 列表） |
| POST | /api/user/cf-ips/apply | 应用优选 IP |

### 7.2 管理端 API (`/api/admin/`)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/admin/login | 管理员登录 |
| PUT | /api/admin/password | 修改密码 |
| GET | /api/admin/admins | 管理员列表 |
| POST | /api/admin/admins | 添加管理员 |
| DELETE | /api/admin/admins/:id | 删除管理员 |
| GET | /api/admin/servers | 3X-UI 服务器列表 |
| POST | /api/admin/servers | 添加服务器 |
| PUT | /api/admin/servers/:id | 修改服务器 |
| DELETE | /api/admin/servers/:id | 删除服务器 |
| GET | /api/admin/servers/:id/detail | 服务器详情（节点+用户） |
| POST | /api/admin/servers/:id/sync | 同步服务器状态 |
| GET | /api/admin/users | 用户列表 |
| PUT | /api/admin/users/:id | 修改用户信息 |
| GET | /api/admin/plans | 套餐列表 |
| POST | /api/admin/plans | 添加套餐 |
| PUT | /api/admin/plans/:id | 修改套餐 |
| DELETE | /api/admin/plans/:id | 删除套餐 |
| GET | /api/admin/announcements | 公告列表 |
| POST | /api/admin/announcements | 添加公告 |
| PUT | /api/admin/announcements/:id | 修改公告 |
| DELETE | /api/admin/announcements/:id | 删除公告 |
| GET | /api/admin/orders | 订单列表 |
| GET | /api/admin/cf-ips | CF IP 池列表 |
| POST | /api/admin/cf-ips | 添加 IP |
| PUT | /api/admin/cf-ips/:id | 修改 IP |
| DELETE | /api/admin/cf-ips/:id | 删除 IP |
| POST | /api/admin/cf-ips/import | 批量导入 IP |

---

## 八、支付对接（易支付 + 支付宝）

### 流程

```
1. 前端提交：邮箱 + 密码 + 套餐ID
2. 后端校验：
   - 邮箱是否已被注册 → 已注册则直接创建订单（续费）
   - 未注册 → 先创建用户（标记为"待支付"状态）
   - 创建订单（status: pending）
3. 后端构造易支付请求参数，生成支付 URL
4. 前端跳转到易支付收银台
5. 用户完成支付
6. 易支付异步回调（notify_url）：
   - 验签
   - 更新订单状态为 paid
   - 激活用户账号
   - 设置用户套餐、流量、到期时间
   - 同步到所有 3X-UI 服务器
7. 前端轮询订单状态 → 支付成功 → 跳转用户中心
```

### 安全要点

- 回调验签必须严格校验
- 使用 out_trade_no 做幂等处理，防止重复回调
- 订单超时未支付自动关闭（30 分钟）

---

## 九、安全设计

### 9.1 端口隔离

| 项目 | 用户端 (30000) | 管理端 (30001) |
|------|----------------|----------------|
| Express 实例 | 独立 | 独立 |
| JWT 密钥 | user_secret | admin_secret |
| CORS | 允许用户域名 | 仅 localhost / 内网 IP |
| Rate Limit | 较宽松 | 较严格 |
| API 路由前缀 | /api/user/ | /api/admin/ |

### 9.2 认证安全

- 密码使用 bcrypt 哈希（salt rounds: 12）
- JWT 有效期：用户端 7 天，管理端 2 小时
- 管理端登录失败限速（5 次/15 分钟锁定）
- 管理端建议通过 Nginx 限制来源 IP 或配置 VPN/内网访问

### 9.3 数据安全

- 3X-UI 密码加密存储（AES-256）
- 支付回调日志脱敏
- SQL 参数化查询，防止注入
- 输入校验（express-validator）
- 请求体大小限制（1MB）
- Helmet 中间件（安全 Header）

### 9.4 网络安全

- 管理端 30001 端口不对外暴露，仅通过 Nginx 反向代理 + IP 白名单访问
- 强制 HTTPS
- 管理端添加 Basic Auth 作为额外保护层（可选）

---

## 十、前端页面结构

### 10.1 用户端页面

```
/                    → 首页（套餐展示 + 公告）
/login               → 登录页
/user                → 个人中心（需登录）
/user/subscription   → 订阅信息
/user/cf-optimize    → CF IP 优选工具
/payment/callback    → 支付回调处理页
```

### 10.2 管理端页面

```
/admin/login              → 管理员登录
/admin/dashboard          → 仪表盘（概览）
/admin/servers            → 3X-UI 服务器列表（卡片视图）
/admin/servers/:id        → 服务器详情
/admin/plans              → 套餐管理
/admin/announcements      → 公告管理
/admin/users              → 用户管理
/admin/orders             → 订单管理
/admin/cf-ips             → CF IP 池管理
/admin/settings           → 系统设置（管理员账号）
```

---

## 十一、项目目录结构

```
project/
├── server/                    # 后端
│   ├── app.js                 # 统一启动入口 (同时启动用户端和管理端)
│   ├── app-user.js            # 用户端 Express 实例 (port 30000)
│   ├── app-admin.js           # 管理端 Express 实例 (port 30001)
│   ├── init-db.js             # 数据库初始化脚本（首次部署运行）
│   ├── db/
│   │   └── init.js            # PostgreSQL 数据库初始化 + 表创建
│   ├── middleware/
│   │   ├── auth-user.js       # 用户端 JWT 认证
│   │   ├── auth-admin.js      # 管理端 JWT 认证
│   │   └── validator.js       # 通用校验
│   ├── routes/
│   │   ├── user/              # 用户端路由
│   │   │   ├── auth.js
│   │   │   ├── plans.js
│   │   │   ├── orders.js
│   │   │   ├── subscription.js
│   │   │   ├── announcements.js
│   │   │   └── cf-optimize.js
│   │   └── admin/             # 管理端路由
│   │       ├── auth.js
│   │       ├── servers.js
│   │       ├── plans.js
│   │       ├── users.js
│   │       ├── orders.js
│   │       ├── announcements.js
│   │       └── cf-ips.js
│   ├── services/
│   │   ├── xui-service.js     # 3X-UI API 封装（使用 3xui-api-client）
│   │   ├── payment-service.js # 易支付对接
│   │   └── user-sync.js       # 用户同步到 3X-UI
│   ├── config.js              # 配置（端口、密钥、数据库连接等）
│   ├── ecosystem.config.js    # PM2 部署配置
│   └── package.json
├── client-user/               # 用户端前端
│   ├── src/
│   │   ├── views/
│   │   ├── components/
│   │   ├── router/
│   │   ├── stores/            # Pinia
│   │   ├── api/               # Axios 封装
│   │   └── App.vue
│   ├── vite.config.js
│   └── package.json
├── client-admin/              # 管理端前端
│   ├── src/
│   │   ├── views/
│   │   ├── components/
│   │   ├── router/
│   │   ├── stores/
│   │   ├── api/
│   │   └── App.vue
│   ├── vite.config.js
│   └── package.json
└── docs/
    └── requirements.md        # 本文档
```

---

## 十二、部署方案

```bash
# 1. 安装 PostgreSQL 并创建数据库
# Ubuntu/Debian: sudo apt install postgresql
# 创建数据库和用户
sudo -u postgres psql
CREATE USER postgres WITH PASSWORD 'postgres';
CREATE DATABASE subscription_manager OWNER postgres;
\q

# 2. 安装依赖
cd server && npm install
cd ../client-user && npm install && npm run build
cd ../client-admin && npm install && npm run build

# 3. 初始化数据库（首次部署运行）
cd server
node init-db.js

# 4. 启动后端
node app.js          # 同时启动用户端(30000)和管理端(30001)
# 或使用 PM2
pm2 start ecosystem.config.js

# 5. Nginx 配置
# 用户端：proxy_pass http://127.0.0.1:30000
# 管理端：proxy_pass http://127.0.0.1:30001（限制来源 IP）
```

---

## 十三、开发优先级

| 阶段 | 内容 | 预计 |
|------|------|------|
| P0 | 数据库初始化 + 管理员登录 + 用户注册登录 + 套餐 CRUD | 核心 |
| P1 | 易支付对接 + 订单流程 | 核心 |
| P2 | 3X-UI 服务器管理 + 用户同步 | 核心 |
| P3 | 用户中心 + 订阅链接 | 重要 |
| P4 | CF IP 优选工具 | 重要 |
| P5 | 公告管理 + 管理员管理 + 用户管理 | 完善 |
| P6 | 前端美化 + 部署优化 | 优化 |
