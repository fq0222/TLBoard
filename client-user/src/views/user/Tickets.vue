<template>
  <div class="tickets-container">
    <div class="page-header">
      <h1 class="page-title">我的工单</h1>
      <el-button type="primary" @click="$router.push('/user/tickets/create')">
        创建工单
      </el-button>
    </div>

    <div class="content-card">
      <el-table :data="tickets" v-loading="loading" class="tickets-table">
        <el-table-column prop="title" label="工单标题" min-width="200">
          <template #default="{ row }">
            <router-link :to="`/user/tickets/${row.id}`" class="ticket-link">
              {{ row.title }}
              <span v-if="row.is_unread" class="unread-badge">未读</span>
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

      <div v-loading="loading" class="mobile-ticket-list">
        <el-empty v-if="tickets.length === 0 && !loading" description="暂无工单" />
        <router-link
          v-for="ticket in tickets"
          :key="ticket.id"
          :to="`/user/tickets/${ticket.id}`"
          class="mobile-ticket-card"
        >
          <div class="mobile-ticket-top">
            <div class="mobile-ticket-title-row">
              <span class="mobile-ticket-title">{{ ticket.title }}</span>
              <span v-if="ticket.is_unread" class="unread-badge mobile-unread-badge">未读</span>
            </div>
            <el-tag class="mobile-ticket-status" :type="getStatusType(ticket.status)">
              {{ getStatusText(ticket.status) }}
            </el-tag>
          </div>

          <div class="mobile-ticket-meta">
            <div class="mobile-ticket-field">
              <span>创建</span>
              <strong>{{ formatCompactTime(ticket.created_at) }}</strong>
            </div>
            <div class="mobile-ticket-field action-field">
              <span>操作</span>
              <strong>查看</strong>
            </div>
          </div>
        </router-link>
      </div>

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

/**
 * 格式化移动端工单时间，保留日期和分钟，减少卡片高度。
 *
 * @param {number|string|null} timestamp - 后端返回的秒级时间戳
 * @returns {string} 紧凑时间文本
 */
function formatCompactTime(timestamp) {
  if (!timestamp) return '-'

  const date = new Date(Number(timestamp) * 1000)
  if (Number.isNaN(date.getTime())) return '-'

  const pad = (num) => String(num).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
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

.tickets-table {
  width: 100%;
}

.mobile-ticket-list {
  display: none;
}

.unread-badge {
  display: inline-block;
  font-size: 12px;
  color: #f56c6c;
  background: #fef0f0;
  border: 1px solid #fde2e2;
  border-radius: 4px;
  padding: 0 6px;
  margin-left: 8px;
  font-weight: normal;
}

.pagination {
  margin-top: 20px;
  display: flex;
  justify-content: center;
}

@media (max-width: 768px) {
  .tickets-container {
    max-width: none;
  }

  .page-header {
    margin-bottom: 16px;
  }

  .page-title {
    font-size: 22px;
  }

  .content-card {
    border-radius: 14px;
    padding: 14px;
  }

  .tickets-table {
    display: none;
  }

  .mobile-ticket-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 120px;
  }

  .mobile-ticket-card {
    display: block;
    padding: 10px 12px;
    border: 1px solid #ebeef5;
    border-radius: 8px;
    background: #fff;
    color: #303133;
    text-decoration: none;
  }

  .mobile-ticket-top {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
  }

  .mobile-ticket-title-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .mobile-ticket-title {
    min-width: 0;
    overflow: hidden;
    color: #409eff;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.35;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mobile-unread-badge {
    flex-shrink: 0;
    margin-left: 0;
  }

  .mobile-ticket-status {
    height: 24px;
    padding: 0 8px;
    font-size: 12px;
  }

  .mobile-ticket-meta {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
    margin-top: 8px;
  }

  .mobile-ticket-field {
    display: flex;
    align-items: baseline;
    gap: 5px;
    min-width: 0;
  }

  .mobile-ticket-field span {
    color: #909399;
    font-size: 12px;
    line-height: 1.2;
  }

  .mobile-ticket-field strong {
    min-width: 0;
    overflow: hidden;
    color: #606266;
    font-size: 12px;
    font-weight: 500;
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .action-field {
    justify-content: flex-end;
  }

  .action-field strong {
    color: #409eff;
  }

  .pagination {
    margin-top: 14px;
  }
}
</style>
