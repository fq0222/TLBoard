# Brevo 邮件发送功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在管理端添加基于 Brevo 平台的邮件发送功能，支持配置管理、模板管理、群发任务、发送日志和用户端 API。

**Architecture:** 使用数据库存储配置和模板，新增 email-service.js 服务层处理邮件发送，管理端新增 3 个页面（邮件发送、群发任务、邮件模板），扩展现有 Settings 页面添加邮件配置。定时任务每天 9 点处理群发队列，每天 3 点清理过期日志。

**Tech Stack:** Node.js, Express, PostgreSQL, Vue 3, Element Plus, Brevo API (@getbrevo/brevo)

---

## 文件结构

### 新增文件

| 文件路径 | 说明 |
|---------|------|
| `server/services/email-service.js` | 邮件发送核心服务 |
| `server/routes/admin/email.js` | 管理端邮件路由 |
| `server/routes/user/email.js` | 用户端邮件路由 |
| `server/jobs/email-campaign.js` | 群发任务定时处理 |
| `client-admin/src/views/EmailTemplates.vue` | 邮件模板管理页面 |
| `client-admin/src/views/EmailSender.vue` | 邮件发送页面 |
| `client-admin/src/views/EmailCampaigns.vue` | 群发任务管理页面 |

### 修改文件

| 文件路径 | 说明 |
|---------|------|
| `server/db/init.js` | 添加 4 个新表 |
| `server/app-admin.js` | 注册邮件路由 |
| `server/app-user.js` | 注册用户端邮件路由 |
| `server/jobs/index.js` | 注册定时任务 |
| `client-admin/src/router/index.js` | 添加邮件管理路由 |
| `client-admin/src/api/index.js` | 添加邮件 API 方法 |
| `client-admin/src/views/Settings.vue` | 添加邮件配置 Tab |
| `client-admin/src/views/Layout.vue` | 添加邮件管理菜单 |

---

## Task 1: 安装依赖

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: 安装 Brevo SDK**

Run: `cd server && npm install @getbrevo/brevo`

- [ ] **Step 2: 验证安装**

Run: `cd server && node -e "const brevo = require('@getbrevo/brevo'); console.log('Brevo SDK installed:', !!brevo)"`

Expected: `Brevo SDK installed: true`

---

## Task 2: 创建数据库表

**Files:**
- Modify: `server/db/init.js`

- [ ] **Step 1: 在 initTables 函数中添加 4 个新表**

在 `server/db/init.js` 的 `initTables` 函数末尾添加：

```javascript
// 系统配置表
await client.query(`
  CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(50) PRIMARY KEY,
    value TEXT,
    updated_at BIGINT
  )
`)

// 邮件模板表
await client.query(`
  CREATE TABLE IF NOT EXISTS email_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    subject VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    variables TEXT,
    created_at BIGINT,
    updated_at BIGINT
  )
`)

// 群发任务表
await client.query(`
  CREATE TABLE IF NOT EXISTS email_campaigns (
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
  )
`)

// 邮件日志表
await client.query(`
  CREATE TABLE IF NOT EXISTS email_logs (
    id SERIAL PRIMARY KEY,
    campaign_id INT,
    user_id INT,
    email VARCHAR(200),
    subject VARCHAR(200),
    status VARCHAR(20),
    error_message TEXT,
    sent_at BIGINT,
    created_at BIGINT
  )
`)
```

- [ ] **Step 2: 运行数据库初始化**

Run: `cd server && npm run init-db`

Expected: 表创建成功，无错误

- [ ] **Step 3: 验证表已创建**

Run: `cd server && node -e "const db = require('./db/init'); db.init().then(() => db.query(\"SELECT table_name FROM information_schema.tables WHERE table_name IN ('system_settings', 'email_templates', 'email_campaigns', 'email_logs')\")).then(r => { console.log('Tables created:', r.rows.map(r => r.table_name)); process.exit(0); })"`

Expected: `Tables created: [ 'system_settings', 'email_templates', 'email_campaigns', 'email_logs' ]`

- [ ] **Step 4: 提交**

```bash
git add server/db/init.js
git commit -m "feat: 添加邮件系统数据库表"
```

---

## Task 3: 创建邮件服务

**Files:**
- Create: `server/services/email-service.js`

- [ ] **Step 1: 创建邮件服务基础结构**

```javascript
const brevo = require('@getbrevo/brevo')

class EmailService {
  constructor() {
    this.apiInstance = null
  }

  async getConfig(db) {
    const result = await db.query(
      "SELECT key, value FROM system_settings WHERE key LIKE 'brevo_%'"
    )
    const config = {}
    result.rows.forEach(row => {
      config[row.key] = row.value
    })
    return config
  }

  async saveConfig(db, config) {
    const now = Math.floor(Date.now() / 1000)
    for (const [key, value] of Object.entries(config)) {
      await db.query(
        `INSERT INTO system_settings (key, value, updated_at) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3`,
        [key, value, now]
      )
    }
  }

  async initClient(db) {
    const config = await this.getConfig(db)
    if (!config.brevo_api_key) {
      throw new Error('Brevo API Key 未配置')
    }

    const defaultClient = brevo.ApiClient.instance
    const apiKey = defaultClient.authentications['api-key']
    apiKey.apiKey = config.brevo_api_key
    this.apiInstance = new brevo.TransactionalEmailsApi()

    return {
      senderEmail: config.brevo_sender_email,
      senderName: config.brevo_sender_name
    }
  }

  async sendEmail(db, { to, subject, content, senderEmail, senderName }) {
    const config = await this.getConfig(db)
    const sendSmtpEmail = new brevo.SendSmtpEmail()

    sendSmtpEmail.subject = subject
    sendSmtpEmail.htmlContent = content
    sendSmtpEmail.sender = {
      email: senderEmail || config.brevo_sender_email,
      name: senderName || config.brevo_sender_name
    }
    sendSmtpEmail.to = [{ email: to }]

    try {
      const result = await this.apiInstance.sendTransacEmail(sendSmtpEmail)
      return { success: true, messageId: result.messageId }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  async sendTestEmail(db, { to }) {
    await this.initClient(db)
    const subject = '测试邮件 - 机场面板'
    const content = '<h1>测试邮件</h1><p>这是一封测试邮件，用于验证 Brevo 配置是否正确。</p>'
    return await this.sendEmail(db, { to, subject, content })
  }

  replaceVariables(content, variables) {
    let result = content
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
    }
    return result
  }

  async getUserVariables(db, userId) {
    const result = await db.query(
      `SELECT u.email, u.plan_id, u.traffic_used, u.traffic_limit, u.expire_at,
              p.name as plan_name
       FROM users u
       LEFT JOIN plans p ON u.plan_id = p.id
       WHERE u.id = $1`,
      [userId]
    )
    const user = result.rows[0]
    if (!user) return null

    const username = user.email.split('@')[0]
    const formatTraffic = (bytes) => {
      if (!bytes || bytes === 0) return '0 B'
      const gb = bytes / (1024 * 1024 * 1024)
      return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    }

    return {
      username,
      email: user.email,
      user_id: userId.toString(),
      plan_name: user.plan_name || '无套餐',
      expire_date: user.expire_at ? new Date(user.expire_at * 1000).toLocaleDateString('zh-CN') : '无限期',
      traffic_used: formatTraffic(user.traffic_used),
      traffic_limit: formatTraffic(user.traffic_limit)
    }
  }
}

module.exports = new EmailService()
```

