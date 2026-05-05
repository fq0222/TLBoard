# 续费功能设计文档

> 版本：V1.0  
> 创建日期：2026-05-05  
> 状态：待审批

---

## 1. 概述

### 1.1 需求背景

用户在使用流量套餐过程中，需要续费以增加流量。当前系统只支持"注册并支付"一体化流程，不支持已登录用户单独续费。

### 1.2 核心需求

- **入口**：用户端个人中心页面新增"续费"按钮
- **套餐选择**：用户可从所有启用套餐中选择任意一个
- **流量累加**：新总流量 = 当前套餐流量 + 新套餐流量
- **支付方式**：VMQ在线支付（复用现有流程）
- **使用期限**：无限期（duration_days = 0）
- **同步**：支付成功后同步到所有3X-UI服务器

### 1.3 业务规则

1. 用户必须已登录且有有效套餐（已购买过）
2. 流量累加是在现有 `traffic_limit` 基础上加新套餐流量
3. 无限期套餐：`duration_days = 0`，`expire_at = 0`
4. 支付成功后异步同步到3X-UI服务器

---

## 2. 整体架构

### 2.1 新增组件

| 组件 | 路径 | 说明 |
|------|------|------|
| 续费路由 | `server/routes/user/renew.js` | 处理续费请求 |
| 续费弹窗 | `client-user/src/components/RenewDialog.vue` | 套餐选择弹窗 |

### 2.2 数据流

```
用户点击续费按钮 → 显示套餐选择弹窗 → 选择套餐 → 调用续费接口 → 
创建VMQ订单 → 支付成功 → 流量累加 → 同步3X-UI
```

### 2.3 复用组件

- VMQ支付服务：`server/services/vmq-service.js`
- 订单服务：`server/services/order-service.js`
- 3X-UI服务：`server/services/xui-service.js`
- 支付等待页：`client-user/src/views/PaymentCallback.vue`

---

## 3. 后端设计

### 3.1 新增接口

#### POST `/api/user/renew`

**说明**：用户续费接口，创建续费订单并调用VMQ支付。

**请求头**：
```
Authorization: Bearer <token>
```

**请求体**：
```json
{
  "plan_id": 1
}
```

**参数说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| plan_id | number | 是 | 套餐ID |

