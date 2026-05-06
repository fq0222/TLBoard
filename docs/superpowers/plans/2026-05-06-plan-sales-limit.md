# 套餐可销售总量功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为套餐管理添加"可销售总量"功能，支持设置每个套餐的最大销售数量，售罄后禁止购买，并通过定时任务自动释放过期用户的名额。

**Architecture:** 使用数据库字段 `sales_limit` 和 `sales_count` 跟踪销售状态，定时任务每小时检查并释放流量用完超过 3 天且未续费的用户名额。

**Tech Stack:** Node.js, Express, PostgreSQL, Vue 3, Element Plus

---

## 文件结构

### 后端文件
- `server/db/init.js` - 数据库初始化，添加新字段
- `server/routes/admin/plans.js` - 管理端套餐 API
- `server/routes/user/plans.js` - 用户端套餐 API
- `server/routes/user/auth.js` - 用户注册 API（添加售罄检查）
- `server/routes/user/renew.js` - 用户续费 API（添加售罄检查）
- `server/jobs/index.js` - 定时任务（添加名额释放任务）

### 前端文件
- `client-admin/src/views/Plans.vue` - 管理端套餐管理页面
- `client-user/src/views/Home.vue` - 用户端首页
- `client-user/src/views/Login.vue` - 用户端登录/注册页面
- `client-user/src/components/RenewDialog.vue` - 续费对话框组件
- `client-admin/src/api/index.js` - 管理端 API 定义
- `client-user/src/api/index.js` - 用户端 API 定义

---

## Task 1: 数据库字段添加

**Files:**
- Modify: `server/db/init.js:176-189`

- [ ] **Step 1: 修改 plans 表结构**

在 `server/db/init.js` 中找到 plans 表的 CREATE TABLE 语句，添加新字段：

```sql
CREATE TABLE IF NOT EXISTS plans (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price INTEGER NOT NULL,
  duration_days INTEGER NOT NULL,
  traffic_limit BIGINT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  sales_limit INTEGER DEFAULT -1,
  sales_count INTEGER DEFAULT 0,
  updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
)
```

- [ ] **Step 2: 修改 users 表结构**

在 `server/db/init.js` 中找到 users 表的 CREATE TABLE 语句，添加新字段：

```sql
traffic_used_at BIGINT
```

- [ ] **Step 3: 提交更改**

```bash
git add server/db/init.js
git commit -m "feat(db): 添加套餐可销售总量相关字段"
```

---

## Task 2: 管理端套餐 API 修改

**Files:**
- Modify: `server/routes/admin/plans.js:29-41` (GET 返回字段)
- Modify: `server/routes/admin/plans.js:100-107` (INSERT 语句)
- Modify: `server/routes/admin/plans.js:142-150` (UPDATE 语句)

- [ ] **Step 1: 修改 GET /api/admin/plans 返回字段**

在 `server/routes/admin/plans.js` 中找到格式化套餐数据的代码（约第 29-41 行），添加新字段：

```javascript
const formattedPlans = plans.map(plan => ({
  id: plan.id,
  name: plan.name,
  description: plan.description,
  price: plan.price,
  price_text: (plan.price / 100).toFixed(2),
  duration_days: plan.duration_days,
  traffic_limit: plan.traffic_limit,
  traffic_text: formatTraffic(plan.traffic_limit),
  sort_order: plan.sort_order,
  enabled: plan.enabled,
  sales_limit: plan.sales_limit,
  sales_count: plan.sales_count,
  updated_at: plan.updated_at,
  created_at: plan.created_at
}));
```

- [ ] **Step 2: 修改 POST /api/admin/plans 添加 sales_limit 字段**

在 `server/routes/admin/plans.js` 中找到 INSERT 语句（约第 104-107 行），添加 sales_limit 字段：

