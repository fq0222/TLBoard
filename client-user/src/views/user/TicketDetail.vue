<template>
  <div class="ticket-detail-container">
    <div class="page-header">
      <h1 class="page-title">工单详情</h1>
      <div class="header-actions">
        <el-button @click="$router.push('/user/tickets')">返回列表</el-button>
        <el-button 
          v-if="ticket && ticket.status !== 'closed'" 
          type="danger" 
          @click="handleClose"
        >
          关闭工单
        </el-button>
      </div>
    </div>

    <div class="content-card" v-loading="loading">
      <template v-if="ticket">
        <!-- 工单信息 -->
        <div class="ticket-info">
          <div class="info-header">
            <h2 class="ticket-title">{{ ticket.title }}</h2>
            <el-tag :type="getStatusType(ticket.status)">
              {{ getStatusText(ticket.status) }}
            </el-tag>
          </div>
          <div class="info-meta">
            <span>创建时间：{{ formatTime(ticket.created_at) }}</span>
          </div>
          <div class="ticket-description">
            {{ ticket.description }}
          </div>
        </div>

        <!-- 回复列表 -->
        <div class="replies-section">
          <h3 class="section-title">回复记录</h3>
          <div class="replies-list">
            <div 
              v-for="reply in ticket.replies" 
              :key="reply.id"
              class="reply-item"
              :class="{ 'reply-user': reply.user_id, 'reply-admin': reply.admin_id }"
            >
              <div class="reply-header">
                <span class="reply-name">{{ reply.reply_name }}</span>
                <span class="reply-time">{{ formatTime(reply.created_at) }}</span>
              </div>
              <div class="reply-content">{{ reply.content }}</div>
            </div>
          </div>
        </div>

        <!-- 回复输入框 -->
        <div class="reply-input" v-if="ticket.status !== 'closed'">
          <el-input
            v-model="replyContent"
            type="textarea"
            :rows="4"
            placeholder="请输入回复内容"
            maxlength="500"
            show-word-limit
          />
          <div class="reply-actions">
            <el-button type="primary" @click="handleReply" :loading="replying">
              发送回复
            </el-button>
          </div>
        </div>

        <div class="closed-notice" v-else>
          <el-alert title="工单已关闭" type="info" :closable="false" show-icon />
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/api'

const route = useRoute()
const router = useRouter()
const ticket = ref(null)
const loading = ref(false)
const replyContent = ref('')
const replying = ref(false)

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

async function fetchTicket() {
  try {
    loading.value = true
    const id = route.params.id
    const response = await api.user.getTicketDetail(id)
    if (response.code === 0) {
      ticket.value = response.data
      window.dispatchEvent(new CustomEvent('ticket-read-state-changed'))
    }
  } catch (error) {
    console.error('获取工单详情失败:', error)
    ElMessage.error('获取工单详情失败')
  } finally {
    loading.value = false
  }
}

async function handleReply() {
  if (!replyContent.value.trim()) {
    ElMessage.warning('请输入回复内容')
    return
  }

  try {
    replying.value = true
    const id = route.params.id
    const response = await api.user.replyTicket(id, { content: replyContent.value })
    if (response.code === 0) {
      ElMessage.success('回复成功')
      replyContent.value = ''
      fetchTicket()
    }
  } catch (error) {
    console.error('回复失败:', error)
    ElMessage.error('回复失败')
  } finally {
    replying.value = false
  }
}

async function handleClose() {
  try {
    await ElMessageBox.confirm('确定要关闭此工单吗？', '确认关闭', {
      type: 'warning'
    })
    
    const id = route.params.id
    const response = await api.user.closeTicket(id)
    if (response.code === 0) {
      ElMessage.success('工单已关闭')
      fetchTicket()
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('关闭工单失败:', error)
      ElMessage.error('关闭工单失败')
    }
  }
}

onMounted(() => {
  fetchTicket()
})
</script>

<style scoped>
.ticket-detail-container {
  max-width: 900px;
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

.header-actions {
  display: flex;
  gap: 10px;
}

.content-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 30px;
}

.ticket-info {
  margin-bottom: 30px;
  padding-bottom: 20px;
  border-bottom: 1px solid #ebeef5;
}

.info-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.ticket-title {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}

.info-meta {
  color: #909399;
  font-size: 14px;
  margin-bottom: 15px;
}

.ticket-description {
  color: #606266;
  line-height: 1.6;
  white-space: pre-wrap;
}

.replies-section {
  margin-bottom: 30px;
  max-height: 60vh;
  overflow-y: auto;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin: 0 0 20px 0;
}

.replies-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.reply-item {
  padding: 15px;
  border-radius: 8px;
  max-width: 80%;
}

.reply-user {
  background: #e6f7ff;
  border: 1px solid #91d5ff;
  align-self: flex-start;
}

.reply-admin {
  background: #f5f5f5;
  border: 1px solid #d9d9d9;
  align-self: flex-end;
}

.reply-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.reply-name {
  font-weight: 600;
  color: #303133;
}

.reply-time {
  color: #909399;
  font-size: 12px;
}

.reply-content {
  color: #606266;
  line-height: 1.6;
  white-space: pre-wrap;
}

.reply-input {
  margin-top: 30px;
  padding-top: 20px;
  border-top: 1px solid #ebeef5;
}

.reply-actions {
  margin-top: 15px;
  display: flex;
  justify-content: flex-end;
}

.closed-notice {
  margin-top: 30px;
}
</style>
