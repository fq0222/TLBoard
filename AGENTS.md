# 项目指令与协作规范

> 使用简体中文回答所有问题

## 项目概述

机场面板订阅管理系统，包含三个独立包（无根 package.json）：
- `server/` - Node.js Express 后端 + PostgreSQL
- `client-user/` - Vue 3 + Vite 用户端
- `client-admin/` - Vue 3 + Vite 管理端

## 关键命令

### 后端 (server/)
```bash
npm run dev          # 开发模式（nodemon）
npm run dev:all      # 同时启动用户端(30000)和管理端(30001)
npm run init-db      # 初始化数据库表结构
node test/xxx.js     # 运行测试脚本
```

### 前端 (client-user/ 或 client-admin/)
```bash
npm run dev          # 开发服务器
npm run build        # 生产构建（需要 terser）
npx vite build --minify esbuild  # 绕过 terser 的构建方式
```

## 测试账号

| 用途 | 账号 | 密码 |
|------|------|------|
| 用户端 | `fuqiang_2015@163.com` | `fuqiang2015` |
| 管理端 | `admin` | `admin123` |

*需要测试时主动询问用户，不要猜测密码*

## 工作流规范

### 代码提交
1. 可以 `git commit` 提交本地更改
2. `git push` 前**必须**展示变更并获得用户同意
3. **commit 信息必须使用中文书写**

### 验证要求
- 后端修改：运行 `server/test/` 下的脚本验证
- 前端修改：执行构建确保无错误
- 完成时**必须**展示测试日志

### 服务器重启
修改 `server/**/*.js` 后提醒用户重启服务器，**不要自行启动**

## 架构要点

### 双 Express 应用
- `app.js` 统一启动入口，同时运行用户端和管理端
- 用户端端口：30000，管理端端口：30001
- 共享 PostgreSQL 数据库实例

### API 路径
- 用户端：`/api/user/*`
- 管理端：`/api/admin/*`

### Service 层
- `services/order-service.js` - 订单处理
- `services/vmq-service.js` - VMQ 支付
- `services/xui-service.js` - 3X-UI 服务器交互
- `services/xui-sync.js` - 节点信息同步工具
- `services/traffic-manager.js` - 流量统计与自动禁用管理

## 关键配置

### ecosystem.config.js (PM2)
- 生产环境启动配置
- **禁止写入真实敏感信息**，此文件需提交至 GitHub

### config.js (本地开发)
- **允许写入真实数据**，严禁提交至远程仓库
- 包含数据库连接、JWT 密钥等

## 3X-UI API 注意事项

3X-UI API 返回字段使用**驼峰命名**，不是下划线命名：

| 正确（驼峰） | 错误（下划线） |
|--------------|----------------|
| `streamSettings` | `stream_settings` |
| `clientStats` | `client_stats` |
| `expiryTime` | `expiry_time` |
| `totalGB` | `total_gb` |
| `limitIp` | `limit_ip` |
| `subId` | `sub_id` |

## 订阅链接格式

- **通用订阅** `/api/user/sub/:token` - Base64 编码的 v2ray 链接
- **Clash 订阅** `/api/user/sub/:token?clash=1` - YAML 配置

两种格式不通用，Clash 客户端必须使用 Clash 链接

## Clash 配置要点

- 多个 CF 优选 IP 时，节点名需添加序号后缀（如 `节点名-1`、`节点名-2`）
- IPv6 地址**不能**包含方括号：`server: 2606:4700:4700::0`（不是 `[2606:4700:4700::0]`）

## 数据库字段类型

`traffic_used` 和 `traffic_limit` 可能是 `null`、`undefined` 或字符串，格式化时需处理：
```javascript
function formatTraffic(bytes) {
  if (bytes === null || bytes === undefined || bytes === '') return '0 B';
  const numBytes = Number(bytes);
  if (isNaN(numBytes) || numBytes === 0) return '0 B';
  // ... 格式化逻辑
}
```

## 安全防护

### 暴力破解防护

用户端登录和注册接口已实现基于 IP+邮箱组合的速率限制：

- **窗口时间**：15 分钟
- **最大尝试次数**：3 次失败尝试
- **响应格式**：HTTP 429 + Retry-After 头
- **存储方式**：内存存储（单实例部署）

**配置文件：**
- `server/middleware/rate-limiter.js` - 速率限制中间件
- `config.security.rateLimitWindow` - 窗口时间（毫秒）
- `config.security.rateLimitMax` - 最大尝试次数

**环境变量：**
```bash
RATE_LIMIT_WINDOW=900000  # 15分钟
RATE_LIMIT_MAX=3          # 最大尝试次数
```

**测试脚本：**
```bash
node server/test/test-rate-limiter.js
```

### 多台 3X-UI 服务器 UUID 同步问题

**问题**：多台 3X-UI 服务器时，订阅链接返回的 UUID 不一致，导致某些节点不可用。

