<template>
  <div class="referral-page" v-loading="loading">
    <section class="hero-card">
      <div class="hero-copy">
        <div class="hero-badge">推广中心</div>
        <h1 class="hero-title">
          {{ rewardPercent > 0 ? `邀请好友，首单奖励${rewardPercent}%` : '分享链接，赚取奖励余额' }}
        </h1>
        <p v-if="rewardPercent > 0" class="hero-desc">
          好友首次付款后，你将获得该订单实付金额{{ rewardPercent }}%的奖励余额。奖励自动到账，可直接用于购买或续费套餐。
        </p>
        <p v-else class="hero-desc">查看推广点击、累计奖励余额和每一笔奖励的到账时间。</p>
      </div>

    </section>

    <section class="summary-grid">
      <article class="panel-card link-card">
        <div class="panel-head link-card-head">
          <div>
            <h2 class="panel-title">专属推广链接</h2>
            <p class="panel-subtitle">复制链接分享给好友，好友通过链接注册并完成首单后，奖励将自动发放。</p>
          </div>
        </div>

        <div v-if="rewardPercent > 0" class="reward-calculation">
          <span class="reward-calculation-label">奖励怎么算？</span>
          <div class="reward-calculation-grid">
            <span>好友实付 ¥10 <strong>你获得 ¥{{ rewardExamples.ten }} 余额</strong></span>
            <span>好友实付 ¥50 <strong>你获得 ¥{{ rewardExamples.fifty }} 余额</strong></span>
            <span>好友实付 ¥100 <strong>你获得 ¥{{ rewardExamples.hundred }} 余额</strong></span>
          </div>
        </div>

        <div class="link-box">
          <span class="link-text">{{ summary.referral_url || '暂无推广链接' }}</span>
        </div>

        <div class="link-card-action">
          <el-button
            class="copy-link-btn"
            size="large"
            :disabled="!summary.referral_url"
            @click="copyReferralLink"
          >
            复制推广链接
          </el-button>
        </div>

        <details v-if="rewardPercent > 0" class="reward-rules">
          <summary>奖励规则</summary>
          <ol>
            <li>好友必须通过你的专属推广链接注册。</li>
            <li>奖励仅针对好友完成的首笔付款订单。</li>
            <li>奖励金额为该订单实际支付金额的{{ rewardPercent }}%。</li>
            <li>奖励在订单付款成功后自动发放至账户余额。</li>
            <li>奖励余额可用于购买或续费套餐，同样支持提现。</li>
          </ol>
        </details>

      </article>

      <article class="panel-card stats-card">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">推广概览</h2>
          </div>
        </div>
        <div class="stat-grid">
          <div class="stat-item">
            <span class="stat-label">点击量</span>
            <span class="stat-value">{{ summary.click_count || 0 }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">奖励订单数</span>
            <span class="stat-value">{{ summary.reward_count || 0 }}</span>
          </div>
          <div class="stat-item stat-item-wide">
            <span class="stat-label">奖励总余额</span>
            <span class="stat-value">{{ rewardAmountText }}</span>
          </div>
        </div>
      </article>
    </section>

    <section class="panel-card detail-card">
      <div class="panel-head detail-head">
        <div>
          <h2 class="panel-title">奖励明细</h2>
        </div>
      </div>

      <el-table
        :data="rewards"
        stripe
        class="reward-table"
        empty-text="暂无推广奖励记录"
      >
        <el-table-column label="付款用户" min-width="200">
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

        <el-table-column label="付款金额" min-width="100">
          <template #default="{ row }">
            <span>{{ formatAmount(row.amount) }}</span>
          </template>
        </el-table-column>

        <el-table-column label="奖励时间" min-width="180">
          <template #default="{ row }">
            <span>{{ formatDateTime(row.created_at) }}</span>
          </template>
        </el-table-column>
      </el-table>

      <div class="mobile-reward-list">
        <el-empty v-if="rewards.length === 0" description="暂无推广奖励记录" />
        <article
          v-for="reward in rewards"
          :key="reward.id || reward.out_trade_no"
          class="mobile-reward-card"
        >
          <div class="mobile-reward-row mobile-reward-user-row">
            <span class="mobile-reward-label">付款用户</span>
            <strong class="mobile-reward-user">{{ reward.referred_email || '-' }}</strong>
          </div>
          <div class="mobile-reward-row mobile-reward-order-row">
            <span class="mobile-reward-label">订单号</span>
            <strong class="mobile-reward-value mobile-reward-order">{{ reward.out_trade_no || '-' }}</strong>
          </div>
          <div class="mobile-reward-grid">
            <div class="mobile-reward-field mobile-reward-highlight">
              <span class="mobile-reward-label">奖励金额</span>
              <strong class="mobile-reward-value">{{ formatAmount(reward.reward_amount) }}</strong>
            </div>
            <div class="mobile-reward-field">
              <span class="mobile-reward-label">付款金额</span>
              <strong class="mobile-reward-value">{{ formatAmount(reward.amount) }}</strong>
            </div>
            <div class="mobile-reward-field mobile-reward-time">
              <span class="mobile-reward-label">奖励时间</span>
              <strong class="mobile-reward-value">{{ formatDateTime(reward.created_at) }}</strong>
            </div>
          </div>
        </article>
      </div>

      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="pagination.page"
          :page-size="pagination.limit"
          :total="pagination.total"
          layout="prev, pager, next"
          @current-change="handlePageChange"
        />
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import api from '@/api'
import {
  calculateReferralRewardAmount,
  normalizeReferralRewardPercent
} from '@/utils/referral-reward-display'

const loading = ref(false)
const summary = ref({})
const rewards = ref([])
const pagination = reactive({
  page: 1,
  limit: 10,
  total: 0
})

const rewardAmountText = computed(() => {
  if (summary.value.reward_amount_text) {
    return summary.value.reward_amount_text
  }

  return formatAmount(summary.value.reward_amount)
})
const rewardPercent = computed(() => normalizeReferralRewardPercent(summary.value))
const rewardExamples = computed(() => ({
  ten: calculateReferralRewardAmount(10, summary.value),
  fifty: calculateReferralRewardAmount(50, summary.value),
  hundred: calculateReferralRewardAmount(100, summary.value)
}))

/**
 * 格式化流量显示，兼容后端返回的字符串数字。
 *
 * @param {*} bytes - 原始字节数
 * @returns {string} 格式化后的流量文本
 */
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

/**
 * 格式化金额展示，兼容分和元两种返回口径。
 *
 * @param {*} amount - 订单金额
 * @returns {string} 格式化后的金额文本
 */
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

/**
 * 格式化奖励时间，兼容秒级与毫秒级时间戳。
 *
 * @param {*} timestamp - 时间戳
 * @returns {string} 格式化后的时间文本
 */
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

/**
 * 获取推广概览。
 *
 * @returns {Promise<void>}
 */
async function fetchSummary() {
  const response = await api.user.getReferralSummary()
  if (response.code === 0) {
    summary.value = response.data || {}
  }
}

/**
 * 获取推广奖励分页数据。
 *
 * @returns {Promise<void>}
 */
async function fetchRewards() {
  const response = await api.user.getReferralRewards({
    page: pagination.page,
    limit: pagination.limit
  })

  if (response.code === 0) {
    const data = response.data || {}
    rewards.value = data.list || []
    pagination.total = data.total || 0
    pagination.page = data.page || pagination.page
    pagination.limit = data.limit || pagination.limit
  }
}

/**
 * 同步加载概览和列表，统一处理页面 loading。
 *
 * @returns {Promise<void>}
 */
async function fetchPageData() {
  try {
    loading.value = true
    await Promise.all([fetchSummary(), fetchRewards()])
  } catch (error) {
    console.error('获取推广数据失败:', error)
    ElMessage.error('获取推广数据失败')
  } finally {
    loading.value = false
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
 * 复制推广链接。
 *
 * @returns {Promise<void>}
 */
async function copyReferralLink() {
  if (!summary.value.referral_url) {
    return
  }

  try {
    await copyToClipboard(summary.value.referral_url)
    ElMessage.success(rewardPercent.value > 0
      ? `推广链接已复制，好友完成首购后你可获得${rewardPercent.value}%奖励`
      : '推广链接已复制')
  } catch (error) {
    console.error('复制推广链接失败:', error)
    ElMessage.error('复制失败，请手动复制')
  }
}

/**
 * 分页切换后刷新奖励列表。
 *
 * @param {number} page - 目标页码
 * @returns {Promise<void>}
 */
async function handlePageChange(page) {
  pagination.page = page
  await fetchRewards()
}

onMounted(() => {
  fetchPageData()
})
</script>

<style scoped>
.referral-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.hero-card,
.panel-card {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
}

.hero-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 24px;
  background: linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%);
}

.hero-copy {
  min-width: 0;
}

.hero-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.78);
  color: #2563eb;
  font-size: 12px;
  font-weight: 600;
}

