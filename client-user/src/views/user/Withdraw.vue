<template>
  <div class="withdraw-page">
    <aside class="withdraw-panel balance-panel">
      <header class="balance-heading">
        <span class="heading-icon">
          <el-icon><WalletFilled /></el-icon>
        </span>
        <el-tag :type="pendingWithdrawal ? 'warning' : 'primary'" effect="light" round>
          {{ pendingWithdrawal ? '处理中' : '余额提现' }}
        </el-tag>
      </header>

      <section class="reward-summary" aria-label="累计奖励">
        <span>累计奖励</span>
        <strong v-if="rewardLoading">加载中</strong>
        <strong v-else-if="rewardLoadError" class="metric-error">
          加载失败
          <button type="button" @click="fetchRewardSummary">重试</button>
        </strong>
        <strong v-else>¥{{ formatCents(rewardTotal) }}</strong>
      </section>

      <div v-if="overviewLoadError" class="panel-state is-error">
        <el-icon><WarningFilled /></el-icon>
        <div>
          <strong>钱包信息加载失败</strong>
          <p>{{ overviewLoadError }}</p>
          <el-button size="small" @click="fetchOverview">重新加载</el-button>
        </div>
      </div>

      <div v-else v-loading="overviewLoading" class="balance-content">
        <p class="balance-label">可用余额</p>
        <strong class="balance-value"><small>¥</small>{{ formatCents(overview.balance) }}</strong>

        <dl class="balance-metrics">
          <div>
            <dt>最低提现</dt>
            <dd>¥{{ formatCents(overview.minimum_withdrawal_amount) }}</dd>
          </div>
          <div>
            <dt>收款方式</dt>
            <dd>{{ paymentTypeText }}</dd>
          </div>
        </dl>

        <section v-if="pendingWithdrawal" class="pending-card">
          <div class="pending-title">
            <span>提现申请处理中</span>
            <el-tag type="warning" size="small" effect="light">处理中</el-tag>
          </div>
          <strong>¥{{ formatCents(pendingWithdrawal.amount) }}</strong>
          <p>提交于 {{ formatDateTime(pendingWithdrawal.created_at) }}</p>
          <p>当前申请处理完成前不能再次提交。</p>
        </section>

        <section class="withdraw-form">
          <label class="form-label" for="withdraw-amount">提现金额</label>
          <el-input
            id="withdraw-amount"
            v-model="amountInput"
            class="amount-input"
            inputmode="decimal"
            placeholder="请输入提现金额"
            :disabled="submitDisabled"
            @keyup.enter="handleSubmit"
          >
            <template #prefix>¥</template>
          </el-input>
          <p class="form-help">金额最多保留两位小数，提交后将进入人工处理。</p>
          <el-button
            class="submit-button"
            type="primary"
            :loading="submitting"
            :disabled="submitDisabled"
            @click="handleSubmit"
          >
            {{ pendingWithdrawal ? '已有申请处理中' : '申请提现' }}
          </el-button>
          <p v-if="!overview.has_payment_qr && !overviewLoading" class="payment-tip">
            <el-icon><InfoFilled /></el-icon>
            请先前往“我的”上传收款码。
          </p>
        </section>
      </div>
    </aside>

    <section class="withdraw-panel transactions-panel">
      <header class="transactions-heading">
        <div>
          <p class="eyebrow">WALLET</p>
          <h1>余额明细</h1>
          <p>查看每笔余额变动及变动后的账户余额</p>
        </div>
        <div class="filters">
          <el-input
            v-model="searchDraft"
            class="search-input"
            aria-label="搜索余额明细"
            clearable
            :maxlength="200"
            placeholder="搜索说明"
            :prefix-icon="Search"
            @clear="handleSearch"
            @keyup.enter="handleSearch"
          />
          <el-select
            v-model="selectedType"
            class="type-select"
            aria-label="筛选余额明细类型"
            placeholder="所有类型"
            @change="handleTypeChange"
          >
            <el-option label="所有类型" value="" />
            <el-option
              v-for="option in transactionTypeOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
          <el-button :icon="Search" :loading="transactionsLoading" @click="handleSearch">搜索</el-button>
        </div>
      </header>

      <el-alert
        v-if="transactionsLoadError"
        class="transactions-error"
        type="error"
        :closable="false"
        show-icon
      >
        <template #title>
          <span>{{ transactionsLoadError }}</span>
          <el-button link type="primary" @click="fetchTransactions(currentPage)">重试</el-button>
        </template>
      </el-alert>

      <el-table
        v-loading="transactionsLoading"
        :data="transactions"
        class="transactions-table"
        empty-text="暂无余额明细"
      >
        <el-table-column label="时间" min-width="170">
          <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="类型" min-width="120">
          <template #default="{ row }">
            <el-tag :type="transactionTagType(row.type)" effect="light">
              {{ transactionTypeText(row.type) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="说明" min-width="180">
          <template #default="{ row }">
            <div>{{ row.description || '-' }}</div>
            <div v-if="withdrawalStatusText(row)" class="withdrawal-state">
              <el-tag :type="withdrawalStatusTagType(row.withdrawal_status)" effect="plain" size="small">
                {{ withdrawalStatusText(row) }}
              </el-tag>
              <span v-if="row.withdrawal_processed_at">处理于 {{ formatDateTime(row.withdrawal_processed_at) }}</span>
              <span v-if="row.withdrawal_status === 'rejected' && row.withdrawal_reject_reason" class="withdrawal-reason">
                原因：{{ row.withdrawal_reject_reason }}
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="变动金额" min-width="130" align="right">
          <template #default="{ row }">
            <strong class="amount-change" :class="amountClass(row.amount)">
              {{ formatSignedCents(row.amount) }}
            </strong>
          </template>
        </el-table-column>
        <el-table-column label="变动后余额" min-width="130" align="right">
          <template #default="{ row }">¥{{ formatCents(row.balance_after) }}</template>
        </el-table-column>
      </el-table>

      <div v-loading="transactionsLoading" class="mobile-transaction-list">
        <el-empty v-if="transactions.length === 0 && !transactionsLoading" description="暂无余额明细" />
        <article
          v-for="transaction in transactions"
          :key="transaction.id"
          class="mobile-transaction-card"
        >
          <div class="mobile-transaction-top">
            <el-tag :type="transactionTagType(transaction.type)" effect="light" size="small">
              {{ transactionTypeText(transaction.type) }}
            </el-tag>
            <strong class="amount-change" :class="amountClass(transaction.amount)">
              {{ formatSignedCents(transaction.amount) }}
            </strong>
          </div>
          <p class="transaction-description">{{ transaction.description || '-' }}</p>
          <div v-if="withdrawalStatusText(transaction)" class="withdrawal-state">
            <el-tag :type="withdrawalStatusTagType(transaction.withdrawal_status)" effect="plain" size="small">
              {{ withdrawalStatusText(transaction) }}
            </el-tag>
            <span v-if="transaction.withdrawal_processed_at">处理于 {{ formatDateTime(transaction.withdrawal_processed_at) }}</span>
            <span v-if="transaction.withdrawal_status === 'rejected' && transaction.withdrawal_reject_reason" class="withdrawal-reason">
              原因：{{ transaction.withdrawal_reject_reason }}
            </span>
          </div>
          <div class="mobile-transaction-meta">
            <span>{{ formatDateTime(transaction.created_at) }}</span>
            <span>余额 ¥{{ formatCents(transaction.balance_after) }}</span>
          </div>
        </article>
      </div>

      <footer v-if="total > pageSize" class="pagination-row">
        <el-pagination
          v-model:current-page="currentPage"
          :page-size="pageSize"
          :total="total"
          layout="prev, pager, next"
          @current-change="fetchTransactions"
        />
      </footer>
    </section>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { InfoFilled, Search, WalletFilled, WarningFilled } from '@element-plus/icons-vue'
import api from '@/api'

const transactionTypeOptions = [
  { value: 'opening_balance', label: '初始余额' },
  { value: 'referral_reward', label: '推广奖励' },
  { value: 'plan_payment', label: '套餐消费' },
  { value: 'withdrawal', label: '提现申请' },
  { value: 'withdrawal_refund', label: '提现退回' }
]

const overview = reactive({
  balance: 0,
  payment_type: null,
  has_payment_qr: false,
  minimum_withdrawal_amount: 0,
  pending_withdrawal: null
})
const overviewLoading = ref(true)
const overviewLoadError = ref('')
const rewardTotal = ref(null)
const rewardLoading = ref(true)
const rewardLoadError = ref('')
const amountInput = ref('')
const confirming = ref(false)
const submitting = ref(false)
const transactions = ref([])
const transactionsLoading = ref(true)
const transactionsLoadError = ref('')
const searchDraft = ref('')
const activeKeyword = ref('')
const selectedType = ref('')
const currentPage = ref(1)
const pageSize = 20
const total = ref(0)
let overviewRequestSequence = 0
let requestSequence = 0
let confirmRequestSequence = 0
let alive = true

const pendingWithdrawal = computed(() => overview.pending_withdrawal)
const paymentTypeText = computed(() => {
  if (!overview.has_payment_qr) return '未设置'
  return overview.payment_type === 'alipay' ? '支付宝' : '微信'
})
const submitDisabled = computed(() => (
  overviewLoading.value || !!overviewLoadError.value || !!pendingWithdrawal.value ||
  !overview.has_payment_qr || confirming.value || submitting.value
))

/**
 * 将后端分值格式化为固定两位小数的元文本。
 * @param {number|string|null} cents - 分单位金额
 * @returns {string} 不含币种符号的金额文本
 */
function formatCents(cents) {
  const value = Number(cents)
  return Number.isFinite(value) ? (value / 100).toFixed(2) : '0.00'
}

/**
 * 格式化带方向的流水金额，正数显式添加加号。
 * @param {number|string|null} cents - 分单位有符号金额
 * @returns {string} 带币种与方向的金额文本
 */
function formatSignedCents(cents) {
  const value = Number(cents)
  if (!Number.isFinite(value)) return '¥0.00'
  return `${value > 0 ? '+' : value < 0 ? '-' : ''}¥${formatCents(Math.abs(value))}`
}

/**
 * 按金额方向返回视觉类名。
 * @param {number|string|null} amount - 分单位有符号金额
 * @returns {string} 正、负或中性类名
 */
function amountClass(amount) {
  const value = Number(amount)
  if (value > 0) return 'is-positive'
  if (value < 0) return 'is-negative'
  return 'is-neutral'
}

/**
 * 兼容秒、毫秒时间戳以及 PostgreSQL 时间字符串。
 * @param {number|string|null} value - 原始时间
 * @returns {string} 本地时间文本
 */
function formatDateTime(value) {
  if (!value) return '-'
  const raw = String(value)
  const numericValue = Number(value)
  const date = /^\d+$/.test(raw)
    ? new Date(numericValue < 100000000000 ? numericValue * 1000 : numericValue)
    : new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false })
}

