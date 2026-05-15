# 用户端导航栏条件显示功能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在用户端左侧导航栏中，"订阅信息"和"CF IP优选"两个选项默认不显示，只有用户同时完成优选IP且生成订阅链接后才显示

**Architecture:** 在用户信息API中新增 `subscription_ready` 字段，后端检查 `cf_optimized` 和 `user_subscriptions` 表，前端根据字段控制导航栏显示

**Tech Stack:** Vue 3 + Element Plus (前端), Node.js + Express + PostgreSQL (后端)

---

## 文件结构

| 文件 | 操作 | 说明 |
|------|------|------|
| `server/routes/user/auth.js` | 修改 | 用户信息API新增 `subscription_ready` 字段 |
| `client-user/src/views/user/Layout.vue` | 修改 | 导航栏条件显示 |

---

## Task 1: 后端 - 用户信息API新增字段

**Files:**
- Modify: `server/routes/user/auth.js`

- [ ] **Step 1: 修改用户信息接口**

在 `server/routes/user/auth.js` 中，在 `cfOptimized` 变量之后添加 `subscriptionReady` 变量：

```javascript
// 检查用户是否已完成 CF 优选
const cfIps = await db.prepare(`
  SELECT 1 FROM user_cf_ips WHERE user_id = ? LIMIT 1
`).get(userId);
const cfOptimized = !!cfIps;

// 检查用户是否已生成订阅链接
const subscription = await db.prepare(`
  SELECT 1 FROM user_subscriptions WHERE sub_id = ?
`).get(user.sub_id);
const subscriptionReady = cfOptimized && !!subscription;
```

- [ ] **Step 2: 添加返回字段**

在 `res.json` 的 `data` 对象中添加 `subscription_ready` 字段：

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
    created_at: user.created_at
  }
});
```

- [ ] **Step 3: 验证接口语法**

运行以下命令检查语法：
```bash
node -c server/routes/user/auth.js
```

预期输出：无错误

- [ ] **Step 4: 提交代码**

```bash
git add server/routes/user/auth.js
git commit -m "后端：用户信息API新增subscription_ready字段"
```

---

## Task 2: 前端 - 导航栏条件显示

**Files:**
- Modify: `client-user/src/views/user/Layout.vue`

- [ ] **Step 1: 添加状态变量**

在 `client-user/src/views/user/Layout.vue` 的 `<script setup>` 中，在现有状态变量之后添加：

```javascript
const subscriptionReady = ref(false)
```

- [ ] **Step 2: 修改 fetchUserInfo 方法**

在 `onMounted` 中调用 `fetchUserInfo` 方法，获取用户信息并更新 `subscriptionReady` 状态：

```javascript
/**
 * 获取用户信息
 */
async function fetchUserInfo() {
  try {
    const result = await userStore.fetchUserProfile()
    if (result.success) {
      subscriptionReady.value = result.data.subscription_ready || false
    }
  } catch (error) {
    console.error('获取用户信息失败:', error)
  }
}
```

- [ ] **Step 3: 在 onMounted 中调用 fetchUserInfo**

```javascript
onMounted(() => {
  fetchUnreadCount()
  fetchUserInfo()
})
```

- [ ] **Step 4: 修改导航栏模板**

修改 `client-user/src/views/user/Layout.vue` 中的 `<nav>` 部分，添加 `v-if` 条件：

```vue
<nav class="sidebar-nav">
  <router-link to="/user" class="nav-item" exact-active-class="active" @click="closeSidebar">
    <el-icon><User /></el-icon>
    <span>个人中心</span>
  </router-link>
  <router-link 
    v-if="subscriptionReady" 
    to="/user/subscription" 
    class="nav-item" 
    active-class="active" 
    @click="closeSidebar"
  >
    <el-icon><Link /></el-icon>
    <span>订阅信息</span>
  </router-link>
  <router-link 
    v-if="subscriptionReady" 
    to="/user/cf-optimize" 
    class="nav-item" 
    active-class="active" 
    @click="closeSidebar"
  >
    <el-icon><Connection /></el-icon>
    <span>CF IP优选</span>
  </router-link>
  <router-link to="/user/tickets" class="nav-item" active-class="active" @click="closeSidebar">
    <el-icon><ChatDotRound /></el-icon>
    <span>工单支持</span>
    <span v-if="unreadTicketCount > 0" class="badge"></span>
  </router-link>
</nav>
```

- [ ] **Step 5: 验证构建**

运行以下命令检查构建：
```bash
cd client-user && npm run build
```

预期输出：构建成功

- [ ] **Step 6: 提交代码**

```bash
git add client-user/src/views/user/Layout.vue
git commit -m "前端：导航栏条件显示订阅信息和CF IP优选"
```

---

## Task 3: 测试验证

- [ ] **Step 1: 启动后端服务**

```bash
cd server && npm run dev
```

预期输出：服务启动成功

- [ ] **Step 2: 启动前端服务**

```bash
cd client-user && npm run dev
```

预期输出：前端服务启动成功

- [ ] **Step 3: 测试新注册用户**

1. 注册一个新用户
2. 登录用户端
3. 验证导航栏不显示"订阅信息"和"CF IP优选"

- [ ] **Step 4: 测试完成优选IP但未生成订阅链接**

1. 登录用户端
2. 完成优选IP
3. 验证导航栏不显示"订阅信息"和"CF IP优选"

- [ ] **Step 5: 测试完成优选IP且生成订阅链接**

1. 登录用户端
2. 完成优选IP
3. 生成订阅链接
4. 验证导航栏立即显示"订阅信息"和"CF IP优选"

- [ ] **Step 6: 测试刷新页面**

1. 刷新页面
2. 验证导航栏继续显示"订阅信息"和"CF IP优选"

- [ ] **Step 7: 提交最终代码**

```bash
git add .
git commit -m "完成用户端导航栏条件显示功能"
```

---

## 实施计划自检

- ✅ 所有设计需求都有对应任务
- ✅ 无占位符或 TODO
- ✅ 函数名、类型一致
- ✅ 代码完整，无省略
