<template>
  <div class="my-container">
    <section class="content-card wallet-card">
      <div class="wallet-heading">
        <div class="wallet-title-wrap">
          <span class="wallet-title-icon">
            <el-icon><Wallet /></el-icon>
          </span>
          <div>
            <h2 class="section-title">收款信息</h2>
            <p class="wallet-description">设置微信或支付宝收款码，用于接收余额提现。</p>
          </div>
        </div>
        <span
          class="wallet-status"
          :class="{
            'is-ready': !walletLoading && !walletLoadError && walletSummary.has_payment_qr,
            'is-error': walletLoadError
          }"
        >
          <el-icon>
            <Loading v-if="walletLoading" class="is-loading" />
            <CircleCheck v-else-if="!walletLoadError && walletSummary.has_payment_qr" />
            <Warning v-else />
          </el-icon>
          {{ walletStatusText }}
        </span>
      </div>

      <div class="wallet-metrics">
        <div class="wallet-metric">
          <span class="metric-label">当前余额</span>
          <strong class="wallet-amount">{{ walletBalanceDisplayText }}</strong>
          <span class="metric-hint">可用于购买套餐或申请提现</span>
        </div>
        <div class="wallet-metric">
          <span class="metric-label">累计推广奖励</span>
          <strong class="wallet-amount">{{ rewardAmountText }}</strong>
          <span class="metric-hint">邀请好友首购后自动计入余额</span>
        </div>
      </div>

      <div v-if="walletLoading" class="wallet-load-state">
        <el-icon class="wallet-load-icon is-loading"><Loading /></el-icon>
        <div>
          <strong>正在加载钱包信息</strong>
          <p>余额和收款码状态确认后即可继续操作。</p>
        </div>
      </div>

      <div v-else-if="walletLoadError" class="wallet-load-state is-error">
        <el-icon class="wallet-load-icon"><Warning /></el-icon>
        <div class="wallet-load-content">
          <strong>{{ walletLoadError }}</strong>
          <p>钱包信息加载失败，暂时无法申请提现。请重新加载后再操作。</p>
          <div class="wallet-load-actions">
            <el-button type="primary" plain @click="fetchWalletSummary">重新加载</el-button>
            <el-button disabled>提现</el-button>
          </div>
        </div>
      </div>

      <div v-else class="payment-form">
        <div class="payment-type-row">
          <div>
            <span class="field-label">收款方式</span>
            <p class="field-help">
              当前保存：{{ savedPaymentTypeText }}，更换时请选择与图片一致的平台。
            </p>
          </div>
          <el-radio-group
            v-model="paymentType"
            class="payment-type-group"
            :disabled="savingQr"
          >
            <el-radio-button label="wechat">微信</el-radio-button>
            <el-radio-button label="alipay">支付宝</el-radio-button>
          </el-radio-group>
        </div>

        <div class="payment-upload-row">
          <el-upload
            ref="qrUploadRef"
            class="qr-uploader"
            drag
            accept="image/png,image/jpeg,image/webp"
            :auto-upload="false"
            :limit="1"
            :show-file-list="false"
            :on-change="handleQrChange"
            :disabled="savingQr"
          >
            <div v-if="qrPreviewUrl" class="qr-preview">
              <img :src="qrPreviewUrl" alt="待保存的收款码预览">
              <span class="qr-preview-mask">
                <el-icon><UploadFilled /></el-icon>
                点击更换图片
              </span>
            </div>
            <div v-else class="qr-upload-empty">
              <el-icon class="qr-upload-icon"><UploadFilled /></el-icon>
              <strong>{{ walletSummary.has_payment_qr ? '上传新的收款码' : '上传收款码' }}</strong>
              <span>PNG、JPEG 或 WebP，不超过 5 MB</span>
            </div>
          </el-upload>

          <div class="payment-actions-panel">
            <div>
              <span class="field-label">保存状态</span>
              <p class="field-help payment-state-copy">{{ paymentStateText }}</p>
            </div>
            <div class="wallet-actions">
              <el-button
                class="primary-action"
                type="primary"
                :loading="savingQr"
                :disabled="!qrFile || savingQr"
                @click="savePaymentQr"
              >
                <el-icon v-if="!savingQr"><Upload /></el-icon>
                {{ walletSummary.has_payment_qr ? '保存更换' : '保存收款码' }}
              </el-button>
              <el-button
                class="withdraw-action"
                :disabled="!walletSummary.has_payment_qr"
                @click="goWithdraw"
              >
                提现
                <el-icon><ArrowRight /></el-icon>
              </el-button>
            </div>
            <p v-if="!walletSummary.has_payment_qr" class="withdraw-tip">
              <el-icon><Warning /></el-icon>
              请先保存有效收款码，再申请提现。
            </p>
          </div>
        </div>
      </div>
    </section>

    <section class="content-card">
      <div class="section-head">
        <div>
          <h2 class="section-title">推广</h2>
        </div>
        <router-link to="/user/referral" class="section-link">
          <span>查看详情</span>
          <el-icon><ArrowRight /></el-icon>
        </router-link>
      </div>

      <div class="referral-overview">
        <div v-if="rewardPercent > 0" class="reward-callout">
          <div>
            <strong>邀请好友，首单奖励{{ rewardPercent }}%</strong>
            <p>邀请好友完成首购，你可获得订单实付金额{{ rewardPercent }}%的奖励余额</p>
          </div>
        </div>
        <div class="referral-stat">
          <span class="referral-stat-label">推广链接</span>
          <div class="referral-link-row">
            <span class="referral-link-text">{{ referralSummary.referral_url || '加载中...' }}</span>
            <div class="referral-actions">
              <el-button
                class="copy-button"
                size="small"
                :disabled="!referralSummary.referral_url"
                @click="showReferralPoster"
              >
                生成海报
              </el-button>
              <el-button
                class="copy-button"
                size="small"
                :disabled="!referralSummary.referral_url"
                @click="copyReferralLink"
              >
                复制链接
              </el-button>
            </div>
          </div>
        </div>

        <div class="referral-metrics">
          <div class="metric-card">
            <span class="metric-label">点击量</span>
            <span class="metric-value">{{ referralSummary.click_count || 0 }}</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">奖励总余额</span>
            <span class="metric-value">{{ rewardAmountText }}</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">奖励订单数</span>
            <span class="metric-value">{{ referralSummary.reward_count || 0 }}</span>
          </div>
        </div>
      </div>
    </section>

    <section class="content-card">
      <div class="section-head">
        <div>
          <h2 class="section-title">我的服务</h2>
        </div>
      </div>

      <div class="action-list">
        <router-link to="/user/orders" class="action-item">
          <div class="action-main">
            <span class="action-title">我的订单</span>
            <span class="action-desc">查看当前账号的套餐购买、续费和支付记录</span>
          </div>
          <el-icon><ArrowRight /></el-icon>
        </router-link>

        <router-link to="/user/tickets" class="action-item">
          <div class="action-main">
            <span class="action-title">工单支持</span>
            <span class="action-desc">提交问题、查看回复和跟进处理进度</span>
          </div>
          <div class="action-extra">
            <span v-if="unreadTicketCount > 0" class="action-badge">{{ unreadTicketCount }} 条未读</span>
            <el-icon><ArrowRight /></el-icon>
          </div>
        </router-link>

        <router-link to="/user/feedback" class="action-item">
          <div class="action-main">
            <span class="action-title">留言</span>
            <span class="action-desc">提交建议、参与优质留言投票和需求反馈</span>
          </div>
          <el-icon><ArrowRight /></el-icon>
        </router-link>

        <router-link to="/user/cf-optimize" class="action-item">
          <div class="action-main">
            <span class="action-title">线路优选</span>
            <span class="action-desc">测试并应用更优节点入口，改善连接体验</span>
          </div>
          <el-icon><ArrowRight /></el-icon>
        </router-link>
      </div>
    </section>

    <section class="content-card">
      <div class="section-head">
        <div>
          <h2 class="section-title">常用管理</h2>
        </div>
      </div>

      <div class="management-grid">
        <router-link to="/user" class="manage-tile">
          <span class="manage-title">返回首页</span>
          <span class="manage-desc">回到会员工作台</span>
        </router-link>

        <button type="button" class="manage-tile danger-tile" @click="handleLogout">
          <span class="manage-title">退出登录</span>
          <span class="manage-desc">安全退出当前账户</span>
        </button>
      </div>
    </section>

    <ReferralPosterDialog
      ref="posterDialogRef"
      :referral-url="referralSummary.referral_url || ''"
    />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowRight, CircleCheck, Loading, Upload, UploadFilled, Wallet, Warning } from '@element-plus/icons-vue'
