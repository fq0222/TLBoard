# Brevo 邮件发送功能设计文档

> 创建日期：2026-05-12
> 状态：待实现

---

## 1. 需求概述

在管理端添加基于 Brevo 平台的邮件发送功能，包括：

1. **Brevo 配置管理** - 在系统设置页面配置 API Key、发件人信息
2. **邮件模板管理** - 支持创建、编辑、删除 HTML 邮件模板，支持变量替换
3. **邮件发送** - 支持群发（所有用户/禁用用户）、单发、多发，支持 HTML 预览
4. **群发任务队列** - 每天限额 200 封，断点续发，自动排队
5. **发送日志** - 完整记录每封邮件状态，支持清理过期日志
6. **用户端 API** - 预设场景触发（如发送教程、账单）

---

## 2. 技术选型

| 组件 | 技术 | 说明 |
|------|------|------|
| 邮件服务 | Brevo (GetBrevo) | npm install @getbrevo/brevo |
| 后端 | Node.js + Express | 现有架构 |
| 前端 | Vue 3 + Element Plus | 现有架构 |
| 数据库 | PostgreSQL | 现有架构 |

---

## 3. 数据库设计

### 3.1 `system_settings` 表（系统配置）

```sql
CREATE TABLE system_settings (
  key VARCHAR(50) PRIMARY KEY,
  value TEXT,
  updated_at BIGINT
);
```

存储内容：

| key | value 示例 | 说明 |
|-----|-----------|------|
| `brevo_api_key` | `xkeysib-xxx...` | Brevo API Key |
| `brevo_sender_email` | `noreply@example.com` | 发件人邮箱 |
| `brevo_sender_name` | `机场面板` | 发件人名称 |

### 3.2 `email_templates` 表（邮件模板）

```sql
CREATE TABLE email_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  variables TEXT,
  created_at BIGINT,
  updated_at BIGINT
);
```

字段说明：

| 字段 | 类型 | 说明 |
|------|------|------|
| name | VARCHAR(100) | 模板名称 |
| subject | VARCHAR(200) | 邮件主题，支持变量 |
| content | TEXT | HTML 邮件内容 |
| variables | TEXT | JSON 数组，可用变量列表 |

### 3.3 `email_campaigns` 表（群发任务）

```sql
CREATE TABLE email_campaigns (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100),
  template_id INT,
  subject VARCHAR(200),
  content TEXT,
  target_type VARCHAR(20),
  target_users TEXT,
  total_count INT DEFAULT 0,
  sent_count INT DEFAULT 0,
  failed_count INT DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending',
  daily_limit INT DEFAULT 200,
  created_at BIGINT,
  updated_at BIGINT
);
```

字段说明：

| 字段 | 类型 | 说明 |
|------|------|------|
| name | VARCHAR(100) | 任务名称 |
| template_id | INT | 使用的模板 ID |
| subject | VARCHAR(200) | 邮件主题 |
| content | TEXT | 邮件内容（快照） |
| target_type | VARCHAR(20) | 目标类型：all / disabled / custom |
| target_users | TEXT | custom 时存储用户 ID JSON 数组 |
| total_count | INT | 总发送数量 |
| sent_count | INT | 已发送数量 |
| failed_count | INT | 失败数量 |
| status | VARCHAR(20) | 状态：pending / sending / completed / paused |
| daily_limit | INT | 每日发送限额，默认 200 |

### 3.4 `email_logs` 表（发送日志）

```sql
CREATE TABLE email_logs (
  id SERIAL PRIMARY KEY,
  campaign_id INT,
  user_id INT,
  email VARCHAR(200),
  subject VARCHAR(200),
  status VARCHAR(20),
  error_message TEXT,
  sent_at BIGINT,
  created_at BIGINT
);
```

字段说明：