**成功响应**：
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "order_id": 10002,
    "out_trade_no": "REN1746260000000abc123",
    "vmq_order_id": "202605050001",
    "pay_type": 2,
    "really_price": "19.90",
    "payment_url": "https://qr.alipay.com/fkxxxxx",
    "expire_in": 300
  }
}
```

**失败响应**：

```json
{
  "code": 1002,
  "message": "未登录或Token无效",
  "data": null
}
```

```json
{
  "code": 2004,
  "message": "请先购买套餐后再续费",
  "data": null
}
```

```json
{
  "code": 1001,
  "message": "套餐不存在或未启用",
  "data": null
}
```

```json
{
  "code": 5002,
  "message": "VMQ创建订单失败",
  "data": null
}
```

```json
{
  "code": 5003,
  "message": "当前支付通道需要用户手动输入金额，存在少付风险，请更换VMQ监控通道配置后再试",
  "data": null
}
```

### 3.2 业务逻辑

```javascript
// server/routes/user/renew.js
router.post('/', authenticateUser, [
  body('plan_id').isInt({ min: 1 }).withMessage('套餐ID无效')
], async (req, res) => {
  // 1. 验证用户有有效套餐
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user.plan_id) {
    return res.json({ code: 2004, message: '请先购买套餐后再续费' });
  }

  // 2. 验证套餐存在且启用
  const plan = await db.prepare('SELECT * FROM plans WHERE id = ? AND enabled = 1').get(req.body.plan_id);
  if (!plan) {
    return res.json({ code: 1001, message: '套餐不存在或未启用' });
  }

  // 3. 创建订单
  const outTradeNo = 'REN' + Date.now() + randomString(6);
  await db.prepare(`
    INSERT INTO orders (user_id, email, plan_id, amount, out_trade_no, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).run(user.id, user.email, plan.id, plan.price, outTradeNo);

  // 4. 调用VMQ创建支付订单
  const vmqResult = await vmqService.createOrder({
    payId: outTradeNo,
    type: req.body.pay_type || 2,
    price: plan.price / 100
  });

  // 5. 返回支付链接
  // ...
});
```

### 3.3 修改订单服务

修改 `server/services/order-service.js` 的 `completePaidOrder` 函数，支持续费场景：

```javascript
// 续费场景：流量累加
const isRenewOrder = order.out_trade_no.startsWith('REN');
let newTrafficLimit;

if (isRenewOrder) {
  // 续费：当前流量 + 新套餐流量
  const currentTrafficLimit = Number(user.traffic_limit || 0);
  newTrafficLimit = currentTrafficLimit + plan.traffic_limit;
} else {
  // 新购：直接使用套餐流量
  newTrafficLimit = plan.traffic_limit;
}

await db.prepare(`
  UPDATE users SET
    enabled = 1,
    plan_id = ?,
    traffic_limit = ?,
    expire_at = ?,
    payment_count = payment_count + 1,
    updated_at = ?
  WHERE id = ?
`).run(plan.id, newTrafficLimit, expireAt, now, order.user_id);
```

---

## 4. 前端设计

### 4.1 新增续费弹窗组件

**文件**：`client-user/src/components/RenewDialog.vue`

**Props**：
- `visible`：控制弹窗显示
- `currentPlanId`：当前套餐ID（用于高亮显示）

**Events**：
- `@close`：关闭弹窗
- `@renew`：选择套餐后触发，返回 `plan_id`

**UI设计**：
- 使用Element Plus的Dialog组件
- 套餐列表使用卡片布局
- 显示套餐名称、价格、流量、描述
- 当前套餐高亮显示
- 选择套餐后点击"立即续费"按钮

### 4.2 修改个人中心页面

**文件**：`client-user/src/views/user/Profile.vue`

**修改内容**：
1. 在流量使用情况卡片下方添加"续费"按钮
2. 引入续费弹窗组件
3. 处理续费逻辑

```vue
<template>
  <!-- 现有内容 -->
  
  <!-- 续费按钮 -->
  <div class="content-card">
    <h2 class="card-title">套餐续费</h2>
    <div class="renew-section">
      <p class="renew-tip">续费将在现有套餐基础上累加流量</p>
      <el-button 
        type="primary" 
        size="large" 
        @click="showRenewDialog = true"
      >
        <el-icon><Refresh /></el-icon>
        续费套餐
      </el-button>
    </div>
  </div>
  
  <!-- 续费弹窗 -->
  <RenewDialog 
    v-model:visible="showRenewDialog"
    :current-plan-id="userInfo.plan_id"
    @renew="handleRenew"
  />
</template>

<script setup>
import { ref } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import RenewDialog from '@/components/RenewDialog.vue'
import api from '@/api'
import { useRouter } from 'vue-router'

const router = useRouter()
const showRenewDialog = ref(false)

async function handleRenew(planId) {
  try {
    const response = await api.user.renew({ plan_id: planId })
    if (response.code === 0) {
      // 跳转到支付等待页
      router.push({
        path: '/payment/callback',
        query: {
          order_id: response.data.order_id,
          out_trade_no: response.data.out_trade_no,
          payment_url: response.data.payment_url,
          expire_in: response.data.expire_in
        }
      })
    } else {
      ElMessage.error(response.message)
    }
  } catch (error) {
    ElMessage.error('续费失败，请重试')
  }
}
</script>
```

### 4.3 新增API方法

**文件**：`client-user/src/api/index.js`

```javascript
const userApi = {
  // 现有方法...
  
  /**
   * 用户续费
   * @param {Object} data - 续费数据
   * @param {number} data.plan_id - 套餐ID
   * @returns {Promise<Object>} 响应数据
   */
  renew(data) {
    return apiClient.post('/renew', data)
  }
}
```

---

## 5. 数据库设计

### 5.1 现有表结构（无需修改）

**orders表**：复用现有结构，通过 `out_trade_no` 前缀区分订单类型
- 新购订单：`ORD` + 时间戳 + 随机字符串
- 续费订单：`REN` + 时间戳 + 随机字符串

**users表**：复用现有结构
- `traffic_limit`：续费后累加

**plans表**：复用现有结构

### 5.2 订单类型识别

```javascript
// 通过 out_trade_no 前缀识别订单类型
const isRenewOrder = order.out_trade_no.startsWith('REN');
```

---

## 6. 3X-UI同步

### 6.1 同步逻辑

复用现有的 `syncUserToXuiServers` 函数，修改流量计算逻辑：

```javascript
// 续费场景：更新流量限制
const totalGB = isRenewOrder ? newTrafficLimit : plan.traffic_limit;

const result = await xuiService.addClient(inbound.id, inbound.protocol, {
  email: user.email,
  id: user.subscription_token,
  enable: true,
  expiryTime: expiryTime,
  totalGB: totalGB,
  limitIp: 0,
  tgId: 0,
  subId: ''
});
```

### 6.2 同步时机

- 支付成功后异步同步
- 不阻塞支付回调响应
- 复用现有的定时同步任务（每4小时）

---

## 7. 错误处理

### 7.1 错误场景

| 场景 | 错误码 | 错误信息 |
|------|--------|----------|
| 用户未登录 | 1002 | 未登录或Token无效 |
| 用户没有有效套餐 | 2004 | 请先购买套餐后再续费 |
| 套餐不存在或未启用 | 1001 | 套餐不存在或未启用 |
| VMQ创建订单失败 | 5002 | VMQ创建订单失败 |
| VMQ通道需要手输金额 | 5003 | 当前支付通道需要用户手动输入金额... |

### 7.2 边界情况

1. **用户套餐已过期**：允许续费，流量从0开始累加
2. **用户流量已用完**：允许续费，累加新流量
3. **并发续费**：使用数据库事务保证数据一致性
4. **支付超时**：复用现有订单超时处理逻辑（30分钟）

---

## 8. 测试计划

### 8.1 单元测试

- 续费接口参数验证
- 流量累加计算逻辑
- 订单类型识别逻辑

### 8.2 集成测试

- 续费完整流程测试
- VMQ支付回调测试
- 3X-UI同步测试

### 8.3 边界测试

- 过期用户续费
- 流量用完用户续费
- 并发续费测试

---

## 9. 部署说明

### 9.1 后端部署

1. 新增 `server/routes/user/renew.js` 文件
2. 修改 `server/services/order-service.js` 支持续费场景
3. 在 `server/app-user.js` 中注册续费路由
4. 重启服务器

### 9.2 前端部署

1. 新增 `client-user/src/components/RenewDialog.vue` 组件
2. 修改 `client-user/src/views/user/Profile.vue` 添加续费入口
3. 修改 `client-user/src/api/index.js` 添加续费API
4. 执行 `npx vite build --minify esbuild` 构建前端（项目未安装terser）

---

## 10. 风险评估

### 10.1 技术风险

- **低风险**：复用现有VMQ支付流程，技术成熟
- **低风险**：复用现有3X-UI同步逻辑，已验证

### 10.2 业务风险

- **低风险**：流量累加逻辑简单清晰
- **低风险**：订单类型通过前缀区分，不影响现有功能

### 10.3 缓解措施

- 充分测试边界情况
- 使用数据库事务保证数据一致性
- 支付成功后异步同步，不阻塞主流程

---

## 11. 附录

### 11.1 相关文件

- `server/routes/user/renew.js`（新增）
- `server/services/order-service.js`（修改）
- `client-user/src/components/RenewDialog.vue`（新增）
- `client-user/src/views/user/Profile.vue`（修改）
- `client-user/src/api/index.js`（修改）

### 11.2 参考文档

- `docs/requirements.md`：需求文档
- `docs/api.md`：API接口文档
- `docs/vmq-server-api.md`：VMQ支付接口文档

---

**文档状态**：待审批  
**下一步**：用户审查设计文档，确认后开始编写实施计划