import api from '@/api'
import ReferralPosterDialog from '@/components/ReferralPosterDialog.vue'
import { useUserStore } from '@/stores/user'
import { normalizeReferralRewardPercent } from '@/utils/referral-reward-display'

const router = useRouter()
const userStore = useUserStore()
const unreadTicketCount = ref(0)
const referralSummary = ref({})
const walletSummary = ref({})
const paymentType = ref('wechat')
const qrFile = ref(null)
const qrPreviewUrl = ref('')
const savingQr = ref(false)
const walletLoading = ref(true)
const walletLoadError = ref('')
const qrUploadRef = ref(null)
const posterDialogRef = ref(null)

const rewardAmountText = computed(() => {
  if (referralSummary.value.reward_amount_text) {
    return referralSummary.value.reward_amount_text
  }

  return formatAmount(referralSummary.value.reward_amount)
})
const rewardPercent = computed(() => normalizeReferralRewardPercent(referralSummary.value))
const walletStatusText = computed(() => {
  if (walletLoading.value) return '正在加载'
  if (walletLoadError.value) return '加载失败'
  return walletSummary.value.has_payment_qr ? '已设置收款码' : '暂未设置'
})
const walletBalanceText = computed(() => {
  if (walletSummary.value.balance_text) {
    return walletSummary.value.balance_text.replace(/元$/, ' 元')
  }

  return formatAmount(walletSummary.value.balance)
})
const walletBalanceDisplayText = computed(() => (
  walletLoading.value || walletLoadError.value ? '--' : walletBalanceText.value
))
const savedPaymentTypeText = computed(() => {
  if (!walletSummary.value.has_payment_qr) return '未设置'
  return walletSummary.value.payment_type === 'alipay' ? '支付宝' : '微信'
})
const paymentStateText = computed(() => {
  if (qrFile.value) return `已选择 ${qrFile.value.name}，保存后生效。`
  if (walletSummary.value.has_payment_qr) return `${savedPaymentTypeText.value}收款码已生效，可上传新图片更换。`
  return '请选择收款方式并上传对应的收款码图片。'
})