**根因**：
- `xui_nodes` 表的 `settings` 字段存储的是同步时的快照
- 新用户支付完成后，`syncUserToXuiServers()` 会将用户添加到 3X-UI，但不会更新 `xui_nodes` 表
- 订阅时从 `xui_nodes.settings` 中查找用户 UUID，找不到时会返回错误的 UUID（第一个客户端的 UUID）

**解决方案**：
- 创建 `server/services/xui-sync.js` 工具函数
- 新增 `POST /api/user/subscription/generate` 接口
- 用户点击"生成订阅链接"时，先同步所有服务器的节点信息，再返回订阅链接
- 同步操作不放在每次访问订阅接口时执行，避免影响访问速度

**关键代码**：
- `server/services/xui-sync.js` - 同步工具函数
- `server/routes/user/subscription.js` - `/generate` 接口
- `client-user/src/api/index.js` - `generateSubscription()` 方法
- `client-user/src/views/user/Profile.vue` - 生成按钮调用新接口+loading

### PostgreSQL 事务使用

**问题**：`db.prepare().run()` 使用连接池的默认连接，不在事务中。

**解决方案**：需要使用 `db.pool.connect()` 获取专用连接，在事务中执行所有操作：

```javascript
const client = await db.pool.connect()
try {
  await client.query('BEGIN')
  // 所有查询和写入使用 client.query()
  await client.query('COMMIT')
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
}
```

**注意**：`db` 代理对象已暴露 `pool` 属性，可以直接使用 `db.pool.connect()`。

### Element Plus 组件注意事项

- `el-switch` 组件需要布尔值，数据库返回的 `0/1` 整数需用 `!!` 转换：
```javascript
announcementForm.pinned = !!announcement.pinned
announcementForm.enabled = !!announcement.enabled
```

- `ElMessageBox.confirm` 默认按钮是英文，需手动设置中文：
```javascript
await ElMessageBox.confirm('确定删除？', '提示', {
  confirmButtonText: '确定',
  cancelButtonText: '取消'
})
```

### Markdown 渲染

前端使用 `marked` 库渲染 Markdown 内容：
```javascript
import { marked } from 'marked'

const renderedHtml = marked(markdownContent)
```

### 分页组件

使用 `el-pagination` 组件实现分页：
```vue
<el-pagination
  v-model:current-page="currentPage"
  :page-size="pageSize"
  :total="total"
  layout="prev, pager, next"
  @current-change="handlePageChange"
/>
```

## VMQ 支付回调

回调地址**不能**使用 `127.0.0.1`（VMQ 和后端可能在不同设备），需使用局域网 IP 或公网域名：
```
http://192.168.31.100:30000/api/user/payment/notify
```

## 续费功能

- 订单号前缀：续费 `REN`，新购 `ORD`
- 流量累加：`新总流量 = 当前套餐流量 + 新套餐流量`
- 3X-UI 同步：使用 `updateClient` 更新已存在用户
- `traffic_limit` 可能是字符串，运算前用 `Number()` 转换
- **续费规则**：
  - 续费当前套餐：流量用完后 3 天内可续费，不管套餐是否售罄
  - 切换其他套餐：需要检查新套餐是否售罄
  - 超过 3 天：需等待名额释放后重新购买

## 套餐可销售总量

- `sales_limit`：可销售总量，`-1` 表示不限制
- `sales_count`：已售数量
- 售罄检查：注册时检查，续费切换套餐时检查
- 名额释放：流量用完超过 3 天未续费，定时任务自动释放
- `traffic_used_at`：记录流量用完的时间戳

## 流量管理模块

### 功能概述

`server/services/traffic-manager.js` 负责流量统计、自动禁用和解除禁用：

- **流量统计**：汇总所有 3X-UI 服务器的用户流量（增量更新）
- **自动禁用**：流量达到套餐限额后自动禁用用户并同步到 3X-UI
- **自动解除禁用**：用户续费后自动解除禁用状态

### 核心函数

```javascript
// 主函数：同步流量并处理禁用
await trafficManager.syncTrafficAndHandleDisable(db)

// 子函数
await trafficManager.fetchAllServerTraffic(db)           // 获取所有服务器流量
await trafficManager.calculateUserTotalTraffic(db, data)  // 计算用户总流量
await trafficManager.updateTrafficInDatabase(db, data)    // 更新数据库
await trafficManager.checkAndDisableOverLimitUsers(db, data) // 检查并禁用超量用户
await trafficManager.syncDisableStatusToXui(db, userId, disable) // 同步禁用状态到 3X-UI
```

### 增量更新机制

使用 `traffic_sync_log` 表记录每个服务器上次同步的流量值：

1. 从所有服务器获取当前流量
2. 计算增量：`增量 = 本次流量 - 上次流量`
3. 累加到用户总流量：`新总流量 = 原有流量 + 增量`
4. 更新同步日志

### 数据库事务

流量计算使用 PostgreSQL 事务保护：

```javascript
const client = await db.pool.connect()
try {
  await client.query('BEGIN')
  // 所有查询和写入使用 client.query()
  await client.query('COMMIT')
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
}
```