/**
 * 将流水类型映射为稳定中文标签。
 * @param {string} type - 后端流水枚举
 * @returns {string} 中文类型
 */
function transactionTypeText(type) {
  return transactionTypeOptions.find(option => option.value === type)?.label || type || '-'
}

/**
 * 将流水类型映射为 Element Plus 标签风格。
 * @param {string} type - 后端流水枚举
 * @returns {string} 标签类型
 */
function transactionTagType(type) {
  return {
    opening_balance: 'info',
    referral_reward: 'success',
    plan_payment: 'danger',
    withdrawal: 'warning',
    withdrawal_refund: 'success'
  }[type] || 'info'
}

/** 只展示后端白名单中的提现状态，普通余额流水不追加状态文案。 */
function withdrawalStatusText(transaction) {
  return ({ pending: '处理中', completed: '已完成', rejected: '已驳回' })[transaction?.withdrawal_status] || ''
}

/** 将提现处理状态映射为稳定的标签颜色。 */
function withdrawalStatusTagType(status) {
  return ({ pending: 'warning', completed: 'success', rejected: 'danger' })[status] || 'info'
}

/**
 * 加载提现概览；序号较旧的响应不覆盖新请求结果。
 * @returns {Promise<void>}
 */
async function fetchOverview() {
  const sequence = ++overviewRequestSequence
  overviewLoading.value = true
  overviewLoadError.value = ''
  try {
    const response = await api.user.getWithdrawalOverview()
    if (sequence !== overviewRequestSequence) return
    if (response.code !== 0) throw new Error(response.message || '钱包信息加载失败')
    Object.assign(overview, response.data || {})
  } catch (error) {
    if (sequence !== overviewRequestSequence) return
    overviewLoadError.value = error.userMessage || error.message || '请稍后重试'
  } finally {
    if (sequence === overviewRequestSequence) overviewLoading.value = false
  }
}