function formatAmount(amount) {
  const cents = Number(amount)
  if (!Number.isFinite(cents) || cents <= 0) {
    return '0.00 元'
  }

  return `${(cents / 100).toFixed(2)} 元`
}

/**
 * 获取余额与收款码公开摘要，并以服务端已保存的平台作为默认选择。
 *
 * @returns {Promise<void>}
 */
async function fetchWalletSummary() {
  walletLoading.value = true
  walletLoadError.value = ''

  try {
    const response = await api.user.getWalletSummary()
    if (response.code !== 0) {
      throw new Error('wallet summary request failed')
    }

    walletSummary.value = response.data || {}
    if (['wechat', 'alipay'].includes(walletSummary.value.payment_type)) {
      paymentType.value = walletSummary.value.payment_type
    }
  } catch (error) {
    console.error('获取钱包摘要失败:', error)
    walletLoadError.value = '钱包信息加载失败，请重试'
  } finally {
    walletLoading.value = false
  }
}

/** 释放本地图片预览地址，避免用户反复换图造成内存泄漏。 */
function revokeQrPreview() {
  if (!qrPreviewUrl.value) return
  URL.revokeObjectURL(qrPreviewUrl.value)
  qrPreviewUrl.value = ''
}

/**
 * 校验并预览用户选择的收款码；非法文件不会替换当前有效选择。
 *
 * @param {Object} uploadFile - Element Plus 上传文件对象
 */