```javascript
const { name, description, price, duration_days, traffic_limit, sort_order = 0, enabled = true, sales_limit = -1 } = req.body;

const result = await db.prepare(`
  INSERT INTO plans (name, description, price, duration_days, traffic_limit, sort_order, enabled, sales_limit)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(name, description || null, price, duration_days, traffic_limit, sort_order, enabled ? 1 : 0, sales_limit);
```

- [ ] **Step 3: 修改 PUT /api/admin/plans/:id 支持更新 sales_limit**

在 `server/routes/admin/plans.js` 中找到 UPDATE 语句，添加 sales_limit 字段支持：

```javascript
// 在路由处理函数中添加 sales_limit 字段
const { name, description, price, duration_days, traffic_limit, sort_order, enabled, sales_limit } = req.body;

// 构建动态 UPDATE 语句
const updates = [];
const params = [];

if (name !== undefined) { updates.push('name = ?'); params.push(name); }
if (description !== undefined) { updates.push('description = ?'); params.push(description); }
if (price !== undefined) { updates.push('price = ?'); params.push(price); }
if (duration_days !== undefined) { updates.push('duration_days = ?'); params.push(duration_days); }
if (traffic_limit !== undefined) { updates.push('traffic_limit = ?'); params.push(traffic_limit); }
if (sort_order !== undefined) { updates.push('sort_order = ?'); params.push(sort_order); }
if (enabled !== undefined) { updates.push('enabled = ?'); params.push(enabled ? 1 : 0); }
if (sales_limit !== undefined) { updates.push('sales_limit = ?'); params.push(sales_limit); }

updates.push('updated_at = ?');
params.push(Math.floor(Date.now() / 1000));

params.push(req.params.id);

await db.prepare(`
  UPDATE plans SET ${updates.join(', ')} WHERE id = ?
`).run(...params);
```

- [ ] **Step 4: 提交更改**

```bash
git add server/routes/admin/plans.js
git commit -m "feat(api): 管理端套餐 API 支持 sales_limit 字段"
```

---

## Task 3: 用户端套餐 API 修改

**Files:**
- Modify: `server/routes/user/plans.js:21-39`

- [ ] **Step 1: 修改 GET /api/user/plans 返回字段**

在 `server/routes/user/plans.js` 中找到查询语句和格式化代码（约第 21-39 行），添加新字段：

```javascript
// 查询已上架套餐
const plans = await db.prepare(`
  SELECT id, name, description, price, duration_days, traffic_limit, sort_order, sales_limit, sales_count
  FROM plans 
  WHERE enabled = 1 
  ORDER BY sort_order ASC, id ASC
`).all();

// 格式化套餐数据
const formattedPlans = plans.map(plan => ({
  id: plan.id,
  name: plan.name,
  description: plan.description,
  price: plan.price,
  price_text: (plan.price / 100).toFixed(2),
  duration_days: plan.duration_days,
  traffic_limit: plan.traffic_limit,
  traffic_text: formatTraffic(plan.traffic_limit),
  sort_order: plan.sort_order,
  sales_limit: plan.sales_limit,
  sales_count: plan.sales_count,
  is_soldout: plan.sales_limit !== -1 && plan.sales_count >= plan.sales_limit
}));
```

- [ ] **Step 2: 提交更改**

```bash
git add server/routes/user/plans.js
git commit -m "feat(api): 用户端套餐 API 返回 sales_limit 和 sales_count"
```

---

## Task 4: 用户注册 API 添加售罄检查

**Files:**
- Modify: `server/routes/user/auth.js:23-50`

- [ ] **Step 1: 在注册接口中添加售罄检查**

在 `server/routes/user/auth.js` 中找到套餐验证的代码，在验证套餐存在后添加售罄检查：

```javascript
// 4. 验证套餐存在且启用
const plan = await db.prepare('SELECT * FROM plans WHERE id = ? AND enabled = 1').get(plan_id);
if (!plan) {
  logger.warn(`注册失败: 套餐不存在或未启用 - ${plan_id}`);
  return res.status(400).json({
    code: 1001,
    message: '套餐不存在或未启用',
    data: null
  });
}

