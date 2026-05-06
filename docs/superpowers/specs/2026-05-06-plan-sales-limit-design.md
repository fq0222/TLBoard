# 套餐可销售总量功能设计文档

## 概述

为套餐管理添加"可销售总量"功能，支持设置每个套餐的最大销售数量。当销售数量达到上限时，用户端将显示"已售罄"提示，禁止购买。支持通过定时任务自动释放过期用户的名额。

## 需求背景

管理员需要控制每个套餐的销售数量，防止过度销售。当用户流量用完后 3 天内未续费，其占用的名额应回归池中，允许其他用户购买。

## 功能设计

### 1. 数据库设计

#### 1.1 plans 表新增字段

```sql
ALTER TABLE plans ADD COLUMN sales_limit INTEGER DEFAULT -1;
ALTER TABLE plans ADD COLUMN sales_count INTEGER DEFAULT 0;
```

**字段说明：**
- `sales_limit`：可销售总量，**-1 表示不限制**，0 或正整数表示具体限制数量
- `sales_count`：当前已售出的有效订单数量

#### 1.2 users 表新增字段

```sql
ALTER TABLE users ADD COLUMN traffic_used_at BIGINT;
```

**字段说明：**
- `traffic_used_at`：流量用完的时间戳，用于判断是否超过 3 天未续费

### 2. 后端 API 设计

#### 2.1 管理端 API（`/api/admin/plans`）

| 端点 | 改动说明 |
|------|----------|
| `GET /api/admin/plans` | 返回字段增加 `sales_limit`、`sales_count`、`updated_at` |
| `POST /api/admin/plans` | 请求体增加 `sales_limit` 字段 |
| `PUT /api/admin/plans/:id` | 请求体增加 `sales_limit` 字段 |

**返回数据格式：**
```json
{
  "id": 1,
  "name": "基础套餐",
  "price": 1990,
  "sales_limit": 100,
  "sales_count": 50,
  "updated_at": 1714982400
}
```

#### 2.2 用户端 API（`/api/user/plans`）

| 端点 | 改动说明 |
|------|----------|
| `GET /api/user/plans` | 返回字段增加 `sales_limit`、`sales_count` |

**返回数据格式：**
```json
{
  "id": 1,
  "name": "基础套餐",
  "price": 1990,
  "sales_limit": 100,
  "sales_count": 50,
  "is_soldout": false
}
```

**is_soldout 计算逻辑：**
```javascript
const is_soldout = plan.sales_limit !== -1 && plan.sales_count >= plan.sales_limit;
```

#### 2.3 购买检查逻辑

在 `POST /api/user/register` 和 `POST /api/user/renew` 中添加售罄检查：

```javascript
// 检查套餐是否售罄
if (plan.sales_limit !== -1 && plan.sales_count >= plan.sales_limit) {
  return res.status(400).json({ error: '该套餐已售罄' });
}

// 购买成功后增加 sales_count
await db.query(
  'UPDATE plans SET sales_count = sales_count + 1 WHERE id = $1',
  [planId]
);
```

#### 2.4 续费时的名额处理

**续费逻辑（在 `POST /api/user/renew` 中）：**

```javascript
// 1. 获取用户当前套餐
const currentUser = await db.query('SELECT plan_id FROM users WHERE id = $1', [userId]);
const oldPlanId = currentUser.rows[0]?.plan_id;

// 2. 检查新套餐是否售罄
if (newPlan.sales_limit !== -1 && newPlan.sales_count >= newPlan.sales_limit) {
  return res.status(400).json({ error: '该套餐已售罄' });
}

// 3. 处理名额变化
if (oldPlanId && oldPlanId !== newPlanId) {
  // 更换套餐：旧套餐名额 -1，新套餐名额 +1
  await db.query('UPDATE plans SET sales_count = GREATEST(0, sales_count - 1) WHERE id = $1', [oldPlanId]);
  await db.query('UPDATE plans SET sales_count = sales_count + 1 WHERE id = $1', [newPlanId]);
} else if (!oldPlanId) {
  // 新用户：新套餐名额 +1
  await db.query('UPDATE plans SET sales_count = sales_count + 1 WHERE id = $1', [newPlanId]);
}
// 续费相同套餐：名额不变

// 4. 重置流量用完时间
await db.query('UPDATE users SET traffic_used_at = NULL WHERE id = $1', [userId]);
```

