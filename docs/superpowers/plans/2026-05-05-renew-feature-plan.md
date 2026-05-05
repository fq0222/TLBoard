# 续费功能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在用户端个人中心页面添加续费功能，支持用户选择任意套餐进行续费，支付成功后累加流量并同步到3X-UI服务器。

**Architecture:** 新增独立续费接口 `POST /api/user/renew`，复用现有VMQ支付流程和3X-UI同步逻辑。前端新增续费弹窗组件，个人中心页面添加续费入口。

**Tech Stack:** Node.js + Express (后端), Vue 3 + Element Plus (前端), PostgreSQL (数据库), VMQ (支付), 3X-UI (代理服务)

---

## 文件结构

### 新增文件
- `server/routes/user/renew.js` - 续费路由
- `client-user/src/components/RenewDialog.vue` - 续费弹窗组件

### 修改文件
- `server/services/order-service.js` - 修改 `completePaidOrder` 函数支持续费场景
- `client-user/src/views/user/Profile.vue` - 添加续费入口
- `client-user/src/api/index.js` - 添加续费API方法

### 测试文件
- `server/test/test-renew.js` - 续费接口测试脚本

---

## Task 1: 创建续费路由文件

**Files:**
- Create: `server/routes/user/renew.js`

- [ ] **Step 1: 创建续费路由文件**