| 字段 | 类型 | 说明 |
|------|------|------|
| campaign_id | INT | 关联的群发任务 ID，单发时为 null |
| user_id | INT | 收件用户 ID |
| email | VARCHAR(200) | 收件邮箱 |
| subject | VARCHAR(200) | 邮件主题 |
| status | VARCHAR(20) | 状态：pending / sent / failed |
| error_message | TEXT | 失败原因 |
| sent_at | BIGINT | 发送时间戳 |

---

## 4. API 接口设计

### 4.1 管理端接口（`/api/admin`）

#### 系统配置

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/email/config` | 获取 Brevo 配置 |
| PUT | `/email/config` | 更新 Brevo 配置 |
| POST | `/email/test` | 发送测试邮件 |

#### 邮件模板

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/email/templates` | 模板列表 |
| POST | `/email/templates` | 创建模板 |
| PUT | `/email/templates/:id` | 编辑模板 |
| DELETE | `/email/templates/:id` | 删除模板 |
| GET | `/email/templates/:id/preview` | 预览模板（传入变量值） |

#### 邮件发送

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/email/send` | 发送单封邮件 |
| POST | `/email/campaigns` | 创建群发任务 |
| GET | `/email/campaigns` | 群发任务列表 |
| GET | `/email/campaigns/:id` | 群发任务详情 |
| POST | `/email/campaigns/:id/pause` | 暂停群发任务 |
| POST | `/email/campaigns/:id/resume` | 恢复群发任务 |
| DELETE | `/email/campaigns/:id` | 删除群发任务 |
| GET | `/email/campaigns/:id/logs` | 查看发送日志 |

#### 日志管理

| 方法 | 路径 | 说明 |
|------|------|------|
| DELETE | `/email/logs/:id` | 删除单条日志 |
| DELETE | `/email/logs/batch` | 批量删除日志 |
| DELETE | `/email/logs/clear` | 清空过期日志 |

#### 用户查询

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/email/users/search` | 搜索用户（按邮箱） |

### 4.2 用户端接口（`/api/user`）

#### 预设场景触发

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/email/send-tutorial` | 发送教程邮件 |
| POST | `/email/send-invoice` | 发送账单邮件 |

请求体：

```json
{
  "template_id": 1,
  "variables": {
    "custom_var": "value"
  }
}
```

说明：
- 用户端只能调用预设模板（白名单机制）
- `user_id` 从 JWT Token 中获取
- 后端自动填充用户信息变量（`username`、`email`、`plan_name` 等）

---

## 5. 后端服务设计

### 5.1 文件结构

| 文件路径 | 说明 |
|---------|------|
| `server/services/email-service.js` | 邮件发送核心服务 |
| `server/routes/admin/email.js` | 管理端邮件路由 |
| `server/routes/user/email.js` | 用户端邮件路由 |
| `server/jobs/email-campaign.js` | 群发任务定时处理 |

### 5.2 `email-service.js` 核心方法

```javascript
class EmailService {
  // 初始化 Brevo 客户端
  async initClient(db)

  // 发送单封邮件
  async sendEmail(db, { to, subject, content })

  // 发送测试邮件
  async sendTestEmail(db, { to })

  // 处理群发任务（定时任务调用）
  async processCampaign(db, campaignId)

  // 清理过期日志
  async cleanLogs(db, beforeDays)
}
```

### 5.3 群发任务处理流程

```
定时任务触发（每 10 分钟）
    │
    ▼
查询状态为 pending/sending 的任务
    │
    ▼
检查今日已发送数量（email_logs）
    │
    ├─ 已达 200 → 跳过，等待明天
    │
    ▼
获取待发送用户列表
    │
    ▼
逐个发送邮件
    │
    ├─ 成功 → 记录日志，sent_count++
    ├─ 失败 → 记录日志，failed_count++
    │
    ▼
更新任务状态
    ├─ 全部发送完 → status = completed
    └─ 未完成 → status = pending，等待明天
