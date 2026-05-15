# 新用户同步状态检测设计

## 背景问题

随着管理的服务器增加，用户支付完成首次登录时，用户的信息还在向多个3X-UI服务器同步。在同步未完成时，用户点击生成订阅链接会产生问题。

## 设计目标

1. 新用户首次登录时，检测同步是否完成
2. 同步未完成时显示loading弹窗提示用户
3. 同步完成后自动隐藏弹窗，用户正常使用
4. 不影响现有用户和续费场景

## 技术方案

### 核心逻辑

1. **数据库变更**：在 `users` 表添加 `sync_status` 字段
2. **数据库迁移**：将现有用户的 `sync_status` 设置为已完成
3. **后端逻辑**：同步开始和结束时更新 `sync_status`
4. **前端逻辑**：轮询检查 `sync_status` 状态，自动隐藏弹窗

### 状态定义

- `sync_status=0`：未同步（初始状态）
- `sync_status=1`：同步中
- `sync_status=2`：已完成

### 数据库迁移

**迁移脚本：** `server/db/migrations/002-sync-status-migration.js`

1. 在 `users` 表添加 `sync_status` 字段，默认值为 0
2. 将现有用户的 `sync_status` 设置为 2（已完成）

### 后端实现

#### 1. 修改 `server/services/order-service.js`

在 `syncUserToXuiServers` 函数中：

```javascript
// 同步开始时
await db.prepare('UPDATE users SET sync_status = 1 WHERE id = ?').run(user.id)

// 同步完成时（包括失败）
await db.prepare('UPDATE users SET sync_status = 2 WHERE id = ?').run(user.id)
```

#### 2. 修改 `server/routes/user/profile.js`

在返回用户信息时包含 `sync_status` 字段。

#### 3. 新增 `server/routes/user/sync-status.js`

提供轮询接口，返回用户的 `sync_status` 状态。

### 前端实现

#### 1. 修改 `client-user/src/api/index.js`

添加轮询接口：

```javascript
getSyncStatus() {
  return apiClient.get('/sync-status')
}
```

#### 2. 修改 `client-user/src/views/user/Profile.vue`

**新增状态变量：**

```javascript
const syncLoading = ref(false)
const syncTimer = ref(null)
```

**页面加载时检查：**

```javascript
onMounted(() => {
  fetchUserInfo()
  fetchOrders()
  checkSyncStatus()
})
```

**检查同步状态函数：**

```javascript
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
```

**轮询函数：**

```javascript
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

**生命周期清理：**

```javascript
onBeforeUnmount(() => {
  if (syncTimer.value) {
    clearInterval(syncTimer.value)
    syncTimer.value = null
  }
})
```

**模板添加loading弹窗：**

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

### 判断逻辑

**新用户判断条件：**
- `payment_count === 1`：首次支付
- `sync_status === 1`：同步中

**同步完成条件：**
- `sync_status === 2`：已完成

### 错误处理

- 同步失败时，后端仍然将 `sync_status` 设置为 2（已完成）
- 前端轮询失败时，继续轮询，不显示错误
- 用户可以手动刷新页面重试

## 修改范围

### 后端

1. `server/db/init.js`：添加 `sync_status` 字段到 `users` 表
2. `server/db/migrations/002-sync-status-migration.js`：迁移脚本
3. `server/services/order-service.js`：同步开始和结束时更新 `sync_status`
4. `server/routes/user/profile.js`：返回 `sync_status` 字段
5. 新增 `server/routes/user/sync-status.js`：轮询接口

### 前端

1. `client-user/src/api/index.js`：添加轮询接口
2. `client-user/src/views/user/Profile.vue`：添加loading弹窗和轮询逻辑

## 测试场景

1. **新用户首次登录**：显示loading弹窗，同步完成后自动隐藏
2. **现有用户登录**：不显示弹窗
3. **续费用户**：不显示弹窗
4. **同步失败**：弹窗自动隐藏，用户可以正常使用
5. **页面刷新**：重新检查同步状态
6. **长时间同步**：轮询持续进行，直到同步完成

## 兼容性

- 不影响现有用户
- 不影响续费场景
- 数据库迁移脚本支持幂等运行
