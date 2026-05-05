<template>
  <div class="tickets-container">
    <div class="page-header">
      <h1 class="page-title">工单管理</h1>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-row">
      <el-card class="stat-card">
        <div class="stat-value">{{ stats.open_count || 0 }}</div>
        <div class="stat-label">待处理</div>
      </el-card>
      <el-card class="stat-card">
        <div class="stat-value">{{ stats.pending_count || 0 }}</div>
        <div class="stat-label">处理中</div>
      </el-card>
      <el-card class="stat-card">
        <div class="stat-value">{{ stats.today_count || 0 }}</div>
        <div class="stat-label">今日新增</div>
      </el-card>
    </div>

    <!-- 搜索和筛选 -->
    <div class="filter-bar">
      <el-input 
        v-model="keyword" 
        placeholder="搜索工单标题或用户邮箱" 
        clearable 
        style="width: 300px"
        @keyup.enter="fetchTickets"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>
      <el-select v-model="statusFilter" placeholder="状态筛选" clearable style="width: 150px">
        <el-option label="待处理" value="open" />
        <el-option label="处理中" value="pending" />
        <el-option label="已关闭" value="closed" />
      </el-select>
      <el-button type="primary" @click="fetchTickets">搜索</el-button>
    </div>

    <!-- 工单列表 -->
    <div class="content-card">
      <el-table :data="tickets" v-loading="loading" style="width: 100%">
        <el-table-column prop="title" label="工单标题" min-width="200">
          <template #default="{ row }">
            <router-link :to="`/admin/tickets/${row.id}`" class="ticket-link">
              {{ row.title }}
            </router-link>
          </template>
        </el-table-column>
        <el-table-column prop="user_email" label="用户邮箱" width="200" />
        <el-table-column prop="status" label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)">
              {{ getStatusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="180">
          <template #default="{ row }">
            {{ formatTime(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150">
          <template #default="{ row }">
            <el-button link type="primary" @click="$router.push(`/admin/tickets/${row.id}`)">
              查看
            </el-button>
            <el-button link type="danger" @click="handleDelete(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination" v-if="total > limit">
        <el-pagination
          v-model:current-page="page"
          :page-size="limit"
          :total="total"
          layout="prev, pager, next"
          @current-change="fetchTickets"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/api'

const tickets = ref([])
const loading = ref(false)
const page = ref(1)
const limit = ref(10)
const total = ref(0)
const keyword = ref('')
const statusFilter = ref('')
const stats = ref({})

function getStatusType(status) {
  const map = { open: 'info', pending: 'warning', closed: '' }
  return map[status] || ''
}

function getStatusText(status) {
  const map = { open: '待处理', pending: '处理中', closed: '已关闭' }
  return map[status] || status
}

function formatTime(timestamp) {
  if (!timestamp) return '-'
  const date = new Date(timestamp * 1000)
  return date.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  })
}

async function fetchStats() {
  try {
    const response = await api.admin.getTicketStats()
    if (response.code === 0) {
      stats.value = response.data
    }
  } catch (error) {
    console.error('获取工单统计失败:', error)
  }
}

async function fetchTickets() {
  try {
    loading.value = true
    const params = {
      page: page.value,
      limit: limit.value
    }
    if (statusFilter.value) params.status = statusFilter.value
    if (keyword.value) params.keyword = keyword.value

    const response = await api.admin.getTickets(params)
    if (response.code === 0) {
      tickets.value = response.data.list
      total.value = response.data.total
    }
  } catch (error) {
    console.error('获取工单列表失败:', error)
    ElMessage.error('获取工单列表失败')
  } finally {
    loading.value = false
  }
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(
      `确定要删除工单"${row.title}"吗？删除后无法恢复。`,
      '确认删除',
      { type: 'warning' }
    )
    
    const response = await api.admin.deleteTicket(row.id)
    if (response.code === 0) {
      ElMessage.success('工单已删除')
      fetchTickets()
      fetchStats()
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除工单失败:', error)
      ElMessage.error('删除工单失败')
    }
  }
}

watch(statusFilter, () => {
  page.value = 1
  fetchTickets()
})

onMounted(() => {
  fetchStats()
  fetchTickets()
})
</script>

<style scoped>
.tickets-container {
  width: 100%;
}

.page-header {
  margin-bottom: 20px;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}

.stats-row {
  display: flex;
  gap: 20px;
  margin-bottom: 20px;
}

.stat-card {
  flex: 1;
  text-align: center;
}

.stat-value {
  font-size: 32px;
  font-weight: 600;
  color: #409eff;
}

.stat-label {
  font-size: 14px;
  color: #909399;
  margin-top: 5px;
}

.filter-bar {
  display: flex;
  gap: 15px;
  margin-bottom: 20px;
}

.content-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 20px;
}

.ticket-link {
  color: #409eff;
  text-decoration: none;
}

.ticket-link:hover {
  text-decoration: underline;
}

.pagination {
  margin-top: 20px;
  display: flex;
  justify-content: center;
}
</style>