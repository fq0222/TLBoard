<template>
  <div class="orders-page">
    <section class="content-card">
      <div class="page-head">
        <div>
          <h1 class="page-title">我的订单</h1>
          <p class="page-subtitle desktop-subtitle">查看当前账号的套餐购买、续费和支付记录</p>
          <p class="page-subtitle mobile-subtitle">长按订单可复制完整文字信息</p>
        </div>
        <el-button :loading="loading" @click="fetchOrders">刷新</el-button>
      </div>

      <el-table
        v-loading="loading"
        :data="orders"
        class="orders-table"
        empty-text="暂无订单"
      >
        <el-table-column prop="out_trade_no" label="订单号" min-width="170" />
        <el-table-column prop="plan_name" label="套餐" min-width="140">
          <template #default="{ row }">
            {{ row.plan_name || '-' }}
          </template>
        </el-table-column>
        <el-table-column label="金额" width="110">
          <template #default="{ row }">
            ¥{{ row.amount_text || formatAmount(row.amount) }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)" effect="light">
              {{ row.status_text || getStatusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" min-width="160">
          <template #default="{ row }">
            {{ formatTime(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column label="支付时间" min-width="160">
          <template #default="{ row }">
            {{ formatTime(row.paid_at) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button
              class="copy-order-button"
              size="small"
              type="primary"
              text
              @click="copyOrderText(row)"
            >
              复制
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div v-loading="loading" class="mobile-order-list">
        <el-empty v-if="orders.length === 0 && !loading" description="暂无订单" />
        <article
          v-for="order in orders"
          :key="order.id || order.out_trade_no"
          class="mobile-order-card"
          @touchstart="startLongPress(order)"
          @touchend="clearLongPress"
          @touchcancel="clearLongPress"
          @touchmove="clearLongPress"
          @contextmenu.prevent="copyOrderText(order)"
        >
          <div class="mobile-order-top">
            <span class="order-no-label">订单号</span>
            <span class="order-no">{{ order.out_trade_no }}</span>
            <el-tag class="order-status" :type="getStatusType(order.status)" effect="light">
              {{ order.status_text || getStatusText(order.status) }}
            </el-tag>
          </div>

          <div class="mobile-order-grid">
            <div class="mobile-order-field">
              <span>套餐</span>
              <strong>{{ order.plan_name || '-' }}</strong>
            </div>
            <div class="mobile-order-field amount-field">
              <span>金额</span>
              <strong>¥{{ order.amount_text || formatAmount(order.amount) }}</strong>
            </div>
            <div class="mobile-order-field">
              <span>创建</span>
              <strong>{{ formatCompactTime(order.created_at) }}</strong>
            </div>
            <div class="mobile-order-field">
              <span>支付</span>
              <strong>{{ formatCompactTime(order.paid_at) }}</strong>
            </div>
          </div>
        </article>
      </div>

      <div v-if="total > pageSize" class="pagination-row">
        <el-pagination
          v-model:current-page="currentPage"
          :page-size="pageSize"
          :total="total"
          layout="prev, pager, next"
          @current-change="fetchOrders"
        />
      </div>
    </section>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import api from '@/api'

const orders = ref([])
const loading = ref(false)
const currentPage = ref(1)
const pageSize = 20
const total = ref(0)
const longPressTimer = ref(null)

/**
 * 获取当前登录用户订单列表。
 * 核心分支：成功时同步分页数据，失败时交给全局 API 拦截器提示并保留当前列表。
 * @param {number} [page=currentPage.value] - 需要加载的页码
 * @returns {Promise<void>}
 */
async function fetchOrders(page = currentPage.value) {
  loading.value = true
  currentPage.value = page

  try {
    const response = await api.user.getOrders({
      page: currentPage.value,
      limit: pageSize
    })

    if (response.code === 0) {
      orders.value = response.data?.list || []
      total.value = Number(response.data?.total) || 0
    }
  } catch (error) {
    console.error('获取我的订单失败:', error)
  } finally {
    loading.value = false
  }
}

/**
 * 格式化订单金额，兼容后端返回分单位整数或空值。
 * @param {number|string} amount - 订单金额，单位为分
 * @returns {string} 元单位金额文本
 */
function formatAmount(amount) {
  const cents = Number(amount)
  if (!Number.isFinite(cents) || cents <= 0) {
    return '0.00'
  }

  return (cents / 100).toFixed(2)
}

/**
 * 格式化时间字段，空值显示占位。
 * @param {number|string|null} value - 时间戳或可解析时间字符串
 * @returns {string} 本地时间文本
 */
function formatTime(value) {
  if (!value) {
    return '-'
  }

  const time = parseTime(value)
  if (!time) {
    return '-'
  }

  return time.toLocaleString('zh-CN', { hour12: false })
}

/**
 * 格式化移动端紧凑时间，减少单个订单高度。
 * @param {number|string|null} value - 时间戳或可解析时间字符串
 * @returns {string} 月日和分钟级时间
 */
function formatCompactTime(value) {
  const time = parseTime(value)
  if (!time) {
    return '-'
  }

  const pad = (num) => String(num).padStart(2, '0')
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}`
}

/**
 * 解析后端返回的时间字段。
 * @param {number|string|null} value - 时间戳或可解析时间字符串
 * @returns {Date|null} 可用时间对象
 */
function parseTime(value) {
  if (!value) {
    return null
  }

  const time = /^\d+$/.test(String(value))
    ? new Date(Number(value))
    : new Date(value)

  if (Number.isNaN(time.getTime())) {
    return null
  }

  return time
}

/**
 * 映射订单状态到 Element Plus 标签类型。
 * @param {string} status - 订单状态
 * @returns {string} 标签类型
 */
function getStatusType(status) {
  const statusTypes = {
    pending: 'warning',
    paid: 'success',
    expired: 'info'
  }

  return statusTypes[status] || 'info'
}

/**
 * 映射订单状态到中文文本。
 * @param {string} status - 订单状态
 * @returns {string} 状态文本
 */
function getStatusText(status) {
  const statusTexts = {
    pending: '待支付',
    paid: '已支付',
    expired: '已过期'
  }

  return statusTexts[status] || status || '-'
}

/**
 * 拼接可复制的订单文字信息。
 * @param {Object} order - 订单记录
 * @returns {string} 多行订单信息
 */
function buildOrderCopyText(order) {
  return [
    `订单号：${order.out_trade_no || '-'}`,
    `套餐：${order.plan_name || '-'}`,
    `金额：¥${order.amount_text || formatAmount(order.amount)}`,
    `状态：${order.status_text || getStatusText(order.status)}`,
    `创建时间：${formatTime(order.created_at)}`,
    `支付时间：${formatTime(order.paid_at)}`
  ].join('\n')
}

/**
 * 复制文本，兼容非安全上下文和旧浏览器。
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
 * 复制订单文字信息并给出 toast 反馈。
 * @param {Object} order - 订单记录
 * @returns {Promise<void>}
 */
async function copyOrderText(order) {
  clearLongPress()

  try {
    await copyToClipboard(buildOrderCopyText(order))
    ElMessage.success('订单信息已复制')
  } catch (error) {
    console.error('复制订单信息失败:', error)
    ElMessage.error('复制失败，请手动复制')
  }
}

/**
 * 开始移动端长按复制计时。
 * @param {Object} order - 订单记录
 * @returns {void}
 */
function startLongPress(order) {
  clearLongPress()
  longPressTimer.value = window.setTimeout(() => {
    copyOrderText(order)
  }, 650)
}

/**
 * 清理长按计时，滚动或松手时避免误复制。
 * @returns {void}
 */
function clearLongPress() {
  if (!longPressTimer.value) {
    return
  }

  window.clearTimeout(longPressTimer.value)
  longPressTimer.value = null
}

onMounted(() => {
  fetchOrders()
})
</script>

<style scoped>
.orders-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
  overflow-x: hidden;
}

.content-card {
  background: #fff;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
}

.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.page-title {
  margin: 0;
  font-size: 22px;
  color: #303133;
}

.page-subtitle {
  margin: 8px 0 0;
  color: #909399;
  line-height: 1.5;
}

.desktop-subtitle {
  display: block;
}

.mobile-subtitle {
  display: none;
}

.orders-table {
  width: 100%;
}

.copy-order-button {
  padding: 0;
}

.mobile-order-list {
  display: none;
}

.pagination-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 18px;
}

@media (max-width: 768px) {
  .content-card {
    border-radius: 14px;
    padding: 14px;
  }

  .page-head {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    margin-bottom: 12px;
  }

  .page-title {
    font-size: 20px;
  }

  .page-subtitle {
    margin-top: 4px;
    font-size: 13px;
  }

  .desktop-subtitle {
    display: none;
  }

  .mobile-subtitle {
    display: block;
  }

  .orders-table {
    display: none;
  }

  .mobile-order-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 120px;
  }

  .mobile-order-card {
    padding: 8px 10px;
    border: 1px solid #ebeef5;
    border-radius: 8px;
    background: #fff;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    touch-action: pan-y;
  }

  .mobile-order-top {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .order-no-label,
  .mobile-order-field span {
    color: #909399;
    font-size: 11px;
    line-height: 1.2;
  }

  .order-no {
    min-width: 0;
    overflow: hidden;
    color: #303133;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .order-status {
    height: 22px;
    padding: 0 6px;
    font-size: 11px;
  }

  .mobile-order-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 4px 10px;
    margin-top: 6px;
  }

  .mobile-order-field {
    display: flex;
    align-items: baseline;
    gap: 4px;
    min-width: 0;
  }

  .mobile-order-field strong {
    min-width: 0;
    overflow: hidden;
    color: #606266;
    font-size: 12px;
    font-weight: 500;
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .amount-field {
    justify-content: flex-end;
  }

  .amount-field strong {
    color: #303133;
    font-variant-numeric: tabular-nums;
  }

  .pagination-row {
    justify-content: center;
    margin-top: 12px;
  }
}
</style>