- [ ] **Step 2: 验证服务模块可加载**

Run: `cd server && node -e "const emailService = require('./services/email-service'); console.log('Email service loaded:', typeof emailService.sendEmail)"`

Expected: `Email service loaded: function`

- [ ] **Step 3: 提交**

```bash
git add server/services/email-service.js
git commit -m "feat: 创建邮件发送服务"
```

---

## Task 4: 创建管理端邮件路由

**Files:**
- Create: `server/routes/admin/email.js`
- Modify: `server/app-admin.js`

- [ ] **Step 1: 创建管理端邮件路由**

```javascript
const express = require('express')
const router = express.Router()
const emailService = require('../../services/email-service')

// 获取 Brevo 配置
router.get('/config', async (req, res) => {
  try {
    const config = await emailService.getConfig(req.db)
    res.json({
      code: 0,
      message: 'ok',
      data: {
        api_key: config.brevo_api_key || '',
        sender_email: config.brevo_sender_email || '',
        sender_name: config.brevo_sender_name || ''
      }
    })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 更新 Brevo 配置
router.put('/config', async (req, res) => {
  try {
    const { api_key, sender_email, sender_name } = req.body
    await emailService.saveConfig(req.db, {
      brevo_api_key: api_key,
      brevo_sender_email: sender_email,
      brevo_sender_name: sender_name
    })
    res.json({ code: 0, message: '配置已保存', data: null })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 发送测试邮件
router.post('/test', async (req, res) => {
  try {
    const { email } = req.body
    if (!email) {
      return res.json({ code: 1001, message: '请输入测试邮箱', data: null })
    }
    await emailService.initClient(req.db)
    const result = await emailService.sendTestEmail(req.db, { to: email })
    if (result.success) {
      res.json({ code: 0, message: '测试邮件已发送', data: null })
    } else {
      res.json({ code: 6002, message: '发送失败: ' + result.error, data: null })
    }
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 获取模板列表
router.get('/templates', async (req, res) => {
  try {
    const result = await req.db.query('SELECT * FROM email_templates ORDER BY id DESC')
    res.json({ code: 0, message: 'ok', data: result.rows })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 创建模板
router.post('/templates', async (req, res) => {
  try {
    const { name, subject, content, variables } = req.body
    if (!name || !subject || !content) {
      return res.json({ code: 1001, message: '请填写完整信息', data: null })
    }
    const now = Math.floor(Date.now() / 1000)
    const result = await req.db.query(
      `INSERT INTO email_templates (name, subject, content, variables, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, subject, content, JSON.stringify(variables || []), now, now]
    )
    res.json({ code: 0, message: '模板已创建', data: result.rows[0] })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 编辑模板
