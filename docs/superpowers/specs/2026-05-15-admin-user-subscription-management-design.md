# 管理端用户订阅管理功能设计

> 日期：2026-05-15
> 状态：待审核

---

## 1. 需求概述

在管理端用户管理页面，扩展用户编辑弹窗，增加以下功能：

1. **CF IP 管理**：查看、添加、删除用户的优选 CF IP
2. **生成订阅链接**：帮助用户生成订阅链接（与用户自己生成的 URL 一致）

---

## 2. 设计决策

### 2.1 CF IP 添加方式

**决策**：从 `cf_ip_pool` 池中选择，不支持手动输入池中没有的 IP

**理由**：
- 不需要修改数据库表结构
- 复用现有逻辑和数据
- 如果需要新 IP，管理员先去"CF IP 池管理"页面添加

### 2.2 订阅链接 URL 一致性

**决策**：管理员生成的订阅链接 URL 与用户自己生成的保持一致

**理由**：
- 用户无需更换订阅链接
- 使用现有的 URL 更新订阅即可获取最新的节点信息
- 基于用户的 `sub_id` 生成 URL

### 2.3 CF IP 数量限制

**决策**：最多 5 个 CF IP

**理由**：
- 与用户端保持一致
- 避免过多 IP 影响性能

---

## 3. 架构设计

### 3.1 涉及组件

| 组件 | 文件路径 | 修改类型 |
|------|----------|----------|
| 后端用户管理路由 | `server/routes/admin/users.js` | 新增 2 个接口 |
| 前端用户管理页面 | `client-admin/src/views/Users.vue` | 扩展弹窗 |
| 前端 API | `client-admin/src/api/index.js` | 新增 API 方法 |

### 3.2 数据流

```
管理员打开编辑弹窗
  → 调用 getUserDetail(id) 获取用户详情（含 CF IP）
  → 显示当前 CF IP 列表
  → 管理员添加/删除 CF IP（从池中选择）
  → 点击"确定"保存（同时保存基本信息和 CF IP）
  → 管理员点击"生成订阅链接"
  → 后端同步服务器节点 + 生成订阅内容
  → 保存到 user_subscriptions 表
  → 返回订阅链接（与用户自己生成的 URL 一致）
```

---

## 4. 后端接口设计

### 4.1 更新用户 CF IP

**接口**：`PUT /api/admin/users/:id/cf-ips`

**请求体**：
```json
{
  "ip_pool_ids": [1, 2, 3]
}
```

**逻辑**：
1. 验证用户存在
2. 验证 IP ID 有效性（在 `cf_ip_pool` 中存在且启用）
3. 检查数量不超过 5 个
4. 事务中删除旧记录，插入新记录
5. 返回更新结果

**响应**：
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "cf_ips": [
      { "id": 1, "ip": "104.16.132.229" },
      { "id": 2, "ip": "104.16.133.229" }
    ]
  }
}
```

**错误码**：
- `2004`：用户不存在
- `1001`：参数校验失败（IP 数量超过限制）
- `4002`：IP ID 无效或已禁用

### 4.2 管理端生成用户订阅链接

**接口**：`POST /api/admin/users/:id/generate-subscription`

**逻辑**：
1. 查询用户信息（`sub_id`, `enabled` 等）
2. 检查用户是否启用
3. 检查用户 CF IP 是否已配置
4. 调用 `syncAllServers(db)` 同步服务器节点
5. 复用用户端逻辑生成订阅内容
6. 保存到 `user_subscriptions` 表
7. 返回订阅链接

**响应**：
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "subscription_url": "https://example.com/api/user/sub/abc123",
    "clash_url": "https://example.com/api/user/sub/abc123?clash=1",
    "node_count": 10
  }
}
```

**错误码**：
- `2004`：用户不存在
- `2003`：账号已禁用
- `3001`：请先配置优选 IP

---

## 5. 前端设计

### 5.1 弹窗布局

```
┌─────────────────────────────────────────────────────────┐
│ 编辑用户                                                │
├─────────────────────────────────────────────────────────┤
│ 基本信息                                                │
│ 启用：[开关]                                            │
│ 流量上限：[输入框] [单位选择]                           │
│ 到期时间：[日期选择器]                                  │
├─────────────────────────────────────────────────────────┤
│ 优选 IP（最多 5 个）                                    │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ ☑ 104.16.132.229                    [删除]         │ │
│ │ ☑ 104.16.133.229                    [删除]         │ │
│ └─────────────────────────────────────────────────────┘ │
│ [选择 IP ▼]  ← 带搜索功能的下拉选择器                   │
├─────────────────────────────────────────────────────────┤
│ 订阅链接                                                │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ https://example.com/api/user/sub/abc123    [复制]  │ │
│ └─────────────────────────────────────────────────────┘ │
│ [生成订阅链接]  ← 按钮，带 loading 状态                 │
└─────────────────────────────────────────────────────────┘
```

