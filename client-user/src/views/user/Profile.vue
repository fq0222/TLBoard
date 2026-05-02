<template>
  <div class="profile-container">
    <div class="page-header">
      <h1 class="page-title">个人中心</h1>
      <p class="page-subtitle">查看和管理您的账户信息</p>
    </div>
    
    <div class="content-card">
      <div class="user-info">
        <div class="info-item">
          <span class="info-label">邮箱：</span>
          <span class="info-value">{{ userInfo.email }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">当前套餐：</span>
          <span class="info-value">{{ userInfo.plan_name || '未订阅' }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">到期时间：</span>
          <span class="info-value">{{ userInfo.expire_text || '未订阅' }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">账号状态：</span>
          <el-tag :type="userInfo.enabled ? 'success' : 'danger'">
            {{ userInfo.enabled ? '正常' : '禁用' }}
          </el-tag>
        </div>
      </div>
    </div>
    
    <div class="content-card">
      <h2 class="card-title">流量使用情况</h2>
      <div class="traffic-info">
        <div class="traffic-text">
          <span>已用：{{ userInfo.traffic_used_text || '0 B' }}</span>
          <span>总量：{{ userInfo.traffic_limit_text || '0 B' }}</span>
        </div>
        <el-progress 
          :percentage="userInfo.traffic_percent || 0" 
          :stroke-width="20"
          :text-inside="true"
        />
      </div>
    </div>
    
    <div class="content-card">
      <h2 class="card-title">订阅链接</h2>
      <div class="subscription-link">
        <el-input 
          v-model="userInfo.subscription_url" 
          readonly
          size="large"
        >
          <template #append>
            <el-button @click="copyLink">
              <el-icon><CopyDocument /></el-icon>
              复制
            </el-button>
          </template>
        </el-input>
        <p class="link-tip">复制此链接到您的代理客户端中使用</p>
      </div>
    </div>
    
    <div class="content-card">
      <h2 class="card-title">最近订单</h2>
      <el-table :data="orders" style="width: 100%">
        <el-table-column prop="out_trade_no" label="订单号" />
        <el-table-column prop="plan_name" label="套餐" />
        <el-table-column prop="amount_text" label="金额">
          <template #default="scope">
            ¥{{ scope.row.amount_text }}
          </template>
        </el-table-column>
        <el-table-column prop="status_text" label="状态">
          <template #default="scope">
            <el-tag :type="getStatusType(scope.row.status)">
              {{ scope.row.status_text }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="时间">
          <template #default="scope">
            {{ formatTime(scope.row.created_at) }}
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
/**
 * 个人中心组件
 * 展示用户信息、流量使用、订阅链接和订单记录
 */

import { ref, onMounted } from 'vue'
import { useUserStore } from '@/stores/user'
import { CopyDocument } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import api from '@/api'

const userStore = useUserStore()

// 响应式数据
const userInfo = ref({})
const orders = ref([])
const loading = ref(false)

/**
 * 获取用户信息
 */
async function fetchUserInfo() {
  try {
    loading.value = true
    const result = await userStore.fetchUserProfile()
    if (result.success) {
      userInfo.value = result.data
    }
  } catch (error) {
    console.error('获取用户信息失败:', error)
  } finally {
    loading.value = false
  }
}

/**
 * 获取订单列表
 */
async function fetchOrders() {
  try {
    const response = await api.user.getOrders({ page: 1, limit: 10 })
    if (response.code === 0) {
      orders.value = response.data.list
    }
  } catch (error) {
    console.error('获取订单列表失败:', error)
  }
}

/**
 * 复制订阅链接
 */
function copyLink() {
  if (userInfo.value.subscription_url) {
    navigator.clipboard.writeText(userInfo.value.subscription_url)
    ElMessage.success('链接已复制到剪贴板')
  }
}

/**
 * 获取状态类型
 * @param {string} status - 状态值
 * @returns {string} 状态类型
 */
function getStatusType(status) {
  const typeMap = {
    'pending': 'warning',
    'paid': 'success',
    'expired': 'info'
  }
  return typeMap[status] || 'info'
}

/**
 * 格式化时间
 * @param {number} timestamp - 时间戳
 * @returns {string} 格式化后的时间
 */
function formatTime(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp * 1000)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// 组件挂载时获取数据
onMounted(() => {
  fetchUserInfo()
  fetchOrders()
})
</script>

<style scoped>
.profile-container {
  max-width: 800px;
}

.page-header {
  margin-bottom: 30px;
}

.page-title {
  font-size: 28px;
  color: #333;
  margin-bottom: 10px;
}

.page-subtitle {
  color: #666;
  font-size: 16px;
}

.content-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 30px;
  margin-bottom: 20px;
}

.card-title {
  font-size: 20px;
  color: #333;
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 1px solid #eee;
}

.user-info {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}

.info-item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.info-label {
  color: #666;
  font-weight: 500;
}

.info-value {
  color: #333;
}

.traffic-info {
  margin-top: 10px;
}

.traffic-text {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
  color: #666;
}

.subscription-link {
  margin-top: 10px;
}

.link-tip {
  margin-top: 10px;
  color: #999;
  font-size: 14px;
}
</style>