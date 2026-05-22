# 订阅管理系统

[English](./README_EN.md) | 简体中文

一套完整的机场面板订阅管理系统，支持多台 3X-UI 服务器、在线支付、Cloudflare IP 优选、邮件管理等功能。

## 功能特性

### 用户端

- **注册与支付**：一体化注册支付流程，支持支付宝/微信
- **订阅管理**：通用订阅（V2Ray/Clash）和 Clash 订阅
- **IP 优选**：一键测试 Cloudflare 节点延迟，自动选择最优 IP
- **续费套餐**：流量累加机制，支持套餐切换
- **工单系统**：用户可提交问题，管理员及时响应
- **邮件触发**：用户可请求发送教程、账单等邮件
- **移动端适配**：响应式布局，支持手机浏览器访问
- **新手引导**：首次使用步骤引导，快速完成配置

### 管理端

- **套餐管理**：灵活配置套餐价格、流量、有效期，支持销售总量限制
- **订单管理**：查看所有订单，支持状态筛选
- **用户管理**：调整用户套餐、流量、到期时间，管理用户 CF 优选 IP，为用户生成订阅链接
- **公告管理**：支持 Markdown 语法，置顶功能
- **服务器管理**：多台 3X-UI 服务器管理，一键同步
- **工单管理**：处理用户工单，支持自动关闭
- **邮件管理**：基于 Brevo 的邮件发送，支持模板、群发、日志
- **系统设置**：支持配置流量统计倍率
- **数据库备份**：每天凌晨自动备份所有 3X-UI 服务器数据库

### 邮件管理

- **Brevo 集成**：通过 Brevo API 发送邮件
- **邮件模板**：支持 HTML 模板，变量自动替换
- **群发任务**：支持群发所有用户、禁用用户、自定义列表
- **配额管理**：每日发送配额和群发配额可配置
- **发送日志**：完整记录每封邮件的发送状态
- **定时任务**：每天自动处理群发任务，清理过期日志
- **外部收件人**：支持发送到系统外邮箱地址

### 订阅策略

- **节点级独立配置**：每个用户在每个节点上有独立的 UUID 和 sub_id
- **CF 策略**：替换地址为 CF 优选 IP，每个优选 IP 生成独立节点
- **Direct 策略**：直接使用原始节点信息，自动设置 flow: xtls-rprx-vision
- **策略判断**：通过节点备注自动识别（包含 "cf" 使用 CF 策略）

### 技术特性

- **多服务器支持**：同时管理多台 3X-UI 服务器
- **自动同步**：定时同步用户和流量数据，检查 sub_id 和 flow 一致性
- **流量统计**：汇总所有服务器的用户流量（增量更新）
- **流量倍率**：可在管理端配置流量统计倍率，按倍率累加本地已用流量
- **自动禁用**：流量达到套餐限额后自动禁用用户并同步到 3X-UI
- **数据备份**：使用 3X-UI API Token 下载并覆盖保存最新 `x-ui.db`
- **安全防护**：登录注册速率限制，支付验签
- **高性能**：连接池优化，自动重试机制

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Node.js + Express |
| 前端 | Vue 3 + Vite + Element Plus |
| 数据库 | PostgreSQL |
| 支付 | VMQ |
| 邮件 | Brevo |
| 3X-UI 对接 | API Token 认证的 3X-UI API 客户端 |
| 部署 | PM2 + OpenResty + Cloudflare Tunnel |

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
npm install --production

# 安装前端依赖并构建
cd ../client-user
npm install
npm run build

cd ../client-admin
npm install
npm run build

# 初始化数据库
cd ../server
node init-db.js

# 启动服务
npm run dev
```

### 默认账号

| 用途 | 账号 | 密码 |
|------|------|------|
| 管理端 | admin | admin123 |

> ⚠️ 首次登录后请立即修改默认密码

## 项目结构

```
subscription-manager/
├── server/                 # 后端服务
│   ├── routes/            # 路由
│   │   ├── user/          # 用户端 API
│   │   └── admin/         # 管理端 API
│   ├── services/          # 业务逻辑
│   │   ├── subscription-strategy.js  # 订阅策略处理
│   │   ├── order-service.js          # 订单处理
│   │   ├── xui-service.js            # 3X-UI 交互
│   │   ├── xui-sync.js               # 节点同步
│   │   ├── traffic-manager.js        # 流量管理
│   │   └── email-service.js          # 邮件服务
│   ├── middleware/         # 中间件
│   ├── jobs/              # 定时任务
│   │   ├── index.js       # 任务注册
│   │   ├── email-campaign.js  # 邮件群发任务
│   │   └── backupDB.js    # 3X-UI 数据库备份任务
│   ├── backupDB/          # 3X-UI 数据库备份目录（已忽略提交）
│   ├── db/                # 数据库初始化和迁移脚本
│   └── app.js             # 入口文件
├── client-user/           # 用户端前端
│   └── src/
│       ├── views/         # 页面组件
│       ├── api/           # API 接口
│       └── stores/        # 状态管理
├── client-admin/          # 管理端前端
│   └── src/
│       ├── views/         # 页面组件
│       │   └── Email.vue  # 邮件管理（发送、模板、群发）
│       ├── api/           # API 接口
│       └── stores/        # 状态管理
└── docs/                  # 文档
```

## 配置说明

### 服务器配置

编辑 `server/config.js`：

```javascript
module.exports = {
  // 数据库配置
  database: {
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'your_password',
    database: 'subscription_manager'
  },
  
  // JWT 密钥（务必修改）
  user: {
    jwtSecret: 'your_user_jwt_secret'
  },
  admin: {
    jwtSecret: 'your_admin_jwt_secret'
  },

  // 站点配置（生产环境必须配置）
  site: {
    protocol: 'https',  // 生产环境使用 https
    host: 'yourdomain.com'
  }
};
```

### 生产环境配置

使用环境变量或 PM2 配置：

```bash
# 环境变量
SITE_PROTOCOL=https
SITE_HOST=yourdomain.com
```

### 3X-UI 服务器配置

> ⚠️ **认证要求**：当前使用 3X-UI API Token 认证，请在 3X-UI 面板中生成并妥善保存 API Token。

在管理端后台添加 3X-UI 服务器：

- **名称**：服务器标识（如 "美国01"、"香港01"）
- **API 地址**：3X-UI 面板地址
- **API Token**：3X-UI 面板 API Token
- **Host**：CF 端口转发主机名
- **端口**：客户端连接端口（CF 节点使用）
- **订阅地址**：3X-UI 订阅链接地址（如 `https://example.com/sub/aaa333/`）