.hero-title {
  margin: 14px 0 10px;
  color: #0f172a;
  font-size: 28px;
  line-height: 1.3;
}

.hero-desc {
  margin: 0;
  max-width: 680px;
  color: #475569;
  line-height: 1.7;
}

.summary-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.9fr);
  gap: 20px;
}

.panel-card {
  padding: 24px;
}

.panel-head {
  margin-bottom: 18px;
}

.panel-title {
  margin: 0;
  color: #0f172a;
  font-size: 20px;
}

.panel-subtitle {
  margin: 8px 0 0;
  color: #64748b;
  line-height: 1.6;
}

.link-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: start;
}

.reward-calculation {
  grid-column: 1 / -1;
  padding: 16px;
  border: 1px solid rgba(37, 99, 235, 0.1);
  border-radius: 16px;
  background: linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%);
}

.reward-calculation-label {
  display: block;
  margin-bottom: 12px;
  color: #0f172a;
  font-weight: 700;
}

.reward-calculation-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.reward-calculation-grid span {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.82);
  color: #64748b;
  font-size: 13px;
}

.reward-calculation-grid strong {
  color: #2563eb;
  font-size: 15px;
}

.link-card-head {
  margin-bottom: 0;
}

.link-box {
  grid-column: 1;
  padding: 16px;
  border-radius: 16px;
  background: #f8fafc;
}

