# 工单系统设计文档

## 概述

为订阅管理系统添加工单功能，让用户在账号出现问题时可以联系管理员并说明问题。

## 需求总结

### 功能需求
1. 用户端：提交工单、查看工单列表、查看工单详情、回复工单、关闭工单
2. 管理端：查看工单列表、查看工单详情、回复工单、关闭工单、工单统计
3. 自动关闭：管理员回复且用户已读后24小时无回复，自动关闭工单
4. 通知机制：用户登录时提示未读工单数量

### 业务规则
- 工单状态：open（创建）→ pending（处理中）→ closed（已关闭）
- 状态流转：
  - 用户创建工单 → open
  - 管理员回复工单 → pending
  - 用户手动关闭 → closed
  - 管理员手动关闭 → closed
  - 24小时无回复自动关闭 → closed
- 工单支持多次回复，形成对话
- 回复字数限制：500字
- 标题字数限制：50字

### UI 设计
- 工单回复使用气泡样式，左右对齐
  - 用户回复：蓝色气泡（#e6f7ff），左对齐
  - 管理员回复：灰色气泡（#f5f5f5），右对齐
- 气泡样式：圆角矩形（5px）、轻微阴影、1px 实线边框
- 状态颜色：蓝色（创建）、橙色（处理中）、灰色（已关闭）

## 数据库设计

### 工单表 (tickets)

```sql
CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'open',
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
  updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
  closed_at BIGINT,
  last_reply_at BIGINT,
  last_read_at BIGINT,
  reply_count INTEGER DEFAULT 0
);
```

### 工单回复表 (ticket_replies)

```sql
CREATE TABLE IF NOT EXISTS ticket_replies (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL,
  user_id INTEGER,
  admin_id INTEGER,
  content TEXT NOT NULL,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
);
```

### 工单已读表 (ticket_reads)

```sql
CREATE TABLE IF NOT EXISTS ticket_reads (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  last_read_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
  UNIQUE(ticket_id, user_id)
);
```

### 索引设计

```sql
CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at);
CREATE INDEX IF NOT EXISTS idx_ticket_replies_ticket_id ON ticket_replies(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_replies_created_at ON ticket_replies(created_at);
CREATE INDEX IF NOT EXISTS idx_ticket_reads_ticket_id ON ticket_reads(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_reads_user_id ON ticket_reads(user_id);
```

## API 设计

### 用户端 API (`/api/user/tickets`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/user/tickets` | 获取工单列表（分页） |
| POST | `/api/user/tickets` | 创建工单 |
| GET | `/api/user/tickets/:id` | 获取工单详情（含回复） |
| POST | `/api/user/tickets/:id/replies` | 回复工单 |
| PUT | `/api/user/tickets/:id/close` | 关闭工单 |
| GET | `/api/user/tickets/unread-count` | 获取未读工单数量 |

### 管理端 API (`/api/admin/tickets`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/tickets` | 获取工单列表（分页、搜索） |
| GET | `/api/admin/tickets/stats` | 获取工单统计 |
| GET | `/api/admin/tickets/:id` | 获取工单详情（含回复） |
| POST | `/api/admin/tickets/:id/replies` | 回复工单 |
| PUT | `/api/admin/tickets/:id/close` | 关闭工单 |

### 请求/响应格式

**创建工单**：
```
POST /api/user/tickets
{
  "title": "无法连接服务器",
  "description": "今天早上开始无法连接到代理服务器"
}
```

**获取工单列表**：
```
GET /api/user/tickets?page=1&limit=10
```

**回复工单**：
```
POST /api/user/tickets/1/replies
{
  "content": "您好，请问是哪个节点无法连接？"
}
```

## 前端页面设计

### 用户端

**1. 工单列表页** (`/user/tickets`)
- 显示工单标题、状态、创建时间
- 状态颜色：蓝色(创建)、橙色(处理中)、灰色(已关闭)
- 分页显示，每页10条
- 右上角"创建工单"按钮

**2. 创建工单页** (`/user/tickets/create`)
- 标题输入框（50字限制）
- 描述输入框（500字限制）
- 提交按钮

**3. 工单详情页** (`/user/tickets/:id`)
- 顶部：工单标题、状态、创建时间
- 中部：回复历史（气泡样式，左右对齐）
- 底部：回复输入框 + 发送按钮
- 右上角：关闭工单按钮（仅 open/pending 状态显示）

### 管理端

**1. 工单列表页** (`/admin/tickets`)
- 搜索框：按关键词搜索工单标题
- 筛选：按状态筛选
- 列表显示：工单标题、用户邮箱、状态、创建时间
- 分页显示，每页10条
- 顶部统计卡片：待处理数量、处理中数量、今日新增

**2. 工单详情页** (`/admin/tickets/:id`)
- 顶部：工单标题、状态、用户邮箱、创建时间
- 中部：回复历史（气泡样式，左右对齐）
- 底部：回复输入框 + 发送按钮
- 右上角：关闭工单按钮（仅 open/pending 状态显示）

## 自动关闭机制

### 定时任务

每小时执行一次检查，关闭满足条件的工单。

### 关闭条件（同时满足）

1. 工单状态为 `pending`
2. 用户已读最后一条管理员回复
3. 用户已读后超过24小时无新回复

### 实现逻辑

```javascript
const ticketsToClose = await db.prepare(`
  SELECT id FROM tickets 
  WHERE status = 'pending' 
    AND last_read_at IS NOT NULL 
    AND last_read_at < EXTRACT(EPOCH FROM NOW()) - 86400
    AND last_reply_at <= last_read_at
`).all();

for (const ticket of ticketsToClose) {
  await db.prepare(`
    UPDATE tickets 
    SET status = 'closed', closed_at = EXTRACT(EPOCH FROM NOW()), updated_at = EXTRACT(EPOCH FROM NOW())
    WHERE id = ?
  `).run(ticket.id);
}
```

## 通知机制

### 用户端通知

用户登录时检查是否有未读的管理员回复，在页面顶部显示提示。

### 未读判断逻辑

```javascript
const unreadCount = await db.prepare(`
  SELECT COUNT(*) as count FROM tickets t
  WHERE t.user_id = ? 
    AND t.status IN ('open', 'pending')
    AND t.last_reply_at IS NOT NULL
    AND (t.last_read_at IS NULL OR t.last_reply_at > t.last_read_at)
`).get(userId);
```

## 技术实现

### 后端

- 路由：`server/routes/user/tickets.js`、`server/routes/admin/tickets.js`
- 服务层：`server/services/ticket-service.js`
- 定时任务：`server/jobs/ticket-auto-close.js`
- 认证中间件：复用现有的 `auth-user.js`、`auth-admin.js`

### 前端

- 用户端页面：`client-user/src/views/user/Tickets.vue`、`TicketDetail.vue`、`CreateTicket.vue`
- 管理端页面：`client-admin/src/views/admin/Tickets.vue`、`TicketDetail.vue`
- API 封装：在现有的 `api/index.js` 中添加工单相关接口
- 路由配置：在现有的 `router/index.js` 中添加工单路由