/**
 * 独立加载累计推广奖励，失败时保留错误态而不伪装为零。
 * @returns {Promise<void>}
 */
async function fetchRewardSummary() {
  rewardLoading.value = true
  rewardLoadError.value = ''
  try {
    const response = await api.user.getReferralSummary()
    if (response.code !== 0) throw new Error(response.message || '奖励信息加载失败')
    const value = Number(response.data?.reward_amount)
    if (!Number.isFinite(value)) throw new Error('奖励数据格式异常')
    rewardTotal.value = value
  } catch (error) {
    rewardTotal.value = null
    rewardLoadError.value = error.userMessage || error.message || '请稍后重试'
  } finally {
    rewardLoading.value = false
  }
}

/**
 * 加载服务端分页流水；仅最后一次请求可更新列表与 loading/error。
 * @param {number} [page=currentPage.value] - 目标页码
 * @returns {Promise<void>}
 */
async function fetchTransactions(page = currentPage.value) {
  const sequence = ++requestSequence
  currentPage.value = page
  transactionsLoading.value = true
  transactionsLoadError.value = ''
  try {
    const response = await api.user.getBalanceTransactions({
      page,
      limit: pageSize,
      type: selectedType.value || undefined,
      keyword: activeKeyword.value || undefined
    })
    if (sequence !== requestSequence) return
    if (response.code !== 0) throw new Error(response.message || '余额明细加载失败')
    const data = response.data || {}
    transactions.value = Array.isArray(data.list) ? data.list : []
    total.value = Number(data.total) || 0
    currentPage.value = Number(data.page) || page
  } catch (error) {
    if (sequence !== requestSequence) return
    transactionsLoadError.value = error.userMessage || error.message || '余额明细加载失败，请重试'
  } finally {
    if (sequence === requestSequence) transactionsLoading.value = false
  }
}