### 5.2 交互逻辑

1. **打开弹窗**：
   - 调用 `getUserDetail(id)` 获取用户信息
   - 显示当前 CF IP 列表
   - 显示当前订阅链接（如果有）

2. **添加 CF IP**：
   - 下拉选择器显示所有启用的 CF IP
   - 支持搜索过滤（按 IP 地址）
   - 已选择的 IP 不显示在下拉列表中
   - 达到 5 个时禁用添加

3. **删除 CF IP**：
   - 点击删除按钮移除
   - 不需要确认弹窗

4. **保存**：
   - 点击"确定"按钮时，同时保存基本信息和 CF IP
   - 调用两个接口：`updateUser` 和 `updateUserCfIps`

5. **生成订阅链接**：
   - 点击"生成订阅链接"按钮
   - 显示 loading 状态
   - 完成后显示订阅链接

### 5.3 API 方法

在 `client-admin/src/api/index.js` 中新增：

```javascript
/**
 * 更新用户 CF IP
 * @param {number} id - 用户ID
 * @param {Array} ipPoolIds - CF IP 池 ID 列表
 * @returns {Promise<Object>} 响应数据
 */
updateUserCfIps(id, ipPoolIds) {
  return apiClient.put(`/users/${id}/cf-ips`, { ip_pool_ids: ipPoolIds })
},

/**
 * 生成用户订阅链接
 * @param {number} id - 用户ID
 * @returns {Promise<Object>} 响应数据
 */
generateUserSubscription(id) {
  return apiClient.post(`/users/${id}/generate-subscription`)
}
```

---

## 6. 错误处理

| 场景 | 处理方式 |
|------|----------|
| 用户未配置 CF IP | 生成订阅链接时返回错误提示"请先配置优选 IP" |
| CF IP 数量超过 5 个 | 前端禁用添加按钮，后端返回错误 |
| 服务器同步失败 | 记录日志，继续处理其他服务器，返回部分成功 |
| 用户账号已禁用 | 生成订阅链接时返回错误提示"账号已禁用" |
| 网络超时 | 前端显示重试提示 |

---

## 7. 边界情况

1. **用户没有 CF IP 时生成订阅链接**：
   - 返回错误码 `3001`，提示"请先配置优选 IP"

2. **重复添加同一个 CF IP**：
   - 前端下拉列表过滤已选择的 IP
   - 后端使用 `ON CONFLICT` 处理

3. **并发操作**：
   - 前端按钮 loading 状态防重复点击
   - 后端使用数据库事务保证一致性

4. **订阅链接已存在**：
   - 生成订阅链接时覆盖旧数据（`ON CONFLICT DO UPDATE`）

---

## 8. 数据库表结构

### 现有表（无需修改）

**`user_cf_ips` 表**：
```sql
CREATE TABLE IF NOT EXISTS user_cf_ips (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  ip_pool_id INTEGER NOT NULL,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
)
```

**`cf_ip_pool` 表**：
```sql
CREATE TABLE IF NOT EXISTS cf_ip_pool (
  id SERIAL PRIMARY KEY,
  ip VARCHAR(45) NOT NULL,
  enabled INTEGER DEFAULT 1,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
)
```

---

## 9. 实施步骤

### 后端

1. 在 `server/routes/admin/users.js` 中新增 `PUT /:id/cf-ips` 接口
2. 在 `server/routes/admin/users.js` 中新增 `POST /:id/generate-subscription` 接口
3. 复用 `server/routes/user/subscription.js` 中的生成逻辑

### 前端

1. 在 `client-admin/src/api/index.js` 中新增 API 方法
2. 在 `client-admin/src/views/Users.vue` 中扩展编辑弹窗
3. 添加 CF IP 选择组件（带搜索功能）
4. 添加生成订阅链接功能

---

## 10. 测试要点

1. CF IP 添加、删除功能正常
2. CF IP 数量限制（最多 5 个）
3. 生成订阅链接 URL 与用户自己生成的一致
4. 订阅链接可正常访问
5. 错误场景处理正确