### 3X-UI 数据库备份

后端会在每天凌晨 4:00 自动备份所有已配置 API Token 的 3X-UI 服务器数据库：

- 备份目录：`server/backupDB`
- 文件名：`<服务器名称>-x-ui.db`
- 同名文件会被覆盖，始终保留最新备份
- `server/backupDB/` 已加入 `.gitignore`，避免提交真实数据库备份

## 部署指南

详细部署说明请参考 [部署文档](./docs/deploy-subscription-manager.md)

### 生产环境启动

```bash
# 使用 PM2 启动
cd server
pm2 start ecosystem.config.js

# 保存并设置开机自启
pm2 save
pm2 startup
```

## API 文档

完整 API 文档请参考 [API.md](./docs/api.md)

## 更新日志

### V1.6.0 (2026-05-22)

- ✨ 3X-UI 认证：适配新版 API Token 认证方式
- ✨ 流量统计倍率：管理端支持配置流量统计倍率
- ✨ 3X-UI 数据库备份：每天凌晨 4 点自动备份所有服务器的 `x-ui.db`
- ✅ 资源下载分发：同一用户只保留一条分发记录，避免重复链接
- ✅ 下载链接获取：用户端支持自动创建、重置或复用下载链接

### V1.5.0 (2026-05-15)

- ✨ 管理端用户管理：支持管理用户 CF 优选 IP（最多 5 个）
- ✨ 管理端用户管理：支持为用户生成订阅链接（与用户自己生成的 URL 一致）
- ✅ 释放过期名额逻辑修复：只释放付过款且流量用完超过 3 天未续费的用户
- ✅ 释放过期名额定时任务改为每天 5 点执行一次

### V1.4.0 (2026-05-13)

- ✨ 移动端适配：用户端响应式布局，支持手机浏览器访问
- ✨ 新手引导：首次使用步骤引导，快速完成配置
- ✨ 教程获取：支持 Android 和 Windows 客户端教程邮件
- ✨ 站点配置：支持 HTTPS 协议配置，适应生产环境
- ✨ 外部收件人：邮件发送支持系统外邮箱地址
- ✨ 服务器管理：同步按钮添加 loading 状态，超时延长至 60 秒
- ✅ 订阅链接持久化：生成后刷新页面仍显示
- ✅ 真实 IP 获取：启用 Express trust proxy

### V1.3.0 (2026-05-12)

- ✨ 邮件管理：基于 Brevo 的邮件发送功能
- ✨ 邮件模板：支持 HTML 模板，变量自动替换
- ✨ 群发任务：支持群发所有用户、禁用用户、自定义列表
- ✨ 配额管理：每日发送配额和群发配额可配置
- ✨ 发送日志：完整记录每封邮件的发送状态，支持分页
- ✨ 定时任务：每天自动处理群发任务，清理过期日志
- ✨ 仪表盘：显示今日邮件发送数量和配额
- ✨ 页面合并：邮件相关页面合并为统一的邮件管理页面

### V1.2.0 (2026-05-11)

- ✨ 节点订阅策略：支持 CF 和 Direct 两种策略
- ✨ 节点级独立配置：每个用户在每个节点上有独立的 UUID 和 sub_id
- ✨ CF 节点多 IP：每个优选 IP 生成独立节点
- ✨ Direct 节点 flow：自动设置 xtls-rprx-vision
- ✅ 3X-UI 服务器新增订阅地址字段
- ✅ 定时任务同步 sub_id 和 flow 一致性
- ✅ 数据库迁移脚本

### V1.1.0 (2026-05-09)

- ✨ 流量统计：汇总所有 3X-UI 服务器的用户流量（增量更新）
- ✨ 自动禁用：流量达到套餐限额后自动禁用用户并同步到 3X-UI
- ✨ 自动解除禁用：用户续费后自动解除禁用状态
- ✨ 流量同步频率从 3 小时改为 1 小时

### V1.0.0 (2026-05-09)

- 🎉 首个正式版本
- ✨ 多台 3X-UI 服务器支持
- ✨ 在线支付（VMQ）
- ✨ Cloudflare IP 优选
- ✨ 订阅管理（V2Ray/Clash）
- ✨ 续费套餐
- ✨ 工单系统
- ✨ 公告管理

## 许可证

MIT License

## 支持与反馈

- 提交 [Issue](https://github.com/fq0222/TLBoard/issues)
- 查看 [Wiki](https://github.com/fq0222/TLBoard/wiki)
