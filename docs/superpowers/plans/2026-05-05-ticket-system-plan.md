# 工单系统实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为订阅管理系统添加工单功能，让用户可以提交问题工单，管理员可以回复处理

**Architecture:** 后端使用 Express 路由 + PostgreSQL 数据库，前端使用 Vue 3 + Element Plus，定时任务处理自动关闭

**Tech Stack:** Express, PostgreSQL, Vue 3, Element Plus, Pinia

---

## 文件结构

### 后端文件
- `server/db/init.js` - 添加工单相关表结构
- `server/routes/user/tickets.js` - 用户端工单路由（新建）
- `server/routes/admin/tickets.js` - 管理端工单路由（新建）
- `server/services/ticket-service.js` - 工单服务层（新建）
- `server/jobs/index.js` - 添加工单自动关闭任务
- `server/app.js` - 注册工单路由

### 前端文件（用户端）
- `client-user/src/api/index.js` - 添加工单 API
- `client-user/src/router/index.js` - 添加工单路由
- `client-user/src/views/user/Tickets.vue` - 工单列表页（新建）
- `client-user/src/views/user/TicketDetail.vue` - 工单详情页（新建）
- `client-user/src/views/user/CreateTicket.vue` - 创建工单页（新建）
- `client-user/src/views/user/Layout.vue` - 添加工单导航菜单

### 前端文件（管理端）
- `client-admin/src/api/index.js` - 添加工单 API
- `client-admin/src/router/index.js` - 添加工单路由
- `client-admin/src/views/Tickets.vue` - 工单列表页（新建）
- `client-admin/src/views/TicketDetail.vue` - 工单详情页（新建）
- `client-admin/src/views/Layout.vue` - 添加工单导航菜单

---

## Task 1: 数据库表结构

**Files:**
- Modify: `server/db/init.js`

- [ ] **Step 1: 添加工单表结构**

在 `server/db/init.js` 的 `initTables` 方法中，在公告表之后添加：

```javascript
// 工单表
await client.query(`
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
  )
`);
logger.info('工单表初始化完成');

// 工单回复表
await client.query(`
  CREATE TABLE IF NOT EXISTS ticket_replies (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL,
    user_id INTEGER,
    admin_id INTEGER,
    content TEXT NOT NULL,
    created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
  )
`);
logger.info('工单回复表初始化完成');

// 工单已读表
await client.query(`
  CREATE TABLE IF NOT EXISTS ticket_reads (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    last_read_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
    UNIQUE(ticket_id, user_id)
  )
`);
logger.info('工单已读表初始化完成');
```

- [ ] **Step 2: 添加工单表索引**

在 `createIndexes` 方法中添加：

```javascript
await client.query('CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets(user_id)');
await client.query('CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)');
await client.query('CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at)');
await client.query('CREATE INDEX IF NOT EXISTS idx_ticket_replies_ticket_id ON ticket_replies(ticket_id)');
await client.query('CREATE INDEX IF NOT EXISTS idx_ticket_replies_created_at ON ticket_replies(created_at)');
await client.query('CREATE INDEX IF NOT EXISTS idx_ticket_reads_ticket_id ON ticket_reads(ticket_id)');
await client.query('CREATE INDEX IF NOT EXISTS idx_ticket_reads_user_id ON ticket_reads(user_id)');
```

- [ ] **Step 3: 运行数据库初始化**

```bash
cd server && npm run init-db
```

- [ ] **Step 4: 提交**

```bash
git add server/db/init.js
git commit -m "feat: 添加工单相关数据库表结构"
```

---

## Task 2: 工单服务层

**Files:**
- Create: `server/services/ticket-service.js`

- [ ] **Step 1: 创建工单服务**

