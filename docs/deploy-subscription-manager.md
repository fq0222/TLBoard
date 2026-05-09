# 订阅管理系统飞牛NAS部署指南

> 将 subscription-manager 项目部署到飞牛NAS，使用PM2进程管理，OpenResty反向代理，Cloudflare Tunnel外网访问。

---

## 目录

- [部署架构](#部署架构)
- [环境要求](#环境要求)
- [阶段一：环境准备](#阶段一环境准备)
- [阶段二：项目部署](#阶段二项目部署)
- [阶段三：服务配置](#阶段三服务配置)
- [阶段四：OpenResty配置](#阶段四openresty配置)
- [阶段五：Cloudflare Tunnel配置](#阶段五cloudflare-tunnel配置)
- [验证部署](#验证部署)
- [常用维护命令](#常用维护命令)
- [安全建议](#安全建议)
- [常见问题](#常见问题)

---

## 部署架构

```
外网访问：用户 → Cloudflare (HTTPS) → Cloudflare Tunnel → OpenResty (80) → Node.js用户端 (30000)
局域网访问：管理员 → OpenResty (80) → Node.js管理端 (30001)
```

### 访问方式

| 服务 | 访问地址 | 用途 | 网络 |
|------|---------|------|------|
| 用户端 | `https://你的域名.com` | 用户订阅管理 | 外网（HTTPS） |
| 管理端 | `http://NAS局域网IP` | 管理员后台 | 局域网 |

### 通信路径

| 通信链路 | 走向 | 是否经过公网 |
|----------|------|:------------:|
| 用户 → 用户端 | Cloudflare (HTTPS) → Tunnel → OpenResty → Node.js | ✅ 加密穿透 |
| 管理员 → 管理端 | OpenResty → Node.js | ❌ 纯本地 |
| OpenResty → Node.js | localhost:30000/30001 | ❌ 纯本地 |
| Node.js → PostgreSQL | localhost:5432 | ❌ 纯本地 |

---

## 环境要求

| 项目 | 要求 |
|------|------|
| 飞牛NAS | FnOS（基于 Debian） |
| CPU | x86_64 架构 |
| 内存 | 建议 4GB+ |
| Node.js | 18.x LTS |
| PostgreSQL | 已安装并运行 |
| OpenResty | 已安装待配置 |
| 域名 | 已配置 Cloudflare Tunnel |

---

## 阶段一：环境准备

### 1.1 安装Node.js 18.x LTS

```bash
# 连接到NAS SSH
ssh your_user@NAS_IP

# 更新系统包
sudo apt update && sudo apt upgrade -y

# 安装curl（如果没有）
sudo apt install curl -y

# 安装Node.js 18.x LTS
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# 验证安装
node --version
npm --version
```

### 1.2 安装PM2进程管理器

```bash
# 全局安装PM2
sudo npm install -g pm2

# 验证安装
pm2 --version
```

### 1.3 安装pm2-logrotate日志轮转模块

```bash
# 安装pm2-logrotate模块
pm2 install pm2-logrotate

# 配置日志轮转参数
pm2 set pm2-logrotate:max_size 100M      # 单个日志文件最大100MB
pm2 set pm2-logrotate:retain 5           # 保留5个轮转文件
pm2 set pm2-logrotate:compress true      # 压缩旧日志文件
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss  # 轮转文件名格式
pm2 set pm2-logrotate:rotateModule true  # 同时轮转PM2模块日志
pm2 set pm2-logrotate:workerInterval 30  # 检查间隔（秒）
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'  # 每天凌晨执行轮转（可选）

# 验证配置
pm2 conf
```

**pm2-logrotate配置说明：**

| 参数 | 值 | 说明 |
|------|-----|------|
| `max_size` | `100M` | 日志文件达到100MB时触发轮转 |
| `retain` | `5` | 保留5个历史日志文件 |
| `compress` | `true` | 启用gzip压缩旧日志 |
| `dateFormat` | `YYYY-MM-DD_HH-mm-ss` | 轮转文件命名格式 |
| `rotateModule` | `true` | 轮转PM2模块日志 |
| `workerInterval` | `30` | 每30秒检查一次日志大小 |
| `rotateInterval` | `0 0 * * *` | cron表达式，每天凌晨轮转 |

### 1.4 创建项目目录

```bash
# 创建项目目录
sudo mkdir -p /opt/subscription-manager

# 设置目录权限（使用你的NAS用户名）
sudo chown -R your_user:your_user /opt/subscription-manager
```

---

## 阶段二：项目部署

### 2.1 上传项目文件

**方法：通过文件管理器上传**

1. 在电脑上压缩项目文件夹（排除 `node_modules`）
2. 通过飞牛NAS文件管理器上传到 `/opt/subscription-manager/`
3. 在NAS上解压文件

```bash
# SSH到NAS后解压
cd /opt/subscription-manager
tar -xzf subscription-manager-v1.0.0.tar.gz --strip-components=1
```

### 2.2 安装项目依赖

```bash
# 安装后端依赖
cd /opt/subscription-manager/server
npm install --production

# 安装用户端依赖并构建
cd /opt/subscription-manager/client-user
npm install
npm run build

# 安装管理端依赖并构建
cd /opt/subscription-manager/client-admin
npm install
npm run build
```

### 2.3 配置环境变量

编辑 `server/config.js`，修改以下关键配置：

```javascript
module.exports = {
  // 用户端配置
  user: {
    port: process.env.USER_PORT || 30000,
    jwtSecret: process.env.USER_JWT_SECRET || '修改为强密码_至少32位随机字符串',
    jwtExpiresIn: '7d'
  },

  // 管理端配置
  admin: {
    port: process.env.ADMIN_PORT || 30001,
    jwtSecret: process.env.ADMIN_JWT_SECRET || '修改为另一个强密码_至少32位随机字符串',
    jwtExpiresIn: '2h'
  },

  // PostgreSQL 数据库配置
  database: {
    host: process.env.DB_HOST || 'localhost',  // PostgreSQL地址
    port: parseInt(process.env.DB_PORT) || 5432,  // PostgreSQL端口
    user: process.env.DB_USER || 'postgres',  // 数据库用户名
    password: process.env.DB_PASSWORD || '你的数据库密码',  // 数据库密码
    database: process.env.DB_NAME || 'subscription_manager',
    max: 20,
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 5000,
    allowExitOnIdle: false
  },

  // 支付配置（VMQ）
  payment: {
    pid: process.env.PAY_PID || '100001',
    key: process.env.PAY_KEY || '你的支付密钥',
    apiUrl: process.env.PAY_API_URL || 'https://pay.example.com',
    notifyUrl: process.env.PAY_NOTIFY_URL || 'http://你的NAS局域网IP:30000/api/user/payment/notify',
    returnUrl: process.env.PAY_RETURN_URL || 'http://你的NAS局域网IP/api/user/payment/return',
    vmqApiUrl: process.env.VMQ_API_URL || 'http://VMQ服务器地址:8280',
    vmqKey: process.env.VMQ_KEY || '你的VMQ密钥',
    vmqDefaultType: parseInt(process.env.VMQ_DEFAULT_TYPE || '2', 10),
    vmqTimeout: parseInt(process.env.VMQ_TIMEOUT || '10000', 10)
  },

  // 3X-UI配置
  xui: {
    syncInterval: 5 * 60 * 1000, // 5分钟同步一次
    timeout: 10000 // API超时时间10秒
  },

  // 安全配置
  security: {
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 12,
    rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000,
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 3,
    maxRequestBodySize: '1mb'
  },

  // 日志配置
  logging: {
    level: process.env.LOG_LEVEL || 'info'
  }
};
```

### 2.4 初始化数据库

```bash
# 确保PostgreSQL已创建数据库
# 连接到PostgreSQL
psql -U postgres

# 创建数据库
CREATE DATABASE subscription_manager;

# 退出psql
\q

# 运行初始化脚本
cd /opt/subscription-manager/server
node init-db.js
```

初始化成功后会显示：
```
========================================
数据库初始化脚本 (PostgreSQL)
========================================
[OK] 数据库表结构初始化完成
[OK] 默认数据初始化完成
========================================
初始化完成！
默认管理员账号: admin / admin123
========================================
```

---

## 阶段三：服务配置

### 3.1 配置PM2启动脚本

编辑 `server/ecosystem.config.js`：

```javascript
module.exports = {
  apps: [
    {
      name: 'subscription-manager',
      script: './app.js',
      cwd: '/opt/subscription-manager/server',
      
      env: {
        NODE_ENV: 'production',
        
        // 用户端端口
        USER_PORT: 30000,
        
        // 管理端端口
        ADMIN_PORT: 30001,
        
        // JWT 密钥（务必修改为强密码）
        USER_JWT_SECRET: '你的用户JWT密钥_至少32位随机字符串',
        ADMIN_JWT_SECRET: '你的管理JWT密钥_至少32位随机字符串',
        
        // PostgreSQL 数据库配置
        DB_HOST: 'localhost',
        DB_PORT: 5432,
        DB_USER: 'postgres',
        DB_PASSWORD: '你的数据库密码',
        DB_NAME: 'subscription_manager',
        DB_POOL_MAX: 20,
        DB_IDLE_TIMEOUT: 60000,
        DB_CONNECT_TIMEOUT: 5000,
        
        // 日志级别
        LOG_LEVEL: 'info',
        
        // 安全配置
        RATE_LIMIT_WINDOW: 900000, // 15分钟
        RATE_LIMIT_MAX: 3,
        BCRYPT_ROUNDS: 12
      },
      
      // 日志配置
      log_file: './logs/app.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      
      // 自动重启
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      
      // 实例数
      instances: 1,
      exec_mode: 'fork'
    }
  ]
};
```

### 3.2 启动服务并设置开机自启

```bash
# 创建日志目录
mkdir -p /opt/subscription-manager/server/logs

# 使用PM2启动服务
cd /opt/subscription-manager/server
pm2 start ecosystem.config.js

# 保存PM2进程列表
pm2 save

# 设置PM2开机自启
pm2 startup

# 按照提示执行命令（通常是）
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u your_user --hp /home/your_user

# 验证服务状态
pm2 status
pm2 logs subscription-manager
```

---

## 阶段四：前端部署与OpenResty配置

### 4.1 前端静态文件部署

将前端构建的 `dist` 目录文件复制到OpenResty的html目录：

```bash
# 进入 www 目录
cd /vol1/@appdata/1Panel/1panel/apps/openresty/openresty/www

# 创建网站存放根目录
mkdir -p sites/sub-user/index
mkdir -p sites/sub-admin/index

# 复制用户端构建文件
sudo cp -r /opt/subscription-manager/client-user/dist/* /usr/local/openresty/html/user/

# 复制管理端构建文件
sudo cp -r /opt/subscription-manager/client-admin/dist/* /usr/local/openresty/html/admin/

# 设置权限
sudo chown -R www:www /usr/local/openresty/html/user
sudo chown -R www:www /usr/local/openresty/html/admin
```

### 4.2 通过1Panel配置OpenResty反向代理

1Panel中安装的OpenResty通过网站管理界面配置，无需手动编辑配置文件。

#### 4.2.1 配置用户端网站

1. 登录1Panel管理界面
2. 进入 **网站** → **网站** → **创建网站**
3. 选择 **反向代理** 类型
4. 填写配置：
   - **域名：** `你的域名.com`
   - **代理地址：** `http://127.0.0.1:30000`
   - **启用HTTPS：** 不需要（由Cloudflare Tunnel提供）

#### 4.2.2 配置管理端网站（局域网访问）

1. 在1Panel中创建第二个网站
2. 配置：
   - **域名：** `NAS局域网IP`（如 `192.168.1.100`）
   - **代理地址：** `http://127.0.0.1:30001`
   - **启用HTTPS：** 不需要

#### 4.2.3 高级Nginx配置

在1Panel网站设置中，找到 **配置文件** 或 **自定义配置**，添加以下优化配置：

**用户端网站配置：**

```nginx
# API请求代理到Node.js
location /api/ {
    proxy_pass http://127.0.0.1:30000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
    
    # 超时设置
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
}

# 健康检查接口
location /health {
    proxy_pass http://127.0.0.1:30000;
}

# 订阅链接接口
location /api/user/sub/ {
    proxy_pass http://127.0.0.1:30000;
}

# 前端静态文件
location / {
    root /usr/local/openresty/html/user;
    index index.html;
    try_files $uri $uri/ /index.html;
    
    # 静态资源缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 7d;
        add_header Cache-Control "public, no-transform";
    }
}
```

**管理端网站配置：**

```nginx
# API请求代理到Node.js
location /api/ {
    proxy_pass http://127.0.0.1:30001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
    
    # 超时设置
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
}

# 健康检查接口
location /health {
    proxy_pass http://127.0.0.1:30001;
}

# 前端静态文件
location / {
    root /usr/local/openresty/html/admin;
    index index.html;
    try_files $uri $uri/ /index.html;
    
    # 静态资源缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 7d;
        add_header Cache-Control "public, no-transform";
    }
}
```

### 4.3 测试OpenResty配置

```bash
# 通过1Panel重启OpenResty
# 或者命令行测试配置
sudo openresty -t

# 重启OpenResty
sudo systemctl restart openresty
```

---

## 阶段五：Cloudflare Tunnel配置

> **HTTPS说明：** Cloudflare Tunnel会自动为你的域名提供HTTPS证书，无需在NAS上配置SSL证书。用户通过HTTPS访问时，请求经过Cloudflare网络加密传输到你的NAS。

### 5.1 安装cloudflared

```bash
# 下载cloudflared
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb

# 安装
sudo dpkg -i cloudflared-linux-amd64.deb

# 登录Cloudflare
cloudflared tunnel login
```

### 5.2 创建并配置Tunnel

```bash
# 创建Tunnel
cloudflared tunnel create subscription-manager

# 配置Tunnel
nano ~/.cloudflared/config.yml
```

添加配置：

```yaml
tunnel: your-tunnel-id
credentials-file: /home/your_user/.cloudflared/your-tunnel-id.json

ingress:
  # 用户端域名 - 指向OpenResty（80端口）
  - hostname: 你的域名.com
    service: http://localhost:80
  
  # 管理端 - 不暴露到公网（仅局域网访问）
  # 如需外网访问，取消注释并配置Cloudflare Access
  # - hostname: admin.你的域名.com
  #   service: http://localhost:80
  
  # 兜底规则
  - service: http_status:404
```

### 5.3 配置DNS记录

```bash
# 添加DNS记录
cloudflared tunnel route dns subscription-manager 你的域名.com
```

### 5.4 启动Tunnel并设置开机自启

```bash
# 测试运行
cloudflared tunnel run subscription-manager

# 安装为系统服务
sudo cloudflared service install

# 启动服务
sudo systemctl start cloudflared
sudo systemctl enable cloudflared

# 验证状态
sudo systemctl status cloudflared
```

---

## 验证部署

### 检查服务状态

```bash
# 检查PM2状态
pm2 status

# 检查Node.js进程
ps aux | grep node

# 检查端口监听
netstat -tlnp | grep -E '30000|30001'

# 检查OpenResty状态
sudo systemctl status openresty

# 检查Cloudflare Tunnel状态
sudo systemctl status cloudflared
```

### 访问测试

1. **局域网测试：**
   - 用户端：`http://NAS局域网IP`（OpenResty监听80端口）
   - 管理端：`http://NAS局域网IP`（需要配置单独的域名或端口）

2. **外网测试：**
   - 用户端：`https://你的域名.com`（Cloudflare自动HTTPS）

3. **登录测试：**
   - 管理端：`admin` / `admin123`（首次登录后请立即修改密码）
   - 用户端：需要先注册账号

---

## 常用维护命令

### PM2进程管理

```bash
# 查看服务状态
pm2 status

# 查看日志
pm2 logs subscription-manager

# 查看实时日志（最后100行）
pm2 logs subscription-manager --lines 100

# 重启服务
pm2 restart subscription-manager

# 停止服务
pm2 stop subscription-manager

# 监控资源
pm2 monit
```

### PM2日志轮转管理

```bash
# 查看pm2-logrotate配置
pm2 conf

# 修改日志大小限制（例如改为50MB）
pm2 set pm2-logrotate:max_size 50M

# 修改保留文件数量（例如保留10个）
pm2 set pm2-logrotate:retain 10

# 手动触发日志轮转（测试用）
pm2 trigger pm2-logrotate rotate

# 查看pm2-logrotate日志
pm2 logs pm2-logrotate

# 重启pm2-logrotate模块
pm2 restart pm2-logrotate
```

### 数据库备份

```bash
# 备份数据库
pg_dump -U postgres subscription_manager > /opt/backup/db-$(date +%Y%m%d).sql

# 恢复数据库
psql -U postgres subscription_manager < /opt/backup/db-20260101.sql
```

### 日志查看

```bash
# 应用日志
tail -f /opt/subscription-manager/server/logs/app.log

# 错误日志
tail -f /opt/subscription-manager/server/logs/error.log

# OpenResty日志
tail -f /usr/local/openresty/nginx/logs/access.log
tail -f /usr/local/openresty/nginx/logs/error.log

# Cloudflare Tunnel日志
journalctl -u cloudflared -f
```

---

## 安全建议

1. **修改默认密码：** 首次登录后立即修改管理员密码
2. **修改JWT密钥：** 使用随机生成的强密码（至少32位）
3. **配置防火墙：** 只开放必要端口（80、443）
4. **定期备份：** 备份数据库和配置文件
5. **更新系统：** 定期更新NAS系统和Node.js
6. **限制管理端访问：** 仅允许局域网IP访问管理端
7. **HTTPS由Cloudflare提供：** 无需在NAS上配置SSL证书

---

## 常见问题

### Q: PM2启动失败怎么办？

```bash
# 查看详细错误日志
pm2 logs subscription-manager --err

# 检查Node.js版本
node --version

# 检查依赖是否安装完整
cd /opt/subscription-manager/server
npm install --production
```

### Q: 数据库连接失败？

```bash
# 检查PostgreSQL状态
sudo systemctl status postgresql

# 检查数据库是否存在
psql -U postgres -l

# 检查配置文件中的数据库连接信息
cat /opt/subscription-manager/server/config.js
```

### Q: OpenResty配置测试失败？

```bash
# 查看详细错误
sudo /usr/local/openresty/bin/openresty -t

# 检查配置文件语法
sudo nginx -t

# 查看错误日志
tail -f /usr/local/openresty/nginx/logs/error.log
```

### Q: Cloudflare Tunnel断开连接？

```bash
# 检查状态
sudo systemctl status cloudflared

# 重启服务
sudo systemctl restart cloudflared

# 查看日志
journalctl -u cloudflared --since "1 hour ago"
```

### Q: 如何更新项目？

```bash
# 停止服务
pm2 stop subscription-manager

# 备份当前版本
cp -r /opt/subscription-manager /opt/backup/subscription-manager-$(date +%Y%m%d)

# 上传新版本文件
# ...

# 安装依赖
cd /opt/subscription-manager/server
npm install --production

# 重新构建前端
cd /opt/subscription-manager/client-user
npm run build

cd /opt/subscription-manager/client-admin
npm run build

# 重启服务
pm2 restart subscription-manager
```

### Q: 如何修改端口？

编辑 `server/ecosystem.config.js`，修改 `USER_PORT` 和 `ADMIN_PORT` 环境变量，然后重启服务：

```bash
pm2 restart subscription-manager
```

同时更新OpenResty配置中的端口。

---

## 参考链接

| 资源 | 地址 |
|------|------|
| Node.js | https://nodejs.org/ |
| PM2 | https://pm2.keymetrics.io/ |
| OpenResty | https://openresty.org/ |
| Cloudflare Tunnel | https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/ |
| PostgreSQL | https://www.postgresql.org/ |
