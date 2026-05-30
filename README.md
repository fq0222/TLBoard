# 订阅管理系统

[English](./README_EN.md) | 简体中文

一套面向 3X-UI 多节点场景的订阅管理系统，提供套餐购买、用户订阅生成、Cloudflare 优选、资源分发、邮件触达与 3X-UI 多服务器同步能力。

## 项目概览

- 后端：`server/`，Node.js + Express + PostgreSQL
- 用户端：`client-user/`，Vue 3 + Vite + Element Plus
- 管理端：`client-admin/`，Vue 3 + Vite + Element Plus
- 启动方式：三个包独立安装依赖，无根 `package.json`
- 后端入口：`server/app.js` 统一启动用户端 API（30000）和管理端 API（30001）

## 当前能力

### 用户端

- 套餐浏览、下单、续费、切换套餐
- 通用订阅与 Clash 订阅生成
- Cloudflare 优选 IP 管理
- 下载资源领取与链接重置
- 公告、帮助中心、客户端教程邮件获取
- 响应式布局，支持移动端访问

### 管理端

- 3X-UI 服务器管理与一键同步
- 套餐、订单、用户、公告管理
- 资源分发、到期控制与令牌刷新
- 邮件模板、群发、发送日志管理
- 仪表盘统计与系统流量倍率设置
- 每日 3X-UI 数据库备份

## 节点与订阅策略

系统目前支持三类入站处理策略，均通过 inbound `remark` 自动识别：

- `cf`：备注包含 `cf`，订阅生成时替换地址、端口和 Host，并为多个优选 IP 生成独立节点
- `direct`：默认策略，保留原始节点信息；同步到 3X-UI 时自动补 `flow: xtls-rprx-vision`
- `hy2`：备注包含 `hy2`，对应 3X-UI 的 `protocol=hysteria`，订阅输出为 `hysteria2://`

### hy2 处理细节

- 3X-UI 客户端字段使用 `auth`，不使用 `id`
- 客户端同步字段包含 `auth`、`email`、`subId`、`enable`、`expiryTime`、`totalGB`、`limitIp`、`tgId`
- 通用订阅会补齐 `security=tls`、`mport=40000-50000`、`insecure=0`、`allowInsecure=0`
- Clash 订阅会补齐 `ports: 40000-50000`、`tls: true`、`skip-cert-verify: false`

### 原始订阅模板缓存

- 系统会把每个用户、每台服务器、每个 inbound 的原始订阅模板缓存到 `user_subscription_sources`
- 生成订阅时优先复用缓存模板，缓存缺失时会按失效节点做增量修复
- `hysteria` inbound 会自动匹配 `hysteria2://` 原始链接

## 同步与后台任务

### 3X-UI 用户同步

- 购买、续费、启用、禁用都会触发 3X-UI 同步
- 失败任务会写入 `xui_sync_tasks` 补偿队列
- 补偿任务默认首轮延迟 30 秒，之后每分钟轮询一次
- 退避间隔依次为 1 分钟、5 分钟、15 分钟、1 小时、4 小时

### 定时任务

- 流量同步与自动禁用：首轮延迟 10 分钟，之后每小时一次
- 订单过期标记：每 10 分钟一次
- 过期订单删除：首轮延迟 5 分钟，之后每小时一次
- 僵尸用户清理：首轮延迟 2 分钟，之后每 30 分钟一次
- 3X-UI 全量用户同步：首轮延迟 1 分钟，之后每 4 小时一次
- 工单自动关闭检查：首轮延迟 3 分钟，之后每小时一次
- 释放过期销售名额：每天 05:00
- 邮件群发任务：每天 09:00
- 邮件日志清理：每天 03:00
- 3X-UI 数据库备份：每天 04:00

## 技术特性

- 多台 3X-UI 服务器统一管理
- PostgreSQL 连接池与失败自动重试
- 用户登录/注册速率限制
- 用户流量聚合、倍率换算、超限自动禁用
- 基于 `sub_id` / `auth` / `flow` 的节点配置一致性维护
- 支持使用 3X-UI API Token 下载并覆盖保存最新 `x-ui.db`

## 快速开始

### 环境要求

- Node.js 18.x LTS
- PostgreSQL 12+
- OpenResty 或 Nginx

### 安装步骤

```bash
# 克隆仓库
git clone https://github.com/fq0222/TLBoard.git
cd TLBoard

# 安装后端依赖
cd server
npm install

# 安装用户端依赖
cd ../client-user
npm install

# 安装管理端依赖
cd ../client-admin
npm install

# 初始化数据库
cd ../server
npm run init-db

# 仅启动后端
npm run dev

# 生产方式启动后端
npm run start

# 当前 dev:all 为统一后端入口兼容脚本，等价于 npm run dev
npm run dev:all

# 用户端前端开发
cd ../client-user
npm run dev

# 管理端前端开发
cd ../client-admin
npm run dev
```

### 默认管理账号