```javascript
/**
 * 工单服务封装
 * 处理工单相关业务逻辑
 */

const { createLogger } = require('../utils/logger');

const logger = createLogger('TICKET-SERVICE');

/**
 * 创建工单
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户ID
 * @param {string} title - 工单标题
 * @param {string} description - 工单描述
 * @returns {Promise<Object>} 创建的工单
 */
async function createTicket(db, userId, title, description) {
  const result = await db.prepare(`
    INSERT INTO tickets (user_id, title, description, status, created_at, updated_at)
    VALUES (?, ?, ?, 'open', EXTRACT(EPOCH FROM NOW()), EXTRACT(EPOCH FROM NOW()))
  `).run(userId, title, description);

  const ticket = await db.prepare('SELECT * FROM tickets WHERE id = ?').get(result.lastInsertRowid);
  return ticket;
}

/**
 * 获取用户工单列表
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户ID
 * @param {number} page - 页码
 * @param {number} limit - 每页条数
 * @returns {Promise<Object>} 工单列表和总数
 */
async function getUserTickets(db, userId, page = 1, limit = 10) {
  const offset = (page - 1) * limit;

  const total = (await db.prepare(
    'SELECT COUNT(*) as count FROM tickets WHERE user_id = ?'
  ).get(userId)).count;

  const tickets = await db.prepare(`
    SELECT * FROM tickets 
    WHERE user_id = ? 
    ORDER BY created_at DESC 
    LIMIT ? OFFSET ?
  `).all(userId, limit, offset);

  return { total, list: tickets };
}

/**
 * 获取工单详情（含回复）
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单ID
 * @returns {Promise<Object>} 工单详情
 */
async function getTicketDetail(db, ticketId) {
  const ticket = await db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
  
  if (!ticket) {
    return null;
  }

  const replies = await db.prepare(`
    SELECT 
      tr.*,
      CASE 
        WHEN tr.user_id IS NOT NULL THEN u.email
        WHEN tr.admin_id IS NOT NULL THEN a.username
      END as reply_name
    FROM ticket_replies tr
    LEFT JOIN users u ON tr.user_id = u.id
    LEFT JOIN admins a ON tr.admin_id = a.id
    WHERE tr.ticket_id = ?
    ORDER BY tr.created_at ASC
  `).all(ticketId);

  // 获取用户信息
  const user = await db.prepare('SELECT id, email FROM users WHERE id = ?').get(ticket.user_id);

  return { ...ticket, user, replies };
}

/**
 * 回复工单
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单ID
 * @param {number|null} userId - 用户ID（用户回复时）
 * @param {number|null} adminId - 管理员ID（管理员回复时）
 * @param {string} content - 回复内容
 * @returns {Promise<Object>} 创建的回复
 */
async function addReply(db, ticketId, userId, adminId, content) {
  const result = await db.prepare(`
    INSERT INTO ticket_replies (ticket_id, user_id, admin_id, content, created_at)
    VALUES (?, ?, ?, ?, EXTRACT(EPOCH FROM NOW()))
  `).run(ticketId, userId, adminId, content);

  // 更新工单状态和回复数
  if (adminId) {
    // 管理员回复，状态改为 pending
    await db.prepare(`
      UPDATE tickets 
      SET status = 'pending', reply_count = reply_count + 1, 
          last_reply_at = EXTRACT(EPOCH FROM NOW()), 
          updated_at = EXTRACT(EPOCH FROM NOW())
      WHERE id = ?
    `).run(ticketId);
  } else {
    // 用户回复，更新回复数
    await db.prepare(`
      UPDATE tickets 
      SET reply_count = reply_count + 1, 
          last_reply_at = EXTRACT(EPOCH FROM NOW()), 
          updated_at = EXTRACT(EPOCH FROM NOW())
      WHERE id = ?
    `).run(ticketId);
  }

  const reply = await db.prepare('SELECT * FROM ticket_replies WHERE id = ?').get(result.lastInsertRowid);
  return reply;
}

/**
 * 关闭工单
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单ID
 * @returns {Promise<boolean>} 是否成功
 */
async function closeTicket(db, ticketId) {
  await db.prepare(`
    UPDATE tickets 
    SET status = 'closed', closed_at = EXTRACT(EPOCH FROM NOW()), updated_at = EXTRACT(EPOCH FROM NOW())
    WHERE id = ?
  `).run(ticketId);
  return true;
}

/**
 * 更新用户已读时间
 * @param {Object} db - 数据库实例
 * @param {number} ticketId - 工单ID
 * @param {number} userId - 用户ID
 */
async function updateReadTime(db, ticketId, userId) {
  await db.prepare(`
    INSERT INTO ticket_reads (ticket_id, user_id, last_read_at)
    VALUES (?, ?, EXTRACT(EPOCH FROM NOW()))
    ON CONFLICT (ticket_id, user_id) 
    DO UPDATE SET last_read_at = EXTRACT(EPOCH FROM NOW())
  `).run(ticketId, userId);

  // 同步更新 tickets 表的 last_read_at
  await db.prepare(`
    UPDATE tickets SET last_read_at = EXTRACT(EPOCH FROM NOW()) WHERE id = ?
  `).run(ticketId);
}

/**
 * 获取未读工单数量
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户ID
 * @returns {Promise<number>} 未读数量
 */
async function getUnreadCount(db, userId) {
  const result = await db.prepare(`
    SELECT COUNT(*) as count FROM tickets t
    WHERE t.user_id = ? 
      AND t.status IN ('open', 'pending')
      AND t.last_reply_at IS NOT NULL
      AND (t.last_read_at IS NULL OR t.last_reply_at > t.last_read_at)
  `).get(userId);
  return result.count;
}

/**
 * 获取工单统计（管理端）
 * @param {Object} db - 数据库实例
 * @returns {Promise<Object>} 统计数据
 */
async function getTicketStats(db) {
  const openCount = (await db.prepare(
    "SELECT COUNT(*) as count FROM tickets WHERE status = 'open'"
  ).get()).count;

  const pendingCount = (await db.prepare(
    "SELECT COUNT(*) as count FROM tickets WHERE status = 'pending'"
  ).get()).count;

  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const todayCount = (await db.prepare(
    "SELECT COUNT(*) as count FROM tickets WHERE created_at >= ?"
  ).get(todayStart)).count;

  return { open_count: openCount, pending_count: pendingCount, today_count: todayCount };
}

/**
 * 获取管理端工单列表（支持搜索和筛选）
 * @param {Object} db - 数据库实例
 * @param {Object} params - 查询参数
 * @returns {Promise<Object>} 工单列表和总数
 */
async function getAdminTickets(db, params = {}) {
  const { page = 1, limit = 10, status, keyword } = params;
  const offset = (page - 1) * limit;

  let where = '1=1';
  const queryParams = [];

  if (status) {
    where += ' AND t.status = ?';
    queryParams.push(status);
  }

  if (keyword) {
    where += ' AND (t.title LIKE ? OR u.email LIKE ?)';
    queryParams.push(`%${keyword}%`, `%${keyword}%`);
  }

  const countResult = await db.prepare(`
    SELECT COUNT(*) as count 
    FROM tickets t 
    LEFT JOIN users u ON t.user_id = u.id
    WHERE ${where}
  `).get(...queryParams);
  const total = countResult.count;

  const tickets = await db.prepare(`
    SELECT t.*, u.email as user_email
    FROM tickets t
    LEFT JOIN users u ON t.user_id = u.id
    WHERE ${where}
    ORDER BY t.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...queryParams, limit, offset);

  return { total, list: tickets };
}

module.exports = {
  createTicket,
  getUserTickets,
  getTicketDetail,
  addReply,
  closeTicket,
  updateReadTime,
  getUnreadCount,
  getTicketStats,
  getAdminTickets
};
```

- [ ] **Step 2: 提交**

```bash
git add server/services/ticket-service.js
git commit -m "feat: 添加工单服务层"
```

---

## Task 3: 用户端工单路由

**Files:**
- Create: `server/routes/user/tickets.js`

- [ ] **Step 1: 创建用户端工单路由**

```javascript
/**
 * 用户端工单路由
 * 处理工单的创建、查看、回复和关闭
 */

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth-user');
const ticketService = require('../../services/ticket-service');
const { createLogger } = require('../../utils/logger');

const router = express.Router();
const logger = createLogger('USER-TICKETS');

/**
 * GET /api/user/tickets/unread-count
 * 获取未读工单数量
 */