// 5. 检查套餐是否售罄
if (plan.sales_limit !== -1 && plan.sales_count >= plan.sales_limit) {
  logger.warn(`注册失败: 套餐已售罄 - ${plan_id}`);
  return res.status(400).json({
    code: 1002,
    message: '该套餐已售罄',
    data: null
  });
}
```

- [ ] **Step 2: 在注册成功后增加 sales_count**

在注册成功创建用户和订单后，增加 sales_count：

```javascript
// 在事务中，创建用户和订单后
await db.prepare('UPDATE plans SET sales_count = sales_count + 1 WHERE id = ?').run(plan_id);
```

- [ ] **Step 3: 提交更改**

```bash
git add server/routes/user/auth.js
git commit -m "feat(auth): 用户注册时检查套餐是否售罄"
```

---

## Task 5: 用户续费 API 添加售罄检查

**Files:**
- Modify: `server/routes/user/renew.js:77-85`

- [ ] **Step 1: 在续费接口中添加售罄检查**

在 `server/routes/user/renew.js` 中找到套餐验证的代码（约第 77-85 行），添加售罄检查：

```javascript
// 4. 验证套餐存在且启用
const plan = await db.prepare('SELECT * FROM plans WHERE id = ? AND enabled = 1').get(plan_id);
if (!plan) {
  logger.warn(`续费失败: 套餐不存在或未启用 - ${plan_id}`);
  return res.json({
    code: 1001,
    message: '套餐不存在或未启用',
    data: null
  });
}

// 5. 检查套餐是否售罄（续费当前套餐时允许，切换套餐时检查）
if (user.plan_id !== plan_id && plan.sales_limit !== -1 && plan.sales_count >= plan.sales_limit) {
  logger.warn(`续费失败: 套餐已售罄 - ${plan_id}`);
  return res.json({
    code: 1002,
    message: '该套餐已售罄',
    data: null
  });
}
```

- [ ] **Step 2: 在续费成功后处理名额变化**

在续费成功创建订单后，处理名额变化：

```javascript
// 在事务中，创建订单后处理名额变化
if (user.plan_id !== plan_id) {
  // 更换套餐：旧套餐名额 -1，新套餐名额 +1
  await db.prepare('UPDATE plans SET sales_count = GREATEST(0, sales_count - 1) WHERE id = ?').run(user.plan_id);
  await db.prepare('UPDATE plans SET sales_count = sales_count + 1 WHERE id = ?').run(plan_id);
} else if (!user.plan_id) {
  // 新用户：新套餐名额 +1
  await db.prepare('UPDATE plans SET sales_count = sales_count + 1 WHERE id = ?').run(plan_id);
}
// 续费相同套餐：名额不变

// 重置流量用完时间
await db.prepare('UPDATE users SET traffic_used_at = NULL WHERE id = ?').run(userId);
```

- [ ] **Step 3: 提交更改**

```bash
git add server/routes/user/renew.js
git commit -m "feat(renew): 用户续费时检查套餐是否售罄并处理名额变化"
```

---

## Task 6: 定时任务 - 释放过期名额

**Files:**
- Modify: `server/jobs/index.js:439-448` (startAllJobs 函数)

- [ ] **Step 1: 添加释放过期名额的任务函数**

在 `server/jobs/index.js` 中添加新的任务函数：

```javascript
/**
 * 注册释放过期名额任务
 * 每小时检查一次，释放流量用完超过3天且未续费的用户名额
 * @param {Object} db - 数据库实例
 */
function registerReleaseExpiredSalesJob(db) {
  // 启动时延迟15分钟执行第一次
  setTimeout(async () => {
    await runReleaseExpiredSales(db);
  }, 15 * 60 * 1000);

  const interval = setInterval(async () => {
    await runReleaseExpiredSales(db);
  }, 60 * 60 * 1000); // 每1小时执行一次
  
  intervals.push(interval);
  logger.info('释放过期名额任务已注册（每1小时执行一次）');
}

