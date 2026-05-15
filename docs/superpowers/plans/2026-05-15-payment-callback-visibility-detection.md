# 支付回调页面可见性检测 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 解决移动端用户切换到支付APP后浏览器轮询停止、切回后页面卡住的问题

**Architecture:** 使用 `document.visibilitychange` 事件监听页面可见性变化，页面不可见时暂停轮询和倒计时，页面恢复可见时立即检查支付状态并恢复轮询

**Tech Stack:** Vue 3 Composition API, Document Visibility API

---

## 文件结构

仅修改一个文件：
- Modify: `client-user/src/views/PaymentCallback.vue`

---

### Task 1: 添加页面可见性状态变量

**Files:**
- Modify: `client-user/src/views/PaymentCallback.vue:70-75`

- [ ] **Step 1: 添加 `isPageVisible` 状态变量**

在第 75 行 `const pollInterval = 5000` 之后添加：

```javascript
const isPageVisible = ref(true) // 页面是否可见
```

- [ ] **Step 2: 确认变量已正确添加**

检查 `client-user/src/views/PaymentCallback.vue` 第 76 行附近，确认 `isPageVisible` 变量存在。

---

### Task 2: 添加页面可见性处理函数

**Files:**
- Modify: `client-user/src/views/PaymentCallback.vue` (在 `scheduleNextCheck` 函数之前)

- [ ] **Step 1: 添加 `handleVisibilityChange` 函数**

在 `scheduleNextCheck` 函数（第 162 行）之前添加：

```javascript
/**
 * 处理页面可见性变化
 * 页面恢复可见时立即检查支付状态，不可见时暂停轮询
 */
function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    isPageVisible.value = true
    // 页面恢复可见时，立即检查支付状态
    checkPaymentStatus()
  } else {
    isPageVisible.value = false
    // 页面不可见时，清除轮询定时器
    clearTimer()
  }
}
```

- [ ] **Step 2: 确认函数已正确添加**

检查 `client-user/src/views/PaymentCallback.vue`，确认 `handleVisibilityChange` 函数存在于 `scheduleNextCheck` 函数之前。

---

### Task 3: 修改轮询调度逻辑

**Files:**
- Modify: `client-user/src/views/PaymentCallback.vue:166-171`

- [ ] **Step 1: 修改 `scheduleNextCheck` 函数**

将原有的 `scheduleNextCheck` 函数：

```javascript
function scheduleNextCheck() {
  clearTimer()
  timer.value = setTimeout(() => {
    checkPaymentStatus()
  }, pollInterval)
}
```

替换为：

```javascript
function scheduleNextCheck() {
  clearTimer()
  // 只在页面可见时设置轮询
  if (isPageVisible.value) {
    timer.value = setTimeout(() => {
      checkPaymentStatus()
    }, pollInterval)
  }
}
```

- [ ] **Step 2: 确认修改正确**

检查 `scheduleNextCheck` 函数，确认包含 `isPageVisible.value` 的条件判断。

---

### Task 4: 修改倒计时逻辑

**Files:**
- Modify: `client-user/src/views/PaymentCallback.vue:230-239`

- [ ] **Step 1: 修改 `startCountdown` 函数**

将原有的 `startCountdown` 函数：

```javascript
function startCountdown() {
  countdownTimer.value = setInterval(() => {
    if (countdown.value > 0) {
      countdown.value--
    } else {
      clearCountdownTimer()
      clearTimer()
    }
  }, 1000)
}
```

替换为：

```javascript
function startCountdown() {
  countdownTimer.value = setInterval(() => {
    if (isPageVisible.value && countdown.value > 0) {
      countdown.value--
    } else if (countdown.value <= 0) {
      clearCountdownTimer()
      clearTimer()
    }
  }, 1000)
}
```

- [ ] **Step 2: 确认修改正确**

检查 `startCountdown` 函数，确认包含 `isPageVisible.value` 的条件判断。

---

### Task 5: 添加事件监听器生命周期管理

**Files:**
- Modify: `client-user/src/views/PaymentCallback.vue:241-254`

- [ ] **Step 1: 修改 `onMounted` 钩子**

将原有的 `onMounted`：

```javascript
onMounted(() => {
  generateQrCode()
  checkPaymentStatus()
  startCountdown()
})
```

替换为：

```javascript
onMounted(() => {
  generateQrCode()
  checkPaymentStatus()
  startCountdown()
  // 添加页面可见性监听
  document.addEventListener('visibilitychange', handleVisibilityChange)
})
```

- [ ] **Step 2: 修改 `onBeforeUnmount` 钩子**

将原有的 `onBeforeUnmount`：

```javascript
onBeforeUnmount(() => {
  clearTimer()
  clearCountdownTimer()
})
```

替换为：

```javascript
onBeforeUnmount(() => {
  clearTimer()
  clearCountdownTimer()
  // 移除页面可见性监听
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
```

- [ ] **Step 3: 确认生命周期钩子修改正确**

检查 `onMounted` 包含 `addEventListener`，`onBeforeUnmount` 包含 `removeEventListener`。

---

### Task 6: 构建验证

**Files:**
- 无新增文件

- [ ] **Step 1: 执行前端构建**

```bash
cd client-user && npx vite build --minify esbuild
```

Expected: 构建成功，无错误输出

- [ ] **Step 2: 提交代码**

```bash
git add client-user/src/views/PaymentCallback.vue
git commit -m "feat: 支付回调页面添加可见性检测，切回浏览器时立即检查支付状态"
```
