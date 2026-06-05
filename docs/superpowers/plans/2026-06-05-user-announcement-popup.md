# User Announcement Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为用户端首页增加“最近一条系统公告”的 Markdown 弹窗，并按“每个用户 + 每条公告”在用户关闭弹窗后累计展示次数，由管理端配置弹窗显示次数。

**Architecture:** 后端作为弹窗展示判断的唯一来源。公告表新增 `popup_show_limit`，并新增用户-公告弹窗计数表；用户端首页通过独立接口查询是否需要弹窗，关闭时再单独上报，管理端在现有公告管理页补充配置字段与列表展示。

**Tech Stack:** Node.js、Express、PostgreSQL、Vue 3、Element Plus、Axios、`marked`

---

## File Structure

### Backend data and persistence

- Modify: `server/db/schema/tables.js`
  - 给 `announcements` 初始化表结构新增 `popup_show_limit`
  - 给新装环境初始化 `user_announcement_popup_stats`
- Modify: `server/db/schema/indexes.js`
  - 给 `user_announcement_popup_stats` 增加查询索引和唯一索引
- Create: `server/db/migrations/002-announcement-popup-settings.js`
  - 为现有数据库执行 `ALTER TABLE announcements ADD COLUMN popup_show_limit`
  - 创建 `user_announcement_popup_stats`
- Modify: `server/repositories/announcement-repository.js`
  - 补充 `popup_show_limit` 字段读写
  - 新增“最近一条启用公告”查询
- Create: `server/repositories/user-announcement-popup-repository.js`
  - 负责读取 / 创建 / 递增用户公告弹窗计数

### Backend services and routes

- Modify: `server/services/admin/announcements-service.js`
  - 处理 `popup_show_limit` 的新增、更新、返回
- Modify: `server/services/user/announcements-service.js`
  - 新增首页弹窗查询能力
  - 新增关闭弹窗上报能力
- Modify: `server/controllers/admin/announcements-controller.js`
  - 接收并返回 `popup_show_limit`
- Modify: `server/controllers/user/announcements-controller.js`
  - 暴露 `GET /popup/latest`
  - 暴露 `POST /:id/popup-close`
- Modify: `server/routes/admin/announcements.js`
  - 增加 `popup_show_limit` 参数校验
- Modify: `server/routes/user/announcements.js`
  - 增加首页弹窗查询与关闭上报路由

### Frontend admin and user

- Modify: `client-admin/src/api/index.js`
  - 管理端公告 API 透传 `popup_show_limit`
- Modify: `client-admin/src/views/Announcements.vue`
  - 新增输入框、列表列、默认值、回显逻辑
- Modify: `client-user/src/api/index.js`
  - 新增 `getLatestAnnouncementPopup()` 与 `reportAnnouncementPopupClose(id)`
- Modify: `client-user/src/views/user/Profile.vue`
  - 首页加载后查询弹窗数据
  - 新增公告弹窗、Markdown 内容区、关闭上报
  - 新增移动端宽度 / 高度 / 溢出约束

### Tests

- Create: `server/test/test-announcement-popup-service.js`
  - 覆盖后端核心规则：`0` 不弹、最新公告优先、计数递增、到上限不弹
- Modify: `server/test/test-add-announcement.js`
  - 覆盖新增公告时写入 `popup_show_limit`
- Modify: `server/test/test-update-announcement.js`
  - 覆盖编辑公告时更新 `popup_show_limit`

## Task 1: 数据库结构与仓储层

**Files:**
- Create: `server/db/migrations/002-announcement-popup-settings.js`
- Modify: `server/db/schema/tables.js`
- Modify: `server/db/schema/indexes.js`
- Modify: `server/repositories/announcement-repository.js`
- Create: `server/repositories/user-announcement-popup-repository.js`
- Test: `server/test/test-announcement-popup-service.js`

- [ ] **Step 1: 写失败的仓储级测试脚本骨架**

```javascript
const assert = require('assert')
const announcementRepository = require('../repositories/announcement-repository')
const popupRepository = require('../repositories/user-announcement-popup-repository')

async function run() {
  const fakeDb = {
    prepare() {
      throw new Error('请在实现后替换为测试桩')
    }
  }

  await assert.rejects(
    () => popupRepository.findByUserAndAnnouncement(fakeDb, 1, 2),
    /请在实现后替换为测试桩/
  )
}

run().catch(error => {
  console.error(error)
  process.exit(1)
})
```

- [ ] **Step 2: 先跑失败测试，确认新仓储尚未实现**

Run: `node server/test/test-announcement-popup-service.js`

