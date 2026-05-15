# 新用户同步状态检测 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新用户首次登录时，检测同步是否完成，同步未完成时显示loading弹窗提示用户

**Architecture:** 在 users 表添加 sync_status 字段，后端同步开始和结束时更新状态，前端轮询检查状态并自动隐藏弹窗

**Tech Stack:** Node.js, Express, PostgreSQL, Vue 3, Element Plus

---

## 文件结构

### 后端

1. `server/db/init.js`：添加 sync_status 字段到 users 表
2. `server/db/migrations/002-sync-status-migration.js`：迁移脚本
3. `server/services/order-service.js`：同步开始和结束时更新 sync_status
4. `server/routes/user/auth.js`：返回 sync_status 字段
5. 新增 `server/routes/user/sync-status.js`：轮询接口

### 前端

1. `client-user/src/api/index.js`：添加轮询接口
2. `client-user/src/views/user/Profile.vue`：添加loading弹窗和轮询逻辑

---

### Task 1: 数据库迁移脚本

**Files:**
- Create: `server/db/migrations/002-sync-status-migration.js`

- [ ] **Step 1: 创建迁移脚本**

```javascript
/**
 * 数据库迁移脚本: 002-sync-status-migration
 * 
 * 变更内容：
 * 1. users 表添加 sync_status 字段（0=未同步，1=同步中，2=已完成）
 * 2. 将现有用户的 sync_status 设置为 2（已完成）
 * 
 * 使用方法：node server/db/migrations/002-sync-status-migration.js
 */

const { Pool } = require('pg');
const config = require('../../config');

async function migrate() {
  const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database
  });

  const client = await pool.connect();

  try {
    console.log('=== 迁移 002: sync-status ===\n');

    // ========================================
    // 1. users 表添加 sync_status 字段
    // ========================================
    console.log('[1/2] 检查 users.sync_status 字段...');
    const hasSyncStatus = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'sync_status'
      )
    `);

    if (!hasSyncStatus.rows[0].exists) {
      await client.query(`ALTER TABLE users ADD COLUMN sync_status INTEGER DEFAULT 0`);
      console.log('  已添加 sync_status 字段');
    } else {
      console.log('  sync_status 字段已存在，跳过');
    }

    // ========================================
    // 2. 将现有用户的 sync_status 设置为 2（已完成）
    // ========================================
    console.log('\n[2/2] 更新现有用户的 sync_status...');
    const updateResult = await client.query(`
      UPDATE users SET sync_status = 2 WHERE sync_status != 2
    `);
    console.log(`  已更新 ${updateResult.rowCount} 个用户的 sync_status 为 2`);

    console.log('\n=== 迁移完成 ===');

  } catch (error) {
    console.error('\n迁移失败:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().then(() => {
  console.log('\n脚本执行成功');
  process.exit(0);
}).catch(error => {
  console.error('\n脚本执行失败:', error);
  process.exit(1);
});
```

- [ ] **Step 2: 运行迁移脚本**

```bash
cd server && node db/migrations/002-sync-status-migration.js
```

Expected: 迁移成功，输出 "脚本执行成功"

- [ ] **Step 3: 提交**

```bash
git add server/db/migrations/002-sync-status-migration.js
git commit -m "feat: 添加同步状态迁移脚本"
```

---

### Task 2: 修改 order-service.js 更新同步状态

**Files:**
- Modify: `server/services/order-service.js:30-169`

- [ ] **Step 1: 在同步开始时更新 sync_status**

在 `syncUserToXuiServers` 函数中，在查询在线服务器之后添加：

```javascript
// 同步开始时更新状态
await db.prepare('UPDATE users SET sync_status = 1 WHERE id = ?').run(user.id);
logger.info(`用户 ${user.email} 同步状态更新为 1（同步中）`);
```

- [ ] **Step 2: 在同步完成时更新 sync_status**

在 `syncUserToXuiServers` 函数的 finally 块中添加：

```javascript
// 同步完成时更新状态（包括失败）
await db.prepare('UPDATE users SET sync_status = 2 WHERE id = ?').run(user.id);
logger.info(`用户 ${user.email} 同步状态更新为 2（已完成）`);
```

- [ ] **Step 3: 提交**

```bash
git add server/services/order-service.js
git commit -m "feat: 同步开始和完成时更新 sync_status"
```

---

### Task 3: 修改 auth.js 返回 sync_status

**Files:**
- Modify: `server/routes/user/auth.js:348-451`

- [ ] **Step 1: 在查询用户信息时包含 sync_status 字段**

修改第 354-362 行的查询语句：

```javascript
const user = await db.prepare(`
  SELECT 
    u.id, u.email, u.plan_id, u.subscription_token, u.sub_id,
    u.traffic_used, u.traffic_limit, u.expire_at, u.enabled, u.created_at,
    u.payment_count, u.sync_status,
    p.name as plan_name
  FROM users u
  LEFT JOIN plans p ON u.plan_id = p.id
  WHERE u.id = ?
`).get(userId);
```

- [ ] **Step 2: 在返回数据中包含 sync_status 和 payment_count**

修改第 420-442 行的返回数据：

```javascript
res.json({
  code: 0,
  message: 'ok',
  data: {
    id: user.id,
    email: user.email,
    plan_id: user.plan_id,
    plan_name: user.plan_name,
    subscription_url: cfOptimized ? urls.subscription_url : '',
    clash_url: cfOptimized ? urls.clash_url : '',
    cf_optimized: cfOptimized,
    subscription_ready: subscriptionReady,
    traffic_used: user.traffic_used,
    traffic_limit: user.traffic_limit,
    traffic_used_text: formatTraffic(user.traffic_used),
    traffic_limit_text: formatTraffic(user.traffic_limit),
    traffic_percent: trafficPercent,
    expire_at: user.expire_at,
    expire_text: formatTime(user.expire_at),
    enabled: user.enabled,
    created_at: user.created_at,
    payment_count: user.payment_count,
    sync_status: user.sync_status
  }
});
```

- [ ] **Step 3: 提交**

```bash
git add server/routes/user/auth.js
git commit -m "feat: 用户信息接口返回 sync_status 和 payment_count"
```

---

### Task 4: 创建轮询接口

**Files:**
- Create: `server/routes/user/sync-status.js`
- Modify: `server/app.js`

- [ ] **Step 1: 创建 sync-status.js 路由**

```javascript
/**
 * 用户同步状态路由
 * 提供同步状态轮询接口
 */