```

### 5.4 定时任务

| 任务名称 | Cron 表达式 | 执行时间 | 说明 |
|---------|------------|---------|------|
| 处理群发任务 | `0 9 * * *` | 每天 9:00 | 处理待发送的群发任务，每次最多 200 封 |
| 清理邮件日志 | `0 3 * * *` | 每天 3:00 | 删除 30 天前的日志 |

### 5.5 用户端 API 限制

```javascript
// 预设模板白名单
const ALLOWED_TEMPLATES = {
  'send-tutorial': 1,    // 模板 ID
  'send-invoice': 2
};

// 用户只能调用白名单内的模板
// 自动填充用户信息变量（username, email, plan_name 等）
```

---

## 6. 前端页面设计

### 6.1 系统设置页面（扩展现有 `Settings.vue`）

新增"邮件配置"Tab 页：

- API Key 输入框（密码类型）
- 发件人邮箱输入框
- 发件人名称输入框
- 保存按钮
- 发送测试邮件按钮

### 6.2 邮件模板管理页面（新建 `EmailTemplates.vue`）

路径：`/admin/email-templates`

功能：
- 模板列表（表格形式）
- 新增模板弹窗
- 编辑模板弹窗（含 HTML 编辑器、变量提示）
- 删除确认
- 预览功能

### 6.3 邮件发送页面（新建 `EmailSender.vue`）

路径：`/admin/email-sender`

功能：
- 选择模板下拉框
- 收件人选择（所有用户 / 禁用用户 / 自定义）
- 自定义模式：搜索用户、添加/移除收件人
- 邮件主题编辑
- 模板变量编辑
- HTML 内容编辑
- 预览邮件弹窗
- 发送按钮

### 6.4 群发任务管理页面（新建 `EmailCampaigns.vue`）

路径：`/admin/email-campaigns`

功能：
- 任务列表（表格形式）
- 新建任务（复用邮件发送页面逻辑）
- 查看任务详情弹窗
- 发送日志列表
- 暂停/恢复任务
- 删除任务

### 6.5 导航菜单

在管理端侧边栏新增"邮件管理"分组：

```
├─ 邮件管理
│  ├─ 发送邮件        /admin/email-sender
│  ├─ 群发任务        /admin/email-campaigns
│  └─ 邮件模板        /admin/email-templates
```

---

## 7. 模板变量

### 7.1 用户信息变量

| 变量名 | 说明 | 示例值 |
|--------|------|--------|
| `{{username}}` | 用户邮箱前缀 | `fuqiang` |
| `{{email}}` | 用户邮箱 | `fuqiang@example.com` |
| `{{user_id}}` | 用户 ID | `123` |

### 7.2 订阅信息变量

| 变量名 | 说明 | 示例值 |
|--------|------|--------|
| `{{plan_name}}` | 套餐名称 | `基础套餐` |
| `{{expire_date}}` | 到期时间 | `2026/6/12` |
| `{{traffic_used}}` | 已用流量 | `1.5 GB` |
| `{{traffic_limit}}` | 流量上限 | `100 GB` |

---

## 8. 错误处理

### 8.1 错误码

| 错误码 | 说明 |
|--------|------|
| 6001 | Brevo 配置未设置 |
| 6002 | Brevo API Key 无效 |
| 6003 | 模板不存在 |
| 6004 | 群发任务不存在 |
| 6005 | 群发任务状态不允许操作 |
| 6006 | 今日发送限额已达 |
| 6007 | 收件人列表为空 |

### 8.2 Brevo API 错误处理

- 网络超时：重试 3 次
- API 限流：等待后重试
- 无效邮箱：记录失败日志，继续发送

---

## 9. 安全考虑

- API Key 在前端显示为密码类型，不可明文展示
- 用户端 API 使用白名单机制，只能调用预设模板
- 日志定期清理，避免数据堆积
- 群发任务每日限额，避免触发 Brevo 限制
