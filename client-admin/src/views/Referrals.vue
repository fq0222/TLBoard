<template>
  <div class="referrals-container">
    <div class="page-header">
      <h1 class="page-title">推广管理</h1>
      <p class="page-subtitle">查看用户推广链接、点击量、奖励余额，并管理推广开关和重置链接。</p>
    </div>

    <div class="content-card">
      <div class="toolbar">
        <el-input
          v-model="filters.email"
          placeholder="搜索用户邮箱"
          clearable
          style="width: 260px;"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
        <el-input
          v-model="filters.code"
          placeholder="搜索推广码"
          clearable
          style="width: 220px;"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
        <el-select
          v-model="filters.enabled"
          clearable
          placeholder="状态筛选"
          style="width: 160px;"
          @change="handleSearch"
        >
          <el-option label="已启用" :value="1" />
          <el-option label="已禁用" :value="0" />
        </el-select>
        <el-button type="primary" @click="handleSearch">查询</el-button>
      </div>

      <el-table v-loading="loading" :data="rows" stripe class="referrals-table">
        <el-table-column prop="user_id" label="用户 ID" width="90" />
        <el-table-column prop="email" label="用户邮箱" min-width="220" />
        <el-table-column label="推广码" min-width="150">
          <template #default="{ row }">
            <span>{{ row.code || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="推广链接" min-width="260">
          <template #default="{ row }">
            <div class="link-cell">
              <span class="link-text">{{ row.referral_url || '-' }}</span>
              <el-button
                text
                type="primary"
                :disabled="!row.referral_url"
                @click="copyText(row.referral_url, '推广链接已复制')"
              >
                复制
              </el-button>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="click_count" label="点击量" width="100" />
        <el-table-column prop="reward_count" label="奖励订单" width="110" />
        <el-table-column label="奖励总余额" min-width="140">
          <template #default="{ row }">
            <span>{{ formatAmount(row.reward_amount) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="推广状态" width="120">
          <template #default="{ row }">
            <el-switch
              :model-value="!!row.enabled"
              :loading="switchLoadingMap[row.user_id]"
              @change="(value) => handleToggleEnabled(row, value)"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="210" fixed="right">
          <template #default="{ row }">
            <div class="action-group">
              <el-button class="action-btn" @click="openDetail(row)">查看详情</el-button>
              <el-button class="action-btn action-btn-danger" @click="handleResetCode(row)">重置链接</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="pagination.page"
          :page-size="pagination.limit"
          :total="pagination.total"
          layout="prev, pager, next"
          @current-change="handlePageChange"
        />
      </div>
    </div>

    <el-drawer
      v-model="detailVisible"
      title="推广详情"
      size="900px"
      destroy-on-close
    >
      <div v-loading="detailLoading" class="detail-wrap">
        <div class="summary-grid">
          <div class="summary-card">
            <span class="summary-label">用户</span>
            <strong class="summary-value">{{ detailSummary?.email || '-' }}</strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">推广码</span>
            <strong class="summary-value">{{ detailSummary?.code || '-' }}</strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">点击量</span>
            <strong class="summary-value">{{ detailSummary?.click_count || 0 }}</strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">奖励订单</span>
            <strong class="summary-value">{{ detailSummary?.reward_count || 0 }}</strong>
          </div>
          <div class="summary-card summary-card-wide">
            <span class="summary-label">奖励总余额</span>
            <strong class="summary-value">{{ formatAmount(detailSummary?.reward_amount) }}</strong>
          </div>
        </div>

        <div class="detail-link-card">
          <span class="summary-label">推广链接</span>
          <div class="detail-link-row">
            <span class="detail-link-text">{{ detailSummary?.referral_url || '-' }}</span>
            <el-button
              type="primary"
              plain
              :disabled="!detailSummary?.referral_url"
              @click="copyText(detailSummary?.referral_url || '', '推广链接已复制')"
            >
              复制
            </el-button>
          </div>
        </div>

        <el-table :data="detailRewards" stripe empty-text="暂无奖励记录">
          <el-table-column label="付款用户" min-width="180">
            <template #default="{ row }">
              <span>{{ row.referred_email || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="订单号" min-width="160">
            <template #default="{ row }">
              <span>{{ row.out_trade_no || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="奖励金额" min-width="120">
            <template #default="{ row }">
              <span>{{ formatAmount(row.reward_amount) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="付款金额" min-width="110">
            <template #default="{ row }">
              <span>{{ formatAmount(row.amount) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="奖励时间" min-width="170">
            <template #default="{ row }">
              <span>{{ formatDateTime(row.created_at) }}</span>
            </template>
          </el-table-column>
        </el-table>

        <div class="pagination-wrap">
          <el-pagination
            v-model:current-page="detailPagination.page"
            :page-size="detailPagination.limit"
            :total="detailPagination.total"
            layout="prev, pager, next"
            @current-change="handleDetailPageChange"
          />
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
/**
 * 管理端推广管理页面。
 * 负责查询用户推广汇总、切换启用状态、重置推广码和查看奖励明细。
 */

import { reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/api'

const loading = ref(false)
const rows = ref([])
const filters = reactive({
  email: '',
  code: '',
  enabled: undefined
})
const pagination = reactive({
  page: 1,
  limit: 20,
  total: 0
})
const switchLoadingMap = reactive({})

const detailVisible = ref(false)
const detailLoading = ref(false)
const detailUserId = ref(null)
const detailSummary = ref(null)
const detailRewards = ref([])
const detailPagination = reactive({
  page: 1,
  limit: 10,
  total: 0
})

function formatTraffic(bytes) {
  if (bytes === null || bytes === undefined || bytes === '') return '0 B'

  const numericValue = Number(bytes)
  if (Number.isNaN(numericValue) || numericValue === 0) return '0 B'

  const unitBase = 1024
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unitIndex = Math.min(
    Math.floor(Math.log(numericValue) / Math.log(unitBase)),
    units.length - 1
  )

  return `${parseFloat((numericValue / (unitBase ** unitIndex)).toFixed(2))} ${units[unitIndex]}`
}

function formatAmount(amount) {
  if (amount === null || amount === undefined || amount === '') {
    return '¥0.00'
  }

  const numericValue = Number(amount)
  if (Number.isNaN(numericValue)) {
    return String(amount)
  }

  const normalizedAmount = numericValue / 100
  return `¥${normalizedAmount.toFixed(2)}`
}

function formatDateTime(timestamp) {
  if (!timestamp) {
    return '-'
  }

  const numericValue = Number(timestamp)
  if (Number.isNaN(numericValue)) {
    return '-'
  }

  const normalizedTimestamp = numericValue > 1e12 ? numericValue : numericValue * 1000
  return new Date(normalizedTimestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

async function copyText(text, successMessage) {
  if (!text) {
    return
  }

  try {
    await copyToClipboard(text)
    ElMessage.success(successMessage)
  } catch (error) {
    console.error('复制失败:', error)
    ElMessage.error('复制失败，请手动复制')
  }
}

/**
 * 兼容 HTTP、非安全上下文和旧浏览器的复制实现。
 *
 * @param {string} text - 需要复制的文本
 * @returns {Promise<void>}
 */
async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'readonly')
  textarea.style.position = 'fixed'
  textarea.style.top = '-9999px'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  try {
    const copied = document.execCommand('copy')
    if (!copied) {
      throw new Error('execCommand copy failed')
    }
  } finally {
    document.body.removeChild(textarea)
  }
}

/**
 * 获取推广汇总列表。
 * 核心分支：分页和筛选统一由当前响应回填，避免前后端默认值不一致。
 */
async function fetchRows() {
  try {
    loading.value = true
    const response = await api.admin.getReferrals({
      page: pagination.page,
      limit: pagination.limit,
      email: filters.email || undefined,
      code: filters.code || undefined,
      enabled: filters.enabled
    })

    if (response.code === 0) {
      const data = response.data || {}
      rows.value = data.list || []
      pagination.total = data.total || 0
      pagination.page = data.page || pagination.page
      pagination.limit = data.limit || pagination.limit
      return
    }

    ElMessage.error(response.message || '获取推广列表失败')
  } catch (error) {
    console.error('获取推广列表失败:', error)
    ElMessage.error('获取推广列表失败')
  } finally {
    loading.value = false
  }
}

async function fetchDetail() {
  if (!detailUserId.value) {
    return
  }

  try {
    detailLoading.value = true
    const response = await api.admin.getReferralDetail(detailUserId.value, {
      page: detailPagination.page,
      limit: detailPagination.limit
    })

    if (response.code === 0) {
      const data = response.data || {}
      detailSummary.value = data.summary || null
      detailRewards.value = data.rewards?.list || []
      detailPagination.total = data.rewards?.total || 0
      detailPagination.page = data.rewards?.page || detailPagination.page
      detailPagination.limit = data.rewards?.limit || detailPagination.limit
      return
    }

    ElMessage.error(response.message || '获取推广详情失败')
  } catch (error) {
    console.error('获取推广详情失败:', error)
    ElMessage.error('获取推广详情失败')
  } finally {
    detailLoading.value = false
  }
}

function handleSearch() {
  pagination.page = 1
  fetchRows()
}

function handlePageChange(page) {
  pagination.page = page
  fetchRows()
}

function handleDetailPageChange(page) {
  detailPagination.page = page
  fetchDetail()
}

function openDetail(row) {
  detailUserId.value = row.user_id
  detailPagination.page = 1
  detailVisible.value = true
  fetchDetail()
}

async function handleToggleEnabled(row, enabled) {
  try {
    switchLoadingMap[row.user_id] = true
    const response = await api.admin.updateReferralEnabled(row.user_id, enabled)
    if (response.code === 0) {
      row.enabled = enabled ? 1 : 0
      if (detailSummary.value && detailSummary.value.user_id === row.user_id) {
        detailSummary.value.enabled = row.enabled
      }
      ElMessage.success(enabled ? '推广已启用' : '推广已禁用')
      return
    }

    ElMessage.error(response.message || '更新推广状态失败')
    await fetchRows()
  } catch (error) {
    console.error('更新推广状态失败:', error)
    ElMessage.error('更新推广状态失败')
    await fetchRows()
  } finally {
    switchLoadingMap[row.user_id] = false
  }
}

async function handleResetCode(row) {
  try {
    await ElMessageBox.confirm(
      `确定重置用户 ${row.email} 的推广链接吗？重置后原链接将不可继续使用。`,
      '提示',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    const response = await api.admin.resetReferralCode(row.user_id)
    if (response.code === 0) {
      const data = response.data || {}
      row.code = data.code || row.code
      row.enabled = data.enabled === undefined ? row.enabled : (data.enabled ? 1 : 0)
      row.referral_url = data.referral_url || row.referral_url || ''

      if (detailSummary.value && detailSummary.value.user_id === row.user_id) {
        detailSummary.value = {
          ...detailSummary.value,
          code: row.code,
          enabled: row.enabled,
          referral_url: row.referral_url
        }
      }

      ElMessage.success('推广链接已重置')
      return
    }

    ElMessage.error(response.message || '重置推广链接失败')
  } catch (error) {
    if (error !== 'cancel') {
      console.error('重置推广链接失败:', error)
      ElMessage.error('重置推广链接失败')
    }
  }
}

fetchRows()
</script>

<style scoped>
.referrals-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.page-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.page-title {
  margin: 0;
  color: #303133;
  font-size: 28px;
}

.page-subtitle {
  margin: 0;
  color: #909399;
}

.content-card {
  padding: 24px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06);
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 20px;
}

.link-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.link-text,
.detail-link-text {
  min-width: 0;
  flex: 1;
  word-break: break-all;
}

.action-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.action-btn {
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid #dbeafe;
  border-radius: 999px;
  color: #2563eb;
  background: #f8fbff;
}

.action-btn:hover,
.action-btn:focus-visible {
  color: #1d4ed8;
  border-color: #93c5fd;
  background: #eff6ff;
}

.action-btn-danger {
  color: #dc2626;
  border-color: #fecaca;
  background: #fff7f7;
}

.action-btn-danger:hover,
.action-btn-danger:focus-visible {
  color: #b91c1c;
  border-color: #fca5a5;
  background: #fef2f2;
}

.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
}

:deep(.pagination-wrap .el-pager li),
:deep(.pagination-wrap .btn-prev),
:deep(.pagination-wrap .btn-next) {
  min-width: 32px;
  height: 32px;
  margin: 0 4px;
  border: 1px solid #dbe3f0;
  border-radius: 8px;
  background: #fff;
}

:deep(.pagination-wrap .btn-prev:disabled),
:deep(.pagination-wrap .btn-next:disabled) {
  border-color: #e5e7eb;
  background: #f8fafc;
}

:deep(.pagination-wrap .el-pager li.is-active) {
  border-color: #93c5fd;
  background: #eff6ff;
}

.detail-wrap {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.summary-card,
.detail-link-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: 10px;
  background: #f8fafc;
}

.summary-card-wide {
  grid-column: 1 / -1;
}

.summary-label {
  color: #909399;
  font-size: 13px;
}

.summary-value {
  color: #303133;
  font-size: 18px;
}

.detail-link-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

:deep(.referrals-table .el-table__cell) {
  padding-top: 8px;
  padding-bottom: 8px;
}

@media (max-width: 768px) {
  .content-card {
    padding: 16px;
  }

  .summary-grid {
    grid-template-columns: 1fr;
  }

  .detail-link-row,
  .link-cell {
    flex-direction: column;
    align-items: flex-start;
  }

  .pagination-wrap {
    justify-content: center;
  }
}
</style>
