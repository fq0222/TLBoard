<template>
  <div class="feedback-admin">
    <div class="page-header">
      <div>
        <h1 class="page-title">留言板管理</h1>
        <p class="page-subtitle">查看用户建议，挑选优质留言展示到用户端，并管理投票内容</p>
      </div>
      <el-button type="primary" :loading="loading" @click="fetchPage">刷新</el-button>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <span>全部留言</span>
        <strong>{{ stats.total }}</strong>
      </div>
      <div class="stat-card">
        <span>精选展示</span>
        <strong>{{ stats.featured }}</strong>
      </div>
      <div class="stat-card">
        <span>累计投票</span>
        <strong>{{ stats.votes }}</strong>
      </div>
    </div>

    <div class="content-card">
      <el-table :data="messages" v-loading="loading" style="width: 100%">
        <el-table-column prop="id" label="ID" width="76" />
        <el-table-column prop="user_email" label="用户邮箱" min-width="180" />
        <el-table-column prop="content" label="留言内容" min-width="300">
          <template #default="{ row }">
            <div class="message-text">{{ row.content }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="vote_count" label="投票数" width="100">
          <template #default="{ row }">
            <el-tag type="primary" size="small">{{ row.vote_count }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="featured" label="用户端展示" width="130">
          <template #default="{ row }">
            <el-switch
              :model-value="!!row.featured"
              :loading="updatingId === row.id"
              @change="value => updateFeatured(row, value)"
            />
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" min-width="170">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button link type="danger" @click="deleteMessage(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination" v-if="total > limit">
        <el-pagination
          v-model:current-page="page"
          :page-size="limit"
          :total="total"
          layout="prev, pager, next"
          @current-change="fetchMessages"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * 管理端留言板页面。
 * 职责：分页管理用户留言、精选展示状态和删除操作。
 */

import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/api'

const messages = ref([])
const loading = ref(false)
const updatingId = ref(null)
const page = ref(1)
const limit = ref(10)
const total = ref(0)
const stats = reactive({
  total: 0,
  featured: 0,
  votes: 0
})

/**
 * 获取留言统计。
 * 职责：刷新顶部统计卡片。
 * 关键参数：无。
 * 核心分支语义：成功时覆盖统计数据，失败时保留旧值。
 *
 * @returns {Promise<void>}
 */
async function fetchStats() {
  try {
    const response = await api.admin.getFeedbackStats()
    if (response.code === 0) {
      stats.total = Number(response.data.total || 0)
      stats.featured = Number(response.data.featured || 0)
      stats.votes = Number(response.data.votes || 0)
    }
  } catch (error) {
    console.error('获取留言统计失败:', error)
  }
}

/**
 * 获取留言分页列表。
 * 职责：加载当前页留言。
 * 关键参数：page 和 limit 控制分页。
 * 核心分支语义：成功时同步列表和 total。
 *
 * @returns {Promise<void>}
 */
async function fetchMessages() {
  try {
    loading.value = true
    const response = await api.admin.getFeedbackMessages({
      page: page.value,
      limit: limit.value
    })
    if (response.code === 0) {
      messages.value = response.data.list || []
      total.value = response.data.total || 0
    }
  } catch (error) {
    console.error('获取留言列表失败:', error)
    ElMessage.error('获取留言列表失败')
  } finally {
    loading.value = false
  }
}

/**
 * 刷新完整页面数据。
 * 职责：同时刷新统计和列表。
 * 关键参数：无。
 * 核心分支语义：两个请求串行执行，避免 loading 状态互相覆盖。
 *
 * @returns {Promise<void>}
 */
async function fetchPage() {
  await fetchMessages()
  await fetchStats()
}

/**
 * 更新精选展示状态。
 * 职责：将留言展示或取消展示到用户端。
 * 关键参数：row 为当前留言，value 为目标开关值。
 * 核心分支语义：请求失败时保持原值并提示，成功后刷新统计。
 *
 * @param {Object} row - 留言行
 * @param {boolean} value - 是否展示
 * @returns {Promise<void>}
 */
async function updateFeatured(row, value) {
  try {
    updatingId.value = row.id
    const response = await api.admin.updateFeedbackFeatured(row.id, value)
    if (response.code === 0) {
      row.featured = value
      ElMessage.success(value ? '已展示到用户端' : '已取消展示')
      fetchStats()
    }
  } catch (error) {
    console.error('更新留言展示状态失败:', error)
    ElMessage.error('更新展示状态失败')
  } finally {
    updatingId.value = null
  }
}

/**
 * 删除留言。
 * 职责：管理员删除不适合保留的留言，并清理关联投票。
 * 关键参数：row 为待删除留言。
 * 核心分支语义：用户确认后删除，成功后刷新列表和统计。
 *
 * @param {Object} row - 留言行
 * @returns {Promise<void>}
 */
async function deleteMessage(row) {
  try {
    await ElMessageBox.confirm('确定删除这条留言吗？删除后关联投票也会清理。', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })

    const response = await api.admin.deleteFeedbackMessage(row.id)
    if (response.code === 0) {
      ElMessage.success('删除成功')
      if (messages.value.length === 1 && page.value > 1) {
        page.value -= 1
      }
      fetchPage()
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除留言失败:', error)
    }
  }
}

/**
 * 格式化 Unix 时间戳。
 * 职责：让表格展示中文本地时间。
 * 关键参数：timestamp 为秒级时间戳。
 * 核心分支语义：空值显示短横线。
 *
 * @param {number|string} timestamp - 秒级时间戳
 * @returns {string} 格式化时间
 */
function formatTime(timestamp) {
  if (!timestamp) return '-'
  return new Date(Number(timestamp) * 1000).toLocaleString('zh-CN')
}

onMounted(() => {
  fetchPage()
})
</script>

<style scoped>
.feedback-admin {
  width: 100%;
  max-width: 100%;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.page-title {
  margin: 0 0 8px;
  color: #303133;
  font-size: 28px;
}

.page-subtitle {
  margin: 0;
  color: #606266;
  font-size: 15px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 18px;
}

.stat-card,
.content-card {
  background: #fff;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.06);
}

.stat-card {
  padding: 18px;
}

.stat-card span {
  display: block;
  color: #606266;
  font-size: 13px;
  margin-bottom: 8px;
}

.stat-card strong {
  color: #111827;
  font-size: 28px;
}

.content-card {
  padding: 18px;
  overflow-x: auto;
}

.message-text {
  max-width: 560px;
  line-height: 1.6;
  color: #374151;
  word-break: break-word;
}

.pagination {
  display: flex;
  justify-content: center;
  margin-top: 18px;
}

@media (max-width: 768px) {
  .page-header {
    align-items: flex-start;
    flex-direction: column;
    margin-bottom: 12px;
  }

  .page-title {
    font-size: 22px;
  }

  .page-subtitle {
    font-size: 13px;
  }

  .stats-grid {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .stat-card {
    padding: 12px 14px;
  }

  .stat-card strong {
    font-size: 22px;
  }

  .content-card {
    padding: 10px;
  }
}
</style>