/**
 * 执行释放过期名额
 * @param {Object} db - 数据库实例
 */
async function runReleaseExpiredSales(db) {
  try {
    // 查找需要释放名额的用户（流量用完超过3天且未续费）
    const expiredUsers = await db.prepare(`
      SELECT u.plan_id, COUNT(*) as expired_count
      FROM users u
      WHERE u.plan_id IS NOT NULL
        AND u.traffic_used_at IS NOT NULL
        AND u.traffic_used_at < EXTRACT(EPOCH FROM NOW()) - 259200
        AND NOT EXISTS (
          SELECT 1 FROM orders o 
          WHERE o.user_id = u.id 
            AND o.status = 'paid'
            AND o.created_at > u.traffic_used_at
        )
      GROUP BY u.plan_id
    `).all();

    let releasedCount = 0;

    for (const row of expiredUsers) {
      const result = await db.prepare(`
        UPDATE plans 
        SET sales_count = GREATEST(0, sales_count - ?)
        WHERE id = ?
      `).run(row.expired_count, row.plan_id);
      
      if (result.changes > 0) {
        releasedCount += row.expired_count;
      }
    }

    if (releasedCount > 0) {
      logger.info(`释放过期名额完成，共释放 ${releasedCount} 个名额`);
    }
  } catch (error) {
    logger.error(`释放过期名额任务错误: ${error.message}`);
  }
}
```

- [ ] **Step 2: 在 startAllJobs 中注册新任务**

在 `server/jobs/index.js` 中找到 `startAllJobs` 函数（约第 439-448 行），添加新任务：

```javascript
function startAllJobs(db) {
  logger.info('正在启动所有定时任务...');
  registerMarkExpiredJob(db);
  registerDeleteExpiredJob(db);
  registerCleanZombieUsersJob(db);
  registerXuiSyncJob(db);
  registerTrafficSyncJob(db);
  registerTicketAutoCloseJob(db);
  registerReleaseExpiredSalesJob(db);  // 新增
  logger.info(`所有定时任务已启动，共 ${intervals.length} 个任务`);
}
```

- [ ] **Step 3: 提交更改**

```bash
git add server/jobs/index.js
git commit -m "feat(jobs): 添加释放过期名额定时任务"
```

---

## Task 7: 流量同步时记录流量用完时间

**Files:**
- Modify: `server/jobs/index.js:325-328` (流量同步任务)

- [ ] **Step 1: 在流量同步任务中添加流量用完时间记录**

在 `server/jobs/index.js` 中找到流量同步任务的 `runTrafficSync` 函数（约第 325-328 行），在更新流量数据后添加检查：

```javascript
// 更新数据库中的流量数据
await db.prepare(`
  UPDATE users SET traffic_used = ?, updated_at = ? WHERE id = ?
`).run(trafficUsed, Math.floor(Date.now() / 1000), user.id);

// 检查流量是否用完，记录时间戳
const userData = await db.prepare('SELECT traffic_limit FROM users WHERE id = ?').get(user.id);
if (userData && trafficUsed >= userData.traffic_limit) {
  await db.prepare(`
    UPDATE users SET traffic_used_at = ? WHERE id = ? AND traffic_used_at IS NULL
  `).run(Math.floor(Date.now() / 1000), user.id);
}
```

- [ ] **Step 2: 提交更改**

```bash
git add server/jobs/index.js
git commit -m "feat(jobs): 流量同步时记录流量用完时间"
```

---

## Task 8: 管理端前端 - Plans.vue 修改

**Files:**
- Modify: `client-admin/src/views/Plans.vue:16-48` (表格列)
- Modify: `client-admin/src/views/Plans.vue:56-87` (对话框表单)
- Modify: `client-admin/src/views/Plans.vue:113-121` (planForm 数据)
- Modify: `client-admin/src/views/Plans.vue:145-180` (showEditDialog 函数)
- Modify: `client-admin/src/views/Plans.vue:182-192` (resetForm 函数)

- [ ] **Step 1: 添加表格列显示可销售总量、已售数量、最后更新时间**

在 `client-admin/src/views/Plans.vue` 中找到表格列定义（约第 16-48 行），在"状态"列前添加新列：

```vue
<el-table-column label="可销售总量" width="120">
  <template #default="scope">
    {{ scope.row.sales_limit === -1 ? '不限制' : scope.row.sales_limit }}
  </template>