function handleQrChange(uploadFile) {
  if (savingQr.value) return

  const rawFile = uploadFile?.raw
  const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])
  const maxFileSize = 5 * 1024 * 1024

  if (!rawFile || !allowedTypes.has(rawFile.type)) {
    ElMessage.error('仅支持 PNG、JPEG 或 WebP 格式的图片')
    qrUploadRef.value?.clearFiles()
    return
  }

  if (rawFile.size > maxFileSize) {
    ElMessage.error('收款码图片不能超过 5 MB')
    qrUploadRef.value?.clearFiles()
    return
  }

  revokeQrPreview()
  qrFile.value = rawFile
  qrPreviewUrl.value = URL.createObjectURL(rawFile)
  qrUploadRef.value?.clearFiles()
}

/**
 * 上传当前选择并刷新摘要；失败时保留文件和预览，便于直接重试。
 *
 * @returns {Promise<void>}
 */
async function savePaymentQr() {
  if (!qrFile.value || savingQr.value) return

  const submittedFile = qrFile.value
  const formData = new FormData()
  formData.append('payment_type', paymentType.value)
  formData.append('qr_code', submittedFile)
  savingQr.value = true

  try {
    const response = await api.user.savePaymentQr(formData)
    if (response.code !== 0) {
      throw new Error('payment qr save failed')
    }

    walletSummary.value = { ...walletSummary.value, ...(response.data || {}) }
    await fetchWalletSummary()
    if (qrFile.value === submittedFile) {
      qrFile.value = null
      qrUploadRef.value?.clearFiles()
      revokeQrPreview()
    }
    ElMessage.success('收款码已保存')
  } catch {
    ElMessage.error('保存失败，请检查收款码类型和图片后重试')
  } finally {
    savingQr.value = false
  }
}

/** 进入提现页面；未保存收款码时由按钮禁用状态阻止操作。 */
function goWithdraw() {
  if (!walletSummary.value.has_payment_qr) return
  router.push('/user/withdraw')
}

/**
 * 获取未读工单数量。
 *
 * @returns {Promise<void>}
 */
async function fetchUnreadCount() {
  try {
    const response = await api.user.getTicketUnreadCount()
    if (response.code === 0) {
      unreadTicketCount.value = response.data.count || 0
    }
  } catch (error) {
    console.error('获取未读工单数量失败:', error)
  }
}

/**
 * 获取推广概览，用于“我的”页面的快捷预览。
 *
 * @returns {Promise<void>}
 */
async function fetchReferralSummary() {
  try {
    const response = await api.user.getReferralSummary()
    if (response.code === 0) {
      referralSummary.value = response.data || {}
    }
  } catch (error) {
    console.error('获取推广概览失败:', error)
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
 * 复制推广链接，便于用户直接分享。
 *
 * @returns {Promise<void>}
 */
async function copyReferralLink() {
  if (!referralSummary.value.referral_url) {
    return
  }

  try {
    await copyToClipboard(referralSummary.value.referral_url)
    ElMessage.success(rewardPercent.value > 0
      ? `推广链接已复制，好友完成首购后你可获得${rewardPercent.value}%奖励`
      : '推广链接已复制')
  } catch (error) {
    console.error('复制推广链接失败:', error)
    ElMessage.error('复制失败，请手动复制')
  }
}

/** 打开共享推广海报弹窗。 */
function showReferralPoster() {
  posterDialogRef.value?.open()
}

/**
 * 退出当前登录账户。
 *
 * @returns {Promise<void>}
 */
async function handleLogout() {
  try {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })

    userStore.logout()
    router.push('/')
  } catch {
    // 用户取消操作
  }
}

onMounted(async () => {
  if (!userStore.isLoggedIn) {
    return
  }

  await Promise.allSettled([
    userStore.fetchUserProfile(),
    fetchWalletSummary(),
    fetchUnreadCount(),
    fetchReferralSummary()
  ])
})