/** 显式提交当前搜索词并回到第一页，避免输入中连续请求。 */
function handleSearch() {
  activeKeyword.value = searchDraft.value.trim()
  fetchTransactions(1)
}

/** 类型改变后从第一页重新加载服务端筛选结果。 */
function handleTypeChange() {
  fetchTransactions(1)
}

/**
 * 以 BigInt 精确校验元字符串，并转换为安全整数分用于前端范围判断。
 * 原始字符串不会被改写，真正提交仍由后端完成转换。
 * @param {string} amount - 输入框原始值
 * @returns {number|null} 安全整数分，非法时为 null
 */
function amountToCents(amount) {
  if (typeof amount !== 'string' || !/^\d+(\.\d{1,2})?$/.test(amount)) return null
  const [yuan, fraction = ''] = amount.split('.')
  const cents = Number(BigInt(yuan) * 100n + BigInt(fraction.padEnd(2, '0')))
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null
}

/**
 * 校验并确认提现；确认与网络提交分别加锁，避免连续点击产生重复请求。
 * @returns {Promise<void>}
 */
async function handleSubmit() {
  if (submitDisabled.value) return
  const amountSnapshot = amountInput.value
  const paymentTypeSnapshot = paymentTypeText.value
  const cents = amountToCents(amountSnapshot)
  if (cents === null) {
    ElMessage.warning('请输入正数金额，最多保留两位小数')
    return
  }
  if (cents < Number(overview.minimum_withdrawal_amount)) {
    ElMessage.warning(`最低提现金额为 ¥${formatCents(overview.minimum_withdrawal_amount)}`)
    return
  }
  if (cents > Number(overview.balance)) {
    ElMessage.warning('提现金额不能超过可用余额')
    return
  }

  const confirmSequence = ++confirmRequestSequence
  confirming.value = true
  try {
    await ElMessageBox.confirm(
      `确认提现 ¥${formatCents(cents)} 至${paymentTypeSnapshot}收款码？`,
      '确认提现',
      {
        confirmButtonText: '确认提现',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
    if (!alive || confirmSequence !== confirmRequestSequence) return
  } catch {
    return
  } finally {
    if (alive && confirmSequence === confirmRequestSequence) {
      confirming.value = false
    }
  }

  if (submitting.value || pendingWithdrawal.value) return
  submitting.value = true
  try {
    const response = await api.user.createWithdrawal({ amount: amountSnapshot })
    if (!alive) return
    if (response.code !== 0) throw new Error(response.message || '提现申请提交失败')
    ElMessage.success('提现申请已提交')
    amountInput.value = ''
    currentPage.value = 1
    await Promise.all([fetchOverview(), fetchTransactions(1)])
  } catch (error) {
    if (!alive) return
    if (Number(error.response?.status) === 409) {
      await fetchOverview()
      return
    }
    ElMessage.error(error.userMessage || error.message || '提现申请提交失败，请重试')
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  fetchOverview()
  fetchRewardSummary()
  fetchTransactions(1)
})

/** 卸载时仅使本组件的异步请求与确认流程失效，不触碰全局消息框实例。 */
onBeforeUnmount(() => {
  alive = false
  overviewRequestSequence += 1
  requestSequence += 1
  confirmRequestSequence += 1
})
</script>

<style scoped>
.withdraw-page {
  display: grid;
  grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
  align-items: start;
  gap: 20px;
}

.withdraw-panel {
  min-width: 0;
  border: 1px solid #ebeef5;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
}

.balance-panel {
  padding: 24px;
}

.balance-heading,
.pending-title,
.transactions-heading,
.filters,
.mobile-transaction-top,
.mobile-transaction-meta {
  display: flex;
  align-items: center;
}

.balance-heading {
  justify-content: space-between;
  margin-bottom: 20px;
}

.heading-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: 14px;
  color: #2563eb;
  font-size: 24px;
  background: #eff6ff;
}

.balance-content {
  min-height: 390px;
}

.reward-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 22px;
  padding: 13px 15px;
  border: 1px solid #dbeafe;
  border-radius: 12px;
  color: #475569;
  background: #f8fbff;
  font-size: 13px;
}