const express = require('express');
const { authenticateUser } = require('../../middleware/auth-user');
const { createLogger } = require('../../utils/logger');

const router = express.Router();
const logger = createLogger('SYNC-STATUS');

/**
 * GET /api/user/sync-status
 * 获取当前用户的同步状态
 */
router.get('/', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const db = req.app.locals.db;

    const user = await db.prepare('SELECT sync_status FROM users WHERE id = ?').get(userId);
    
    if (!user) {
      return res.status(400).json({
        code: 2004,
        message: '用户不存在',
        data: null
      });
    }

    res.json({
      code: 0,
      message: 'ok',
      data: {
        sync_status: user.sync_status
      }
    });
  } catch (error) {
    logger.error(`获取同步状态错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

module.exports = router;
```

- [ ] **Step 2: 在 app.js 中注册路由**

在 `server/app.js` 第 35 行之后添加：

```javascript
const userSyncStatusRoutes = require('./routes/user/sync-status');
```

在第 90 行之后添加：

```javascript
userApp.use(`${userPrefix}/sync-status`, userSyncStatusRoutes);
```

- [ ] **Step 3: 提交**

```bash
git add server/routes/user/sync-status.js server/app.js
git commit -m "feat: 添加同步状态轮询接口"
```

---

### Task 5: 前端 API 封装

**Files:**
- Modify: `client-user/src/api/index.js`

- [ ] **Step 1: 添加轮询接口**

在 `userApi` 对象中添加：

```javascript
/**
 * 获取同步状态
 * @returns {Promise<Object>} 响应数据
 */
getSyncStatus() {
  return apiClient.get('/sync-status')
}
```

- [ ] **Step 2: 提交**

```bash
git add client-user/src/api/index.js
git commit -m "feat: 添加同步状态轮询接口封装"
```

---

### Task 6: 前端 Profile.vue 添加 loading 弹窗和轮询逻辑

**Files:**
- Modify: `client-user/src/views/user/Profile.vue`

- [ ] **Step 1: 添加状态变量**

在第 335 行之后添加：

```javascript
const syncLoading = ref(false)
const syncTimer = ref(null)
```

- [ ] **Step 2: 添加检查同步状态函数**

在 `fetchOrders` 函数之后添加：

```javascript
/**
 * 检查同步状态
 * 新用户首次登录时，如果同步未完成则显示loading弹窗
 */
async function checkSyncStatus() {
  try {
    const result = await userStore.fetchUserProfile()
    if (result.success) {
      userInfo.value = result.data
      
      // 判断是否是新用户且同步未完成
      if (result.data.payment_count === 1 && result.data.sync_status === 1) {
        syncLoading.value = true
        startSyncPolling()
      }
    }
  } catch (error) {
    console.error('获取用户信息失败:', error)
  }
}

/**
 * 开始轮询同步状态
 */
function startSyncPolling() {
  syncTimer.value = setInterval(async () => {
    try {
      const response = await api.user.getSyncStatus()
      if (response.code === 0 && response.data.sync_status === 2) {
        // 同步完成，隐藏弹窗
        syncLoading.value = false
        clearInterval(syncTimer.value)
        syncTimer.value = null
        // 刷新用户信息
        await fetchUserInfo()
      }
    } catch (error) {
      console.error('检查同步状态失败:', error)
    }
  }, 5000)
}
```

- [ ] **Step 3: 修改 onMounted**

在第 694-697 行添加 `checkSyncStatus()` 调用：

```javascript
onMounted(() => {
  fetchUserInfo()
  fetchOrders()
  checkSyncStatus()
})
```

- [ ] **Step 4: 添加 onBeforeUnmount 清理**

在 `onMounted` 之后添加：

```javascript
onBeforeUnmount(() => {
  if (syncTimer.value) {
    clearInterval(syncTimer.value)
    syncTimer.value = null
  }
})
```

- [ ] **Step 5: 添加 Loading 图标导入**

在第 308 行修改导入：

```javascript
import { CopyDocument, MagicStick, Link, Refresh, InfoFilled, QuestionFilled, ArrowRight, Loading } from '@element-plus/icons-vue'
```

- [ ] **Step 6: 添加 loading 弹窗模板**

在 `<template>` 标签内，`</div>` 结束标签之前添加：

```vue
<!-- 同步中弹窗 -->
<el-dialog 
  v-model="syncLoading" 
  title="账号同步中" 
  :close-on-click-modal="false"
  :close-on-press-escape="false"
  :show-close="false"
  width="400px"
>
  <div class="sync-loading-content">
    <el-icon class="sync-loading-icon"><Loading /></el-icon>
    <p>您的账号信息正在同步到服务器，请稍候...</p>
    <p class="sync-loading-tip">同步完成后将自动关闭此窗口</p>
  </div>
</el-dialog>
```

- [ ] **Step 7: 添加 CSS 样式**

在 `<style scoped>` 标签内添加：

```css
.sync-loading-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 20px 0;
}

.sync-loading-icon {
  font-size: 48px;
  color: #409eff;
  animation: spin 2s linear infinite;
}

.sync-loading-tip {
  color: #909399;
  font-size: 13px;
}
```

- [ ] **Step 8: 提交**

```bash
git add client-user/src/views/user/Profile.vue
git commit -m "feat: 新用户同步中显示loading弹窗"
```

---

### Task 7: 构建验证

**Files:**
- 无新增文件

- [ ] **Step 1: 执行前端构建**

```bash
cd client-user && npx vite build --minify esbuild
```

Expected: 构建成功，无错误输出

- [ ] **Step 2: 运行迁移脚本**

```bash
cd server && node db/migrations/002-sync-status-migration.js
```

Expected: 迁移成功，输出 "脚本执行成功"

- [ ] **Step 3: 提交所有变更**

```bash
git add -A
git commit -m "feat: 新用户同步状态检测功能完成"
```