router.get('/unread-count', authenticateUser, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const userId = req.user.id;

    const count = await ticketService.getUnreadCount(db, userId);

    res.json({
      code: 0,
      message: 'ok',
      data: { count }
    });
  } catch (error) {
    logger.error(`获取未读工单数量错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

/**
 * GET /api/user/tickets
 * 获取工单列表
 */
router.get('/', authenticateUser, [
  query('page').optional().isInt({ min: 1 }).withMessage('页码必须是大于0的整数'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('每页条数必须是1-100之间的整数')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ code: 1001, message: '参数校验失败', data: null });
    }

    const db = req.app.locals.db;
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const result = await ticketService.getUserTickets(db, userId, page, limit);

    res.json({
      code: 0,
      message: 'ok',
      data: { total: result.total, page, limit, list: result.list }
    });
  } catch (error) {
    logger.error(`获取工单列表错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

/**
 * POST /api/user/tickets
 * 创建工单
 */
router.post('/', authenticateUser, [
  body('title').notEmpty().withMessage('工单标题不能为空')
    .isLength({ max: 50 }).withMessage('工单标题不能超过50字'),
  body('description').notEmpty().withMessage('工单描述不能为空')
    .isLength({ max: 500 }).withMessage('工单描述不能超过500字')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ code: 1001, message: '参数校验失败', data: null });
    }

    const db = req.app.locals.db;
    const userId = req.user.id;
    const { title, description } = req.body;

    const ticket = await ticketService.createTicket(db, userId, title, description);

    logger.info(`用户 ${req.user.email} 创建工单成功: ${ticket.id}`);

    res.json({
      code: 0,
      message: 'ok',
      data: ticket
    });
  } catch (error) {
    logger.error(`创建工单错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

/**
 * GET /api/user/tickets/:id
 * 获取工单详情
 */
router.get('/:id', authenticateUser, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ code: 1001, message: '参数校验失败', data: null });
    }

    const db = req.app.locals.db;
    const userId = req.user.id;
    const ticketId = parseInt(req.params.id);

    const ticket = await ticketService.getTicketDetail(db, ticketId);

    if (!ticket) {
      return res.status(400).json({ code: 1001, message: '工单不存在', data: null });
    }

    // 验证工单所有权
    if (ticket.user_id !== userId) {
      return res.status(403).json({ code: 1004, message: '无权限访问', data: null });
    }

    // 更新已读时间
    await ticketService.updateReadTime(db, ticketId, userId);

    res.json({
      code: 0,
      message: 'ok',
      data: ticket
    });
  } catch (error) {
    logger.error(`获取工单详情错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

/**
 * POST /api/user/tickets/:id/replies
 * 回复工单
 */
router.post('/:id/replies', authenticateUser, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数'),
  body('content').notEmpty().withMessage('回复内容不能为空')
    .isLength({ max: 500 }).withMessage('回复内容不能超过500字')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ code: 1001, message: '参数校验失败', data: null });
    }

    const db = req.app.locals.db;
    const userId = req.user.id;
    const ticketId = parseInt(req.params.id);
    const { content } = req.body;

    // 验证工单存在且属于当前用户
    const ticket = await db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    if (!ticket) {
      return res.status(400).json({ code: 1001, message: '工单不存在', data: null });
    }
    if (ticket.user_id !== userId) {
      return res.status(403).json({ code: 1004, message: '无权限访问', data: null });
    }
    if (ticket.status === 'closed') {
      return res.status(400).json({ code: 1001, message: '工单已关闭，无法回复', data: null });
    }

    const reply = await ticketService.addReply(db, ticketId, userId, null, content);

    logger.info(`用户 ${req.user.email} 回复工单 ${ticketId} 成功`);

    res.json({
      code: 0,
      message: 'ok',
      data: reply
    });
  } catch (error) {
    logger.error(`回复工单错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

/**
 * PUT /api/user/tickets/:id/close
 * 关闭工单
 */
router.put('/:id/close', authenticateUser, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ code: 1001, message: '参数校验失败', data: null });
    }

    const db = req.app.locals.db;
    const userId = req.user.id;
    const ticketId = parseInt(req.params.id);

    // 验证工单存在且属于当前用户
    const ticket = await db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    if (!ticket) {
      return res.status(400).json({ code: 1001, message: '工单不存在', data: null });
    }
    if (ticket.user_id !== userId) {
      return res.status(403).json({ code: 1004, message: '无权限访问', data: null });
    }
    if (ticket.status === 'closed') {
      return res.status(400).json({ code: 1001, message: '工单已关闭', data: null });
    }

    await ticketService.closeTicket(db, ticketId);

    logger.info(`用户 ${req.user.email} 关闭工单 ${ticketId} 成功`);

    res.json({
      code: 0,
      message: 'ok',
      data: { message: '工单已关闭' }
    });
  } catch (error) {
    logger.error(`关闭工单错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

module.exports = router;
```

- [ ] **Step 2: 提交**

```bash
git add server/routes/user/tickets.js
git commit -m "feat: 添加用户端工单路由"
```

---

## Task 4: 管理端工单路由

**Files:**
- Create: `server/routes/admin/tickets.js`

- [ ] **Step 1: 创建管理端工单路由**

```javascript
/**
 * 管理端工单路由
 * 处理工单查看、回复和关闭
 */

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const ticketService = require('../../services/ticket-service');
const { createLogger } = require('../../utils/logger');

const router = express.Router();
const logger = createLogger('ADMIN-TICKETS');

/**
 * GET /api/admin/tickets/stats
 * 获取工单统计
 */
router.get('/stats', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const stats = await ticketService.getTicketStats(db);

    res.json({
      code: 0,
      message: 'ok',
      data: stats
    });
  } catch (error) {
    logger.error(`获取工单统计错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

/**
 * GET /api/admin/tickets
 * 获取工单列表（支持搜索和筛选）
 */
router.get('/', authenticateAdmin, [
  query('page').optional().isInt({ min: 1 }).withMessage('页码必须是大于0的整数'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('每页条数必须是1-100之间的整数'),
  query('status').optional().isIn(['open', 'pending', 'closed']).withMessage('状态值无效'),
  query('keyword').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ code: 1001, message: '参数校验失败', data: null });
    }

    const db = req.app.locals.db;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status || null;
    const keyword = req.query.keyword || null;

    const result = await ticketService.getAdminTickets(db, { page, limit, status, keyword });

    res.json({
      code: 0,
      message: 'ok',
      data: { total: result.total, page, limit, list: result.list }
    });
  } catch (error) {
    logger.error(`获取工单列表错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

/**
 * GET /api/admin/tickets/:id
 * 获取工单详情
 */
router.get('/:id', authenticateAdmin, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ code: 1001, message: '参数校验失败', data: null });
    }

    const db = req.app.locals.db;
    const ticketId = parseInt(req.params.id);

    const ticket = await ticketService.getTicketDetail(db, ticketId);

    if (!ticket) {
      return res.status(400).json({ code: 1001, message: '工单不存在', data: null });
    }

    res.json({
      code: 0,
      message: 'ok',
      data: ticket
    });
  } catch (error) {
    logger.error(`获取工单详情错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

/**
 * POST /api/admin/tickets/:id/replies
 * 回复工单
 */
router.post('/:id/replies', authenticateAdmin, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数'),
  body('content').notEmpty().withMessage('回复内容不能为空')
    .isLength({ max: 500 }).withMessage('回复内容不能超过500字')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ code: 1001, message: '参数校验失败', data: null });
    }

    const db = req.app.locals.db;
    const adminId = req.admin.id;
    const ticketId = parseInt(req.params.id);
    const { content } = req.body;

    // 验证工单存在
    const ticket = await db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    if (!ticket) {
      return res.status(400).json({ code: 1001, message: '工单不存在', data: null });
    }
    if (ticket.status === 'closed') {
      return res.status(400).json({ code: 1001, message: '工单已关闭，无法回复', data: null });
    }

    const reply = await ticketService.addReply(db, ticketId, null, adminId, content);

    logger.info(`管理员 ${req.admin.username} 回复工单 ${ticketId} 成功`);

    res.json({
      code: 0,
      message: 'ok',
      data: reply
    });
  } catch (error) {
    logger.error(`回复工单错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

/**
 * PUT /api/admin/tickets/:id/close
 * 关闭工单
 */
router.put('/:id/close', authenticateAdmin, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ code: 1001, message: '参数校验失败', data: null });
    }

    const db = req.app.locals.db;
    const ticketId = parseInt(req.params.id);

    // 验证工单存在
    const ticket = await db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    if (!ticket) {
      return res.status(400).json({ code: 1001, message: '工单不存在', data: null });
    }
    if (ticket.status === 'closed') {
      return res.status(400).json({ code: 1001, message: '工单已关闭', data: null });
    }

    await ticketService.closeTicket(db, ticketId);

    logger.info(`管理员 ${req.admin.username} 关闭工单 ${ticketId} 成功`);

    res.json({
      code: 0,
      message: 'ok',
      data: { message: '工单已关闭' }
    });
  } catch (error) {
    logger.error(`关闭工单错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

module.exports = router;
```

- [ ] **Step 2: 提交**

```bash
git add server/routes/admin/tickets.js
git commit -m "feat: 添加管理端工单路由"
```

---

## Task 5: 注册路由和定时任务

**Files:**
- Modify: `server/app.js`
- Modify: `server/jobs/index.js`

- [ ] **Step 1: 在 app.js 中注册工单路由**

在 `server/app.js` 中添加路由导入：

```javascript
// 用户端路由
const userTicketsRoutes = require('./routes/user/tickets');

// 管理端路由
const adminTicketsRoutes = require('./routes/admin/tickets');
```

在路由挂载处添加：

```javascript
// 用户端工单路由
userApp.use(`${userPrefix}/tickets`, userTicketsRoutes);

// 管理端工单路由
adminApp.use(`${adminPrefix}/tickets`, adminTicketsRoutes);
```

- [ ] **Step 2: 在 jobs/index.js 中添加工单自动关闭任务**

在 `server/jobs/index.js` 中添加：

```javascript
/**
 * 注册工单自动关闭任务
 * 每小时检查一次，关闭满足条件的工单
 * 条件：状态为 pending，用户已读后超过24小时无新回复
 * @param {Object} db - 数据库实例
 */
function registerTicketAutoCloseJob(db) {
  // 启动时延迟3分钟执行第一次
  setTimeout(async () => {
    await runTicketAutoClose(db);
  }, 3 * 60 * 1000);

  const interval = setInterval(async () => {
    await runTicketAutoClose(db);
  }, 60 * 60 * 1000); // 每1小时执行一次
  
  intervals.push(interval);
  logger.info('工单自动关闭任务已注册（每1小时执行一次）');
}

/**
 * 执行工单自动关闭
 * @param {Object} db - 数据库实例
 */
async function runTicketAutoClose(db) {
  try {
    const result = await db.prepare(`
      UPDATE tickets 
      SET status = 'closed', closed_at = EXTRACT(EPOCH FROM NOW()), updated_at = EXTRACT(EPOCH FROM NOW())
      WHERE status = 'pending' 
        AND last_read_at IS NOT NULL 
        AND last_read_at < EXTRACT(EPOCH FROM NOW()) - 86400
        AND last_reply_at <= last_read_at
    `).run();
    
    if (result.changes > 0) {
      logger.info(`自动关闭 ${result.changes} 个超时工单`);
    }
  } catch (error) {
    logger.error(`工单自动关闭任务错误: ${error.message}`);
  }
}
```

在 `startAllJobs` 函数中添加：

```javascript
registerTicketAutoCloseJob(db);
```

- [ ] **Step 3: 提交**

```bash
git add server/app.js server/jobs/index.js
git commit -m "feat: 注册工单路由和自动关闭定时任务"
```

---

## Task 6: 用户端前端 - API 和路由

**Files:**
- Modify: `client-user/src/api/index.js`
- Modify: `client-user/src/router/index.js`

- [ ] **Step 1: 添加工单 API**

在 `client-user/src/api/index.js` 的 `userApi` 对象中添加：

```javascript
/**
 * 获取未读工单数量
 * @returns {Promise<Object>} 响应数据
 */
getTicketUnreadCount() {
  return apiClient.get('/tickets/unread-count')
},

/**
 * 获取工单列表
 * @param {Object} params - 查询参数
 * @returns {Promise<Object>} 响应数据
 */
getTickets(params) {
  return apiClient.get('/tickets', { params })
},

/**
 * 创建工单
 * @param {Object} data - 工单数据
 * @returns {Promise<Object>} 响应数据
 */
createTicket(data) {
  return apiClient.post('/tickets', data)
},

/**
 * 获取工单详情
 * @param {number} id - 工单ID
 * @returns {Promise<Object>} 响应数据
 */
getTicketDetail(id) {
  return apiClient.get(`/tickets/${id}`)
},

/**
 * 回复工单
 * @param {number} id - 工单ID
 * @param {Object} data - 回复数据
 * @returns {Promise<Object>} 响应数据
 */
replyTicket(id, data) {
  return apiClient.post(`/tickets/${id}/replies`, data)
},

/**
 * 关闭工单
 * @param {number} id - 工单ID
 * @returns {Promise<Object>} 响应数据
 */
closeTicket(id) {
  return apiClient.put(`/tickets/${id}/close`)
}
```

- [ ] **Step 2: 添加工单路由**

在 `client-user/src/router/index.js` 的 `children` 数组中添加：

```javascript
{
  path: 'tickets',
  name: 'Tickets',
  component: () => import('@/views/user/Tickets.vue'),
  meta: { title: '我的工单' }
},
{
  path: 'tickets/create',
  name: 'CreateTicket',
  component: () => import('@/views/user/CreateTicket.vue'),
  meta: { title: '创建工单' }
},
{
  path: 'tickets/:id',
  name: 'TicketDetail',
  component: () => import('@/views/user/TicketDetail.vue'),
  meta: { title: '工单详情' }
}
```

- [ ] **Step 3: 提交**

```bash
git add client-user/src/api/index.js client-user/src/router/index.js
git commit -m "feat: 添加用户端工单 API 和路由"
```

---

## Task 7: 用户端前端 - 工单列表页

**Files:**
- Create: `client-user/src/views/user/Tickets.vue`

- [ ] **Step 1: 创建工单列表页**

```vue
<template>
  <div class="tickets-container">
    <div class="page-header">
      <h1 class="page-title">我的工单</h1>
      <el-button type="primary" @click="$router.push('/user/tickets/create')">
        创建工单
      </el-button>
    </div>

    <div class="content-card">
      <el-table :data="tickets" v-loading="loading" style="width: 100%">
        <el-table-column prop="title" label="工单标题" min-width="200">
          <template #default="{ row }">
            <router-link :to="`/user/tickets/${row.id}`" class="ticket-link">
              {{ row.title }}
            </router-link>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)">
              {{ getStatusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="180">
          <template #default="{ row }">
            {{ formatTime(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-button link type="primary" @click="$router.push(`/user/tickets/${row.id}`)">
              查看
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination" v-if="total > limit">
        <el-pagination
          v-model:current-page="page"
          :page-size="limit"
          :total="total"
          layout="prev, pager, next"
          @current-change="fetchTickets"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '@/api'

const tickets = ref([])
const loading = ref(false)
const page = ref(1)
const limit = ref(10)
const total = ref(0)

function getStatusType(status) {
  const map = { open: 'info', pending: 'warning', closed: '' }
  return map[status] || ''
}

function getStatusText(status) {
  const map = { open: '待处理', pending: '处理中', closed: '已关闭' }
  return map[status] || status
}

function formatTime(timestamp) {
  if (!timestamp) return '-'
  const date = new Date(timestamp * 1000)
  return date.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  })
}

async function fetchTickets() {
  try {
    loading.value = true
    const response = await api.user.getTickets({ page: page.value, limit: limit.value })
    if (response.code === 0) {
      tickets.value = response.data.list
      total.value = response.data.total
    }
  } catch (error) {
    console.error('获取工单列表失败:', error)
    ElMessage.error('获取工单列表失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchTickets()
})
</script>

<style scoped>
.tickets-container {
  max-width: 1000px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}

.content-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 20px;
}

.ticket-link {
  color: #409eff;
  text-decoration: none;
}

.ticket-link:hover {
  text-decoration: underline;
}

.pagination {
  margin-top: 20px;
  display: flex;
  justify-content: center;
}
</style>
```

- [ ] **Step 2: 提交**

```bash
git add client-user/src/views/user/Tickets.vue
git commit -m "feat: 添加用户端工单列表页"
```

---

## Task 8: 用户端前端 - 创建工单页

**Files:**
- Create: `client-user/src/views/user/CreateTicket.vue`

- [ ] **Step 1: 创建创建工单页**

```vue
<template>
  <div class="create-ticket-container">
    <div class="page-header">
      <h1 class="page-title">创建工单</h1>
      <el-button @click="$router.push('/user/tickets')">返回列表</el-button>
    </div>

    <div class="content-card">
      <el-form :model="form" :rules="rules" ref="formRef" label-width="100px">
        <el-form-item label="工单标题" prop="title">
          <el-input v-model="form.title" placeholder="请输入工单标题" maxlength="50" show-word-limit />
        </el-form-item>
        <el-form-item label="问题描述" prop="description">
          <el-input v-model="form.description" type="textarea" :rows="6" placeholder="请详细描述您遇到的问题" maxlength="500" show-word-limit />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSubmit" :loading="submitting">提交工单</el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import api from '@/api'

const router = useRouter()
const formRef = ref(null)
const submitting = ref(false)

const form = ref({
  title: '',
  description: ''
})

const rules = {
  title: [
    { required: true, message: '请输入工单标题', trigger: 'blur' },
    { max: 50, message: '工单标题不能超过50字', trigger: 'blur' }
  ],
  description: [
    { required: true, message: '请输入问题描述', trigger: 'blur' },
    { max: 500, message: '问题描述不能超过500字', trigger: 'blur' }
  ]
}

async function handleSubmit() {
  try {
    await formRef.value.validate()
    submitting.value = true

    const response = await api.user.createTicket(form.value)
    if (response.code === 0) {
      ElMessage.success('工单创建成功')
      router.push(`/user/tickets/${response.data.id}`)
    }
  } catch (error) {
    if (error !== false) {
      console.error('创建工单失败:', error)
      ElMessage.error('创建工单失败')
    }
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.create-ticket-container {
  max-width: 800px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}

.content-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 30px;
}
</style>
```

- [ ] **Step 2: 提交**

```bash
git add client-user/src/views/user/CreateTicket.vue
git commit -m "feat: 添加用户端创建工单页"
```

---

## Task 9: 用户端前端 - 工单详情页

**Files:**
- Create: `client-user/src/views/user/TicketDetail.vue`

- [ ] **Step 1: 创建工单详情页**

```vue
<template>
  <div class="ticket-detail-container">
    <div class="page-header">
      <h1 class="page-title">工单详情</h1>
      <div class="header-actions">
        <el-button @click="$router.push('/user/tickets')">返回列表</el-button>
        <el-button 
          v-if="ticket && ticket.status !== 'closed'" 
          type="danger" 
          @click="handleClose"
        >
          关闭工单
        </el-button>
      </div>
    </div>

    <div class="content-card" v-loading="loading">
      <template v-if="ticket">
        <!-- 工单信息 -->
        <div class="ticket-info">
          <div class="info-header">
            <h2 class="ticket-title">{{ ticket.title }}</h2>
            <el-tag :type="getStatusType(ticket.status)">
              {{ getStatusText(ticket.status) }}
            </el-tag>
          </div>
          <div class="info-meta">
            <span>创建时间：{{ formatTime(ticket.created_at) }}</span>
          </div>
          <div class="ticket-description">
            {{ ticket.description }}
          </div>
        </div>

        <!-- 回复列表 -->
        <div class="replies-section">
          <h3 class="section-title">回复记录</h3>
          <div class="replies-list">
            <div 
              v-for="reply in ticket.replies" 
              :key="reply.id"
              class="reply-item"
              :class="{ 'reply-user': reply.user_id, 'reply-admin': reply.admin_id }"
            >
              <div class="reply-header">
                <span class="reply-name">{{ reply.reply_name }}</span>
                <span class="reply-time">{{ formatTime(reply.created_at) }}</span>
              </div>
              <div class="reply-content">{{ reply.content }}</div>
            </div>
          </div>
        </div>

        <!-- 回复输入框 -->
        <div class="reply-input" v-if="ticket.status !== 'closed'">
          <el-input
            v-model="replyContent"
            type="textarea"
            :rows="4"
            placeholder="请输入回复内容"
            maxlength="500"
            show-word-limit
          />
          <div class="reply-actions">
            <el-button type="primary" @click="handleReply" :loading="replying">
              发送回复
            </el-button>
          </div>
        </div>

        <div class="closed-notice" v-else>
          <el-alert title="工单已关闭" type="info" :closable="false" show-icon />
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/api'

const route = useRoute()
const router = useRouter()
const ticket = ref(null)
const loading = ref(false)
const replyContent = ref('')
const replying = ref(false)

function getStatusType(status) {
  const map = { open: 'info', pending: 'warning', closed: '' }
  return map[status] || ''
}

function getStatusText(status) {
  const map = { open: '待处理', pending: '处理中', closed: '已关闭' }
  return map[status] || status
}

function formatTime(timestamp) {
  if (!timestamp) return '-'
  const date = new Date(timestamp * 1000)
  return date.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  })
}

async function fetchTicket() {
  try {
    loading.value = true
    const id = route.params.id
    const response = await api.user.getTicketDetail(id)
    if (response.code === 0) {
      ticket.value = response.data
    }
  } catch (error) {
    console.error('获取工单详情失败:', error)
    ElMessage.error('获取工单详情失败')
  } finally {
    loading.value = false
  }
}

async function handleReply() {
  if (!replyContent.value.trim()) {
    ElMessage.warning('请输入回复内容')
    return
  }

  try {
    replying.value = true
    const id = route.params.id
    const response = await api.user.replyTicket(id, { content: replyContent.value })
    if (response.code === 0) {
      ElMessage.success('回复成功')
      replyContent.value = ''
      fetchTicket()
    }
  } catch (error) {
    console.error('回复失败:', error)
    ElMessage.error('回复失败')
  } finally {
    replying.value = false
  }
}

async function handleClose() {
  try {
    await ElMessageBox.confirm('确定要关闭此工单吗？', '确认关闭', {
      type: 'warning'
    })
    
    const id = route.params.id
    const response = await api.user.closeTicket(id)
    if (response.code === 0) {
      ElMessage.success('工单已关闭')
      fetchTicket()
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('关闭工单失败:', error)
      ElMessage.error('关闭工单失败')
    }
  }
}

onMounted(() => {
  fetchTicket()
})
</script>

<style scoped>
.ticket-detail-container {
  max-width: 900px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.content-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 30px;
}

.ticket-info {
  margin-bottom: 30px;
  padding-bottom: 20px;
  border-bottom: 1px solid #ebeef5;
}

.info-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.ticket-title {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}

.info-meta {
  color: #909399;
  font-size: 14px;
  margin-bottom: 15px;
}

.ticket-description {
  color: #606266;
  line-height: 1.6;
  white-space: pre-wrap;
}

.replies-section {
  margin-bottom: 30px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin: 0 0 20px 0;
}

.replies-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.reply-item {
  padding: 15px;
  border-radius: 8px;
  max-width: 80%;
}

.reply-user {
  background: #e6f7ff;
  border: 1px solid #91d5ff;
  align-self: flex-start;
}

.reply-admin {
  background: #f5f5f5;
  border: 1px solid #d9d9d9;
  align-self: flex-end;
}

.reply-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.reply-name {
  font-weight: 600;
  color: #303133;
}

.reply-time {
  color: #909399;
  font-size: 12px;
}

.reply-content {
  color: #606266;
  line-height: 1.6;
  white-space: pre-wrap;
}

.reply-input {
  margin-top: 30px;
  padding-top: 20px;
  border-top: 1px solid #ebeef5;
}

.reply-actions {
  margin-top: 15px;
  display: flex;
  justify-content: flex-end;
}

.closed-notice {
  margin-top: 30px;
}
</style>
```

- [ ] **Step 2: 提交**

```bash
git add client-user/src/views/user/TicketDetail.vue
git commit -m "feat: 添加用户端工单详情页"
```

---

## Task 10: 用户端前端 - 添加导航菜单

**Files:**
- Modify: `client-user/src/views/user/Layout.vue`

- [ ] **Step 1: 在侧边栏菜单中添加工单项**

在 Layout.vue 的菜单列表中添加：

```javascript
{
  path: '/user/tickets',
  name: '工单支持',
  icon: 'ChatDotRound'
}
```

- [ ] **Step 2: 提交**

```bash
git add client-user/src/views/user/Layout.vue
git commit -m "feat: 用户端侧边栏添加工单菜单"
```

---

## Task 11: 管理端前端 - API 和路由

**Files:**
- Modify: `client-admin/src/api/index.js`
- Modify: `client-admin/src/router/index.js`

- [ ] **Step 1: 添加工单 API**

在 `client-admin/src/api/index.js` 的 `adminApi` 对象中添加：

```javascript
/**
 * 获取工单统计
 * @returns {Promise<Object>} 响应数据
 */
getTicketStats() {
  return apiClient.get('/tickets/stats')
},

/**
 * 获取工单列表
 * @param {Object} params - 查询参数
 * @returns {Promise<Object>} 响应数据
 */
getTickets(params) {
  return apiClient.get('/tickets', { params })
},

/**
 * 获取工单详情
 * @param {number} id - 工单ID
 * @returns {Promise<Object>} 响应数据
 */
getTicketDetail(id) {
  return apiClient.get(`/tickets/${id}`)
},

/**
 * 回复工单
 * @param {number} id - 工单ID
 * @param {Object} data - 回复数据
 * @returns {Promise<Object>} 响应数据
 */
replyTicket(id, data) {
  return apiClient.post(`/tickets/${id}/replies`, data)
},

/**
 * 关闭工单
 * @param {number} id - 工单ID
 * @returns {Promise<Object>} 响应数据
 */
closeTicket(id) {
  return apiClient.put(`/tickets/${id}/close`)
}
```

- [ ] **Step 2: 添加工单路由**

在 `client-admin/src/router/index.js` 的 `children` 数组中添加：

```javascript
{
  path: 'tickets',
  name: 'Tickets',
  component: () => import('@/views/Tickets.vue'),
  meta: { title: '工单管理' }
},
{
  path: 'tickets/:id',
  name: 'TicketDetail',
  component: () => import('@/views/TicketDetail.vue'),
  meta: { title: '工单详情' }
}
```

- [ ] **Step 3: 提交**

```bash
git add client-admin/src/api/index.js client-admin/src/router/index.js
git commit -m "feat: 添加管理端工单 API 和路由"
```

---

## Task 12: 管理端前端 - 工单列表页

**Files:**
- Create: `client-admin/src/views/Tickets.vue`

- [ ] **Step 1: 创建工单列表页**

```vue
<template>
  <div class="tickets-container">
    <div class="page-header">
      <h1 class="page-title">工单管理</h1>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-row">
      <el-card class="stat-card">
        <div class="stat-value">{{ stats.open_count || 0 }}</div>
        <div class="stat-label">待处理</div>
      </el-card>
      <el-card class="stat-card">
        <div class="stat-value">{{ stats.pending_count || 0 }}</div>
        <div class="stat-label">处理中</div>
      </el-card>
      <el-card class="stat-card">
        <div class="stat-value">{{ stats.today_count || 0 }}</div>
        <div class="stat-label">今日新增</div>
      </el-card>
    </div>

    <!-- 搜索和筛选 -->
    <div class="filter-bar">
      <el-input 
        v-model="keyword" 
        placeholder="搜索工单标题或用户邮箱" 
        clearable 
        style="width: 300px"
        @keyup.enter="fetchTickets"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>
      <el-select v-model="statusFilter" placeholder="状态筛选" clearable style="width: 150px">
        <el-option label="待处理" value="open" />
        <el-option label="处理中" value="pending" />
        <el-option label="已关闭" value="closed" />
      </el-select>
      <el-button type="primary" @click="fetchTickets">搜索</el-button>
    </div>

    <!-- 工单列表 -->
    <div class="content-card">
      <el-table :data="tickets" v-loading="loading" style="width: 100%">
        <el-table-column prop="title" label="工单标题" min-width="200">
          <template #default="{ row }">
            <router-link :to="`/admin/tickets/${row.id}`" class="ticket-link">
              {{ row.title }}
            </router-link>
          </template>
        </el-table-column>
        <el-table-column prop="user_email" label="用户邮箱" width="200" />
        <el-table-column prop="status" label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)">
              {{ getStatusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="180">
          <template #default="{ row }">
            {{ formatTime(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-button link type="primary" @click="$router.push(`/admin/tickets/${row.id}`)">
              查看
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination" v-if="total > limit">
        <el-pagination
          v-model:current-page="page"
          :page-size="limit"
          :total="total"
          layout="prev, pager, next"
          @current-change="fetchTickets"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import api from '@/api'

const tickets = ref([])
const loading = ref(false)
const page = ref(1)
const limit = ref(10)
const total = ref(0)
const keyword = ref('')
const statusFilter = ref('')
const stats = ref({})

function getStatusType(status) {
  const map = { open: 'info', pending: 'warning', closed: '' }
  return map[status] || ''
}

function getStatusText(status) {
  const map = { open: '待处理', pending: '处理中', closed: '已关闭' }
  return map[status] || status
}

function formatTime(timestamp) {
  if (!timestamp) return '-'
  const date = new Date(timestamp * 1000)
  return date.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  })
}

async function fetchStats() {
  try {
    const response = await api.admin.getTicketStats()
    if (response.code === 0) {
      stats.value = response.data
    }
  } catch (error) {
    console.error('获取工单统计失败:', error)
  }
}

async function fetchTickets() {
  try {
    loading.value = true
    const params = {
      page: page.value,
      limit: limit.value
    }
    if (statusFilter.value) params.status = statusFilter.value
    if (keyword.value) params.keyword = keyword.value

    const response = await api.admin.getTickets(params)
    if (response.code === 0) {
      tickets.value = response.data.list
      total.value = response.data.total
    }
  } catch (error) {
    console.error('获取工单列表失败:', error)
    ElMessage.error('获取工单列表失败')
  } finally {
    loading.value = false
  }
}

watch(statusFilter, () => {
  page.value = 1
  fetchTickets()
})

onMounted(() => {
  fetchStats()
  fetchTickets()
})
</script>

<style scoped>
.tickets-container {
  width: 100%;
}

.page-header {
  margin-bottom: 20px;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}

.stats-row {
  display: flex;
  gap: 20px;
  margin-bottom: 20px;
}

.stat-card {
  flex: 1;
  text-align: center;
}

.stat-value {
  font-size: 32px;
  font-weight: 600;
  color: #409eff;
}

.stat-label {
  font-size: 14px;
  color: #909399;
  margin-top: 5px;
}

.filter-bar {
  display: flex;
  gap: 15px;
  margin-bottom: 20px;
}

.content-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 20px;
}

.ticket-link {
  color: #409eff;
  text-decoration: none;
}

.ticket-link:hover {
  text-decoration: underline;
}

.pagination {
  margin-top: 20px;
  display: flex;
  justify-content: center;
}
</style>
```

- [ ] **Step 2: 提交**

```bash
git add client-admin/src/views/Tickets.vue
git commit -m "feat: 添加管理端工单列表页"
```

---

## Task 13: 管理端前端 - 工单详情页

**Files:**
- Create: `client-admin/src/views/TicketDetail.vue`

- [ ] **Step 1: 创建工单详情页**

```vue
<template>
  <div class="ticket-detail-container">
    <div class="page-header">
      <h1 class="page-title">工单详情</h1>
      <div class="header-actions">
        <el-button @click="$router.push('/admin/tickets')">返回列表</el-button>
        <el-button 
          v-if="ticket && ticket.status !== 'closed'" 
          type="danger" 
          @click="handleClose"
        >
          关闭工单
        </el-button>
      </div>
    </div>

    <div class="content-card" v-loading="loading">
      <template v-if="ticket">
        <!-- 工单信息 -->
        <div class="ticket-info">
          <div class="info-header">
            <h2 class="ticket-title">{{ ticket.title }}</h2>
            <el-tag :type="getStatusType(ticket.status)">
              {{ getStatusText(ticket.status) }}
            </el-tag>
          </div>
          <div class="info-meta">
            <span>用户：{{ ticket.user?.email || '-' }}</span>
            <span>创建时间：{{ formatTime(ticket.created_at) }}</span>
          </div>
          <div class="ticket-description">
            {{ ticket.description }}
          </div>
        </div>

        <!-- 回复列表 -->
        <div class="replies-section">
          <h3 class="section-title">回复记录</h3>
          <div class="replies-list">
            <div 
              v-for="reply in ticket.replies" 
              :key="reply.id"
              class="reply-item"
              :class="{ 'reply-user': reply.user_id, 'reply-admin': reply.admin_id }"
            >
              <div class="reply-header">
                <span class="reply-name">{{ reply.reply_name }}</span>
                <span class="reply-time">{{ formatTime(reply.created_at) }}</span>
              </div>
              <div class="reply-content">{{ reply.content }}</div>
            </div>
          </div>
        </div>

        <!-- 回复输入框 -->
        <div class="reply-input" v-if="ticket.status !== 'closed'">
          <el-input
            v-model="replyContent"
            type="textarea"
            :rows="4"
            placeholder="请输入回复内容"
            maxlength="500"
            show-word-limit
          />
          <div class="reply-actions">
            <el-button type="primary" @click="handleReply" :loading="replying">
              发送回复
            </el-button>
          </div>
        </div>

        <div class="closed-notice" v-else>
          <el-alert title="工单已关闭" type="info" :closable="false" show-icon />
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/api'

const route = useRoute()
const router = useRouter()
const ticket = ref(null)
const loading = ref(false)
const replyContent = ref('')
const replying = ref(false)

function getStatusType(status) {
  const map = { open: 'info', pending: 'warning', closed: '' }
  return map[status] || ''
}

function getStatusText(status) {
  const map = { open: '待处理', pending: '处理中', closed: '已关闭' }
  return map[status] || status
}

function formatTime(timestamp) {
  if (!timestamp) return '-'
  const date = new Date(timestamp * 1000)
  return date.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  })
}

async function fetchTicket() {
  try {
    loading.value = true
    const id = route.params.id
    const response = await api.admin.getTicketDetail(id)
    if (response.code === 0) {
      ticket.value = response.data
    }
  } catch (error) {
    console.error('获取工单详情失败:', error)
    ElMessage.error('获取工单详情失败')
  } finally {
    loading.value = false
  }
}

async function handleReply() {
  if (!replyContent.value.trim()) {
    ElMessage.warning('请输入回复内容')
    return
  }

  try {
    replying.value = true
    const id = route.params.id
    const response = await api.admin.replyTicket(id, { content: replyContent.value })
    if (response.code === 0) {
      ElMessage.success('回复成功')
      replyContent.value = ''
      fetchTicket()
    }
  } catch (error) {
    console.error('回复失败:', error)
    ElMessage.error('回复失败')
  } finally {
    replying.value = false
  }
}

async function handleClose() {
  try {
    await ElMessageBox.confirm('确定要关闭此工单吗？', '确认关闭', {
      type: 'warning'
    })
    
    const id = route.params.id
    const response = await api.admin.closeTicket(id)
    if (response.code === 0) {
      ElMessage.success('工单已关闭')
      fetchTicket()
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('关闭工单失败:', error)
      ElMessage.error('关闭工单失败')
    }
  }
}

onMounted(() => {
  fetchTicket()
})
</script>

<style scoped>
.ticket-detail-container {
  width: 100%;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.content-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 30px;
}

.ticket-info {
  margin-bottom: 30px;
  padding-bottom: 20px;
  border-bottom: 1px solid #ebeef5;
}

.info-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.ticket-title {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}

.info-meta {
  color: #909399;
  font-size: 14px;
  margin-bottom: 15px;
  display: flex;
  gap: 20px;
}

.ticket-description {
  color: #606266;
  line-height: 1.6;
  white-space: pre-wrap;
}

.replies-section {
  margin-bottom: 30px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin: 0 0 20px 0;
}

.replies-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.reply-item {
  padding: 15px;
  border-radius: 8px;
  max-width: 80%;
}

.reply-user {
  background: #e6f7ff;
  border: 1px solid #91d5ff;
  align-self: flex-start;
}

.reply-admin {
  background: #f5f5f5;
  border: 1px solid #d9d9d9;
  align-self: flex-end;
}

.reply-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.reply-name {
  font-weight: 600;
  color: #303133;
}

.reply-time {
  color: #909399;
  font-size: 12px;
}

.reply-content {
  color: #606266;
  line-height: 1.6;
  white-space: pre-wrap;
}

.reply-input {
  margin-top: 30px;
  padding-top: 20px;
  border-top: 1px solid #ebeef5;
}

.reply-actions {
  margin-top: 15px;
  display: flex;
  justify-content: flex-end;
}

.closed-notice {
  margin-top: 30px;
}
</style>
```

- [ ] **Step 2: 提交**

```bash
git add client-admin/src/views/TicketDetail.vue
git commit -m "feat: 添加管理端工单详情页"
```

---

## Task 14: 管理端前端 - 添加导航菜单

**Files:**
- Modify: `client-admin/src/views/Layout.vue`

- [ ] **Step 1: 在侧边栏菜单中添加工单项**

在 Layout.vue 的菜单列表中添加：

```javascript
{
  path: '/admin/tickets',
  name: '工单管理',
  icon: 'ChatDotRound'
}
```

- [ ] **Step 2: 提交**

```bash
git add client-admin/src/views/Layout.vue
git commit -m "feat: 管理端侧边栏添加工单菜单"
```

---

## Task 15: 测试验证

- [ ] **Step 1: 重启服务器并测试 API**

```bash
# 重启服务器后测试用户端 API
node server/test/test-ticket-user.js

# 测试管理端 API
node server/test/test-ticket-admin.js
```

- [ ] **Step 2: 前端构建验证**

```bash
cd client-user && npm run build
cd client-admin && npm run build
```

- [ ] **Step 3: 最终提交**

```bash
git add -A
git commit -m "feat: 工单系统功能完成"
```

---

## 完成

计划完成，保存到 `docs/superpowers/plans/2026-05-05-ticket-system-plan.md`。

两种执行选项：

**1. Subagent-Driven (推荐)** - 每个任务分派一个新的子代理，任务间进行审查，快速迭代

**2. Inline Execution** - 在当前会话中执行任务，批量执行并设置检查点

选择哪种方式？
