# 订阅管理系统

[English](./README_EN.md) | 简体中文

面向 3X-UI 多服务器部署的机场面板订阅管理系统，包含用户端、管理端和统一 Node.js 后端。当前代码支持套餐购买、续费、订阅生成、Cloudflare 优选、工单、帮助中心、资源下载、邮件触达、推广余额奖励、Telegram 内部接口和 3X-UI 同步补偿。

## 项目结构

本仓库根目录没有 `package.json`，三个包独立安装依赖：

| 目录 | 说明 | 技术栈 |
| --- | --- | --- |
| `server/` | 统一后端，同时启动用户端 API 和管理端 API | Node.js、Express、PostgreSQL |
| `client-user/` | 用户端 SPA | Vue 3、Vite、Element Plus、Pinia |
| `client-admin/` | 管理端 SPA | Vue 3、Vite、Element Plus、Pinia |

主要目录职责：

```text
subscription-manager-v1.0.0/
  server/
    app.js                         # 后端统一启动入口，同时监听用户端和管理端 API
    config.js                      # 本地开发配置，包含数据库、JWT、站点和支付配置
    ecosystem.config.js            # PM2 生产部署模板，不能写入真实敏感信息
    bootstrap/                     # Express 应用创建、路由注册、退出清理
    routes/
      user/                        # 用户端 API 路由，挂载到 /api/user
      admin/                       # 管理端 API 路由，挂载到 /api/admin
      internal/                    # Telegram 等内部 API
    controllers/
      user/                        # 用户端请求处理和响应格式兼容
      admin/                       # 管理端请求处理和响应格式兼容
    services/
      user/                        # 用户端业务编排
      admin/                       # 管理端业务编排
      shared/                      # 订单、订阅、流量、工单等共享领域逻辑
    repositories/                  # PostgreSQL 查询和数据访问封装
    integrations/
      xui/                         # 3X-UI API 客户端和同步任务
      vmq/                         # VMQ 支付适配
      email/                       # Brevo 邮件适配
    db/
      schema/                      # 当前表结构、索引、默认数据
      migrations/                  # 已有环境升级迁移脚本
    jobs/                          # 定时任务注册和任务处理器
    websocket/                     # 管理端长任务进度推送
    uploads/                       # 运行时上传文件目录，包含资源和博客图片
    backupDB/                      # 运行时 3X-UI 数据库备份目录
    test/                          # 后端验证脚本
  client-user/
    src/
      api/                         # 用户端 API 封装
      stores/                      # Pinia 用户状态
      views/                       # 登录、首页、用户中心、工单、帮助中心等页面
      components/                  # 用户端复用组件
      utils/                       # 新手引导等工具
  client-admin/
    src/
      api/                         # 管理端 API 封装
      stores/                      # Pinia 管理员状态
      views/                       # 仪表盘、用户、套餐、服务器、资源、邮件等页面
  docs/                            # 需求、API、部署和专题设计文档
```

默认端口：

- 用户端 API：`30000`
- 管理端 API：`30001`
- 用户端前端开发服务：Vite 默认端口
- 管理端前端开发服务：Vite 默认端口

## 主要功能

### 用户端

- 首页套餐展示、公告列表和公开在线客服链接。
- 注册并支付、登录、忘记密码、重置密码。
- 个人中心展示套餐、流量、余额、状态、Telegram 频道链接和新手引导状态。
- 续费套餐，支持 VMQ 支付和余额支付。
- Cloudflare 优选 IP，支持按 IP 池 ID 或 IP 地址应用。
- 生成通用订阅、Clash 订阅和 V2Ray Base64 订阅。
- 帮助中心文章、分类、图片展示。
- 下载栏资源获取和用户独立下载链接。
- 工单创建、回复、关闭和未读提醒。
- 教程邮件和预设邮件触发。
- 推广链接、点击统计和首单余额奖励明细。
- 移动端响应式布局。

### 管理端