### 3. 定时任务设计

#### 3.1 任务配置

- **任务名称：** `release-expired-sales`
- **执行频率：** 每小时执行一次
- **执行时间：** 整点执行（如 00:00, 01:00, 02:00...）
- **实现方式：** 使用 `node-cron` 库或 `setInterval` 定时器
- **启动位置：** 在 `server/app.js` 中启动服务器时同时启动定时任务

#### 3.2 检查逻辑

```sql
-- 查找需要释放名额的用户（流量用完超过3天且未续费）
SELECT u.plan_id, COUNT(*) as expired_count
FROM users u
WHERE u.plan_id IS NOT NULL
  AND u.traffic_used_at IS NOT NULL
  AND u.traffic_used_at < EXTRACT(EPOCH FROM NOW()) - 259200  -- 3天 = 259200秒
  AND NOT EXISTS (
    SELECT 1 FROM orders o 
    WHERE o.user_id = u.id 
      AND o.status = 'paid'
      AND o.created_at > u.traffic_used_at
  )
GROUP BY u.plan_id;
```

#### 3.3 释放名额

```sql
-- 释放名额
UPDATE plans 
SET sales_count = GREATEST(0, sales_count - :expired_count)
WHERE id = :plan_id;
```

#### 3.4 流量用完时间记录

**触发时机：** 在 `server/services/xui-service.js` 中同步用户流量时检查

**检查逻辑：**
```javascript
// 在同步用户流量后检查
if (user.traffic_used >= user.traffic_limit && !user.traffic_used_at) {
  await db.query(
    'UPDATE users SET traffic_used_at = EXTRACT(EPOCH FROM NOW()) WHERE id = $1',
    [user.id]
  );
}
```

**注意事项：**
- 只在流量首次用完时记录时间戳
- 续费后重置 `traffic_used_at` 为 NULL

### 4. 管理端前端设计

#### 4.1 Plans.vue 页面改动

**表格列新增：**

| 列名 | 字段 | 显示格式 |
|------|------|----------|
| 可销售总量 | `sales_limit` | -1 显示"不限制"，其他显示数字 |
| 已售数量 | `sales_count` | 显示数字 |
| 最后更新时间 | `updated_at` | 时间格式（YYYY-MM-DD HH:mm） |

**添加/编辑对话框新增：**
- 可销售总量输入框：数字输入，-1 表示不限制
- 提示文字：设置为 -1 表示不限制可售数量

### 5. 用户端前端设计

#### 5.1 Home.vue 页面改动

**套餐卡片显示：**
- 当 `sales_limit !== -1 && sales_count >= sales_limit` 时：
  - 卡片显示"已售罄"红色徽章
  - "立即购买"按钮变灰，显示"已售罄"
  - 按钮不可点击

#### 5.2 Login.vue 页面改动

- 注册+支付模式下，如果套餐已售罄，显示提示"该套餐已售罄"并禁用注册按钮

#### 5.3 RenewDialog.vue 页面改动

- 续费对话框中，如果套餐已售罄，显示"已售罄"标签，禁用选择

### 6. 错误处理

| 场景 | 处理方式 |
|------|----------|
| 购买时套餐已售罄 | 返回 400 错误，提示"该套餐已售罄" |
| 续费时套餐已售罄 | 允许续费当前套餐，禁止切换到已售罄套餐 |
| sales_count 计算错误 | 定时任务自动修正（通过重新计算有效订单数） |

### 7. 测试要点

1. **管理端测试：**
   - 添加套餐时设置可销售总量
   - 编辑套餐的可销售总量
   - 查看已售数量和最后更新时间

2. **用户端测试：**
   - 购买套餐时检查售罄状态
   - 售罄套餐显示"已售罄"标签
   - 售罄套餐禁用购买按钮

3. **定时任务测试：**
   - 流量用完 3 天后自动释放名额
   - 续费后不释放名额
   - 多个用户同时过期的处理

## 实现优先级

1. **P0（必须）：**
   - 数据库字段添加
   - 管理端 API 支持
   - 用户端 API 支持
   - 购买检查逻辑

2. **P1（重要）：**
   - 管理端前端显示
   - 用户端前端显示
   - 定时任务实现

3. **P2（可选）：**
   - 流量用完时间记录优化
   - 错误处理增强