</el-table-column>
<el-table-column prop="sales_count" label="已售数量" width="100" />
<el-table-column label="最后更新时间" width="160">
  <template #default="scope">
    {{ scope.row.updated_at ? formatTime(scope.row.updated_at) : '-' }}
  </template>
</el-table-column>
```

- [ ] **Step 2: 添加对话框表单字段**

在 `client-admin/src/views/Plans.vue` 中找到对话框表单（约第 56-87 行），在"是否上架"前添加新字段：

```vue
<el-form-item label="可销售总量" prop="sales_limit">
  <el-input-number v-model="planForm.sales_limit" :min="-1" />
  <span class="form-tip">-1 表示不限制可售数量</span>
</el-form-item>
```

- [ ] **Step 3: 更新 planForm 数据**

在 `client-admin/src/views/Plans.vue` 中找到 planForm 定义（约第 113-121 行），添加 sales_limit 字段：

```javascript
const planForm = reactive({
  name: '',
  description: '',
  price: 0,
  duration_days: 30,
  traffic_limit: 0,
  sort_order: 0,
  enabled: true,
  sales_limit: -1
})
```

- [ ] **Step 4: 更新 showEditDialog 函数**

在 `client-admin/src/views/Plans.vue` 中找到 showEditDialog 函数（约第 152-180 行），添加 sales_limit 字段：

```javascript
function showEditDialog(plan) {
  isEditing.value = true
  editingId.value = plan.id
  planForm.name = plan.name
  planForm.description = plan.description
  planForm.price = plan.price
  planForm.duration_days = plan.duration_days
  planForm.sort_order = plan.sort_order
  planForm.enabled = !!plan.enabled
  planForm.sales_limit = plan.sales_limit  // 新增
  
  // 计算流量值和单位
  // ... 原有代码 ...
  
  dialogVisible.value = true
}
```

- [ ] **Step 5: 更新 resetForm 函数**

在 `client-admin/src/views/Plans.vue` 中找到 resetForm 函数（约第 182-192 行），添加 sales_limit 字段：

```javascript
function resetForm() {
  planForm.name = ''
  planForm.description = ''
  planForm.price = 0
  planForm.duration_days = 30
  planForm.traffic_limit = 0
  planForm.sort_order = 0
  planForm.enabled = true
  planForm.sales_limit = -1  // 新增
  trafficValue.value = 0
  trafficUnit.value = 1073741824
}
```

- [ ] **Step 6: 添加 formatTime 函数**

在 `client-admin/src/views/Plans.vue` 的 `<script setup>` 中添加 formatTime 函数：

```javascript
function formatTime(timestamp) {
  if (!timestamp) return '-'
  const date = new Date(timestamp * 1000)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}
```

- [ ] **Step 7: 提交更改**

```bash
git add client-admin/src/views/Plans.vue
git commit -m "feat(admin): 套餐管理页面显示可销售总量、已售数量、最后更新时间"
```

---

## Task 9: 用户端前端 - Home.vue 修改

**Files:**
- Modify: `client-user/src/views/Home.vue:21-51` (套餐卡片)

- [ ] **Step 1: 添加售罄状态显示**

在 `client-user/src/views/Home.vue` 中找到套餐卡片模板（约第 21-51 行），添加售罄状态：

```vue
<div 
  v-for="plan in plans" 
  :key="plan.id" 
  class="plan-card"
