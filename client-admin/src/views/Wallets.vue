<template>
  <section class="wallets-container tw-min-w-0">
    <div class="page-header">
      <div>
        <h1 class="page-title">余额管理</h1>
        <p class="page-subtitle">查看用户余额、奖励与流水，并处理待确认提现</p>
      </div>
    </div>

    <div class="content-card">
      <div class="toolbar">
        <el-input
          v-model="emailKeyword"
          class="wallet-email-search"
          clearable
          aria-label="按邮箱搜索余额用户"
          placeholder="输入邮箱搜索"
          @input="scheduleEmailSearch"
          @clear="scheduleEmailSearch"
        />
      </div>

      <div class="tw-hidden md:tw-block">
        <el-table v-loading="listLoading" :data="walletUsers" style="width: 100%">
          <el-table-column prop="email" label="邮箱" min-width="220" />
          <el-table-column label="余额" min-width="120">
            <template #default="{ row }">{{ formatCents(row.balance) }}</template>
          </el-table-column>
          <el-table-column label="累计奖励" min-width="120">
            <template #default="{ row }">{{ formatCents(row.reward_total) }}</template>
          </el-table-column>
          <el-table-column label="处理中金额" min-width="130">
            <template #default="{ row }">{{ formatPendingAmount(row) }}</template>
          </el-table-column>
          <el-table-column label="状态" min-width="110">
            <template #default="{ row }">
              <el-tag :type="pendingStatusType(row.pending_withdrawal_status)">
                {{ pendingStatusText(row.pending_withdrawal_status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120" fixed="right">
            <template #default="{ row }">
              <el-button class="view-wallet-detail" type="primary" link @click="openWalletDetail(row)">
                查看详情
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div v-loading="listLoading" class="mobile-wallet-list tw-grid tw-gap-3 md:tw-hidden">
        <article v-for="user in walletUsers" :key="walletUserId(user)" class="wallet-user-card">
          <div class="mobile-record-header">
            <strong>{{ user.email }}</strong>
            <el-tag :type="pendingStatusType(user.pending_withdrawal_status)">
              {{ pendingStatusText(user.pending_withdrawal_status) }}
            </el-tag>
          </div>
          <dl class="mobile-record-fields">
            <div><dt>余额</dt><dd>{{ formatCents(user.balance) }}</dd></div>
            <div><dt>累计奖励</dt><dd>{{ formatCents(user.reward_total) }}</dd></div>
            <div><dt>处理中金额</dt><dd>{{ formatPendingAmount(user) }}</dd></div>
          </dl>
          <div class="mobile-record-actions">
            <el-button class="view-wallet-detail" type="primary" @click="openWalletDetail(user)">
              查看详情
            </el-button>
          </div>
        </article>
        <el-empty v-if="!listLoading && walletUsers.length === 0" description="暂无余额用户" />
      </div>

      <el-pagination
        v-if="listTotal > listPageSize"
        v-model:current-page="listPage"
        class="pagination list-pagination"
        :page-size="listPageSize"
        :total="listTotal"
        layout="prev, pager, next"
        @current-change="loadWalletUsers"
      />
    </div>

    <el-drawer
      v-model="detailDrawerVisible"
      class="wallet-detail-drawer"
      title="余额详情"
      size="min(760px, 94vw)"
      @closed="handleDrawerClosed"
    >
      <template #header>
        <div class="drawer-heading">
          <strong>余额详情</strong>
          <span>{{ walletDetail?.user?.email || '正在加载…' }}</span>
        </div>
      </template>

      <div v-loading="detailLoading" class="drawer-content">
        <el-alert v-if="detailError" :title="detailError" type="error" :closable="false" show-icon />

        <template v-if="walletDetail?.user">
          <div class="summary-grid">
            <div class="summary-item">
              <span>当前余额</span>
              <strong>{{ formatCents(walletDetail.user.balance) }}</strong>
            </div>
            <div class="summary-item">
              <span>累计奖励</span>
              <strong>{{ formatCents(walletDetail.user.reward_total) }}</strong>
            </div>
          </div>

          <section v-if="pendingWithdrawal" class="pending-card">
            <div class="section-heading">
              <div>
                <h2>待处理提现</h2>
                <p>{{ paymentTypeText(pendingWithdrawal.payment_type) }} · {{ formatTime(pendingWithdrawal.created_at) }}</p>
              </div>
              <strong>{{ formatCents(pendingWithdrawal.amount) }}</strong>
            </div>

            <div class="qr-panel">
              <img v-if="withdrawalQrUrl" :src="withdrawalQrUrl" class="withdrawal-qr" alt="用户申请时的收款二维码" />
              <div v-else class="qr-placeholder">
                {{ qrLoading ? '收款码加载中…' : (qrError || '暂无收款码') }}
              </div>
            </div>

            <div class="withdrawal-actions">
              <el-button
                class="reject-withdrawal"
                type="danger"
                plain
                :disabled="processingWithdrawal"
                :loading="processingAction === 'reject'"
                @click="rejectPendingWithdrawal"
              >
                驳回并退款
              </el-button>
              <el-button
                class="complete-withdrawal"
                type="success"
                :disabled="processingWithdrawal"
                :loading="processingAction === 'complete'"
                @click="completePendingWithdrawal"
              >
                确认已付款
              </el-button>
            </div>
          </section>

          <el-alert v-else title="当前没有待处理提现" type="info" :closable="false" show-icon />

          <section class="transactions-section">
            <div class="transactions-toolbar">
              <h2>余额流水</h2>
              <el-select
                v-model="transactionType"
                aria-label="筛选余额流水类型"
                placeholder="全部类型"
                @change="handleTransactionTypeChange"
              >
                <el-option label="全部类型" value="" />
                <el-option
                  v-for="option in transactionTypeOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
            </div>

            <div class="tw-hidden md:tw-block">
              <el-table v-loading="transactionsLoading" :data="transactions" style="width: 100%">
                <el-table-column label="类型" min-width="120">
                  <template #default="{ row }">{{ transactionTypeText(row.type) }}</template>
                </el-table-column>
                <el-table-column label="变动金额" min-width="120">
                  <template #default="{ row }">
                    <span :class="Number(row.amount) >= 0 ? 'amount-positive' : 'amount-negative'">
                      {{ formatSignedCents(row.amount) }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column label="变动后余额" min-width="130">
                  <template #default="{ row }">{{ formatCents(row.balance_after) }}</template>
                </el-table-column>
                <el-table-column prop="description" label="说明" min-width="180" />
                <el-table-column label="时间" min-width="180">
                  <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
                </el-table-column>
              </el-table>
            </div>

            <div v-loading="transactionsLoading" class="mobile-transactions tw-grid tw-gap-3 md:tw-hidden">
              <article v-for="item in transactions" :key="item.id" class="transaction-card">
                <div class="mobile-record-header">
                  <strong>{{ transactionTypeText(item.type) }}</strong>
                  <span :class="Number(item.amount) >= 0 ? 'amount-positive' : 'amount-negative'">
                    {{ formatSignedCents(item.amount) }}
                  </span>
                </div>
                <dl class="mobile-record-fields">
                  <div><dt>变动后余额</dt><dd>{{ formatCents(item.balance_after) }}</dd></div>
                  <div><dt>说明</dt><dd>{{ item.description || '-' }}</dd></div>
                  <div><dt>时间</dt><dd>{{ formatTime(item.created_at) }}</dd></div>
                </dl>
              </article>
              <el-empty v-if="!transactionsLoading && transactions.length === 0" description="暂无余额流水" />
            </div>

            <el-pagination
              v-if="transactionTotal > transactionPageSize"
              v-model:current-page="transactionPage"
              class="pagination transaction-pagination"
              :page-size="transactionPageSize"
              :total="transactionTotal"
              layout="prev, pager, next"
              @current-change="handleTransactionPageChange"
            />
          </section>
        </template>
      </div>
    </el-drawer>
  </section>
</template>

<script setup>
/**
 * 管理端余额管理页。
 * 职责：只读展示余额与流水，并对 pending 提现执行确认或驳回流程。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import api from '@/api'
import { ElMessage } from 'element-plus/es/components/message/index.mjs'
import { ElMessageBox } from 'element-plus/es/components/message-box/index.mjs'

defineOptions({ name: 'Wallets' })

const listPageSize = 20
const transactionPageSize = 20
const walletUsers = ref([])
const listTotal = ref(0)
const listPage = ref(1)
const emailKeyword = ref('')
const listLoading = ref(false)
const detailDrawerVisible = ref(false)
const selectedUserId = ref(null)
const walletDetail = ref(null)
const detailLoading = ref(false)
const detailError = ref('')
const transactions = ref([])
const transactionTotal = ref(0)
const transactionPage = ref(1)
const transactionType = ref('')
const transactionsLoading = ref(false)
const withdrawalQrUrl = ref('')
const qrLoading = ref(false)
const qrError = ref('')
const processingWithdrawal = ref(false)
const processingAction = ref('')

let emailSearchTimer = null
let listRequestSequence = 0
let detailRequestSequence = 0
let transactionRequestSequence = 0
let qrRequestSequence = 0
let disposed = false

const transactionTypeOptions = [
  { value: 'opening_balance', label: '初始余额' },
  { value: 'referral_reward', label: '推广奖励' },
  { value: 'plan_payment', label: '套餐支付' },
  { value: 'withdrawal', label: '提现申请' },
  { value: 'withdrawal_refund', label: '提现退回' }
]

const pendingWithdrawal = computed(() => {
  const item = walletDetail.value?.pending_withdrawal
  return item?.status === 'pending' ? item : null
})

/** 将整数分格式化为固定两位元金额；空值按 0 分处理。 */
function formatCents(value) {
  const cents = Number(value)
  return `¥${(Number.isFinite(cents) ? cents / 100 : 0).toFixed(2)}`
}

/** 流水金额保留正负号，便于管理员区分收入与支出。 */
function formatSignedCents(value) {
  const cents = Number(value)
  const safeCents = Number.isFinite(cents) ? cents : 0
  return `${safeCents > 0 ? '+' : ''}${formatCents(safeCents)}`
}

/** 同时兼容后端列表契约 user_id 与详情模型 id。 */
function walletUserId(user) {
  return Number(user?.user_id ?? user?.id)
}

/** 只有 pending 行展示处理中金额，其他状态统一显示短横线。 */
function formatPendingAmount(user) {
  return user?.pending_withdrawal_status === 'pending' ? formatCents(user.pending_withdrawal_amount) : '—'
}

/** 将提现状态映射为中文；列表无申请时展示明确的空闲状态。 */
function pendingStatusText(status) {
  return ({ pending: '待处理', completed: '已完成', rejected: '已驳回' })[status] || '无处理中'
}

/** 将提现状态映射为 Element Plus 标签类型。 */
function pendingStatusType(status) {
  return ({ pending: 'warning', completed: 'success', rejected: 'danger' })[status] || 'info'
}

/** 将流水类型映射为用户可读中文，未知类型原样显示。 */
function transactionTypeText(type) {
  return transactionTypeOptions.find(option => option.value === type)?.label || type || '-'
}

/** 将收款平台映射为中文名称。 */
function paymentTypeText(type) {
  return type === 'alipay' ? '支付宝' : '微信'
}

/** 同时兼容秒与毫秒时间戳，非法时间显示短横线。 */
function formatTime(timestamp) {
  const raw = Number(timestamp)
  if (!Number.isFinite(raw) || raw <= 0) return '-'
  return new Date(raw < 1e12 ? raw * 1000 : raw).toLocaleString('zh-CN')
}

/** 拉取钱包用户列表；请求序号确保旧搜索或旧分页不会覆盖最新结果。 */
async function loadWalletUsers() {
  const requestId = ++listRequestSequence
  listLoading.value = true
  try {
    const response = await api.admin.getWalletUsers({ email: emailKeyword.value.trim(), page: listPage.value, limit: listPageSize })
    if (disposed || requestId !== listRequestSequence) return
    if (response.code !== 0) {
      ElMessage.error(response.message || '余额用户加载失败')
      return
    }
    walletUsers.value = response.data?.list || []
    listTotal.value = Number(response.data?.total) || 0
  } catch (error) {
    if (!disposed && requestId === listRequestSequence) {
      console.error('加载余额用户失败:', error)
      ElMessage.error('余额用户加载失败')
    }
  } finally {
    if (!disposed && requestId === listRequestSequence) listLoading.value = false
  }
}

/** 邮箱输入停止 300ms 后才请求，避免每个字符都访问后端。 */
function scheduleEmailSearch() {
  if (emailSearchTimer) clearTimeout(emailSearchTimer)
  emailSearchTimer = setTimeout(() => {
    emailSearchTimer = null
    listPage.value = 1
    loadWalletUsers()
  }, 300)
}

/** 释放当前二维码 Object URL；该方法可重复调用。 */
function revokeWithdrawalQrUrl() {
  if (!withdrawalQrUrl.value) return
  URL.revokeObjectURL(withdrawalQrUrl.value)
  withdrawalQrUrl.value = ''
}

/** 使在途二维码响应失效并清理当前图片。 */
function resetWithdrawalQr() {
  qrRequestSequence += 1
  qrLoading.value = false
  qrError.value = ''
  revokeWithdrawalQrUrl()
}

/**
 * 提现处理接口成功后先提交本地状态，再发起刷新。
 * 这样刷新失败时不会继续暴露已失效申请的按钮或二维码。
 */
function clearProcessedWithdrawal(userId, withdrawalId) {
  if (selectedUserId.value !== userId || pendingWithdrawal.value?.id !== withdrawalId) return
  resetWithdrawalQr()
  walletDetail.value = {
    ...walletDetail.value,
    pending_withdrawal: null
  }
  walletUsers.value = walletUsers.value.map(user => walletUserId(user) === userId
    ? {
        ...user,
        pending_withdrawal_id: null,
        pending_withdrawal_amount: null,
        pending_withdrawal_status: null
      }
    : user)
}

/** 仅为当前打开用户的 pending 申请加载二维码，响应返回后再次核对上下文。 */
async function loadWithdrawalQr(withdrawalId, userId) {
  const requestId = ++qrRequestSequence
  revokeWithdrawalQrUrl()
  qrLoading.value = true
  qrError.value = ''
  try {
    const blob = await api.admin.getWithdrawalQr(withdrawalId)
    const stillCurrent = !disposed && requestId === qrRequestSequence && detailDrawerVisible.value &&
      selectedUserId.value === userId && pendingWithdrawal.value?.id === withdrawalId
    if (!stillCurrent) return
    withdrawalQrUrl.value = URL.createObjectURL(blob)
  } catch (error) {
    if (!disposed && requestId === qrRequestSequence) {
      console.error('加载提现收款码失败:', error)
      qrError.value = '收款码加载失败'
    }
  } finally {
    if (!disposed && requestId === qrRequestSequence) qrLoading.value = false
  }
}

/** 拉取详情；用户切换时旧响应被请求序号与用户 ID 双重丢弃。 */
async function loadWalletDetail(userId = selectedUserId.value) {
  if (!userId) return
  const requestId = ++detailRequestSequence
  detailLoading.value = true
  detailError.value = ''
  try {
    const response = await api.admin.getWalletUserDetail(userId)
    if (disposed || requestId !== detailRequestSequence || selectedUserId.value !== userId || !detailDrawerVisible.value) return
    if (response.code !== 0) {
      detailError.value = response.message || '余额详情加载失败'
      return
    }
    walletDetail.value = response.data || null
    const pending = response.data?.pending_withdrawal
    if (pending?.status === 'pending') loadWithdrawalQr(pending.id, userId)
    else resetWithdrawalQr()
  } catch (error) {
    if (!disposed && requestId === detailRequestSequence && selectedUserId.value === userId) {
      console.error('加载余额详情失败:', error)
      detailError.value = '余额详情加载失败'
    }
  } finally {
    if (!disposed && requestId === detailRequestSequence) detailLoading.value = false
  }
}

/** 拉取流水；筛选、分页或用户切换后的旧响应不会覆盖最新列表。 */
async function loadWalletTransactions(userId = selectedUserId.value) {
  if (!userId) return
  const requestId = ++transactionRequestSequence
  transactionsLoading.value = true
  try {
    const response = await api.admin.getWalletTransactions(userId, {
      page: transactionPage.value,
      limit: transactionPageSize,
      ...(transactionType.value ? { type: transactionType.value } : {})
    })
    if (disposed || requestId !== transactionRequestSequence || selectedUserId.value !== userId || !detailDrawerVisible.value) return
    if (response.code !== 0) {
      ElMessage.error(response.message || '余额流水加载失败')
      return
    }
    transactions.value = response.data?.list || []
    transactionTotal.value = Number(response.data?.total) || 0
  } catch (error) {
    if (!disposed && requestId === transactionRequestSequence && selectedUserId.value === userId) {
      console.error('加载余额流水失败:', error)
      ElMessage.error('余额流水加载失败')
    }
  } finally {
    if (!disposed && requestId === transactionRequestSequence) transactionsLoading.value = false
  }
}

/** 使当前抽屉的详情、流水和二维码请求全部失效，并清空敏感展示状态。 */
function resetDetailSession() {
  detailRequestSequence += 1
  transactionRequestSequence += 1
  resetWithdrawalQr()
  selectedUserId.value = null
  walletDetail.value = null
  transactions.value = []
  transactionTotal.value = 0
  detailError.value = ''
  detailLoading.value = false
  transactionsLoading.value = false
}

/** 打开指定用户详情；先销毁上一用户的二维码和在途请求。 */
function openWalletDetail(user) {
  const userId = walletUserId(user)
  if (!Number.isSafeInteger(userId) || userId <= 0) return
  resetDetailSession()
  selectedUserId.value = userId
  transactionPage.value = 1
  transactionType.value = ''
  detailDrawerVisible.value = true
  loadWalletDetail(userId)
  loadWalletTransactions(userId)
}

/** 抽屉关闭动画结束时再次执行幂等清理，覆盖所有关闭入口。 */
function handleDrawerClosed() {
  resetDetailSession()
}

/** 类型筛选改变后回到第一页，继续复用当前用户上下文。 */
function handleTransactionTypeChange() {
  transactionPage.value = 1
  loadWalletTransactions()
}

/** 流水页码事件只更新分页状态，用户编号始终从当前抽屉上下文读取。 */
function handleTransactionPageChange(page) {
  transactionPage.value = page
  loadWalletTransactions()
}

/** 提现处理成功后同时刷新列表、当前详情和当前筛选下的流水。 */
async function refreshAfterWithdrawal(userId) {
  const refreshes = [loadWalletUsers()]
  // 处理 A 期间若抽屉已切到 B，只刷新全局列表，不能再发起 A 的详情或流水请求。
  if (!disposed && detailDrawerVisible.value && selectedUserId.value === userId) {
    refreshes.push(loadWalletDetail(userId), loadWalletTransactions(userId))
  }
  await Promise.all(refreshes)
}

/** 从确认框开始锁定两个操作按钮，并在确认后复核抽屉仍是原申请。 */
async function completePendingWithdrawal() {
  const withdrawal = pendingWithdrawal.value
  const userId = selectedUserId.value
  if (processingWithdrawal.value || !withdrawal || !userId) return
  processingWithdrawal.value = true
  processingAction.value = 'complete'
  try {
    await ElMessageBox.confirm(`确定已完成 ${formatCents(withdrawal.amount)} 提现付款吗？`, '确认提现完成', {
      confirmButtonText: '确定完成', cancelButtonText: '取消', type: 'warning'
    })
    if (disposed || !detailDrawerVisible.value || selectedUserId.value !== userId || pendingWithdrawal.value?.id !== withdrawal.id) return
    const response = await api.admin.completeWithdrawal(withdrawal.id)
    if (response.code !== 0) {
      ElMessage.error(response.message || '确认提现失败')
      return
    }
    clearProcessedWithdrawal(userId, withdrawal.id)
    ElMessage.success('提现已确认完成')
    await refreshAfterWithdrawal(userId)
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') console.error('确认提现失败:', error)
  } finally {
    processingWithdrawal.value = false
    processingAction.value = ''
  }
}

/** 驳回原因先做非空校验；后端仍以 pending 条件作为最终并发保护。 */
async function rejectPendingWithdrawal() {
  const withdrawal = pendingWithdrawal.value
  const userId = selectedUserId.value
  if (processingWithdrawal.value || !withdrawal || !userId) return
  processingWithdrawal.value = true
  processingAction.value = 'reject'
  try {
    const result = await ElMessageBox.prompt(`驳回后 ${formatCents(withdrawal.amount)} 将退回用户余额，请填写原因。`, '驳回提现', {
      confirmButtonText: '确定驳回',
      cancelButtonText: '取消',
      inputPlaceholder: '请输入驳回原因',
      inputValidator: value => String(value || '').trim() ? true : '请填写驳回原因',
      type: 'warning'
    })
    if (disposed || !detailDrawerVisible.value || selectedUserId.value !== userId || pendingWithdrawal.value?.id !== withdrawal.id) return
    const reason = String(result.value || '').trim()
    const response = await api.admin.rejectWithdrawal(withdrawal.id, reason)
    if (response.code !== 0) {
      ElMessage.error(response.message || '驳回提现失败')
      return
    }
    clearProcessedWithdrawal(userId, withdrawal.id)
    ElMessage.success('提现已驳回并退回余额')
    await refreshAfterWithdrawal(userId)
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') console.error('驳回提现失败:', error)
  } finally {
    processingWithdrawal.value = false
    processingAction.value = ''
  }
}

watch(detailDrawerVisible, isOpen => {
  if (!isOpen) resetDetailSession()
})

onMounted(loadWalletUsers)

onBeforeUnmount(() => {
  disposed = true
  if (emailSearchTimer) {
    clearTimeout(emailSearchTimer)
    emailSearchTimer = null
  }
  listRequestSequence += 1
  resetDetailSession()
})
</script>

<style scoped>
.wallets-container { width: 100%; max-width: 100%; }
.page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 30px; }
.page-title { margin-bottom: 10px; color: #303133; font-size: 28px; }
.page-subtitle { color: #606266; font-size: 16px; }
.content-card { padding: 20px; border-radius: 12px; background: #fff; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); }
.toolbar { display: flex; margin-bottom: 20px; }
.wallet-email-search { width: 340px; }
.pagination { display: flex; justify-content: flex-end; margin-top: 20px; }
.drawer-heading { display: flex; min-width: 0; flex-direction: column; gap: 4px; }
.drawer-heading strong { color: #303133; font-size: 18px; }
.drawer-heading span { overflow: hidden; color: #909399; text-overflow: ellipsis; white-space: nowrap; }
.drawer-content { min-height: 280px; }
.summary-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-bottom: 18px; }
.summary-item { display: flex; flex-direction: column; gap: 8px; padding: 18px; border: 1px solid #ebeef5; border-radius: 10px; background: #f8fafc; }
.summary-item span { color: #909399; font-size: 13px; }
.summary-item strong { color: #303133; font-size: 22px; }
.pending-card { margin-bottom: 24px; padding: 18px; border: 1px solid #f3d19e; border-radius: 12px; background: #fdf6ec; }
.section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.section-heading h2, .transactions-toolbar h2 { margin: 0; color: #303133; font-size: 18px; }
.section-heading p { margin: 6px 0 0; color: #909399; font-size: 13px; }
.section-heading > strong { color: #e6a23c; font-size: 22px; white-space: nowrap; }
.qr-panel { display: flex; justify-content: center; margin: 18px 0; }
.withdrawal-qr, .qr-placeholder { width: 220px; height: 220px; border-radius: 10px; background: #fff; }
.withdrawal-qr { object-fit: contain; }
.qr-placeholder { display: flex; align-items: center; justify-content: center; border: 1px dashed #dcdfe6; color: #909399; }
.withdrawal-actions { display: flex; justify-content: flex-end; gap: 10px; }
.transactions-section { margin-top: 24px; }
.transactions-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.transactions-toolbar :deep(.el-select) { width: 180px; }
.amount-positive { color: #67c23a; font-weight: 600; }
.amount-negative { color: #f56c6c; font-weight: 600; }
.wallet-user-card, .transaction-card { padding: 14px; border: 1px solid #ebeef5; border-radius: 10px; background: #fff; }
.mobile-record-header, .mobile-record-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.mobile-record-header strong { min-width: 0; overflow-wrap: anywhere; }
.mobile-record-fields { display: grid; gap: 8px; margin: 14px 0; }
.mobile-record-fields div { display: flex; justify-content: space-between; gap: 16px; }
.mobile-record-fields dt { color: #909399; }
.mobile-record-fields dd { margin: 0; text-align: right; overflow-wrap: anywhere; }
.mobile-record-actions { justify-content: flex-end; }

@media (max-width: 767px) {
  .page-header { margin-bottom: 18px; }
  .page-title { font-size: 24px; }
  .page-subtitle { font-size: 14px; }
  .content-card { padding: 12px; }
  .wallet-email-search { width: 100%; }
  .pagination { justify-content: flex-start; overflow-x: auto; }
  .summary-grid { grid-template-columns: 1fr; }
  .section-heading, .transactions-toolbar { align-items: stretch; flex-direction: column; }
  .transactions-toolbar :deep(.el-select) { width: 100%; }
  .withdrawal-actions { flex-direction: column-reverse; }
  .withdrawal-actions :deep(.el-button) { width: 100%; margin-left: 0; }
  .withdrawal-qr, .qr-placeholder { width: min(220px, 72vw); height: min(220px, 72vw); }
  :deep(.el-drawer) { width: 94vw !important; }
}
</style>
