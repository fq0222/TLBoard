# 支付回调页面可见性检测设计

## 背景问题

在移动端，用户在 `PaymentCallback.vue` 页面等待支付时，通常会截图支付二维码，然后切换到支付宝或微信APP进行支付。切换到其他APP后，浏览器会暂停JavaScript执行，导致轮询停止。用户切回浏览器时，页面仍显示"等待支付"状态，但实际上支付可能已经完成。

## 设计目标

1. 用户切回浏览器时，立即检测支付状态
2. 减少页面不可见时的资源消耗
3. 保持倒计时的准确性
4. 提供流畅的用户体验

## 技术方案

### 核心逻辑

使用 `document.visibilitychange` 事件监听页面可见性变化，结合轮询优化：

- **页面可见时**：正常轮询（每5秒）
- **页面不可见时**：暂停轮询，减少资源消耗
- **页面恢复可见时**：立即检查一次支付状态，然后恢复正常轮询

### 实现细节

#### 1. 新增状态变量

```javascript
const isPageVisible = ref(true)  // 页面是否可见
```

#### 2. 页面可见性处理函数

```javascript
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

#### 3. 修改轮询逻辑

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

#### 4. 生命周期管理

**onMounted：**
```javascript
onMounted(() => {
  generateQrCode()
  checkPaymentStatus()
  startCountdown()
  // 添加页面可见性监听
  document.addEventListener('visibilitychange', handleVisibilityChange)
})
```

**onBeforeUnmount：**
```javascript
onBeforeUnmount(() => {
  clearTimer()
  clearCountdownTimer()
  // 移除页面可见性监听
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
```

### 倒计时优化

页面不可见时暂停倒计时，页面恢复可见时继续：

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

## 用户体验优化

1. **即时反馈**：页面恢复可见时，立即检查支付状态，避免用户看到"卡住"的页面
2. **资源节约**：页面不可见时暂停轮询，减少不必要的网络请求和CPU消耗
3. **倒计时准确**：页面不可见时暂停倒计时，避免倒计时提前结束

## 修改范围

仅修改 `client-user/src/views/PaymentCallback.vue` 文件：

1. 添加 `isPageVisible` 状态变量
2. 添加 `handleVisibilityChange` 函数
3. 修改 `scheduleNextCheck` 函数，增加页面可见性检查
4. 修改 `startCountdown` 函数，增加页面可见性检查
5. 在 `onMounted` 中添加 `visibilitychange` 事件监听
6. 在 `onBeforeUnmount` 中移除 `visibilitychange` 事件监听

## 测试场景

1. **正常支付流程**：页面可见时，轮询正常工作
2. **切换APP场景**：用户切换到支付APP，切回后立即检查支付状态
3. **长时间后台**：页面长时间不可见，切回后立即检查支付状态
4. **倒计时准确性**：页面不可见时倒计时暂停，切回后继续倒计时
5. **支付完成场景**：页面不可见时支付完成，切回后立即显示支付成功

## 兼容性

- `document.visibilitychange` 事件在所有现代浏览器中都支持
- `document.visibilityState` 属性在所有现代浏览器中都支持
- 无额外的依赖或polyfill需求