Expected:
- 进程退出码非 `0`
- 报错包含 `Cannot find module '../repositories/user-announcement-popup-repository'` 或测试桩报错

- [ ] **Step 3: 在初始化 schema 中补齐新字段和新表**

```javascript
{
  logMessage: '公告表初始化完成',
  sql: `
    CREATE TABLE IF NOT EXISTS announcements (
      id SERIAL PRIMARY KEY,
      title VARCHAR(500) NOT NULL,
      content TEXT,
      pinned INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      popup_show_limit INTEGER DEFAULT 0,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
      updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
    )
  `
},
{
  logMessage: '用户公告弹窗计数表初始化完成',
  sql: `
    CREATE TABLE IF NOT EXISTS user_announcement_popup_stats (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
      shown_count INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
      updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
      UNIQUE(user_id, announcement_id)
    )
  `
}
```

- [ ] **Step 4: 在索引定义中补齐查询索引**

```javascript
'CREATE INDEX IF NOT EXISTS idx_user_announcement_popup_stats_user_id ON user_announcement_popup_stats(user_id)',
'CREATE INDEX IF NOT EXISTS idx_user_announcement_popup_stats_announcement_id ON user_announcement_popup_stats(announcement_id)',
'CREATE UNIQUE INDEX IF NOT EXISTS idx_user_announcement_popup_stats_user_announcement_unique ON user_announcement_popup_stats(user_id, announcement_id)'
```

- [ ] **Step 5: 编写现网库迁移脚本**