| 用途 | 账号 | 密码 |
|------|------|------|
| 管理端 | `admin` | `admin123` |

首次登录后请立即修改默认密码。

## 配置说明

### 核心配置文件

- 开发配置：`server/config.js`
- 生产配置：`server/ecosystem.config.js`
- 站点 URL 工具：`server/utils/site-url.js`

### 站点配置

订阅链接、邮件链接等需要完整 URL 的功能依赖站点配置：

```javascript
site: {
  protocol: process.env.SITE_PROTOCOL || 'http',
  host: process.env.SITE_HOST || '',
}
```

生产环境建议设置：

```bash
SITE_PROTOCOL=https
SITE_HOST=yourdomain.com
```

### 3X-UI 服务器配置

后台添加 3X-UI 服务器时需配置：

- 名称：服务器显示名
- API 地址：3X-UI 面板地址
- API Token：3X-UI 的 API Token
- Host / 端口：用于 `cf` 策略节点输出
- 订阅地址：3X-UI 原始订阅地址

## 主要目录

```text
server/
  app.js
  routes/
  controllers/
  repositories/
  services/
    admin/
    user/
    shared/
  integrations/
    xui/
    vmq/
    email/
  jobs/
  db/
client-user/
  src/
client-admin/
  src/
docs/
```

重点服务文件：

- `server/services/shared/order-service.js`：购买、续费与 3X-UI 同步
- `server/integrations/xui/xui-service.js`：3X-UI API 交互
- `server/services/shared/subscription-strategy.js`：订阅策略解析与链接改写
- `server/services/shared/subscription-service.js`：原始订阅模板缓存与修复
- `server/integrations/xui/xui-sync-task-service.js`：3X-UI 同步补偿队列
- `server/services/shared/traffic-manager.js`：流量统计、超限禁用与恢复
- `server/integrations/vmq/vmq-service.js`：VMQ 支付适配
- `server/integrations/email/email-service.js`：Brevo 邮件发送适配

## 文档入口

- [需求文档](./docs/requirements.md)
- [API 文档](./docs/api.md)
- [部署文档](./docs/deploy-subscription-manager.md)

## 更新日志

### V1.7.1 (2026-05-30)

- 后端完成按 `routes / controllers / repositories / services / integrations` 的目录重构
- 新增 `services/user`、`services/admin`、`services/shared` 三层职责划分
- 新增 `integrations/xui`、`integrations/vmq`、`integrations/email` 外部系统适配目录
- 统一后端启动入口为 `server/app.js`，移除旧的 `app-user.js` 与 `app-admin.js`
- README、需求文档与 API 文档更新为当前实现结构

### V1.7.0 (2026-05-29)

- 新增 `hy2` 节点策略，支持 `hysteria2://` 通用订阅与 Clash 输出
- `hy2` 与 3X-UI 联调完成，客户端认证字段统一使用 `auth`
- 新增原始订阅模板缓存与增量修复机制，修复 `hysteria` / `hysteria2` 匹配问题
- 新增 `xui_sync_tasks` 同步补偿队列，统一处理购买、续费、启停等失败重试
- 帮助中心、资源分发、系统流量倍率等现有能力补齐文档

### V1.6.0 (2026-05-22)

- 3X-UI 认证适配新版本 API Token 方式
- 管理端支持配置流量统计倍率
- 每天凌晨 4 点自动备份所有服务器的 `x-ui.db`
- 资源分发按用户唯一记录复用下载链接
- 用户端支持自动创建、重置或复用下载链接

### V1.5.0 (2026-05-15)

- 管理端支持维护用户的 Cloudflare 优选 IP
- 管理端支持为用户生成订阅链接
- 修复过期名额释放逻辑，只释放已支付且流量耗尽超 3 天未续费的用户
- 过期名额释放任务改为每天 05:00 执行

### V1.4.0 (2026-05-13)

- 用户端完成移动端适配
- 新增新手引导与客户端教程邮件
- 支持站点协议配置，适配 HTTPS 生产环境
- 同步按钮增加 loading，相关超时延长到 60 秒

### V1.3.0 (2026-05-12)

- 接入 Brevo 邮件发送能力
- 支持邮件模板、群发、日志与配额管理

### V1.2.0 (2026-05-11)

- 引入 `cf` 与 `direct` 两种节点订阅策略
- 用户在每个节点拥有独立 UUID 与 `sub_id`
- direct 节点自动设置 `xtls-rprx-vision`

### V1.1.0 (2026-05-09)

- 新增跨服务器流量聚合与自动禁用
- 用户续费后自动解除禁用

### V1.0.0 (2026-05-09)

- 首个正式版本
- 支持多台 3X-UI、在线支付、公告与基础订阅管理

## 许可证

MIT License

## 支持与反馈

- 提交 [Issue](https://github.com/fq0222/TLBoard/issues)
- 查看 [Wiki](https://github.com/fq0222/TLBoard/wiki)
