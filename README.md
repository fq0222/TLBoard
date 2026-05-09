# 订阅管理系统

[English](./README_EN.md) | 简体中文

一套完整的机场面板订阅管理系统，支持多台 3X-UI 服务器、在线支付、Cloudflare IP 优选等功能。

## 功能特性

### 用户端

- **注册与支付**：一体化注册支付流程，支持支付宝/微信
- **订阅管理**：通用订阅（V2Ray/Clash）和 Clash 订阅
- **IP 优选**：一键测试 Cloudflare 节点延迟，自动选择最优 IP
- **续费套餐**：流量累加机制，支持套餐切换
- **工单系统**：用户可提交问题，管理员及时响应

### 管理端

- **套餐管理**：灵活配置套餐价格、流量、有效期，支持销售总量限制
- **订单管理**：查看所有订单，支持状态筛选
- **用户管理**：调整用户套餐、流量、到期时间
- **公告管理**：支持 Markdown 语法，置顶功能
- **服务器管理**：多台 3X-UI 服务器管理，一键同步
- **工单管理**：处理用户工单，支持自动关闭

### 技术特性

- **多服务器支持**：同时管理多台 3X-UI 服务器
- **自动同步**：定时同步用户和流量数据
- **流量统计**：汇总所有服务器的用户流量（增量更新）
- **自动禁用**：流量达到套餐限额后自动禁用用户并同步到 3X-UI
- **安全防护**：登录注册速率限制，支付验签
- **高性能**：连接池优化，自动重试机制

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Node.js + Express |
| 前端 | Vue 3 + Vite + Element Plus |
| 数据库 | PostgreSQL |
| 支付 | VMQ |
| 3X-UI 对接 | 3xui-api-client |
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
│   ├── middleware/         # 中间件
│   ├── jobs/              # 定时任务
│   ├── db/                # 数据库初始化
│   └── app.js             # 入口文件
├── client-user/           # 用户端前端
│   └── src/
│       ├── views/         # 页面组件
│       ├── api/           # API 接口
│       └── stores/        # 状态管理
├── client-admin/          # 管理端前端
│   └── src/
│       ├── views/         # 页面组件
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
  }
};
```

### 3X-UI 服务器配置

在管理端后台添加 3X-UI 服务器：

- **名称**：服务器标识
- **API 地址**：3X-UI 面板地址
- **用户名/密码**：API 认证信息
- **Host**：CF 端口转发主机名
- **端口**：客户端连接端口

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