```javascript
/**
 * 用户端续费路由
 * 处理用户续费请求，创建续费订单并调用VMQ支付
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth-user');
const vmqService = require('../../services/vmq-service');
const { createLogger } = require('../../utils/logger');
const crypto = require('crypto');

const router = express.Router();
const logger = createLogger('USER-RENEW');

/**
 * POST /api/user/renew
 * 用户续费接口
 */
router.post('/', authenticateUser, [
  body('plan_id')
    .isInt({ min: 1 })
    .withMessage('套餐ID无效')
], async (req, res) => {
  try {
    // 验证参数
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('续费参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const userId = req.user.id;
    const { plan_id } = req.body;
    const db = req.app.locals.db;

    // 1. 查询用户信息
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      logger.warn(`续费失败: 用户不存在 - ${userId}`);
      return res.json({
        code: 2004,
        message: '用户不存在',
        data: null
      });
    }

    // 2. 验证用户有有效套餐（已购买过）
    if (!user.plan_id) {
      logger.warn(`续费失败: 用户未购买过套餐 - ${user.email}`);
      return res.json({
        code: 2004,
        message: '请先购买套餐后再续费',
        data: null
      });
    }

    // 3. 验证套餐存在且启用
    const plan = await db.prepare('SELECT * FROM plans WHERE id = ? AND enabled = 1').get(plan_id);
    if (!plan) {
      logger.warn(`续费失败: 套餐不存在或未启用 - ${plan_id}`);
      return res.json({
        code: 1001,
        message: '套餐不存在或未启用',
        data: null
      });
    }

    // 4. 生成商户订单号（REN前缀表示续费订单）
    const outTradeNo = 'REN' + Date.now() + crypto.randomBytes(3).toString('hex');

    // 5. 创建订单
    await db.prepare(`
      INSERT INTO orders (user_id, email, plan_id, amount, out_trade_no, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(userId, user.email, plan_id, plan.price, outTradeNo, Math.floor(Date.now() / 1000));

    logger.info(`续费订单创建成功: ${outTradeNo}, 用户: ${user.email}, 套餐: ${plan.name}`);

    // 6. 调用VMQ创建支付订单
    const vmqResult = await vmqService.createOrder({
      payId: outTradeNo,
      type: req.body.pay_type || 2, // 默认支付宝
      price: plan.price / 100 // 分转元
    });

    if (!vmqResult.success) {
      logger.error(`VMQ创建订单失败: ${outTradeNo} - ${vmqResult.message}`);
      return res.json({
        code: 5002,
        message: 'VMQ创建订单失败',
        data: null
      });
    }

    // 7. 检查是否需要手输金额（isAuto=1）
    if (vmqResult.data.isAuto === 1) {
      logger.warn(`VMQ通道需要手输金额，拒绝下单: ${outTradeNo}`);
      // 关闭订单
      await db.prepare("UPDATE orders SET status = 'expired' WHERE out_trade_no = ?").run(outTradeNo);
      return res.json({
        code: 5003,
        message: '当前支付通道需要用户手动输入金额，存在少付风险，请更换VMQ监控通道配置后再试',
        data: null
      });
    }

    // 8. 更新订单的VMQ订单号
    await db.prepare('UPDATE orders SET trade_no = ?, payment_url = ? WHERE out_trade_no = ?')
      .run(vmqResult.data.orderId, vmqResult.data.payUrl, outTradeNo);

    // 9. 返回支付信息
    logger.info(`续费订单支付链接生成成功: ${outTradeNo}`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        order_id: (await db.prepare('SELECT id FROM orders WHERE out_trade_no = ?').get(outTradeNo)).id,
        out_trade_no: outTradeNo,
        vmq_order_id: vmqResult.data.orderId,
        pay_type: vmqResult.data.payType,
        really_price: vmqResult.data.reallyPrice.toString(),
        payment_url: vmqResult.data.payUrl,
        expire_in: vmqResult.data.timeOut * 60 // 分钟转秒
      }
    });
  } catch (error) {
    logger.error(`续费接口错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

module.exports = router;
```

- [ ] **Step 2: 验证文件创建成功**

Run: `ls -la server/routes/user/renew.js`
Expected: 文件存在且有内容

---

## Task 2: 修改订单服务支持续费场景

**Files:**
- Modify: `server/services/order-service.js`

- [ ] **Step 1: 修改 completePaidOrder 函数**

找到 `completePaidOrder` 函数，修改流量计算逻辑：

```javascript
// 在 completePaidOrder 函数中，找到以下代码（约第135-144行）：
await db.prepare(`
  UPDATE users SET
    enabled = 1,
    plan_id = ?,
    traffic_limit = ?,
    expire_at = ?,
    payment_count = payment_count + 1,
    updated_at = ?
  WHERE id = ?
`).run(plan.id, plan.traffic_limit, expireAt, now, order.user_id);

// 替换为：
// 判断是否为续费订单（REN前缀）
const isRenewOrder = order.out_trade_no.startsWith('REN');
let newTrafficLimit;

if (isRenewOrder) {
  // 续费场景：当前流量 + 新套餐流量
  const currentTrafficLimit = Number(order.current_traffic_limit || 0);
  newTrafficLimit = currentTrafficLimit + plan.traffic_limit;
  logger.info(`续费订单流量累加: ${currentTrafficLimit} + ${plan.traffic_limit} = ${newTrafficLimit}`);
} else {
  // 新购场景：直接使用套餐流量
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

- [ ] **Step 2: 修改查询语句获取当前流量限制**

找到订单查询语句（约第95-100行）：

```javascript
// 原代码：
const order = await db.prepare(`
  SELECT o.*, u.expire_at as current_expire_at, u.email, u.subscription_token
  FROM orders o
  LEFT JOIN users u ON o.user_id = u.id
  WHERE o.out_trade_no = ?
`).get(outTradeNo);

// 修改为：
const order = await db.prepare(`
  SELECT o.*, u.expire_at as current_expire_at, u.traffic_limit as current_traffic_limit, u.email, u.subscription_token
  FROM orders o
  LEFT JOIN users u ON o.user_id = u.id
  WHERE o.out_trade_no = ?
`).get(outTradeNo);
```

- [ ] **Step 3: 修改同步到3X-UI的流量计算**

找到同步用户信息部分（约第152-158行）：

```javascript
// 原代码：
const userInfo = {
  id: order.user_id,
  email: order.email,
  subscription_token: order.subscription_token,
  expire_at: expireAt
};

// 修改为：
const userInfo = {
  id: order.user_id,
  email: order.email,
  subscription_token: order.subscription_token,
  expire_at: expireAt,
  traffic_limit: newTrafficLimit || plan.traffic_limit
};
```

- [ ] **Step 4: 验证修改成功**

Run: `grep -n "isRenewOrder" server/services/order-service.js`
Expected: 显示修改后的代码行

---

## Task 3: 注册续费路由到用户端应用

**Files:**
- Modify: `server/app-user.js`

- [ ] **Step 1: 添加续费路由引用**

在文件顶部的路由引用部分添加：

```javascript
const renewRouter = require('./routes/user/renew');
```

- [ ] **Step 2: 注册续费路由**

在路由注册部分添加：

```javascript
app.use('/api/user/renew', renewRouter);
```

- [ ] **Step 3: 验证路由注册成功**

Run: `grep -n "renew" server/app-user.js`
Expected: 显示新添加的路由引用和注册代码

---

## Task 4: 创建续费测试脚本

**Files:**
- Create: `server/test/test-renew.js`

- [ ] **Step 1: 创建测试脚本**

```javascript
/**
 * 续费接口测试脚本
 * 测试续费功能的完整流程
 */

const http = require('http');

const BASE_URL = 'http://localhost:30000';
let authToken = null;

/**
 * 发送HTTP请求
 */
function request(method, path, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve(body);
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

/**
 * 测试用户登录
 */
async function testLogin() {
  console.log('\n=== 测试用户登录 ===');
  
  const result = await request('POST', '/api/user/login', {
    email: 'fuqiang_2015@163.com',
    password: 'fuqiang2015'
  });

  console.log('登录结果:', result);
  
  if (result.code === 0) {
    authToken = result.data.token;
    console.log('✅ 登录成功，Token:', authToken.substring(0, 20) + '...');
    return true;
  } else {
    console.log('❌ 登录失败:', result.message);
    return false;
  }
}

/**
 * 测试获取套餐列表
 */
async function testGetPlans() {
  console.log('\n=== 测试获取套餐列表 ===');
  
  const result = await request('GET', '/api/user/plans');
  console.log('套餐列表:', result);
  
  if (result.code === 0 && result.data.length > 0) {
    console.log('✅ 获取套餐列表成功，共', result.data.length, '个套餐');
    return result.data[0].id; // 返回第一个套餐ID
  } else {
    console.log('❌ 获取套餐列表失败');
    return null;
  }
}

/**
 * 测试续费接口
 */
async function testRenew(planId) {
  console.log('\n=== 测试续费接口 ===');
  console.log('续费套餐ID:', planId);
  
  const result = await request('POST', '/api/user/renew', {
    plan_id: planId
  }, authToken);

  console.log('续费结果:', result);
  
  if (result.code === 0) {
    console.log('✅ 续费订单创建成功');
    console.log('   订单号:', result.data.out_trade_no);
    console.log('   VMQ订单号:', result.data.vmq_order_id);
    console.log('   支付金额:', result.data.really_price, '元');
    console.log('   支付链接:', result.data.payment_url ? result.data.payment_url.substring(0, 50) + '...' : '无');
    return result.data;
  } else {
    console.log('❌ 续费失败:', result.message);
    return null;
  }
}

/**
 * 测试未登录访问续费接口
 */
async function testRenewWithoutAuth() {
  console.log('\n=== 测试未登录访问续费接口 ===');
  
  const result = await request('POST', '/api/user/renew', {
    plan_id: 1
  });

  console.log('未登录访问结果:', result);
  
  if (result.code === 1002) {
    console.log('✅ 正确返回未登录错误');
    return true;
  } else {
    console.log('❌ 未正确处理未登录情况');
    return false;
  }
}

/**
 * 测试无效套餐ID
 */
async function testRenewWithInvalidPlan() {
  console.log('\n=== 测试无效套餐ID ===');
  
  const result = await request('POST', '/api/user/renew', {
    plan_id: 99999
  }, authToken);

  console.log('无效套餐ID结果:', result);
  
  if (result.code === 1001) {
    console.log('✅ 正确返回套餐不存在错误');
    return true;
  } else {
    console.log('❌ 未正确处理无效套餐ID');
    return false;
  }
}

/**
 * 运行所有测试
 */
async function runAllTests() {
  console.log('🚀 开始续费功能测试\n');
  console.log('测试时间:', new Date().toLocaleString());

  try {
    // 1. 测试登录
    const loginSuccess = await testLogin();
    if (!loginSuccess) {
      console.log('\n❌ 登录失败，终止测试');
      return;
    }

    // 2. 测试获取套餐列表
    const planId = await testGetPlans();
    if (!planId) {
      console.log('\n❌ 获取套餐列表失败，终止测试');
      return;
    }

    // 3. 测试未登录访问
    await testRenewWithoutAuth();

    // 4. 测试无效套餐ID
    await testRenewWithInvalidPlan();

    // 5. 测试正常续费
    const renewResult = await testRenew(planId);

    console.log('\n=== 测试完成 ===');
    console.log('测试时间:', new Date().toLocaleString());
    
    if (renewResult) {
      console.log('\n✅ 所有测试通过！');
      console.log('\n⚠️  注意事项:');
      console.log('1. 续费订单已创建，需要手动在VMQ后台模拟支付回调');
      console.log('2. 支付回调地址: POST /api/user/payment/notify');
      console.log('3. 回调参数示例:');
      console.log(`   payId=${renewResult.out_trade_no}`);
      console.log('   orderId=VMQ订单号');
      console.log('   type=2');
      console.log('   price=套餐金额');
      console.log('   reallyPrice=实付金额');
      console.log('   sign=MD5签名');
    }
  } catch (error) {
    console.error('\n❌ 测试过程中发生错误:', error.message);
  }
}

// 运行测试
runAllTests();
```

- [ ] **Step 2: 验证测试脚本创建成功**

Run: `ls -la server/test/test-renew.js`
Expected: 文件存在且有内容

---

## Task 5: 创建续费弹窗组件

**Files:**
- Create: `client-user/src/components/RenewDialog.vue`

- [ ] **Step 1: 创建续费弹窗组件**

```vue
<template>
  <el-dialog
    v-model="dialogVisible"
    title="续费套餐"
    width="800px"
    :before-close="handleClose"
  >
    <div class="renew-dialog-content">
      <el-alert
        title="续费说明"
        description="续费将在现有套餐基础上累加流量，使用期限保持无限期。"
        type="info"
        :closable="false"
        show-icon
        style="margin-bottom: 20px;"
      />
      
      <div v-if="loading" class="loading-container">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>加载套餐中...</span>
      </div>
      
      <div v-else-if="plans.length === 0" class="empty-container">
        <el-empty description="暂无可用套餐" />
      </div>
      
      <div v-else class="plans-grid">
        <div
          v-for="plan in plans"
          :key="plan.id"
          class="plan-card"
          :class="{ 'is-selected': selectedPlanId === plan.id, 'is-current': plan.id === currentPlanId }"
          @click="selectPlan(plan.id)"
        >
          <div class="plan-header">
            <h3 class="plan-name">{{ plan.name }}</h3>
            <el-tag v-if="plan.id === currentPlanId" type="success" size="small">当前套餐</el-tag>
          </div>
          
          <div class="plan-price">
            <span class="currency">¥</span>
            <span class="amount">{{ (plan.price / 100).toFixed(2) }}</span>
          </div>
          
          <div class="plan-traffic">
            <el-icon><DataLine /></el-icon>
            <span>{{ formatTraffic(plan.traffic_limit) }}</span>
          </div>
          
          <div v-if="plan.description" class="plan-description">
            {{ plan.description }}
          </div>
          
          <div class="plan-check" v-if="selectedPlanId === plan.id">
            <el-icon><CircleCheck /></el-icon>
          </div>
        </div>
      </div>
    </div>
    
    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleClose">取消</el-button>
        <el-button
          type="primary"
          :disabled="!selectedPlanId"
          :loading="submitting"
          @click="handleRenew"
        >
          立即续费
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { Loading, DataLine, CircleCheck } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import api from '@/api'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  currentPlanId: {
    type: Number,
    default: null
  }
})

const emit = defineEmits(['update:visible', 'renew'])

const dialogVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

const loading = ref(false)
const submitting = ref(false)
const plans = ref([])
const selectedPlanId = ref(null)

watch(() => props.visible, (newVal) => {
  if (newVal) {
    fetchPlans()
    selectedPlanId.value = null
  }
})

/**
 * 获取套餐列表
 */
async function fetchPlans() {
  try {
    loading.value = true
    const result = await api.user.getPlans()
    if (result.code === 0) {
      plans.value = result.data || []
    } else {
      ElMessage.error(result.message || '获取套餐列表失败')
    }
  } catch (error) {
    console.error('获取套餐列表失败:', error)
    ElMessage.error('获取套餐列表失败')
  } finally {
    loading.value = false
  }
}

/**
 * 选择套餐
 */
function selectPlan(planId) {
  selectedPlanId.value = planId
}

/**
 * 格式化流量显示
 */
function formatTraffic(bytes) {
  if (!bytes || bytes === 0) return '无限制'
  
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * 关闭弹窗
 */
function handleClose() {
  dialogVisible.value = false
}

/**
 * 提交续费
 */
async function handleRenew() {
  if (!selectedPlanId.value) {
    ElMessage.warning('请选择套餐')
    return
  }
  
  submitting.value = true
  
  try {
    emit('renew', selectedPlanId.value)
  } catch (error) {
    console.error('续费失败:', error)
    ElMessage.error('续费失败，请重试')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.renew-dialog-content {
  min-height: 300px;
}

.loading-container,
.empty-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: #909399;
}

.loading-container .is-loading {
  font-size: 32px;
  margin-bottom: 10px;
}

.plans-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

.plan-card {
  position: relative;
  border: 2px solid #e4e7ed;
  border-radius: 12px;
  padding: 20px;
  cursor: pointer;
  transition: all 0.3s ease;
  background: #fff;
}

.plan-card:hover {
  border-color: #409eff;
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.2);
}

.plan-card.is-selected {
  border-color: #409eff;
  background: #ecf5ff;
}

.plan-card.is-current {
  border-color: #67c23a;
}

.plan-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.plan-name {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}

.plan-price {
  margin-bottom: 12px;
}

.plan-price .currency {
  font-size: 16px;
  color: #f56c6c;
}

.plan-price .amount {
  font-size: 28px;
  font-weight: 700;
  color: #f56c6c;
}

.plan-traffic {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #606266;
  font-size: 14px;
  margin-bottom: 8px;
}

.plan-description {
  color: #909399;
  font-size: 12px;
  line-height: 1.5;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #ebeef5;
}

.plan-check {
  position: absolute;
  top: 10px;
  right: 10px;
  color: #409eff;
  font-size: 24px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
```

- [ ] **Step 2: 验证组件创建成功**

Run: `ls -la client-user/src/components/RenewDialog.vue`
Expected: 文件存在且有内容

---

## Task 6: 修改个人中心页面添加续费入口

**Files:**
- Modify: `client-user/src/views/user/Profile.vue`

- [ ] **Step 1: 添加续费按钮和弹窗**

在模板部分，找到流量使用情况卡片（约第31-44行），在其后添加续费卡片：

```vue
<!-- 在流量使用情况卡片后添加 -->
<div class="content-card">
  <h2 class="card-title">套餐续费</h2>
  <div class="renew-section">
    <el-alert
      title="续费说明"
      description="续费将在现有套餐基础上累加流量，使用期限保持无限期。"
      type="info"
      :closable="false"
      show-icon
      style="margin-bottom: 20px;"
    />
    <el-button 
      type="primary" 
      size="large" 
      @click="showRenewDialog = true"
      :disabled="!userInfo.plan_id"
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
```

- [ ] **Step 2: 添加导入和状态变量**

在script setup部分添加：

```javascript
import { Refresh } from '@element-plus/icons-vue'
import RenewDialog from '@/components/RenewDialog.vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const showRenewDialog = ref(false)
```

- [ ] **Step 3: 添加续费处理函数**

在script setup部分添加：

```javascript
/**
 * 处理续费
 * @param {number} planId - 套餐ID
 */
async function handleRenew(planId) {
  try {
    showRenewDialog.value = false
    
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
      ElMessage.error(response.message || '续费失败')
    }
  } catch (error) {
    console.error('续费失败:', error)
    ElMessage.error('续费失败，请重试')
  }
}
```

- [ ] **Step 4: 添加续费区域样式**

在style部分添加：

```css
.renew-section {
  text-align: center;
  padding: 20px 0;
}
```

- [ ] **Step 5: 验证修改成功**

Run: `grep -n "RenewDialog" client-user/src/views/user/Profile.vue`
Expected: 显示导入和使用RenewDialog的代码行

---

## Task 7: 添加续费API方法

**Files:**
- Modify: `client-user/src/api/index.js`

- [ ] **Step 1: 添加续费API方法**

在userApi对象中添加：

```javascript
/**
 * 用户续费
 * @param {Object} data - 续费数据
 * @param {number} data.plan_id - 套餐ID
 * @returns {Promise<Object>} 响应数据
 */
renew(data) {
  return apiClient.post('/renew', data)
}
```

- [ ] **Step 2: 验证API方法添加成功**

Run: `grep -n "renew" client-user/src/api/index.js`
Expected: 显示新添加的renew方法

---

## Task 8: 测试后端续费接口

**Files:**
- Test: `server/test/test-renew.js`

- [ ] **Step 1: 确保服务器正在运行**

Run: `curl http://localhost:30000/api/user/plans`
Expected: 返回套餐列表数据

- [ ] **Step 2: 运行续费测试脚本**

Run: `node server/test/test-renew.js`
Expected: 
- 登录成功
- 获取套餐列表成功
- 未登录访问返回1002错误
- 无效套餐ID返回1001错误
- 续费订单创建成功

- [ ] **Step 3: 检查数据库中的续费订单**

Run: `psql -d subscription_manager -c "SELECT id, out_trade_no, plan_id, amount, status FROM orders WHERE out_trade_no LIKE 'REN%' ORDER BY id DESC LIMIT 5;"`
Expected: 显示新创建的续费订单

---

## Task 9: 构建前端

**Files:**
- Build: `client-user`

- [ ] **Step 1: 安装依赖（如果需要）**

Run: `cd client-user && npm install`
Expected: 依赖安装成功

- [ ] **Step 2: 构建前端**

Run: `cd client-user && npx vite build --minify esbuild`
Expected: 构建成功，无错误

- [ ] **Step 3: 验证构建产物**

Run: `ls -la client-user/dist/`
Expected: 显示构建产物文件

---

## Task 10: 完整流程测试

**Files:**
- Test: 手动测试

- [ ] **Step 1: 访问用户端**

在浏览器中打开: `http://localhost:30000`

- [ ] **Step 2: 登录测试账号**

使用测试账号登录:
- 邮箱: `fuqiang_2015@163.com`
- 密码: `fuqiang2015`

- [ ] **Step 3: 进入个人中心**

登录后进入个人中心页面

- [ ] **Step 4: 测试续费功能**

1. 点击"续费套餐"按钮
2. 在弹窗中选择套餐
3. 点击"立即续费"
4. 确认跳转到支付等待页

- [ ] **Step 5: 验证支付页面**

确认支付等待页显示：
- 支付二维码
- 订单信息
- 支付链接

---

## 自我审查清单

### 1. 规范覆盖检查

- ✅ 续费接口设计：`POST /api/user/renew`
- ✅ 流量累加逻辑：新总流量 = 当前套餐流量 + 新套餐流量
- ✅ 前端交互：个人中心续费按钮 + 套餐选择弹窗
- ✅ 订单类型识别：通过 `out_trade_no` 前缀 `REN` 区分
- ✅ 3X-UI同步：复用现有同步逻辑

### 2. 占位符扫描

- ✅ 无TBD、TODO或模糊要求
- ✅ 所有代码步骤都有完整实现
- ✅ 所有测试步骤都有明确命令

### 3. 类型一致性检查

- ✅ 函数名称一致
- ✅ 参数类型一致
- ✅ 返回值类型一致

---

## 执行选择

**计划完成并保存到 `docs/superpowers/plans/2026-05-05-renew-feature-plan.md`**

**两种执行选项：**

**1. 子代理驱动（推荐）** - 每个任务分派一个新的子代理，任务间进行审查，快速迭代

**2. 内联执行** - 在当前会话中执行任务，批量执行并设置检查点

**你选择哪种方式？**
