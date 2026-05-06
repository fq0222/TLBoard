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

## 项目开发经验

### PostgreSQL 字段添加

添加新字段时，`ALTER TABLE` 语句不能使用 `prepare().run()`（会自动添加 `RETURNING id`），需使用 `exec()` 方法：
```javascript
// 正确
await db.exec('ALTER TABLE users ADD COLUMN traffic_used_at BIGINT');

// 错误 - 会报 syntax error
await db.prepare('ALTER TABLE users ADD COLUMN traffic_used_at BIGINT').run();
```

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