onBeforeUnmount(() => {
  revokeQrPreview()
})
</script>

<style scoped>
.my-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.content-card {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
}

.wallet-card {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.wallet-heading,
.wallet-title-wrap,
.payment-type-row,
.payment-upload-row,
.wallet-actions {
  display: flex;
  align-items: center;
}

.wallet-heading,
.payment-type-row {
  justify-content: space-between;
  gap: 20px;
}

.wallet-title-wrap {
  min-width: 0;
  gap: 12px;
}

.wallet-title-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 38px;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  color: #2563eb;
  font-size: 20px;
  background: #eff6ff;
}

.wallet-description {
  margin: 6px 0 0;
  color: #909399;
  line-height: 1.5;
}

.wallet-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 7px 11px;
  border-radius: 999px;
  color: #d97706;
  font-size: 13px;
  background: #fffbeb;
  white-space: nowrap;
}

.wallet-status.is-ready {
  color: #0f9f72;
  background: #ecfdf5;
}

.wallet-status.is-error {
  color: #c2410c;
  background: #fff7ed;
}

.wallet-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.wallet-metric {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border-radius: 12px;
  background: #f8fafc;
}

.wallet-amount {
  color: #0f172a;
  font-size: 24px;
  line-height: 1.2;
}

.metric-hint {
  color: #909399;
  font-size: 12px;
  line-height: 1.5;
}

.payment-form {
  padding: 18px;
  border: 1px solid #ebeef5;
  border-radius: 14px;
}

.wallet-load-state {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 18px;
  border: 1px solid #dbeafe;
  border-radius: 14px;
  color: #1e40af;
  background: #eff6ff;
}

.wallet-load-state.is-error {
  border-color: #fed7aa;
  color: #c2410c;
  background: #fff7ed;
}

.wallet-load-state p {
  margin: 6px 0 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.5;
}

.wallet-load-icon {
  flex-shrink: 0;
  margin-top: 2px;
  font-size: 20px;
}

.wallet-load-content {
  min-width: 0;
}

.wallet-load-actions {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}

.field-label {
  display: block;
  color: #303133;
  font-weight: 600;
}

.field-help {
  margin: 6px 0 0;
  color: #909399;
  font-size: 13px;
  line-height: 1.5;
}

.payment-type-group {
  flex-shrink: 0;
}

.payment-form :deep(.el-radio-button__inner) {
  min-width: 84px;
  padding: 10px 18px;
}

.payment-upload-row {
  align-items: stretch;
  gap: 18px;
  margin-top: 18px;
}

.qr-uploader {
  flex: 1 1 360px;
  min-width: 0;
}

.qr-uploader :deep(.el-upload),
.qr-uploader :deep(.el-upload-dragger) {
  width: 100%;
  height: 100%;
}

.qr-uploader :deep(.el-upload-dragger) {
  min-height: 220px;
  padding: 0;
  overflow: hidden;
  border-color: #dbe2ea;
  border-radius: 12px;
  background: #fbfcfe;
}

.qr-uploader :deep(.el-upload-dragger:hover) {
  border-color: #409eff;
}

.qr-upload-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 220px;
  gap: 10px;
  color: #606266;
}

.qr-upload-empty span {
  color: #909399;
  font-size: 13px;
}

.qr-upload-icon {
  color: #409eff;
  font-size: 34px;
}

.qr-preview {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 220px;
  padding: 14px;
  background: #f8fafc;
}

.qr-preview img {
  display: block;
  width: 190px;
  max-width: 100%;
  height: 190px;
  object-fit: contain;
  border-radius: 8px;
}

.qr-preview-mask {
  position: absolute;
  inset: auto 12px 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 8px;
  color: #fff;
  font-size: 13px;
  background: rgba(15, 23, 42, 0.78);
}

.payment-actions-panel {
  display: flex;
  flex: 0 1 340px;
  min-width: 260px;
  flex-direction: column;
  justify-content: space-between;
  gap: 18px;
  padding: 18px;
  border-radius: 12px;
  background: #f8fafc;
}

.payment-state-copy {
  min-height: 42px;
  word-break: break-all;
}

