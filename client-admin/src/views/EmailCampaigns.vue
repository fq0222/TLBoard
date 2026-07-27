<template>
  <div class="email-campaigns-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>群发任务管理</span>
          <el-button type="primary" @click="$router.push('/admin/email-sender')">新建任务</el-button>
        </div>
      </template>

      <el-table :data="campaigns" v-loading="loading">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="name" label="任务名称" />
        <el-table-column label="目标" width="120">
          <template #default="{ row }">
            {{ getTargetLabel(row.target_type) }}
          </template>
        </el-table-column>
        <el-table-column label="进度" width="150">
          <template #default="{ row }">
            {{ row.sent_count + row.failed_count }}/{{ row.total_count }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)">{{ getStatusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="250">
          <template #default="{ row }">
            <el-button size="small" @click="viewDetail(row)">详情</el-button>
            <el-button
              v-if="row.status === 'pending' || row.status === 'sending'"
              size="small"
              type="warning"
              @click="handlePause(row)"
            >
              暂停
            </el-button>
            <el-button
              v-if="row.status === 'paused'"
              size="small"
              type="success"
              @click="handleResume(row)"
            >
              恢复
            </el-button>
            <el-button size="small" type="danger" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 详情弹窗 -->
    <el-dialog v-model="showDetail" title="任务详情" width="800px">
      <el-descriptions :column="2" border>
        <el-descriptions-item label="任务名称">{{ currentCampaign.name }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="getStatusType(currentCampaign.status)">
            {{ getStatusLabel(currentCampaign.status) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="目标类型">{{ getTargetLabel(currentCampaign.target_type) }}</el-descriptions-item>
        <el-descriptions-item label="总数量">{{ currentCampaign.total_count }}</el-descriptions-item>
        <el-descriptions-item label="已发送">{{ currentCampaign.sent_count }}</el-descriptions-item>
        <el-descriptions-item label="失败">{{ currentCampaign.failed_count }}</el-descriptions-item>
      </el-descriptions>

      <div class="logs-section">
        <h4>发送日志</h4>
        <el-table :data="logs" v-loading="logsLoading" max-height="400">
          <el-table-column prop="email" label="邮箱" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.status === 'sent' ? 'success' : 'danger'" size="small">
                {{ row.status === 'sent' ? '成功' : '失败' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="error_message" label="错误信息" />
          <el-table-column label="时间" width="180">
            <template #default="{ row }">
              {{ formatTime(row.sent_at) }}
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index.mjs'
import { ElMessageBox } from 'element-plus/es/components/message-box/index.mjs'
import api from '@/api'

const loading = ref(false)
const logsLoading = ref(false)
const campaigns = ref([])
const showDetail = ref(false)
const currentCampaign = ref({})
const logs = ref([])

const targetLabels = {
  all: '所有用户',
  disabled: '禁用用户',
  custom: '自定义'
}

const statusLabels = {
  pending: '待发送',
  sending: '发送中',
  completed: '已完成',
  paused: '已暂停'
}

const statusTypes = {
  pending: 'info',
  sending: 'warning',
  completed: 'success',
  paused: 'danger'
}

const getTargetLabel = (type) => targetLabels[type] || type
const getStatusLabel = (status) => statusLabels[status] || status
const getStatusType = (status) => statusTypes[status] || 'info'

const formatTime = (timestamp) => {
  if (!timestamp) return '-'
  return new Date(timestamp * 1000).toLocaleString()
}

const loadCampaigns = async () => {
  loading.value = true
  try {
    const res = await api.admin.getEmailCampaigns()
    if (res.code === 0) {
      campaigns.value = res.data
    }
  } catch (error) {
    console.error('加载任务失败:', error)
  } finally {
    loading.value = false
  }
}

const viewDetail = async (row) => {
  currentCampaign.value = row
  showDetail.value = true
  logsLoading.value = true
  try {
    const res = await api.admin.getEmailCampaignLogs(row.id, { limit: 100 })
    if (res.code === 0) {
      logs.value = res.data.list
    }
  } catch (error) {
    console.error('加载日志失败:', error)
  } finally {
    logsLoading.value = false
  }
}

const handlePause = async (row) => {
  try {
    const res = await api.admin.pauseEmailCampaign(row.id)
    if (res.code === 0) {
      ElMessage.success('任务已暂停')
      loadCampaigns()
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    ElMessage.error('操作失败')
  }
}

const handleResume = async (row) => {
  try {
    const res = await api.admin.resumeEmailCampaign(row.id)
    if (res.code === 0) {
      ElMessage.success('任务已恢复')
      loadCampaigns()
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    ElMessage.error('操作失败')
  }
}

const handleDelete = async (row) => {
  try {
    await ElMessageBox.confirm('确定删除该任务？删除后将同时删除相关日志。', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消'
    })
    const res = await api.admin.deleteEmailCampaign(row.id)
    if (res.code === 0) {
      ElMessage.success('任务已删除')
      loadCampaigns()
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    // 取消删除
  }
}

onMounted(() => {
  loadCampaigns()
})
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.logs-section {
  margin-top: 20px;
}
.logs-section h4 {
  margin-bottom: 12px;
}
</style>
