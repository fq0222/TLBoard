# 用户端导航栏条件显示功能设计

> 日期：2026-05-15
> 状态：待审核

---

## 1. 需求概述

在用户端左侧导航栏中，"订阅信息"和"CF IP优选"两个选项默认不显示。只有用户同时完成以下条件后才显示：

1. 完成 CF IP 优选（`cf_optimized` 为 `true`）
2. 生成订阅链接（`user_subscriptions` 表中存在该用户的 `sub_id`）

用户完成后，导航栏需要立即显示（前端状态更新后立即显示）。

---

## 2. 设计决策

### 2.1 状态管理方式

**决策**：前端状态管理（方案1）

**实现方式**：
- 在用户信息API中新增 `subscription_ready` 字段
- 后端检查 `cf_optimized` 和 `user_subscriptions` 表中是否存在该用户的 `sub_id`
- 前端根据 `subscription_ready` 字段控制导航栏显示

**理由**：
- 前端逻辑简单，只需判断一个字段
- 后端统一管理状态，一致性好
- 不需要前端额外查询

### 2.2 显示条件

**决策**：并且关系

**条件**：
- 用户必须同时完成优选IP **且** 生成订阅链接才显示

**理由**：
- 前端逻辑是只有点完优选IP才能点击生成订阅链接
- 符合用户操作流程

### 2.3 状态更新方式

**决策**：立即显示

**实现方式**：
- 用户完成优选IP并生成订阅链接后，Profile组件会调用 `fetchUserInfo` 更新状态
- Layout组件监听用户信息变化，更新 `subscriptionReady` 状态
- 导航栏立即显示

---

## 3. 架构设计

### 3.1 涉及组件

| 组件 | 文件路径 | 修改类型 |
|------|----------|----------|
| 后端用户信息路由 | `server/routes/user/auth.js` | 修改用户信息API，新增字段 |
| 前端用户布局 | `client-user/src/views/user/Layout.vue` | 修改导航栏，条件显示选项 |

### 3.2 数据流

```
用户登录/刷新页面
  → 获取用户信息API
  → 后端检查 cf_optimized 和 user_subscriptions 表
  → 返回 subscription_ready 字段
  → 前端根据字段控制导航栏显示
```

---

## 4. 后端接口设计

### 4.1 修改用户信息接口

**接口**：`GET /api/user/profile`

**新增返回字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| subscription_ready | boolean | 用户是否已完成优选IP且生成订阅链接 |

**后端逻辑**：
```javascript
// 检查 cf_optimized
const cfOptimized = user.cf_optimized || false

// 检查 user_subscriptions 表中是否存在该用户的 sub_id
const subscription = await db.prepare(
  'SELECT 1 FROM user_subscriptions WHERE sub_id = ?'
).get(user.sub_id)

const subscriptionReady = cfOptimized && !!subscription
```

**返回示例**：
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": 1,
    "email": "user@example.com",
    "cf_optimized": true,
    "subscription_ready": true,
    "subscription_url": "https://example.com/api/user/sub/abc123",
    ...
  }
}
```

---

## 5. 前端设计

### 5.1 修改 Layout 组件

**文件**：`client-user/src/views/user/Layout.vue`

**修改内容**：

1. **添加状态变量**：
```javascript
const subscriptionReady = ref(false)
```

2. **获取用户信息**：
```javascript
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

3. **导航栏条件显示**：
```vue
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
```

4. **状态更新**：
- 用户完成优选IP并生成订阅链接后，Profile组件会调用 `fetchUserInfo` 更新状态
- Layout组件监听用户信息变化，更新 `subscriptionReady` 状态
- 导航栏立即显示

---

## 6. 错误处理

| 场景 | 处理方式 |
|------|----------|
| 用户信息获取失败 | `subscriptionReady` 默认为 `false`，导航栏不显示 |
| 后端查询失败 | `subscription_ready` 默认为 `false` |

---

## 7. 边界情况

1. **新注册用户**：
   - `cf_optimized` 为 `false`
   - `user_subscriptions` 表中无记录
   - `subscription_ready` 为 `false`
   - 导航栏不显示

2. **用户完成优选IP但未生成订阅链接**：
   - `cf_optimized` 为 `true`
   - `user_subscriptions` 表中无记录
   - `subscription_ready` 为 `false`
   - 导航栏不显示

3. **用户完成优选IP且生成订阅链接**：
   - `cf_optimized` 为 `true`
   - `user_subscriptions` 表中有记录
   - `subscription_ready` 为 `true`
   - 导航栏显示

4. **用户续费后**：
   - 状态保持不变
   - 导航栏继续显示

---

## 8. 数据库表结构

### 现有表（无需修改）

**`user_subscriptions` 表**：
```sql
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  sub_id VARCHAR(32) UNIQUE NOT NULL,
  nodes_data TEXT,
  updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
)
```

---

## 9. 实施步骤

### 后端

1. 修改 `server/routes/user/auth.js` 中的用户信息API
2. 新增 `subscription_ready` 字段
3. 检查 `cf_optimized` 和 `user_subscriptions` 表

### 前端

1. 修改 `client-user/src/views/user/Layout.vue`
2. 添加 `subscriptionReady` 状态变量
3. 修改 `fetchUserInfo` 方法
4. 修改导航栏模板，添加 `v-if` 条件

---

## 10. 测试要点

1. 新注册用户不显示"订阅信息"和"CF IP优选"
2. 用户完成优选IP但未生成订阅链接，不显示
3. 用户完成优选IP且生成订阅链接后，立即显示
4. 用户刷新页面后，状态保持
5. 用户续费后，状态保持