.wallet-actions {
  align-items: stretch;
  gap: 10px;
}

.wallet-actions .el-button {
  min-height: 42px;
  margin-left: 0;
  border-radius: 10px;
}

.primary-action {
  flex: 1;
  border: none;
  font-weight: 700;
  background: linear-gradient(135deg, #2563eb 0%, #14b8a6 100%);
  box-shadow: 0 10px 22px rgba(37, 99, 235, 0.2);
}

.primary-action:hover,
.primary-action:focus-visible {
  background: linear-gradient(135deg, #1d4ed8 0%, #0f9f94 100%);
}

.primary-action.is-disabled,
.primary-action.is-disabled:hover {
  background: #cbd5e1;
  box-shadow: none;
}

.withdraw-action {
  flex: 0 0 104px;
}

.withdraw-tip {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: -8px 0 0;
  color: #d97706;
  font-size: 12px;
  line-height: 1.5;
}

.withdraw-tip .el-icon {
  flex-shrink: 0;
  margin-top: 2px;
}

.section-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  border-radius: 999px;
  color: #409eff;
  text-decoration: none;
  background: #ecf5ff;
  white-space: nowrap;
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.section-title {
  margin: 0;
  font-size: 18px;
  color: #303133;
}

.referral-overview {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.reward-callout {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px;
  border: 1px solid rgba(37, 99, 235, 0.1);
  border-radius: 14px;
  background: linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%);
}

.reward-callout strong {
  color: #0f172a;
  font-size: 18px;
}

.reward-callout p {
  margin: 6px 0 0;
  color: #64748b;
  line-height: 1.5;
}

.referral-stat {
  padding: 16px;
  border-radius: 14px;
  background: linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%);
}

.referral-stat-label {
  display: block;
  margin-bottom: 10px;
  color: #606266;
  font-size: 13px;
}

.referral-link-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.referral-link-text {
  flex: 1;
  min-width: 0;
  color: #303133;
  font-weight: 600;
  word-break: break-all;
}

.referral-actions {
  display: flex;
  flex-shrink: 0;
  gap: 10px;
}

.copy-button {
  flex-shrink: 0;
  min-width: 84px;
  height: 40px;
  padding: 0 18px;
  border: none;
  border-radius: 999px;
  color: #fff;
  font-weight: 700;
  background: linear-gradient(135deg, #2563eb 0%, #14b8a6 100%);
  box-shadow: 0 14px 30px rgba(37, 99, 235, 0.22);
}

.copy-button:hover,
.copy-button:focus-visible {
  color: #fff;
  background: linear-gradient(135deg, #1d4ed8 0%, #0f9f94 100%);
}

.copy-button.is-disabled,
.copy-button.is-disabled:hover {
  color: rgba(255, 255, 255, 0.78);
  background: linear-gradient(135deg, #94a3b8 0%, #cbd5e1 100%);
  box-shadow: none;
}

.referral-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.metric-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: 12px;
  background: #f8fafc;
}

.metric-label {
  color: #909399;
  font-size: 13px;
}

.metric-value {
  color: #303133;
  font-size: 20px;
  font-weight: 600;
}

.action-list {
  display: flex;
  flex-direction: column;
}

.action-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 0;
  color: #303133;
  text-decoration: none;
  border-bottom: 1px solid #f0f2f5;
}

.action-item:last-child {
  padding-bottom: 0;
  border-bottom: none;
}

.action-item:first-child {
  padding-top: 0;
}

.action-main {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.action-title {
  font-weight: 600;
}

.action-desc {
  color: #909399;
  line-height: 1.5;
}

.action-extra {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.action-badge {
  padding: 4px 10px;
  border-radius: 999px;
  background: #fff1f0;
  color: #f56c6c;
  font-size: 12px;
}

.management-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.manage-tile {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 18px;
  border: 1px solid #ebeef5;
  border-radius: 14px;
  background: #fff;
  color: #303133;
  text-decoration: none;
  text-align: left;
  cursor: pointer;
}

.danger-tile {
  color: #f56c6c;
  border-color: #fbc4c4;
}

.manage-title {
  font-size: 16px;
  font-weight: 600;
}

.manage-desc {
  color: #909399;
  line-height: 1.5;
}

@media (max-width: 1024px) {
  .management-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 860px) {
  .payment-upload-row {
    flex-direction: column;
    align-items: stretch;
  }

  .qr-uploader,
  .payment-actions-panel {
    flex: 1 1 auto;
    min-width: 0;
    width: 100%;
  }
}

@media (max-width: 768px) {
  .my-container {
    gap: 14px;
  }

  .wallet-heading,
  .payment-type-row,
  .payment-upload-row,
  .section-head,
  .referral-link-row,
  .reward-callout {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .content-card {
    border-radius: 8px;
    padding: 15px;
  }

  .wallet-card,
  .referral-overview {
    gap: 14px;
  }

  .section-link {
    min-height: 38px;
    padding: 8px 12px;
    border-radius: 14px;
  }

  .wallet-metrics,
  .management-grid,
  .referral-metrics {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .wallet-metric,
  .metric-card {
    gap: 6px;
    padding: 13px 14px;
    border-radius: 11px;
  }

  .metric-label,
  .referral-stat-label,
  .action-desc,
  .manage-desc {
    font-size: 13px;
  }

  .metric-value {
    font-size: 18px;
  }

  .section-head {
    margin-bottom: 12px;
  }

  .section-title {
    font-size: 17px;
  }

  .section-link {
    width: 100%;
    justify-content: center;
  }

  .wallet-title-wrap {
    align-items: flex-start;
  }

  .wallet-status {
    margin-left: 50px;
  }

  .wallet-amount {
    font-size: 21px;
  }

  .payment-form {
    padding: 13px;
    border-radius: 12px;
  }

  .wallet-load-state {
    padding: 14px;
    border-radius: 12px;
  }

  .wallet-load-actions {
    flex-direction: column;
  }

  .wallet-load-actions .el-button {
    width: 100%;
    margin-left: 0;
  }

  .payment-type-row,
  .payment-upload-row {
    align-items: stretch;
  }

  .payment-type-group {
    display: flex;
    width: 100%;
  }

  .payment-type-group :deep(.el-radio-button) {
    flex: 1;
  }

  .payment-form :deep(.el-radio-button__inner) {
    width: 100%;
    min-width: 0;
  }

  .payment-upload-row {
    margin-top: 14px;
  }

  .qr-uploader,
  .payment-actions-panel {
    flex: 1 1 auto;
    min-width: 0;
    width: 100%;
  }

  .qr-uploader :deep(.el-upload-dragger),
  .qr-upload-empty,
  .qr-preview {
    min-height: 190px;
  }

  .qr-preview img {
    width: 160px;
    height: 160px;
  }

  .payment-actions-panel {
    padding: 14px;
  }

  .wallet-actions {
    flex-direction: column;
  }

  .wallet-actions .el-button,
  .withdraw-action {
    flex: 1 1 auto;
    width: 100%;
  }

  .referral-link-row {
    align-items: stretch;
  }

  .referral-stat {
    padding: 13px;
    border-radius: 12px;
  }

  .referral-stat-label {
    margin-bottom: 8px;
  }

  .referral-link-text {
    line-height: 1.35;
  }

  .referral-actions {
    width: 100%;
    gap: 10px;
  }

  .copy-button {
    flex: 1;
    width: 0;
    min-width: 0;
    height: 36px;
    padding: 0 14px;
    justify-content: center;
    margin-left: 0;
  }

  .action-item {
    align-items: center;
    gap: 12px;
    padding: 13px 0;
  }

  .action-main {
    gap: 5px;
  }

  .action-desc,
  .manage-desc {
    line-height: 1.4;
  }

  .action-extra {
    align-self: center;
  }

  .management-grid {
    gap: 10px;
  }

  .manage-tile {
    gap: 6px;
    padding: 14px;
    border-radius: 12px;
  }

  .manage-title {
    font-size: 15px;
  }
}
</style>