router.put('/templates/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { name, subject, content, variables } = req.body
    const now = Math.floor(Date.now() / 1000)
    const result = await req.db.query(
      `UPDATE email_templates SET name=$1, subject=$2, content=$3, variables=$4, updated_at=$5
       WHERE id=$6 RETURNING *`,
      [name, subject, content, JSON.stringify(variables || []), now, id]
    )
    if (result.rows.length === 0) {
      return res.json({ code: 6003, message: '模板不存在', data: null })
    }
    res.json({ code: 0, message: '模板已更新', data: result.rows[0] })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 删除模板
router.delete('/templates/:id', async (req, res) => {
  try {
    const { id } = req.params
    await req.db.query('DELETE FROM email_templates WHERE id = $1', [id])
    res.json({ code: 0, message: '模板已删除', data: null })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 预览模板
router.get('/templates/:id/preview', async (req, res) => {
  try {
    const { id } = req.params
    const { user_id } = req.query
    const result = await req.db.query('SELECT * FROM email_templates WHERE id = $1', [id])
    if (result.rows.length === 0) {
      return res.json({ code: 6003, message: '模板不存在', data: null })
    }
    const template = result.rows[0]
    let variables = {}
    if (user_id) {
      variables = await emailService.getUserVariables(req.db, user_id) || {}
    }
    const previewContent = emailService.replaceVariables(template.content, variables)
    const previewSubject = emailService.replaceVariables(template.subject, variables)
    res.json({
      code: 0,
      message: 'ok',
      data: { subject: previewSubject, content: previewContent }
    })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 发送单封邮件
router.post('/send', async (req, res) => {
  try {
    const { to, subject, content } = req.body
    if (!to || !subject || !content) {
      return res.json({ code: 1001, message: '请填写完整信息', data: null })
    }
    await emailService.initClient(req.db)
    const result = await emailService.sendEmail(req.db, { to, subject, content })
    if (result.success) {
      const now = Math.floor(Date.now() / 1000)
      await req.db.query(
        `INSERT INTO email_logs (email, subject, status, sent_at, created_at)
         VALUES ($1, $2, 'sent', $3, $4)`,
        [to, subject, now, now]
      )
      res.json({ code: 0, message: '邮件已发送', data: null })
    } else {
      res.json({ code: 500, message: '发送失败: ' + result.error, data: null })
    }
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 创建群发任务
router.post('/campaigns', async (req, res) => {
  try {
    const { name, template_id, target_type, target_users } = req.body
    if (!name || !template_id || !target_type) {
      return res.json({ code: 1001, message: '请填写完整信息', data: null })
    }

    // 获取模板
    const templateResult = await req.db.query('SELECT * FROM email_templates WHERE id = $1', [template_id])
    if (templateResult.rows.length === 0) {
      return res.json({ code: 6003, message: '模板不存在', data: null })
    }
    const template = templateResult.rows[0]

    // 获取目标用户
    let users
    if (target_type === 'all') {
      const result = await req.db.query('SELECT id, email FROM users WHERE enabled = true')
      users = result.rows
    } else if (target_type === 'disabled') {
      const result = await req.db.query('SELECT id, email FROM users WHERE enabled = false')
      users = result.rows
    } else {
      if (!target_users || target_users.length === 0) {
        return res.json({ code: 6007, message: '收件人列表为空', data: null })
      }
      const result = await req.db.query(
        'SELECT id, email FROM users WHERE id = ANY($1)',
        [target_users]
      )
      users = result.rows
    }

    const now = Math.floor(Date.now() / 1000)
    const result = await req.db.query(
      `INSERT INTO email_campaigns (name, template_id, subject, content, target_type, target_users, total_count, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9) RETURNING *`,
      [name, template_id, template.subject, template.content, target_type, JSON.stringify(users.map(u => u.id)), users.length, now, now]
    )

    res.json({ code: 0, message: '群发任务已创建', data: result.rows[0] })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 获取群发任务列表
router.get('/campaigns', async (req, res) => {
  try {
    const result = await req.db.query('SELECT * FROM email_campaigns ORDER BY id DESC')
    res.json({ code: 0, message: 'ok', data: result.rows })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 获取群发任务详情
router.get('/campaigns/:id', async (req, res) => {
  try {
    const { id } = req.params
    const result = await req.db.query('SELECT * FROM email_campaigns WHERE id = $1', [id])
    if (result.rows.length === 0) {
      return res.json({ code: 6004, message: '任务不存在', data: null })
    }
    res.json({ code: 0, message: 'ok', data: result.rows[0] })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 暂停群发任务
router.post('/campaigns/:id/pause', async (req, res) => {
  try {
    const { id } = req.params
    const result = await req.db.query(
      "UPDATE email_campaigns SET status = 'paused', updated_at = $1 WHERE id = $2 AND status IN ('pending', 'sending') RETURNING *",
      [Math.floor(Date.now() / 1000), id]
    )
    if (result.rows.length === 0) {
      return res.json({ code: 6005, message: '任务状态不允许暂停', data: null })
    }
    res.json({ code: 0, message: '任务已暂停', data: result.rows[0] })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 恢复群发任务
router.post('/campaigns/:id/resume', async (req, res) => {
  try {
    const { id } = req.params
    const result = await req.db.query(
      "UPDATE email_campaigns SET status = 'pending', updated_at = $1 WHERE id = $2 AND status = 'paused' RETURNING *",
      [Math.floor(Date.now() / 1000), id]
    )
    if (result.rows.length === 0) {
      return res.json({ code: 6005, message: '任务状态不允许恢复', data: null })
    }
    res.json({ code: 0, message: '任务已恢复', data: result.rows[0] })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 删除群发任务
router.delete('/campaigns/:id', async (req, res) => {
  try {
    const { id } = req.params
    await req.db.query('DELETE FROM email_logs WHERE campaign_id = $1', [id])
    await req.db.query('DELETE FROM email_campaigns WHERE id = $1', [id])
    res.json({ code: 0, message: '任务已删除', data: null })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 获取群发任务日志
router.get('/campaigns/:id/logs', async (req, res) => {
  try {
    const { id } = req.params
    const { page = 1, limit = 50 } = req.query
    const offset = (page - 1) * limit
    const result = await req.db.query(
      'SELECT * FROM email_logs WHERE campaign_id = $1 ORDER BY id DESC LIMIT $2 OFFSET $3',
      [id, limit, offset]
    )
    const countResult = await req.db.query(
      'SELECT COUNT(*) FROM email_logs WHERE campaign_id = $1',
      [id]
    )
    res.json({
      code: 0,
      message: 'ok',
      data: {
        list: result.rows,
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit)
      }
    })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 删除单条日志
router.delete('/logs/:id', async (req, res) => {
  try {
    const { id } = req.params
    await req.db.query('DELETE FROM email_logs WHERE id = $1', [id])
    res.json({ code: 0, message: '日志已删除', data: null })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 批量删除日志
router.delete('/logs/batch', async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || ids.length === 0) {
      return res.json({ code: 1001, message: '请选择要删除的日志', data: null })
    }
    await req.db.query('DELETE FROM email_logs WHERE id = ANY($1)', [ids])
    res.json({ code: 0, message: '日志已删除', data: null })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 清空过期日志
router.delete('/logs/clear', async (req, res) => {
  try {
    const { before_days = 30 } = req.body
    const beforeTime = Math.floor(Date.now() / 1000) - (before_days * 24 * 60 * 60)
    const result = await req.db.query(
      'DELETE FROM email_logs WHERE created_at < $1',
      [beforeTime]
    )
    res.json({ code: 0, message: `已删除 ${result.rowCount} 条日志`, data: null })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 搜索用户
router.get('/users/search', async (req, res) => {
  try {
    const { keyword } = req.query
    if (!keyword) {
      return res.json({ code: 0, message: 'ok', data: [] })
    }
    const result = await req.db.query(
      'SELECT id, email FROM users WHERE email ILIKE $1 LIMIT 20',
      [`%${keyword}%`]
    )
    res.json({ code: 0, message: 'ok', data: result.rows })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

module.exports = router
```

- [ ] **Step 2: 在 app-admin.js 中注册路由**

在 `server/app-admin.js` 中添加：

```javascript
const emailRoutes = require('./routes/admin/email')
// ... 在其他路由之后
app.use('/api/admin/email', emailRoutes)
```

- [ ] **Step 3: 验证路由可加载**

Run: `cd server && node -e "const router = require('./routes/admin/email'); console.log('Email routes loaded:', typeof router)"`

Expected: `Email routes loaded: function`

- [ ] **Step 4: 提交**

```bash
git add server/routes/admin/email.js server/app-admin.js
git commit -m "feat: 添加管理端邮件路由"
```

---

## Task 5: 创建用户端邮件路由

**Files:**
- Create: `server/routes/user/email.js`
- Modify: `server/app-user.js`

- [ ] **Step 1: 创建用户端邮件路由**

```javascript
const express = require('express')
const router = express.Router()
const emailService = require('../../services/email-service')

// 预设模板白名单
const ALLOWED_TEMPLATES = {
  'send-tutorial': 1,
  'send-invoice': 2
}

// 发送预设模板邮件
router.post('/:action', async (req, res) => {
  try {
    const { action } = req.params
    const { variables = {} } = req.body
    const userId = req.user.id

    // 检查白名单
    const templateId = ALLOWED_TEMPLATES[action]
    if (!templateId) {
      return res.json({ code: 1004, message: '不允许的操作', data: null })
    }

    // 获取模板
    const templateResult = await req.db.query('SELECT * FROM email_templates WHERE id = $1', [templateId])
    if (templateResult.rows.length === 0) {
      return res.json({ code: 6003, message: '模板不存在', data: null })
    }
    const template = templateResult.rows[0]

    // 获取用户信息变量
    const userVariables = await emailService.getUserVariables(req.db, userId)
    if (!userVariables) {
      return res.json({ code: 2004, message: '用户不存在', data: null })
    }

    // 合并变量
    const allVariables = { ...userVariables, ...variables }

    // 替换变量
    const subject = emailService.replaceVariables(template.subject, allVariables)
    const content = emailService.replaceVariables(template.content, allVariables)

    // 发送邮件
    await emailService.initClient(req.db)
    const result = await emailService.sendEmail(req.db, {
      to: userVariables.email,
      subject,
      content
    })

    if (result.success) {
      const now = Math.floor(Date.now() / 1000)
      await req.db.query(
        `INSERT INTO email_logs (user_id, email, subject, status, sent_at, created_at)
         VALUES ($1, $2, $3, 'sent', $4, $5)`,
        [userId, userVariables.email, subject, now, now]
      )
      res.json({ code: 0, message: '邮件已发送', data: null })
    } else {
      res.json({ code: 500, message: '发送失败: ' + result.error, data: null })
    }
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

module.exports = router
```

- [ ] **Step 2: 在 app-user.js 中注册路由**

在 `server/app-user.js` 中添加：

```javascript
const emailRoutes = require('./routes/user/email')
// ... 在其他路由之后
app.use('/api/user/email', emailRoutes)
```

- [ ] **Step 3: 提交**

```bash
git add server/routes/user/email.js server/app-user.js
git commit -m "feat: 添加用户端邮件路由"
```

---

## Task 6: 创建定时任务

**Files:**
- Create: `server/jobs/email-campaign.js`
- Modify: `server/jobs/index.js`

- [ ] **Step 1: 创建群发任务处理模块**

```javascript
const emailService = require('../services/email-service')

async function processCampaigns(db) {
  try {
    console.log('[邮件任务] 开始处理群发任务...')

    // 查询待处理的任务
    const campaignResult = await db.query(
      "SELECT * FROM email_campaigns WHERE status IN ('pending', 'sending') ORDER BY id"
    )

    if (campaignResult.rows.length === 0) {
      console.log('[邮件任务] 没有待处理的任务')
      return
    }

    // 检查今日已发送数量
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayTimestamp = Math.floor(today.getTime() / 1000)

    const todayCountResult = await db.query(
      'SELECT COUNT(*) FROM email_logs WHERE created_at >= $1',
      [todayTimestamp]
    )
    const todayCount = parseInt(todayCountResult.rows[0].count)

    if (todayCount >= 200) {
      console.log('[邮件任务] 今日已发送 200 封，跳过')
      return
    }

    const remainingQuota = 200 - todayCount
    console.log(`[邮件任务] 今日剩余配额: ${remainingQuota}`)

    // 初始化 Brevo 客户端
    await emailService.initClient(db)

    for (const campaign of campaignResult.rows) {
      await processCampaign(db, campaign, remainingQuota)
    }

    console.log('[邮件任务] 处理完成')
  } catch (error) {
    console.error('[邮件任务] 处理失败:', error)
  }
}

async function processCampaign(db, campaign, remainingQuota) {
  try {
    // 更新状态为 sending
    await db.query(
      "UPDATE email_campaigns SET status = 'sending', updated_at = $1 WHERE id = $2",
      [Math.floor(Date.now() / 1000), campaign.id]
    )

    // 获取待发送的用户列表
    const targetUserIds = JSON.parse(campaign.target_users || '[]')
    const sentUsersResult = await db.query(
      'SELECT user_id FROM email_logs WHERE campaign_id = $1 AND status = $2',
      [campaign.id, 'sent']
    )
    const sentUserIds = sentUsersResult.rows.map(r => r.user_id)
    const pendingUserIds = targetUserIds.filter(id => !sentUserIds.includes(id))

    if (pendingUserIds.length === 0) {
      await db.query(
        "UPDATE email_campaigns SET status = 'completed', updated_at = $1 WHERE id = $2",
        [Math.floor(Date.now() / 1000), campaign.id]
      )
      console.log(`[邮件任务] 任务 ${campaign.id} 已完成`)
      return
    }

    // 限制本次发送数量
    const sendCount = Math.min(pendingUserIds.length, remainingQuota)
    const usersToSend = pendingUserIds.slice(0, sendCount)

    // 获取用户信息
    const usersResult = await db.query(
      'SELECT id, email FROM users WHERE id = ANY($1)',
      [usersToSend]
    )
    const users = usersResult.rows

    let sentCount = 0
    let failedCount = 0

    for (const user of users) {
      try {
        // 获取用户变量
        const userVariables = await emailService.getUserVariables(db, user.id)
        if (!userVariables) {
          failedCount++
          await logEmail(db, campaign.id, user.id, user.email, campaign.subject, 'failed', '用户不存在')
          continue
        }

        // 替换变量
        const subject = emailService.replaceVariables(campaign.subject, userVariables)
        const content = emailService.replaceVariables(campaign.content, userVariables)

        // 发送邮件
        const result = await emailService.sendEmail(db, {
          to: user.email,
          subject,
          content
        })

        if (result.success) {
          sentCount++
          await logEmail(db, campaign.id, user.id, user.email, subject, 'sent', null)
        } else {
          failedCount++
          await logEmail(db, campaign.id, user.id, user.email, subject, 'failed', result.error)
        }
      } catch (error) {
        failedCount++
        await logEmail(db, campaign.id, user.id, user.email, campaign.subject, 'failed', error.message)
      }
    }

    // 更新任务统计
    const newSentCount = campaign.sent_count + sentCount
    const newFailedCount = campaign.failed_count + failedCount
    const isCompleted = (newSentCount + newFailedCount) >= campaign.total_count

    await db.query(
      `UPDATE email_campaigns 
       SET sent_count = $1, failed_count = $2, status = $3, updated_at = $4
       WHERE id = $5`,
      [newSentCount, newFailedCount, isCompleted ? 'completed' : 'pending', Math.floor(Date.now() / 1000), campaign.id]
    )

    console.log(`[邮件任务] 任务 ${campaign.id}: 发送 ${sentCount}, 失败 ${failedCount}`)
  } catch (error) {
    console.error(`[邮件任务] 任务 ${campaign.id} 处理失败:`, error)
    await db.query(
      "UPDATE email_campaigns SET status = 'pending', updated_at = $1 WHERE id = $2",
      [Math.floor(Date.now() / 1000), campaign.id]
    )
  }
}

async function logEmail(db, campaignId, userId, email, subject, status, errorMessage) {
  const now = Math.floor(Date.now() / 1000)
  await db.query(
    `INSERT INTO email_logs (campaign_id, user_id, email, subject, status, error_message, sent_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [campaignId, userId, email, subject, status, errorMessage, now, now]
  )
}

async function cleanLogs(db, beforeDays = 30) {
  try {
    const beforeTime = Math.floor(Date.now() / 1000) - (beforeDays * 24 * 60 * 60)
    const result = await db.query(
      'DELETE FROM email_logs WHERE created_at < $1',
      [beforeTime]
    )
    console.log(`[邮件任务] 已清理 ${result.rowCount} 条过期日志`)
  } catch (error) {
    console.error('[邮件任务] 清理日志失败:', error)
  }
}

module.exports = { processCampaigns, cleanLogs }
```

- [ ] **Step 2: 在 jobs/index.js 中注册定时任务**

在 `server/jobs/index.js` 中添加：

```javascript
const { processCampaigns, cleanLogs } = require('./email-campaign')

// 邮件群发任务 - 每天 9:00 执行
cron.schedule('0 9 * * *', async () => {
  console.log('[定时任务] 处理邮件群发任务')
  await processCampaigns(db)
})

// 清理邮件日志 - 每天 3:00 执行
cron.schedule('0 3 * * *', async () => {
  console.log('[定时任务] 清理邮件日志')
  await cleanLogs(db, 30)
})
```

注意：需要先安装 cron 依赖（如果还没有的话）：
```bash
npm install node-cron
```

- [ ] **Step 3: 提交**

```bash
git add server/jobs/email-campaign.js server/jobs/index.js
git commit -m "feat: 添加邮件群发定时任务"
```

---

## Task 7: 创建前端 API 方法

**Files:**
- Modify: `client-admin/src/api/index.js`

- [ ] **Step 1: 添加邮件相关 API 方法**

在 `client-admin/src/api/index.js` 中添加：

```javascript
// 邮件配置
export const getEmailConfig = () => request.get('/email/config')
export const updateEmailConfig = (data) => request.put('/email/config', data)
export const sendTestEmail = (data) => request.post('/email/test', data)

// 邮件模板
export const getEmailTemplates = () => request.get('/email/templates')
export const createEmailTemplate = (data) => request.post('/email/templates', data)
export const updateEmailTemplate = (id, data) => request.put(`/email/templates/${id}`, data)
export const deleteEmailTemplate = (id) => request.delete(`/email/templates/${id}`)
export const previewEmailTemplate = (id, params) => request.get(`/email/templates/${id}/preview`, { params })

// 邮件发送
export const sendEmail = (data) => request.post('/email/send', data)

// 群发任务
export const getEmailCampaigns = () => request.get('/email/campaigns')
export const getEmailCampaign = (id) => request.get(`/email/campaigns/${id}`)
export const createEmailCampaign = (data) => request.post('/email/campaigns', data)
export const pauseEmailCampaign = (id) => request.post(`/email/campaigns/${id}/pause`)
export const resumeEmailCampaign = (id) => request.post(`/email/campaigns/${id}/resume`)
export const deleteEmailCampaign = (id) => request.delete(`/email/campaigns/${id}`)
export const getEmailCampaignLogs = (id, params) => request.get(`/email/campaigns/${id}/logs`, { params })

// 邮件日志
export const deleteEmailLog = (id) => request.delete(`/email/logs/${id}`)
export const batchDeleteEmailLogs = (ids) => request.delete('/email/logs/batch', { data: { ids } })
export const clearEmailLogs = (beforeDays) => request.delete('/email/logs/clear', { data: { before_days: beforeDays } })

// 用户搜索
export const searchUsers = (keyword) => request.get('/email/users/search', { params: { keyword } })
```

- [ ] **Step 2: 提交**

```bash
git add client-admin/src/api/index.js
git commit -m "feat: 添加邮件 API 方法"
```

---

## Task 8: 扩展系统设置页面

**Files:**
- Modify: `client-admin/src/views/Settings.vue`

- [ ] **Step 1: 添加邮件配置 Tab**

在 `Settings.vue` 中添加新的 Tab 页：

```vue
<template>
  <div class="settings-container">
    <el-tabs v-model="activeTab">
      <!-- 现有 Tab -->
      <el-tab-pane label="修改密码" name="password">
        <!-- 现有内容 -->
      </el-tab-pane>

      <el-tab-pane label="管理员管理" name="admins">
        <!-- 现有内容 -->
      </el-tab-pane>

      <!-- 新增邮件配置 Tab -->
      <el-tab-pane label="邮件配置" name="email">
        <el-card>
          <template #header>
            <span>Brevo 邮件配置</span>
          </template>
          <el-form :model="emailForm" label-width="120px">
            <el-form-item label="API Key">
              <el-input
                v-model="emailForm.api_key"
                type="password"
                show-password
                placeholder="输入 Brevo API Key"
              />
            </el-form-item>
            <el-form-item label="发件人邮箱">
              <el-input
                v-model="emailForm.sender_email"
                placeholder="noreply@example.com"
              />
            </el-form-item>
            <el-form-item label="发件人名称">
              <el-input
                v-model="emailForm.sender_name"
                placeholder="机场面板"
              />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveEmailConfig">保存配置</el-button>
              <el-button @click="showTestDialog = true">发送测试邮件</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 测试邮件弹窗 -->
    <el-dialog v-model="showTestDialog" title="发送测试邮件" width="400px">
      <el-form>
        <el-form-item label="测试邮箱">
          <el-input v-model="testEmail" placeholder="输入接收测试的邮箱" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showTestDialog = false">取消</el-button>
        <el-button type="primary" @click="handleSendTest">发送</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { getEmailConfig, updateEmailConfig, sendTestEmail } from '@/api'

const activeTab = ref('password')
const emailForm = ref({
  api_key: '',
  sender_email: '',
  sender_name: ''
})
const showTestDialog = ref(false)
const testEmail = ref('')

const loadEmailConfig = async () => {
  try {
    const res = await getEmailConfig()
    if (res.code === 0) {
      emailForm.value = res.data
    }
  } catch (error) {
    console.error('加载邮件配置失败:', error)
  }
}

const saveEmailConfig = async () => {
  try {
    const res = await updateEmailConfig(emailForm.value)
    if (res.code === 0) {
      ElMessage.success('配置已保存')
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    ElMessage.error('保存失败')
  }
}

const handleSendTest = async () => {
  if (!testEmail.value) {
    ElMessage.warning('请输入测试邮箱')
    return
  }
  try {
    const res = await sendTestEmail({ email: testEmail.value })
    if (res.code === 0) {
      ElMessage.success('测试邮件已发送')
      showTestDialog.value = false
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    ElMessage.error('发送失败')
  }
}

onMounted(() => {
  loadEmailConfig()
})
</script>
```

- [ ] **Step 2: 提交**

```bash
git add client-admin/src/views/Settings.vue
git commit -m "feat: 在系统设置页面添加邮件配置"
```

---

## Task 9: 创建邮件模板管理页面

**Files:**
- Create: `client-admin/src/views/EmailTemplates.vue`

- [ ] **Step 1: 创建邮件模板管理页面**

```vue
<template>
  <div class="email-templates-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>邮件模板管理</span>
          <el-button type="primary" @click="showDialog = true; resetForm()">新增模板</el-button>
        </div>
      </template>

      <el-table :data="templates" v-loading="loading">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="name" label="模板名称" />
        <el-table-column prop="subject" label="邮件主题" />
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-button size="small" @click="editTemplate(row)">编辑</el-button>
            <el-button size="small" type="danger" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 编辑弹窗 -->
    <el-dialog
      v-model="showDialog"
      :title="editingId ? '编辑模板' : '新增模板'"
      width="800px"
      :close-on-click-modal="false"
    >
      <el-form :model="form" label-width="100px">
        <el-form-item label="模板名称">
          <el-input v-model="form.name" placeholder="输入模板名称" />
        </el-form-item>
        <el-form-item label="邮件主题">
          <el-input v-model="form.subject" placeholder="支持变量，如 {{username}}" />
        </el-form-item>
        <el-form-item label="可用变量">
          <el-tag
            v-for="varName in availableVariables"
            :key="varName"
            class="variable-tag"
            @click="insertVariable(varName)"
            style="cursor: pointer; margin-right: 8px;"
          >
            {{ '{{' + varName + '}}' }}
          </el-tag>
        </el-form-item>
        <el-form-item label="邮件内容">
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="15"
            placeholder="输入 HTML 邮件内容"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button @click="handlePreview">预览</el-button>
        <el-button type="primary" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 预览弹窗 -->
    <el-dialog v-model="showPreview" title="邮件预览" width="700px">
      <div class="preview-subject">
        <strong>主题：</strong>{{ previewData.subject }}
      </div>
      <div class="preview-content" v-html="previewData.content"></div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getEmailTemplates,
  createEmailTemplate,
  updateEmailTemplate,
  deleteEmailTemplate,
  previewEmailTemplate
} from '@/api'

const loading = ref(false)
const templates = ref([])
const showDialog = ref(false)
const showPreview = ref(false)
const editingId = ref(null)
const previewData = ref({ subject: '', content: '' })

const availableVariables = ['username', 'email', 'user_id', 'plan_name', 'expire_date', 'traffic_used', 'traffic_limit']

const form = ref({
  name: '',
  subject: '',
  content: '',
  variables: []
})

const loadTemplates = async () => {
  loading.value = true
  try {
    const res = await getEmailTemplates()
    if (res.code === 0) {
      templates.value = res.data
    }
  } catch (error) {
    console.error('加载模板失败:', error)
  } finally {
    loading.value = false
  }
}

const resetForm = () => {
  editingId.value = null
  form.value = {
    name: '',
    subject: '',
    content: '',
    variables: []
  }
}

const editTemplate = (row) => {
  editingId.value = row.id
  form.value = {
    name: row.name,
    subject: row.subject,
    content: row.content,
    variables: row.variables ? JSON.parse(row.variables) : []
  }
  showDialog.value = true
}

const insertVariable = (varName) => {
  const textarea = document.querySelector('.el-textarea__inner')
  if (textarea) {
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = form.value.content
    form.value.content = text.substring(0, start) + '{{' + varName + '}}' + text.substring(end)
  }
}

const handlePreview = async () => {
  try {
    const res = await previewEmailTemplate(editingId.value || 0, {
      content: form.value.content,
      subject: form.value.subject
    })
    if (res.code === 0) {
      previewData.value = res.data
      showPreview.value = true
    }
  } catch (error) {
    // 本地预览
    previewData.value = {
      subject: form.value.subject,
      content: form.value.content
    }
    showPreview.value = true
  }
}

const handleSave = async () => {
  if (!form.value.name || !form.value.subject || !form.value.content) {
    ElMessage.warning('请填写完整信息')
    return
  }
  try {
    let res
    if (editingId.value) {
      res = await updateEmailTemplate(editingId.value, form.value)
    } else {
      res = await createEmailTemplate(form.value)
    }
    if (res.code === 0) {
      ElMessage.success(editingId.value ? '模板已更新' : '模板已创建')
      showDialog.value = false
      loadTemplates()
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    ElMessage.error('保存失败')
  }
}

const handleDelete = async (row) => {
  try {
    await ElMessageBox.confirm('确定删除该模板？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消'
    })
    const res = await deleteEmailTemplate(row.id)
    if (res.code === 0) {
      ElMessage.success('模板已删除')
      loadTemplates()
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    // 取消删除
  }
}

onMounted(() => {
  loadTemplates()
})
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.variable-tag:hover {
  opacity: 0.8;
}
.preview-subject {
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid #eee;
}
.preview-content {
  border: 1px solid #eee;
  padding: 16px;
  border-radius: 4px;
}
</style>
```

- [ ] **Step 2: 提交**

```bash
git add client-admin/src/views/EmailTemplates.vue
git commit -m "feat: 创建邮件模板管理页面"
```

---

## Task 10: 创建邮件发送页面

**Files:**
- Create: `client-admin/src/views/EmailSender.vue`

- [ ] **Step 1: 创建邮件发送页面**

```vue
<template>
  <div class="email-sender-container">
    <el-card>
      <template #header>
        <span>发送邮件</span>
      </template>

      <el-form :model="form" label-width="120px">
        <!-- 选择模板 -->
        <el-form-item label="选择模板">
          <el-select v-model="form.template_id" placeholder="选择邮件模板" @change="handleTemplateChange">
            <el-option
              v-for="tpl in templates"
              :key="tpl.id"
              :label="tpl.name"
              :value="tpl.id"
            />
          </el-select>
        </el-form-item>

        <!-- 收件人类型 -->
        <el-form-item label="收件人">
          <el-radio-group v-model="form.target_type">
            <el-radio value="all">所有用户</el-radio>
            <el-radio value="disabled">被禁用用户</el-radio>
            <el-radio value="custom">自定义</el-radio>
          </el-radio-group>
        </el-form-item>

        <!-- 自定义收件人 -->
        <el-form-item v-if="form.target_type === 'custom'" label="搜索用户">
          <el-input
            v-model="searchKeyword"
            placeholder="输入邮箱搜索"
            @input="handleSearch"
          >
            <template #append>
              <el-button @click="handleSearch">搜索</el-button>
            </template>
          </el-input>
          <div v-if="searchResults.length > 0" class="search-results">
            <div
              v-for="user in searchResults"
              :key="user.id"
              class="search-item"
              @click="addUser(user)"
            >
              {{ user.email }}
            </div>
          </div>
          <div v-if="selectedUsers.length > 0" class="selected-users">
            <el-tag
              v-for="user in selectedUsers"
              :key="user.id"
              closable
              @close="removeUser(user)"
            >
              {{ user.email }}
            </el-tag>
          </div>
        </el-form-item>

        <!-- 邮件主题 -->
        <el-form-item label="邮件主题">
          <el-input v-model="form.subject" placeholder="邮件主题" />
        </el-form-item>

        <!-- 模板变量 -->
        <el-form-item v-if="form.template_id" label="模板变量">
          <div class="variables-info">
            <el-tag
              v-for="varName in templateVariables"
              :key="varName"
              type="info"
              style="margin-right: 8px; margin-bottom: 8px;"
            >
              {{ '{{' + varName + '}}' }} - {{ getVariableLabel(varName) }}
            </el-tag>
          </div>
          <div class="variables-tip">
            提示：用户信息变量会自动填充，无需手动设置
          </div>
        </el-form-item>

        <!-- 邮件内容 -->
        <el-form-item label="邮件内容">
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="15"
            placeholder="HTML 邮件内容"
          />
        </el-form-item>

        <!-- 操作按钮 -->
        <el-form-item>
          <el-button @click="handlePreview">预览邮件</el-button>
          <el-button type="primary" @click="handleSend" :loading="sending">
            {{ form.target_type === 'custom' ? '发送' : '创建群发任务' }}
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 预览弹窗 -->
    <el-dialog v-model="showPreview" title="邮件预览" width="700px">
      <div class="preview-subject">
        <strong>主题：</strong>{{ previewData.subject }}
      </div>
      <div class="preview-content" v-html="previewData.content"></div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import {
  getEmailTemplates,
  previewEmailTemplate,
  sendEmail,
  createEmailCampaign,
  searchUsers
} from '@/api'

const router = useRouter()
const loading = ref(false)
const sending = ref(false)
const templates = ref([])
const showPreview = ref(false)
const previewData = ref({ subject: '', content: '' })
const searchKeyword = ref('')
const searchResults = ref([])
const selectedUsers = ref([])

const form = ref({
  template_id: null,
  target_type: 'all',
  subject: '',
  content: ''
})

const templateVariables = computed(() => {
  if (!form.value.template_id) return []
  const tpl = templates.value.find(t => t.id === form.value.template_id)
  return tpl?.variables ? JSON.parse(tpl.variables) : []
})

const variableLabels = {
  username: '用户名',
  email: '邮箱',
  user_id: '用户ID',
  plan_name: '套餐名称',
  expire_date: '到期时间',
  traffic_used: '已用流量',
  traffic_limit: '流量上限'
}

const getVariableLabel = (varName) => variableLabels[varName] || varName

const loadTemplates = async () => {
  try {
    const res = await getEmailTemplates()
    if (res.code === 0) {
      templates.value = res.data
    }
  } catch (error) {
    console.error('加载模板失败:', error)
  }
}

const handleTemplateChange = async (templateId) => {
  const tpl = templates.value.find(t => t.id === templateId)
  if (tpl) {
    form.value.subject = tpl.subject
    form.value.content = tpl.content
  }
}

const handleSearch = async () => {
  if (!searchKeyword.value) {
    searchResults.value = []
    return
  }
  try {
    const res = await searchUsers(searchKeyword.value)
    if (res.code === 0) {
      searchResults.value = res.data.filter(
        user => !selectedUsers.value.find(u => u.id === user.id)
      )
    }
  } catch (error) {
    console.error('搜索失败:', error)
  }
}

const addUser = (user) => {
  if (!selectedUsers.value.find(u => u.id === user.id)) {
    selectedUsers.value.push(user)
  }
  searchResults.value = []
  searchKeyword.value = ''
}

const removeUser = (user) => {
  selectedUsers.value = selectedUsers.value.filter(u => u.id !== user.id)
}

const handlePreview = async () => {
  try {
    const res = await previewEmailTemplate(form.value.template_id, {})
    if (res.code === 0) {
      previewData.value = res.data
    } else {
      previewData.value = {
        subject: form.value.subject,
        content: form.value.content
      }
    }
  } catch (error) {
    previewData.value = {
      subject: form.value.subject,
      content: form.value.content
    }
  }
  showPreview.value = true
}

const handleSend = async () => {
  if (!form.value.subject || !form.value.content) {
    ElMessage.warning('请填写邮件主题和内容')
    return
  }

  // 自定义模式：单发
  if (form.value.target_type === 'custom') {
    if (selectedUsers.value.length === 0) {
      ElMessage.warning('请选择收件人')
      return
    }
    sending.value = true
    try {
      for (const user of selectedUsers.value) {
        await sendEmail({
          to: user.email,
          subject: form.value.subject,
          content: form.value.content
        })
      }
      ElMessage.success(`已发送 ${selectedUsers.value.length} 封邮件`)
      selectedUsers.value = []
    } catch (error) {
      ElMessage.error('发送失败')
    } finally {
      sending.value = false
    }
    return
  }

  // 群发模式：创建任务
  if (!form.value.template_id) {
    ElMessage.warning('请选择邮件模板')
    return
  }

  sending.value = true
  try {
    const res = await createEmailCampaign({
      name: `群发任务 - ${new Date().toLocaleString()}`,
      template_id: form.value.template_id,
      target_type: form.value.target_type
    })
    if (res.code === 0) {
      ElMessage.success('群发任务已创建')
      router.push('/admin/email-campaigns')
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    ElMessage.error('创建失败')
  } finally {
    sending.value = false
  }
}

onMounted(() => {
  loadTemplates()
})
</script>

<style scoped>
.search-results {
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  margin-top: 8px;
  max-height: 200px;
  overflow-y: auto;
}
.search-item {
  padding: 8px 12px;
  cursor: pointer;
}
.search-item:hover {
  background-color: #f5f7fa;
}
.selected-users {
  margin-top: 8px;
}
.selected-users .el-tag {
  margin-right: 8px;
  margin-bottom: 8px;
}
.variables-info {
  margin-bottom: 8px;
}
.variables-tip {
  color: #909399;
  font-size: 12px;
}
.preview-subject {
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid #eee;
}
.preview-content {
  border: 1px solid #eee;
  padding: 16px;
  border-radius: 4px;
}
</style>
```

- [ ] **Step 2: 提交**

```bash
git add client-admin/src/views/EmailSender.vue
git commit -m "feat: 创建邮件发送页面"
```

---

## Task 11: 创建群发任务管理页面

**Files:**
- Create: `client-admin/src/views/EmailCampaigns.vue`

- [ ] **Step 1: 创建群发任务管理页面**

```vue
<template>
  <div class="email-campaigns-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>群发任务管理</span>
          <el-button type="primary" @click="$router.push('/admin/email-sender')">新建任务</el-button>
        </div>
      </template>

      <el-table :data="campaigns" v-loading="loading">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="name" label="任务名称" />
        <el-table-column label="目标" width="120">
          <template #default="{ row }">
            {{ getTargetLabel(row.target_type) }}
          </template>
        </el-table-column>
        <el-table-column label="进度" width="150">
          <template #default="{ row }">
            {{ row.sent_count + row.failed_count }}/{{ row.total_count }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)">{{ getStatusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="250">
          <template #default="{ row }">
            <el-button size="small" @click="viewDetail(row)">详情</el-button>
            <el-button
              v-if="row.status === 'pending' || row.status === 'sending'"
              size="small"
              type="warning"
              @click="handlePause(row)"
            >
              暂停
            </el-button>
            <el-button
              v-if="row.status === 'paused'"
              size="small"
              type="success"
              @click="handleResume(row)"
            >
              恢复
            </el-button>
            <el-button size="small" type="danger" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 详情弹窗 -->
    <el-dialog v-model="showDetail" title="任务详情" width="800px">
      <el-descriptions :column="2" border>
        <el-descriptions-item label="任务名称">{{ currentCampaign.name }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="getStatusType(currentCampaign.status)">
            {{ getStatusLabel(currentCampaign.status) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="目标类型">{{ getTargetLabel(currentCampaign.target_type) }}</el-descriptions-item>
        <el-descriptions-item label="总数量">{{ currentCampaign.total_count }}</el-descriptions-item>
        <el-descriptions-item label="已发送">{{ currentCampaign.sent_count }}</el-descriptions-item>
        <el-descriptions-item label="失败">{{ currentCampaign.failed_count }}</el-descriptions-item>
      </el-descriptions>

      <div class="logs-section">
        <h4>发送日志</h4>
        <el-table :data="logs" v-loading="logsLoading" max-height="400">
          <el-table-column prop="email" label="邮箱" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.status === 'sent' ? 'success' : 'danger'" size="small">
                {{ row.status === 'sent' ? '成功' : '失败' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="error_message" label="错误信息" />
          <el-table-column label="时间" width="180">
            <template #default="{ row }">
              {{ formatTime(row.sent_at) }}
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getEmailCampaigns,
  pauseEmailCampaign,
  resumeEmailCampaign,
  deleteEmailCampaign,
  getEmailCampaignLogs
} from '@/api'

const loading = ref(false)
const logsLoading = ref(false)
const campaigns = ref([])
const showDetail = ref(false)
const currentCampaign = ref({})
const logs = ref([])

const targetLabels = {
  all: '所有用户',
  disabled: '禁用用户',
  custom: '自定义'
}

const statusLabels = {
  pending: '待发送',
  sending: '发送中',
  completed: '已完成',
  paused: '已暂停'
}

const statusTypes = {
  pending: 'info',
  sending: 'warning',
  completed: 'success',
  paused: 'danger'
}

const getTargetLabel = (type) => targetLabels[type] || type
const getStatusLabel = (status) => statusLabels[status] || status
const getStatusType = (status) => statusTypes[status] || 'info'

const formatTime = (timestamp) => {
  if (!timestamp) return '-'
  return new Date(timestamp * 1000).toLocaleString()
}

const loadCampaigns = async () => {
  loading.value = true
  try {
    const res = await getEmailCampaigns()
    if (res.code === 0) {
      campaigns.value = res.data
    }
  } catch (error) {
    console.error('加载任务失败:', error)
  } finally {
    loading.value = false
  }
}

const viewDetail = async (row) => {
  currentCampaign.value = row
  showDetail.value = true
  logsLoading.value = true
  try {
    const res = await getEmailCampaignLogs(row.id, { limit: 100 })
    if (res.code === 0) {
      logs.value = res.data.list
    }
  } catch (error) {
    console.error('加载日志失败:', error)
  } finally {
    logsLoading.value = false
  }
}

const handlePause = async (row) => {
  try {
    const res = await pauseEmailCampaign(row.id)
    if (res.code === 0) {
      ElMessage.success('任务已暂停')
      loadCampaigns()
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    ElMessage.error('操作失败')
  }
}

const handleResume = async (row) => {
  try {
    const res = await resumeEmailCampaign(row.id)
    if (res.code === 0) {
      ElMessage.success('任务已恢复')
      loadCampaigns()
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    ElMessage.error('操作失败')
  }
}

const handleDelete = async (row) => {
  try {
    await ElMessageBox.confirm('确定删除该任务？删除后将同时删除相关日志。', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消'
    })
    const res = await deleteEmailCampaign(row.id)
    if (res.code === 0) {
      ElMessage.success('任务已删除')
      loadCampaigns()
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    // 取消删除
  }
}

onMounted(() => {
  loadCampaigns()
})
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.logs-section {
  margin-top: 20px;
}
.logs-section h4 {
  margin-bottom: 12px;
}
</style>
```

- [ ] **Step 2: 提交**

```bash
git add client-admin/src/views/EmailCampaigns.vue
git commit -m "feat: 创建群发任务管理页面"
```

---

## Task 12: 添加前端路由和菜单

**Files:**
- Modify: `client-admin/src/router/index.js`
- Modify: `client-admin/src/views/Layout.vue`

- [ ] **Step 1: 添加路由配置**

在 `client-admin/src/router/index.js` 中添加：

```javascript
{
  path: 'email-sender',
  name: 'EmailSender',
  component: () => import('@/views/EmailSender.vue'),
  meta: { title: '发送邮件' }
},
{
  path: 'email-campaigns',
  name: 'EmailCampaigns',
  component: () => import('@/views/EmailCampaigns.vue'),
  meta: { title: '群发任务' }
},
{
  path: 'email-templates',
  name: 'EmailTemplates',
  component: () => import('@/views/EmailTemplates.vue'),
  meta: { title: '邮件模板' }
}
```

- [ ] **Step 2: 添加导航菜单**

在 `client-admin/src/views/Layout.vue` 的菜单配置中添加：

```javascript
{
  title: '邮件管理',
  icon: 'Message',
  children: [
    { title: '发送邮件', path: '/admin/email-sender' },
    { title: '群发任务', path: '/admin/email-campaigns' },
    { title: '邮件模板', path: '/admin/email-templates' }
  ]
}
```

- [ ] **Step 3: 提交**

```bash
git add client-admin/src/router/index.js client-admin/src/views/Layout.vue
git commit -m "feat: 添加邮件管理路由和菜单"
```

---

## Task 13: 测试验证

- [ ] **Step 1: 启动后端服务**

Run: `cd server && npm run dev`

Expected: 服务启动成功，无错误

- [ ] **Step 2: 启动管理端前端**

Run: `cd client-admin && npm run dev`

Expected: 前端启动成功，无错误

- [ ] **Step 3: 测试 Brevo 配置**

1. 访问管理端系统设置页面
2. 切换到"邮件配置" Tab
3. 输入 Brevo API Key、发件人邮箱、发件人名称
4. 点击"保存配置"
5. 输入测试邮箱，点击"发送测试邮件"

- [ ] **Step 4: 测试邮件模板**

1. 访问邮件模板管理页面
2. 创建一个新模板
3. 编辑模板内容
4. 预览模板

- [ ] **Step 5: 测试邮件发送**

1. 访问邮件发送页面
2. 选择模板
3. 选择收件人类型
4. 发送邮件

- [ ] **Step 6: 测试群发任务**

1. 创建群发任务
2. 查看任务列表
3. 查看任务详情和日志

- [ ] **Step 7: 最终提交**

```bash
git add -A
git commit -m "feat: Brevo 邮件发送功能完成"
```

---

## 自检清单

- [ ] 所有数据库表已创建
- [ ] Brevo 配置可保存和读取
- [ ] 邮件模板 CRUD 功能正常
- [ ] 单封邮件发送功能正常
- [ ] 群发任务创建和处理功能正常
- [ ] 定时任务配置正确（每天 9:00）
- [ ] 日志清理功能正常
- [ ] 用户端 API 白名单机制正常
- [ ] 前端页面路由和菜单正常
- [ ] 错误处理完善