- 管理员登录、改密和超级管理员账号管理。
- 3X-UI 服务器管理、节点同步、用户更新/删除、数据库备份。
- 套餐管理，支持 `lifetime` / `timed` 类型、销售数量、首页展示开关。
- 用户管理、CF IP 配置、单用户和批量订阅生成。
- 订单、公告、CF IP 池、工单管理。
- 博客/帮助文章管理和图片上传。
- Brevo 邮件配置、模板、单发、群发、日志管理。
- 资源上传、分类、下载栏展示、用户分发、token 刷新和过期设置。
- 系统设置：流量倍率、推广奖励系数、邮件、资源、订阅名称、Clash 更新间隔、Telegram 频道、在线客服。
- 推广管理：推广码、点击、奖励余额、启用/禁用、重置推广码。
- Telegram 管理绑定和内部监控接口配套。

## 订阅路径

当前代码实际生成的订阅路径是：

```text
/api/user/subscription/sub/:subId
/api/user/subscription/sub/:subId?clash=1
/api/user/subscription/sub/:subId?v2ray=1
```

当前后端没有注册 `/api/user/sub/:token`。

## 节点策略

订阅生成按 3X-UI inbound `remark` 自动识别策略：

| 策略 | 识别方式 | 行为 |
| --- | --- | --- |
| `cf` | 备注包含 `cf` | 用用户优选 CF IP 改写地址，使用服务器 `client_port` 和 `host` |
| `direct` | 默认策略 | 保留原始节点；同步 3X-UI 时自动写入 `flow: xtls-rprx-vision` |
| `hy2` | 备注包含 `hy2` | 3X-UI 中通常是 `protocol=hysteria`，订阅输出为 `hysteria2://`，使用 `auth` |

每个用户在每台服务器的每个 inbound 上都有独立 `uuid/auth/sub_id`。原始订阅模板会缓存到 `user_subscription_sources`，后续只修复失效节点。

## 快速开始

### 环境要求

- Node.js 18+
- PostgreSQL 12+
- Nginx 或 OpenResty（生产反向代理建议）

### 安装依赖

```bash
cd server
npm install

cd ../client-user
npm install

cd ../client-admin
npm install
```

### 初始化数据库

```bash
cd server
npm run init-db
```

### 启动后端

```bash
cd server
npm run dev
```

`npm run dev:all` 当前也是启动统一后端入口的兼容脚本。

### 启动前端

```bash
cd client-user
npm run dev

cd ../client-admin
npm run dev
```

### 构建前端

```bash
cd client-user
npm run build

cd ../client-admin
npm run build
```

如果环境缺少 terser，可使用：

```bash
npx vite build --minify esbuild
```

## 关键配置

开发配置在 `server/config.js`，生产 PM2 模板在 `server/ecosystem.config.js`。

生产环境建议至少配置：

```bash
USER_PORT=30000
ADMIN_PORT=30001
SITE_PROTOCOL=https
SITE_HOST=yourdomain.com
USER_APP_URL=https://yourdomain.com

DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=subscription_manager
DB_PASSWORD=change-me
DB_NAME=subscription_manager

USER_JWT_SECRET=change-me
ADMIN_JWT_SECRET=change-me

VMQ_API_URL=https://pay.example.com
VMQ_KEY=change-me
PAY_NOTIFY_URL=https://yourdomain.com/api/user/payment/notify
PAY_RETURN_URL=https://yourdomain.com/api/user/payment/return
```

注意：

- VMQ 回调地址必须能被 VMQ 服务访问，不能使用只对后端本机有效的 `127.0.0.1`。
- `server/config.js` 可用于本地真实配置，但不要提交到公开远程仓库。
- `server/ecosystem.config.js` 禁止写真实敏感信息。

## 默认账号

数据库初始化会创建默认管理账号：

| 用途 | 账号 | 密码 |
| --- | --- | --- |
| 管理端 | `admin` | `admin123` |

首次登录后请立即修改密码。

## 后台任务

后端启动后会注册订单过期、僵尸用户清理、3X-UI 同步、同步重试、流量同步、工单自动关闭、销售名额释放、邮件群发、邮件日志清理、3X-UI 数据库备份、批量订阅任务恢复和 Telegram 健康巡检。

任务时间表以 [需求文档](./docs/requirements.md) 中“后台任务”章节和 `server/jobs/index.js` 为准。

## 文档

- [需求文档](./docs/requirements.md)
- [API 文档](./docs/api.md)
- [部署文档](./docs/deploy-subscription-manager.md)
- [VMQ 服务 API](./docs/vmq-server-api.md)
- [3X-UI API 参考](./docs/3x-ui-api-3.2.5.md)

## 许可

MIT License
