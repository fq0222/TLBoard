<template>
  <div class="tickets-container">
    <div class="page-header">
      <h1 class="page-title">我的工单</h1>
      <el-button type="primary" @click="$router.push('/user/tickets/create')">
        创建工单
      </el-button>
    </div>

    <div class="content-card">
      <el-table :data="tickets" v-loading="loading" style="width: 100%">
        <el-table-column prop="title" label="工单标题" min-width="200">
          <template #default="{ row }">
            <router-link :to="`/user/tickets/${row.id}`" class="ticket-link">
              {{ row.title }}
            </router-link>
          </template>
        </el-table-column>
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
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-button link type="primary" @click="$router.push(`/user/tickets/${row.id}`)">
              查看
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
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '@/api'

const tickets = ref([])
const loading = ref(false)
const page = ref(1)
const limit = ref(10)
const total = ref(0)

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

async function fetchTickets() {
  try {
    loading.value = true
    const response = await api.user.getTickets({ page: page.value, limit: limit.value })
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

onMounted(() => {
  fetchTickets()
})
</script>

<style scoped>
.tickets-container {
  max-width: 1000px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: #303133;
  margin: 0;
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