>
  <div class="plan-header">
    <h3 class="plan-name">{{ plan.name }}</h3>
    <div class="plan-price">
      <span class="price-symbol">¥</span>
      <span class="price-value">{{ plan.price_text }}</span>
    </div>
  </div>
  <div class="plan-body">
    <p class="plan-description">{{ plan.description }}</p>
    <div class="plan-features">
      <div class="feature">
        <el-icon><Check /></el-icon>
        <span>{{ plan.traffic_text }} 流量</span>
      </div>
      <div class="feature">
        <el-icon><Check /></el-icon>
        <span>{{ plan.duration_days === 0 ? '无限期' : plan.duration_days + ' 天有效期' }}</span>
      </div>
    </div>
    <div v-if="plan.is_soldout" class="sold-out-tag">已售罄</div>
  </div>
  <div class="plan-footer">
    <el-button 
      type="primary" 
      size="large" 
      class="buy-btn" 
      :disabled="plan.is_soldout"
      @click="selectPlan(plan)"
    >
      {{ plan.is_soldout ? '已售罄' : '立即购买' }}
    </el-button>
  </div>
</div>
```

- [ ] **Step 2: 添加售罄标签样式**

在 `client-user/src/views/Home.vue` 的 `<style scoped>` 中添加售罄标签样式：

```css
.sold-out-tag {
  display: inline-block;
  background: #f56c6c;
  color: #fff;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  margin-top: 8px;
}
```

- [ ] **Step 3: 修改 selectPlan 函数添加售罄检查**

在 `client-user/src/views/Home.vue` 中找到 selectPlan 函数（约第 143-160 行），添加售罄检查：

```javascript
function selectPlan(plan) {
  if (plan.is_soldout) {
    ElMessage.warning('该套餐已售罄')
    return
  }
  
  if (isLoggedIn.value) {
    router.push({ name: 'UserProfile' })
  } else {
    router.push({ 
      name: 'Login', 
      query: { 
        plan_id: plan.id,
        plan_name: plan.name,
        plan_price: plan.price_text,
        plan_traffic: plan.traffic_text,
        plan_duration: plan.duration_days
      } 
    })
  }
}
```

- [ ] **Step 4: 提交更改**

```bash
git add client-user/src/views/Home.vue
git commit -m "feat(user): 首页套餐卡片显示售罄状态"
```

---

## Task 10: 用户端前端 - Login.vue 修改

**Files:**
- Modify: `client-user/src/views/Login.vue`

- [ ] **Step 1: 在注册模式下检查套餐是否售罄**

在 `client-user/src/views/Login.vue` 中找到套餐信息显示的代码，添加售罄检查：

```vue
<!-- 套餐信息卡片 -->
<div v-if="planInfo" class="plan-info-card">
  <div class="plan-name">{{ planInfo.name }}</div>
  <div class="plan-price">¥{{ planInfo.price }}</div>
  <div v-if="planInfo.is_soldout" class="sold-out-warning">该套餐已售罄</div>
</div>

<!-- 注册按钮 -->
<el-button 
  type="primary" 
  :loading="loading" 
  @click="handleRegister"
  :disabled="planInfo?.is_soldout"
>
  {{ planInfo?.is_soldout ? '套餐已售罄' : '注册并支付' }}
</el-button>
```

- [ ] **Step 2: 提交更改**

```bash
git add client-user/src/views/Login.vue
git commit -m "feat(user): 登录页面检查套餐是否售罄"
```

---

## Task 11: 用户端前端 - RenewDialog.vue 修改

**Files:**
- Modify: `client-user/src/components/RenewDialog.vue`

- [ ] **Step 1: 在续费对话框中显示售罄状态**

在 `client-user/src/components/RenewDialog.vue` 中找到套餐列表，添加售罄状态显示：

```vue
<div 
  v-for="plan in plans" 
  :key="plan.id" 
  class="plan-item"
  :class="{ 'is-current': plan.id === currentPlanId, 'is-soldout': plan.is_soldout }"