.link-card-action {
  display: flex;
  grid-column: 2;
  align-items: center;
  justify-content: center;
}

.reward-rules {
  grid-column: 1 / -1;
  padding-top: 14px;
  border-top: 1px solid #e2e8f0;
  color: #475569;
}

.reward-rules summary {
  color: #2563eb;
  font-weight: 700;
  cursor: pointer;
}

.reward-rules ol {
  margin: 12px 0 0;
  padding-left: 20px;
  line-height: 1.9;
}

.link-text {
  color: #0f172a;
  font-weight: 600;
  word-break: break-all;
}

.copy-link-btn {
  flex-shrink: 0;
  min-width: 156px;
  height: 46px;
  padding: 0 22px;
  border: none;
  border-radius: 999px;
  color: #fff;
  font-weight: 700;
  background: linear-gradient(135deg, #2563eb 0%, #14b8a6 100%);
  box-shadow: 0 14px 30px rgba(37, 99, 235, 0.22);
}

.copy-link-btn:hover,
.copy-link-btn:focus-visible {
  color: #fff;
  background: linear-gradient(135deg, #1d4ed8 0%, #0f9f94 100%);
}

.copy-link-btn.is-disabled,
.copy-link-btn.is-disabled:hover {
  color: rgba(255, 255, 255, 0.78);
  background: linear-gradient(135deg, #94a3b8 0%, #cbd5e1 100%);
  box-shadow: none;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: 16px;
  background: #f8fafc;
}

.stat-item-wide {
  grid-column: 1 / -1;
}

.stat-label {
  color: #64748b;
  font-size: 13px;
}

.stat-value {
  color: #0f172a;
  font-size: 24px;
  font-weight: 700;
}

.detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
}

.mobile-reward-list {
  display: none;
}

@media (max-width: 1024px) {
  .hero-card,
  .summary-grid {
    grid-template-columns: 1fr;
  }

  .hero-card {
    flex-direction: column;
    align-items: flex-start;
  }
}

@media (max-width: 768px) {
  .hero-card,
  .panel-card {
    padding: 18px;
    border-radius: 8px;
  }

  .hero-title {
    font-size: 24px;
  }

  .stat-grid {
    grid-template-columns: 1fr;
  }

  .link-card {
    display: flex;
    flex-direction: column;
  }

  .link-card-head .panel-subtitle {
    max-width: none;
  }

  .link-card-action {
    width: 100%;
    align-items: stretch;
    justify-content: stretch;
  }

  .reward-calculation-grid {
    grid-template-columns: 1fr;
  }

  .reward-calculation {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }

  .reward-rules {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }

  .copy-link-btn {
    width: 100%;
    min-width: 0;
    justify-content: center;
  }

  .pagination-wrap {
    justify-content: center;
  }

  .reward-table {
    display: none;
  }

  .mobile-reward-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 120px;
  }

  .mobile-reward-card {
    padding: 8px 10px;
    border: 1px solid #ebeef5;
    border-radius: 8px;
    background: #fff;
  }

  .mobile-reward-row,
  .mobile-reward-field {
    display: flex;
    align-items: baseline;
    gap: 4px;
    min-width: 0;
  }

  .mobile-reward-user-row {
    justify-content: space-between;
  }

  .mobile-reward-order-row {
    margin-top: 4px;
  }

  .mobile-reward-label {
    flex: 0 0 auto;
    color: #909399;
    font-size: 11px;
    line-height: 1.2;
  }

  .mobile-reward-user {
    min-width: 0;
    color: #303133;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  .mobile-reward-value {
    min-width: 0;
    color: #606266;
    font-size: 12px;
    font-weight: 500;
    line-height: 1.3;
  }

  .mobile-reward-order {
    overflow-wrap: anywhere;
  }

  .mobile-reward-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px 10px;
    margin-top: 6px;
  }

  .mobile-reward-highlight .mobile-reward-value {
    color: #2563eb;
    font-weight: 700;
  }

  .mobile-reward-time {
    grid-column: 1 / -1;
  }
}
</style>