**注意**：`db.prepare().run()` 使用连接池的默认连接，不在事务中。需要使用 `db.pool.connect()` 获取专用连接。

### 定时任务

流量同步任务每 1 小时执行一次（首次延迟 10 分钟）：

```javascript
// server/jobs/index.js
const trafficManager = require('../services/traffic-manager')

function registerTrafficSyncJob(db) {
  setTimeout(async () => {
    await trafficManager.syncTrafficAndHandleDisable(db)
  }, 10 * 60 * 1000)

  setInterval(async () => {
    await trafficManager.syncTrafficAndHandleDisable(db)
  }, 60 * 60 * 1000) // 每1小时
}
```

### 测试脚本

```bash
node server/test/test-traffic-manager.js
```

## 数据库连接优化

### 连接池配置

PostgreSQL 连接池已优化，防止空闲连接超时断开：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `DB_POOL_MAX` | 20 | 最大连接数 |
| `DB_IDLE_TIMEOUT` | 60000 | 空闲超时（60秒） |
| `DB_CONNECT_TIMEOUT` | 5000 | 连接超时（5秒） |

**重试机制：**
- 查询失败自动重试 2 次
- 支持连接错误（ECONNRESET、57P01）自动恢复

**配置文件：**
- `server/config.js` - 开发环境配置
- `server/ecosystem.config.js` - 生产环境配置（PM2）
- `server/db/init.js` - 数据库初始化和连接池管理

## 文档同步

代码与 `docs/requirements.md`、`docs/api.md` 冲突时，以**代码测试通过的实际结果**为准。更新文档前需用户确认。

## 工单系统

### 功能概述
- 用户端：创建工单、查看列表和详情、回复工单、关闭工单
- 管理端：查看列表和详情、回复工单、关闭工单、删除工单
- 未读提示：用户端导航栏显示未读红点，工单列表显示未读标记
- 自动关闭：管理员回复且用户已读后 24 小时无回复自动关闭

### 文件结构
- `server/services/ticket-service.js` - 工单服务层
- `server/routes/user/tickets.js` - 用户端路由
- `server/routes/admin/tickets.js` - 管理端路由
- `client-user/src/views/user/Tickets.vue` - 用户工单列表
- `client-user/src/views/user/TicketDetail.vue` - 用户工单详情
- `client-user/src/views/user/CreateTicket.vue` - 创建工单
- `client-admin/src/views/Tickets.vue` - 管理工单列表
- `client-admin/src/views/TicketDetail.vue` - 管理工单详情

### 状态流转
- `open` → 待处理（用户创建）
- `pending` → 处理中（管理员回复）
- `closed` → 已关闭（手动关闭或自动关闭）

### 注意事项
- 删除工单会同时删除回复和已读记录
- 已读状态通过比较 `last_reply_at` 和 `last_read_at` 判断
- 定时任务每小时检查一次可自动关闭的工单

## 节点订阅策略

### 功能概述
- 每个用户在每个节点上有独立的 UUID 和 sub_id
- 通过节点备注（remark）判断策略类型：包含 "cf" 用 CF 策略，其他用 direct 策略
- CF 策略：替换地址、端口、host；direct 策略：不修改
- direct 节点同步到 3X-UI 时自动设置 `flow: 'xtls-rprx-vision'`

### 关键文件
- `server/services/subscription-strategy.js` - 策略解析和处理
- `server/services/order-service.js` - 购买/续费时同步用户到 3X-UI
- `server/services/xui-service.js` - 3X-UI API 交互（支持 flow 参数）
- `server/services/xui-sync.js` - 节点信息同步
- `server/jobs/index.js` - 定时任务（sub_id/flow 一致性检查）
- `server/routes/user/subscription.js` - 订阅生成和获取
- `server/db/migrations/` - 数据库迁移脚本

### 数据库表
- `user_node_configs` - 用户节点配置（`server_id` + `inbound_id` 关联，不依赖 xui_nodes 外键）
- `user_subscriptions` - 订阅缓存（`nodes_data` JSON 字段）
- `xui_servers.sub_url` - 服务器订阅地址

### sub_id 规则
- 格式：16 位十六进制（`crypto.randomBytes(8).toString('hex')`）
- 数据库为主，定时任务同步到 3X-UI
- 每个节点独立获取原始订阅（使用各自的 sub_id）

### 数据库迁移
- 迁移脚本：`server/db/migrations/001-node-subscription-strategy.js`
- 支持幂等运行，已迁移的步骤自动跳过
- 生产环境部署前需先运行迁移脚本

## 项目开发经验

### PostgreSQL 字段添加

添加新字段时，`ALTER TABLE` 语句不能使用 `prepare().run()`（会自动添加 `RETURNING id`），需使用 `exec()` 方法：
```javascript
// 正确
await db.exec('ALTER TABLE users ADD COLUMN traffic_used_at BIGINT');

// 错误 - 会报 syntax error
await db.prepare('ALTER TABLE users ADD COLUMN traffic_used_at BIGINT').run();
```