```javascript
const { Pool } = require('pg')
const config = require('../../config')

async function migrate() {
  const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database
  })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(`
      ALTER TABLE announcements
      ADD COLUMN IF NOT EXISTS popup_show_limit INTEGER DEFAULT 0
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_announcement_popup_stats (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
        shown_count INTEGER NOT NULL DEFAULT 0,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        UNIQUE(user_id, announcement_id)
      )
    `)

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_announcement_popup_stats_user_announcement_unique
      ON user_announcement_popup_stats(user_id, announcement_id)
    `)

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}
```

- [ ] **Step 6: 扩展公告仓储与新增弹窗计数仓储**

```javascript
async function findLatestEnabledAnnouncement(db) {
  return db.prepare(`
    SELECT id, title, content, pinned, enabled, popup_show_limit, created_at, updated_at
    FROM announcements
    WHERE enabled = 1
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get()
}

async function findByUserAndAnnouncement(db, userId, announcementId) {
  return db.prepare(`
    SELECT id, user_id, announcement_id, shown_count, created_at, updated_at
    FROM user_announcement_popup_stats
    WHERE user_id = ? AND announcement_id = ?
  `).get(userId, announcementId)
}

async function incrementShownCount(db, userId, announcementId) {
  return db.prepare(`
    INSERT INTO user_announcement_popup_stats (user_id, announcement_id, shown_count, updated_at)
    VALUES (?, ?, 1, EXTRACT(EPOCH FROM NOW()))
    ON CONFLICT (user_id, announcement_id)
    DO UPDATE SET
      shown_count = user_announcement_popup_stats.shown_count + 1,
      updated_at = EXTRACT(EPOCH FROM NOW())
  `).run(userId, announcementId)
}
```

- [ ] **Step 7: 跑静态检查确认仓储文件无语法错误**

Run:
- `node --check server/repositories/announcement-repository.js`
- `node --check server/repositories/user-announcement-popup-repository.js`
- `node --check server/db/migrations/002-announcement-popup-settings.js`

Expected:
- 三个命令均无输出并返回 `0`

- [ ] **Step 8: 跑仓储测试，确认新能力可用**

Run: `node server/test/test-announcement-popup-service.js`

Expected:
- 输出断言通过信息
- 退出码为 `0`

- [ ] **Step 9: 提交本任务**

```bash
git add server/db/schema/tables.js server/db/schema/indexes.js server/db/migrations/002-announcement-popup-settings.js server/repositories/announcement-repository.js server/repositories/user-announcement-popup-repository.js server/test/test-announcement-popup-service.js
git commit -m "新增公告弹窗数据结构与仓储支持"
```

## Task 2: 管理端公告字段扩展

**Files:**
- Modify: `server/services/admin/announcements-service.js`
- Modify: `server/controllers/admin/announcements-controller.js`
- Modify: `server/routes/admin/announcements.js`
- Modify: `client-admin/src/api/index.js`
- Modify: `client-admin/src/views/Announcements.vue`
- Test: `server/test/test-add-announcement.js`
- Test: `server/test/test-update-announcement.js`

- [ ] **Step 1: 给新增/编辑公告测试补充失败断言**

```javascript
JSON.stringify({
  title: '弹窗公告',
  content: '测试内容',
  pinned: 0,
  enabled: 1,
  popup_show_limit: 3
})

if (addRes.body?.data?.popup_show_limit !== 3) {
  throw new Error('新增公告未返回 popup_show_limit')
}
```

- [ ] **Step 2: 先运行管理端公告测试，确认字段尚未打通**

Run:
- `node server/test/test-add-announcement.js`
- `node server/test/test-update-announcement.js`

Expected:
- 至少一个脚本因 `popup_show_limit` 缺失而失败

- [ ] **Step 3: 扩展路由校验与管理端 service**

```javascript
body('popup_show_limit')
  .optional()
  .isInt({ min: 0 })
  .withMessage('popup_show_limit 必须是大于等于 0 的整数')
```

```javascript
if (payload.popup_show_limit !== undefined) {
  updates.push('popup_show_limit = ?')
  values.push(payload.popup_show_limit)
}
```

```javascript
const data = await announcementsService.createAnnouncement(req.app.locals.db, {
  title: req.body.title,
  content: req.body.content === undefined ? null : req.body.content,
  pinned: req.body.pinned === undefined ? false : req.body.pinned,
  enabled: req.body.enabled === undefined ? true : req.body.enabled,
  popup_show_limit: req.body.popup_show_limit === undefined ? 0 : req.body.popup_show_limit
})
```

- [ ] **Step 4: 在管理端 API 与页面中增加输入、回显和列表列**

```javascript
const announcementForm = reactive({
  title: '',
  content: '',
  pinned: false,
  enabled: true,
  popup_show_limit: 0
})
```

```vue
<el-table-column prop="popup_show_limit" label="弹窗次数" width="110" />

<el-form-item label="弹窗次数">
  <el-input-number
    v-model="announcementForm.popup_show_limit"
    :min="0"
    :step="1"
    controls-position="right"
  />
  <div class="field-tip">0 表示永不弹出，正整数表示每个用户最多弹出次数</div>
</el-form-item>
```

- [ ] **Step 5: 跑语法检查与管理端相关脚本**

Run:
- `node --check server/services/admin/announcements-service.js`
- `node --check server/controllers/admin/announcements-controller.js`
- `node --check server/routes/admin/announcements.js`
- `node server/test/test-add-announcement.js`
- `node server/test/test-update-announcement.js`

Expected:
- `node --check` 全部通过
- 两个测试脚本返回新增 / 更新后的 `popup_show_limit`

- [ ] **Step 6: 提交本任务**

```bash
git add server/services/admin/announcements-service.js server/controllers/admin/announcements-controller.js server/routes/admin/announcements.js client-admin/src/api/index.js client-admin/src/views/Announcements.vue server/test/test-add-announcement.js server/test/test-update-announcement.js
git commit -m "扩展管理端公告弹窗次数配置"
```

## Task 3: 用户端弹窗查询与关闭上报接口

**Files:**
- Modify: `server/services/user/announcements-service.js`
- Modify: `server/controllers/user/announcements-controller.js`
- Modify: `server/routes/user/announcements.js`
- Create: `server/test/test-user-announcement-popup-routes.js`

- [ ] **Step 1: 写用户侧接口失败测试**

```javascript
const popupRes = await request(30000, '/api/user/announcements/popup/latest', 'GET', {
  Authorization: `Bearer ${token}`
})

if (popupRes.status !== 200 || popupRes.body?.data?.should_popup === undefined) {
  throw new Error('首页公告弹窗接口未返回 should_popup')
}
```

```javascript
const closeRes = await request(30000, `/api/user/announcements/${announcementId}/popup-close`, 'POST', {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json'
}, '{}')
```

- [ ] **Step 2: 先运行新测试，确认路由尚不存在**

Run: `node server/test/test-user-announcement-popup-routes.js`

Expected:
- 返回 `404` 或因缺少 `should_popup` 断言失败

- [ ] **Step 3: 在用户 service 中实现“查询最新弹窗公告”和“关闭上报”**

```javascript
async function getLatestAnnouncementPopup(db, userId) {
  const announcement = await announcementRepository.findLatestEnabledAnnouncement(db)
  if (!announcement || Number(announcement.popup_show_limit) === 0) {
    return { announcement: null, shown_count: 0, should_popup: false }
  }

  const stat = await popupRepository.findByUserAndAnnouncement(db, userId, announcement.id)
  const shownCount = Number(stat?.shown_count || 0)

  return {
    announcement,
    shown_count: shownCount,
    should_popup: shownCount < Number(announcement.popup_show_limit)
  }
}

async function reportAnnouncementPopupClose(db, userId, announcementId) {
  const announcement = await announcementRepository.findAnnouncementById(db, announcementId)
  if (!announcement || !Number(announcement.enabled)) {
    throw new Error('公告不存在或未启用')
  }

  await popupRepository.incrementShownCount(db, userId, announcementId)
  return { message: '公告弹窗关闭已记录' }
}
```

- [ ] **Step 4: 在 controller 与 route 中补齐接口与参数校验**

```javascript
router.get('/popup/latest', authenticateUser, announcementsController.getLatestPopupAnnouncement)

router.post('/:id/popup-close', authenticateUser, [
  param('id').isInt({ min: 1 }).withMessage('ID 必须是大于 0 的整数')
], announcementsController.reportPopupClose)
```

```javascript
async function getLatestPopupAnnouncement(req, res) {
  const data = await announcementsService.getLatestAnnouncementPopup(req.app.locals.db, req.user.id)
  return legacySuccess(res, data)
}

async function reportPopupClose(req, res) {
  const announcementId = parseInt(req.params.id, 10)
  const data = await announcementsService.reportAnnouncementPopupClose(req.app.locals.db, req.user.id, announcementId)
  return legacySuccess(res, data)
}
```

- [ ] **Step 5: 跑语法检查和用户侧接口测试**

Run:
- `node --check server/services/user/announcements-service.js`
- `node --check server/controllers/user/announcements-controller.js`
- `node --check server/routes/user/announcements.js`
- `node server/test/test-user-announcement-popup-routes.js`

Expected:
- `GET /api/user/announcements/popup/latest` 返回 `announcement / shown_count / should_popup`
- `POST /api/user/announcements/:id/popup-close` 返回成功结构

- [ ] **Step 6: 提交本任务**

```bash
git add server/services/user/announcements-service.js server/controllers/user/announcements-controller.js server/routes/user/announcements.js server/test/test-user-announcement-popup-routes.js
git commit -m "新增用户端公告弹窗查询与关闭上报接口"
```

## Task 4: 用户端首页弹窗与移动端适配

**Files:**
- Modify: `client-user/src/api/index.js`
- Modify: `client-user/src/views/user/Profile.vue`
- Test: `client-user` build

- [ ] **Step 1: 先在前端 API 层补接口定义**

```javascript
getLatestAnnouncementPopup() {
  return apiClient.get('/announcements/popup/latest')
},

reportAnnouncementPopupClose(id) {
  return apiClient.post(`/announcements/${id}/popup-close`, {})
}
```

- [ ] **Step 2: 在首页脚本区增加弹窗状态与请求逻辑**

```javascript
const announcementPopupVisible = ref(false)
const popupAnnouncement = ref(null)
const popupClosing = ref(false)

async function fetchAnnouncementPopup() {
  try {
    const response = await api.user.getLatestAnnouncementPopup()
    if (response.code === 0 && response.data?.should_popup && response.data?.announcement) {
      popupAnnouncement.value = response.data.announcement
      announcementPopupVisible.value = true
    }
  } catch (error) {
    console.error('获取公告弹窗失败:', error)
  }
}

async function handleAnnouncementPopupClose() {
  const announcementId = popupAnnouncement.value?.id
  announcementPopupVisible.value = false

  if (!announcementId || popupClosing.value) return

  try {
    popupClosing.value = true
    await api.user.reportAnnouncementPopupClose(announcementId)
  } catch (error) {
    console.error('上报公告弹窗关闭失败:', error)
  } finally {
    popupClosing.value = false
  }
}
```

- [ ] **Step 3: 在首页模板中新增 Markdown 公告弹窗**

```vue
<el-dialog
  v-model="announcementPopupVisible"
  title="系统公告"
  :width="announcementDialogWidth"
  :close-on-click-modal="false"
  class="announcement-popup-dialog"
  @close="handleAnnouncementPopupClose"
>
  <div v-if="popupAnnouncement" class="announcement-popup-body">
    <div class="announcement-popup-head">
      <h3 class="announcement-popup-title">{{ popupAnnouncement.title }}</h3>
      <span class="announcement-popup-time">{{ formatDate(popupAnnouncement.created_at) }}</span>
    </div>
    <div
      class="announcement-popup-content"
      v-html="renderMarkdown(popupAnnouncement.content)"
    ></div>
  </div>
</el-dialog>
```

- [ ] **Step 4: 为桌面端和移动端增加宽高与溢出约束**

```javascript
const announcementDialogWidth = computed(() => (windowWidth.value <= 768 ? '92vw' : '720px'))
```

```css
.announcement-popup-body {
  display: flex;
  flex-direction: column;
  max-height: 80vh;
  min-width: 0;
}

.announcement-popup-content {
  overflow-y: auto;
  overflow-x: hidden;
  word-break: break-word;
  line-height: 1.8;
}

.announcement-popup-content :deep(pre) {
  overflow-x: auto;
}

.announcement-popup-content :deep(table) {
  display: block;
  overflow-x: auto;
  max-width: 100%;
}

@media (max-width: 768px) {
  .announcement-popup-dialog :deep(.el-dialog) {
    width: 92vw !important;
    max-width: 92vw;
    margin-top: 4vh !important;
  }

  .announcement-popup-dialog :deep(.el-dialog__body) {
    max-height: 80vh;
    overflow: hidden;
    padding: 16px !important;
  }
}
```

- [ ] **Step 5: 将弹窗查询接入首页加载流程**

```javascript
onMounted(() => {
  window.addEventListener('resize', handleResize)
  fetchUserInfo()
  fetchAnnouncements()
  fetchAnnouncementPopup()
  checkSyncStatus()
})
```

- [ ] **Step 6: 跑前端语法检查与构建**

Run:
- `npm run build` in `client-user`
- `npm run build` in `client-admin`

Expected:
- 两个前端构建均成功
- 无 `Profile.vue` 或 `Announcements.vue` 语法错误

- [ ] **Step 7: 做移动端手工验证**

Run:
- 在浏览器 DevTools 切换 `375px`、`390px`、`430px`

Expected:
- 弹窗左右留白正常
- 无横向溢出
- 长 Markdown 内容可纵向滚动
- 代码块和表格不会把弹窗撑出屏幕

- [ ] **Step 8: 提交本任务**

```bash
git add client-user/src/api/index.js client-user/src/views/user/Profile.vue client-admin/src/views/Announcements.vue client-admin/src/api/index.js
git commit -m "实现用户端首页公告弹窗与移动端适配"
```

## Task 5: 整体验证与交付检查

**Files:**
- Verify only

- [ ] **Step 1: 运行后端相关脚本做回归**

Run:
- `node server/test/test-add-announcement.js`
- `node server/test/test-update-announcement.js`
- `node server/test/test-announcement-popup-service.js`
- `node server/test/test-user-announcement-popup-routes.js`
- `node server/test/test-announcements.js`

Expected:
- 所有脚本均返回成功
- 用户公告列表仍可正常读取

- [ ] **Step 2: 运行静态检查确认主要改动文件语法正确**

Run:
- `node --check server/services/admin/announcements-service.js`
- `node --check server/services/user/announcements-service.js`
- `node --check server/controllers/admin/announcements-controller.js`
- `node --check server/controllers/user/announcements-controller.js`
- `node --check server/routes/admin/announcements.js`
- `node --check server/routes/user/announcements.js`

Expected:
- 全部返回 `0`

- [ ] **Step 3: 记录测试日志并整理交付说明**

需要整理的交付点：
- 管理端公告编辑支持 `popup_show_limit`
- 用户端首页只弹最近一条启用公告
- `0` 表示永不弹出
- 关闭弹窗后才累计 `shown_count`
- 移动端弹窗在 `375px / 390px / 430px` 不溢出

- [ ] **Step 4: 提醒用户执行数据库迁移并重启后端**

Run:
- `node server/db/migrations/002-announcement-popup-settings.js`

Expected:
- 输出迁移完成日志

交付提醒：
- 因为修改了 `server/**/*.js`，完成后必须提醒用户重启服务器

- [ ] **Step 5: 最终提交**

```bash
git add server client-user client-admin
git commit -m "完成首页公告弹窗与显示次数控制"
```

## Self-Review

- Spec coverage:
  - “每个用户 + 每条公告”计数：Task 1、Task 3
  - `0` 永不弹出：Task 3
  - 只取最近一条启用公告：Task 1、Task 3
  - 关闭弹窗后再 `shown_count + 1`：Task 3、Task 4
  - Markdown 弹窗：Task 4
  - 移动端不溢出屏幕：Task 4、Task 5
- Placeholder scan:
  - 无 `TODO` / `TBD` / “类似上一步”
- Type consistency:
  - 统一使用 `popup_show_limit`、`shown_count`、`should_popup`