.reward-summary strong {
  color: #0f172a;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}

.reward-summary .metric-error {
  color: #c2410c;
  font-size: 12px;
}

.balance-label,
.eyebrow,
.transactions-heading p,
.form-help,
.pending-card p,
.payment-tip {
  color: #909399;
}

.balance-label {
  margin: 0 0 6px;
  font-size: 14px;
}

.balance-value {
  display: block;
  margin-bottom: 28px;
  color: #0f172a;
  font-size: 48px;
  line-height: 1.1;
  letter-spacing: -1px;
  font-variant-numeric: tabular-nums;
}

.balance-value small {
  margin-right: 5px;
  color: #64748b;
  font-size: 22px;
}

.balance-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 0 0 22px;
  padding: 18px 0;
  border-top: 1px solid #eef0f4;
  border-bottom: 1px solid #eef0f4;
}

.balance-metrics div {
  min-width: 0;
}

.balance-metrics dt {
  margin-bottom: 7px;
  color: #909399;
  font-size: 12px;
}

.balance-metrics dd {
  margin: 0;
  color: #303133;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.4;
  word-break: break-word;
}

.balance-metrics .metric-error {
  color: #c2410c;
  font-size: 12px;
}

.metric-error button {
  padding: 0;
  border: 0;
  color: #2563eb;
  background: none;
  cursor: pointer;
}

.pending-card {
  margin-bottom: 18px;
  padding: 15px;
  border: 1px solid #fde68a;
  border-radius: 12px;
  background: #fffbeb;
}

.pending-title {
  justify-content: space-between;
  gap: 12px;
  color: #92400e;
  font-size: 13px;
  font-weight: 700;
}

.pending-card > strong {
  display: block;
  margin-top: 12px;
  color: #78350f;
  font-size: 24px;
}

.pending-card p {
  margin: 5px 0 0;
  font-size: 12px;
  line-height: 1.45;
}

.form-label {
  display: block;
  margin-bottom: 9px;
  color: #303133;
  font-size: 14px;
  font-weight: 700;
}

.amount-input {
  width: 100%;
}

.form-help {
  margin: 8px 0 14px;
  font-size: 12px;
  line-height: 1.5;
}

.submit-button {
  width: 100%;
}

.payment-tip {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 10px 0 0;
  font-size: 12px;
}

.panel-state {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 18px;
  border-radius: 12px;
  color: #c2410c;
  background: #fff7ed;
}

