<template>
  <div class="dashboard-container">
    <div class="page-header">
      <h1 class="page-title">仪表盘</h1>
      <p class="page-subtitle">系统概览和统计数据</p>
    </div>
    
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon" style="background: #409eff;">
          <el-icon><User /></el-icon>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ stats.userCount }}</div>
          <div class="stat-label">用户总数</div>
        </div>
      </div>
      
      <div class="stat-card">
        <div class="stat-icon" style="background: #67c23a;">
          <el-icon><Goods /></el-icon>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ stats.planCount }}</div>
          <div class="stat-label">套餐数量</div>
        </div>
      </div>
      
      <div class="stat-card">
        <div class="stat-icon" style="background: #e6a23c;">
          <el-icon><Document /></el-icon>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ stats.orderCount }}</div>
          <div class="stat-label">订单总数</div>
        </div>
      </div>
      
      <div class="stat-card">
        <div class="stat-icon" style="background: #f56c6c;">
          <el-icon><Monitor /></el-icon>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ stats.serverCount }}</div>
          <div class="stat-label">服务器数量</div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon" style="background: #9c27b0;">
          <el-icon><Message /></el-icon>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ stats.emailTodayCount }} <span class="stat-limit">/ {{ stats.emailDailyLimit }}</span></div>
          <div class="stat-label">今日邮件发送</div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon" style="background: #ff9800;">
          <el-icon><Promotion /></el-icon>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ stats.campaignDailyLimit }}</div>
          <div class="stat-label">每日群发配额</div>
        </div>
      </div>
    </div>
    
    <div class="content-grid">
      <div class="content-card">
        <h2 class="card-title">最近订单</h2>
        <el-table :data="recentOrders" style="width: 100%">
          <el-table-column prop="out_trade_no" label="订单号" />
          <el-table-column prop="email" label="用户邮箱" />
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
        </el-table>
      </div>
      
      <div class="content-card">
        <h2 class="card-title">服务器状态</h2>
        <div class="server-list">
          <div 
            v-for="server in servers" 
            :key="server.id" 
            class="server-item"
          >
            <div class="server-info">
              <span class="server-name">{{ server.name }}</span>
              <el-tag :type="server.status === 1 ? 'success' : 'danger'" size="small">
                {{ server.status_text }}
              </el-tag>
            </div>
            <div class="server-stats">
              <span>节点：{{ server.node_count }}</span>
              <span>用户：{{ server.user_count }}</span>
              <span>在线：{{ server.online_count }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * 仪表盘组件
 * 展示系统概览和统计数据
 */

import { ref, onMounted } from 'vue'
import { User, Goods, Document, Monitor, Message, Promotion } from '@element-plus/icons-vue'
import api from '@/api'

// 响应式数据
const stats = ref({
  userCount: 0,
  planCount: 0,
  orderCount: 0,
  serverCount: 0,
  emailTodayCount: 0,
  emailDailyLimit: 200,
  campaignDailyLimit: 100
})

const fetchStats = async () => {
  try {
    const res = await api.admin.getDashboardStats()
    if (res.code === 0) {
      stats.value = res.data
    }
  } catch (error) {
    console.error('获取统计数据失败:', error)
  }
}

const recentOrders = ref([])
const servers = ref([])

/**
 * 获取最近订单
 */
async function fetchRecentOrders() {
  try {
    const response = await api.admin.getOrders({ page: 1, limit: 5 })
    if (response.code === 0) {
      recentOrders.value = response.data.list
    }
  } catch (error) {
    console.error('获取最近订单失败:', error)
  }
}

/**
 * 获取服务器列表
 */
async function fetchServers() {
  try {
    const response = await api.admin.getServers()
    if (response.code === 0) {
      servers.value = response.data.servers
    }
  } catch (error) {
    console.error('获取服务器列表失败:', error)
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

// 组件挂载时获取数据
onMounted(() => {
  fetchStats()
  fetchRecentOrders()
  fetchServers()
})
</script>

<style scoped>
.dashboard-container {
  max-width: 1200px;
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

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  margin-bottom: 30px;
}

.stat-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 15px;
}

.stat-icon {
  width: 60px;
  height: 60px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 24px;
}

.stat-value {
  font-size: 32px;
  font-weight: bold;
  color: #333;
}

.stat-limit {
  font-size: 16px;
  color: #999;
  font-weight: normal;
}

.stat-label {
  color: #666;
  font-size: 14px;
}

.content-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}

.content-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 20px;
}

.card-title {
  font-size: 18px;
  color: #333;
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 1px solid #eee;
}

.server-list {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.server-item {
  padding: 15px;
  background: #f5f7fa;
  border-radius: 8px;
}

.server-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.server-name {
  font-weight: 500;
  color: #333;
}

.server-stats {
  display: flex;
  gap: 20px;
  color: #666;
  font-size: 14px;
}
</style>