>
  <div class="plan-info">
    <div class="plan-name">{{ plan.name }}</div>
    <div class="plan-price">¥{{ plan.price_text }}</div>
  </div>
  <div v-if="plan.is_soldout" class="sold-out-tag">已售罄</div>
  <div v-if="plan.id === currentPlanId" class="current-tag">当前套餐</div>
</div>
```

- [ ] **Step 2: 修改套餐选择逻辑**

在 `client-user/src/components/RenewDialog.vue` 中找到套餐选择函数，添加售罄检查：

```javascript
function selectPlan(plan) {
  if (plan.is_soldout && plan.id !== currentPlanId) {
    ElMessage.warning('该套餐已售罄')
    return
  }
  selectedPlanId.value = plan.id
}
```

- [ ] **Step 3: 提交更改**

```bash
git add client-user/src/components/RenewDialog.vue
git commit -m "feat(user): 续费对话框显示套餐售罄状态"
```

---

## Task 12: 测试验证

- [ ] **Step 1: 运行后端测试脚本**

创建测试脚本 `server/test/test-sales-limit.js`：

```javascript
const databaseManager = require('../db/init');

async function testSalesLimit() {
  try {
    const db = await databaseManager.init();
    
    // 1. 测试添加套餐时设置 sales_limit
    console.log('测试添加套餐...');
    const result = await db.prepare(`
      INSERT INTO plans (name, description, price, duration_days, traffic_limit, sales_limit)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('测试套餐', '测试描述', 1990, 30, 107374182400, 10);
    console.log('添加套餐成功，ID:', result.lastInsertRowid);
    
    // 2. 测试查询套餐
    const plan = await db.prepare('SELECT * FROM plans WHERE id = ?').get(result.lastInsertRowid);
    console.log('查询套餐:', plan);
    
    // 3. 测试更新 sales_count
    await db.prepare('UPDATE plans SET sales_count = sales_count + 1 WHERE id = ?').run(result.lastInsertRowid);
    const updatedPlan = await db.prepare('SELECT * FROM plans WHERE id = ?').get(result.lastInsertRowid);
    console.log('更新 sales_count 后:', updatedPlan);
    
    // 4. 清理测试数据
    await db.prepare('DELETE FROM plans WHERE id = ?').run(result.lastInsertRowid);
    console.log('测试数据已清理');
    
    console.log('所有测试通过！');
  } catch (error) {
    console.error('测试失败:', error);
  }
}

testSalesLimit();
```

- [ ] **Step 2: 运行测试脚本验证**

```bash
cd server
node test/test-sales-limit.js
```

- [ ] **Step 3: 运行前端构建验证**

```bash
cd client-admin
npm run build

cd ../client-user
npm run build
```

- [ ] **Step 4: 提交测试脚本**

```bash
git add server/test/test-sales-limit.js
git commit -m "test: 添加套餐可销售总量功能测试脚本"
```

---

## 实现优先级

1. **P0（必须）：** Task 1-5（数据库、API、售罄检查）
2. **P1（重要）：** Task 6-7（定时任务、流量用完时间记录）
3. **P2（重要）：** Task 8-11（前端显示）
4. **P3（验证）：** Task 12（测试验证）

---

## 注意事项

1. **数据库迁移：** 如果数据库已存在，需要手动执行 ALTER TABLE 语句添加新字段
2. **数据一致性：** sales_count 可能与实际有效订单数有短暂不一致，通过定时任务修正
3. **性能考虑：** 定时任务每小时执行一次，对数据库影响较小
4. **用户体验：** 售罄套餐显示"已售罄"标签，按钮不可点击，提供明确提示