.panel-state > .el-icon {
  flex-shrink: 0;
  margin-top: 2px;
  font-size: 20px;
}

.panel-state p {
  margin: 5px 0 12px;
  color: #9a3412;
  font-size: 13px;
}

.transactions-panel {
  overflow: hidden;
}

.transactions-heading {
  justify-content: space-between;
  gap: 24px;
  padding: 24px 28px;
}

.eyebrow {
  margin: 0 0 4px !important;
  color: #2563eb !important;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.14em;
}

.transactions-heading h1 {
  margin: 0;
  color: #0f172a;
  font-size: 24px;
}

.transactions-heading p:not(.eyebrow) {
  margin: 7px 0 0;
  font-size: 13px;
}

.filters {
  justify-content: flex-end;
  gap: 10px;
  flex: 1;
}

.search-input {
  width: min(280px, 38%);
}

.type-select {
  width: 150px;
}

.transactions-error {
  margin: 0 28px 16px;
  width: auto;
}

.transactions-error :deep(.el-alert__title) {
  display: flex;
  align-items: center;
  gap: 8px;
}

.transactions-table {
  width: 100%;
  border-top: 1px solid #f0f2f5;
}

.transactions-table :deep(.el-table__header th) {
  height: 54px;
  color: #64748b;
  font-weight: 600;
  background: #f8fafc;
}

.transactions-table :deep(.el-table__row td) {
  height: 64px;
}

.amount-change {
  font-variant-numeric: tabular-nums;
}

.withdrawal-state {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}

.withdrawal-reason {
  width: 100%;
  color: #dc2626;
  word-break: break-word;
}

.amount-change.is-positive {
  color: #059669;
}

.amount-change.is-negative {
  color: #dc2626;
}

.amount-change.is-neutral {
  color: #64748b;
}

.mobile-transaction-list {
  display: none;
}

.pagination-row {
  display: flex;
  justify-content: flex-end;
  padding: 20px 28px;
  border-top: 1px solid #f0f2f5;
}

@media (max-width: 1100px) {
  .withdraw-page {
    grid-template-columns: minmax(280px, 320px) minmax(0, 1fr);
  }

  .transactions-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .filters {
    width: 100%;
    justify-content: flex-start;
  }

  .search-input {
    width: min(320px, 50%);
  }
}

@media (max-width: 768px) {
  .withdraw-page {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .withdraw-panel {
    width: 100%;
    border-radius: 14px;
  }

  .balance-panel {
    padding: 18px;
  }

  .balance-heading {
    margin-bottom: 22px;
  }

  .balance-content {
    min-height: 340px;
  }

  .balance-value {
    margin-bottom: 22px;
    font-size: 42px;
  }

  .transactions-heading {
    gap: 16px;
    padding: 18px;
  }

  .transactions-heading h1 {
    font-size: 21px;
  }

  .filters {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(118px, 0.65fr);
    gap: 8px;
  }

  .search-input,
  .type-select {
    width: 100%;
  }

  .filters > .el-button {
    grid-column: 1 / -1;
    width: 100%;
  }

  .transactions-error {
    margin: 0 14px 14px;
  }

  .transactions-table {
    display: none;
  }

  .mobile-transaction-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 120px;
    padding: 0 14px 14px;
  }

  .mobile-transaction-card {
    padding: 13px;
    border: 1px solid #ebeef5;
    border-radius: 10px;
    background: #fff;
  }

  .mobile-transaction-top,
  .mobile-transaction-meta {
    justify-content: space-between;
    gap: 12px;
  }

  .transaction-description {
    margin: 12px 0;
    color: #303133;
    font-size: 14px;
    line-height: 1.45;
    word-break: break-word;
  }

  .mobile-transaction-meta {
    align-items: flex-start;
    color: #909399;
    font-size: 11px;
    line-height: 1.4;
  }

  .mobile-transaction-meta span:last-child {
    flex-shrink: 0;
  }

  .pagination-row {
    justify-content: center;
    padding: 14px;
  }
}

@media (max-width: 420px) {
  .balance-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .filters {
    grid-template-columns: 1fr;
  }

  .filters > .el-button {
    grid-column: auto;
  }

  .mobile-transaction-meta {
    flex-direction: column;
    gap: 4px;
  }
}
</style>
