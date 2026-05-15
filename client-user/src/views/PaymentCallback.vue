<template>
  <div class="payment-callback-container">
    <div class="callback-card">
      <div v-if="loading" class="loading-state">
        <el-icon class="loading-icon"><Loading /></el-icon>
        <h2>正在确认支付状态...</h2>
        <p>请完成付款，系统会自动刷新当前订单状态。</p>
      </div>

      <div v-else-if="paymentSuccess" class="success-state">
        <el-icon class="success-icon"><CircleCheck /></el-icon>
        <h2>支付成功</h2>
        <p>{{ successMessage }}</p>
        <el-button type="primary" size="large" @click="goAfterSuccess">
          继续前往
        </el-button>
      </div>

      <div v-else class="pending-state">
        <el-icon class="pending-icon"><Wallet /></el-icon>
        <h2>等待支付完成</h2>
        <p class="state-text">{{ errorMessage || `请使用` }}<span class="pay-type-name" v-if="!errorMessage">{{ payTypeName }}</span>{{ errorMessage ? '' : `扫码支付，系统会自动确认付款结果。` }}</p>
        
        <div v-if="paymentUrl && countdown > 0" class="payment-actions">
          <div class="qr-panel">
            <img v-if="qrCodeDataUrl" :src="qrCodeDataUrl" alt="支付二维码" class="qr-image" />
            <div v-else class="qr-fallback">
              二维码生成失败
            </div>
          </div>
          <div class="countdown-section">
            <p class="countdown-text">支付剩余时间：<span class="countdown-value">{{ formatCountdown }}</span></p>
          </div>
        </div>
        
        <div v-if="countdown <= 0 && !paymentSuccess" class="expired-state">
          <p class="expired-text">支付超时，请返回重新下单</p>
        </div>

        <el-button size="large" @click="retryCheck" v-if="countdown > 0">
          重新检查支付状态
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * 支付结果页组件
 * 展示支付二维码并轮询订单状态，支付完成后自动尝试登录
 */

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Loading, CircleCheck, Wallet } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import QRCode from 'qrcode'
import api from '@/api'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

const loading = ref(true)
const paymentSuccess = ref(false)
const errorMessage = ref('')
const successMessage = ref('您的订阅已激活，正在为您跳转。')
const timer = ref(null)
const qrCodeDataUrl = ref('')
const countdown = ref(300) // 5分钟倒计时
const countdownTimer = ref(null)
// 自动轮询间隔 5 秒
const pollInterval = 5000
const isPageVisible = ref(true)

const paymentUrl = computed(() => String(route.query.payment_url || ''))
const orderId = computed(() => String(route.query.order_id || ''))
const payType = computed(() => Number(route.query.pay_type || 2))

// 支付方式名称
const payTypeName = computed(() => {
  return payType.value === 1 ? '微信' : '支付宝'
})

// 格式化倒计时
const formatCountdown = computed(() => {
  const minutes = Math.floor(countdown.value / 60)
  const seconds = countdown.value % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
})

/**
 * 根据支付链接生成二维码
 * 本地生成可减少对外部二维码服务的依赖
 */
async function generateQrCode() {
  if (!paymentUrl.value) {
    qrCodeDataUrl.value = ''
    return
  }

  try {
    qrCodeDataUrl.value = await QRCode.toDataURL(paymentUrl.value, {
      width: 280,
      margin: 2,
      color: {
        dark: '#111827',
        light: '#ffffff'
      }
    })
  } catch (error) {
    console.error('生成二维码失败:', error)
    qrCodeDataUrl.value = ''
  }
}

/**
 * 检查支付状态
 * 支付页使用公共查单接口，未登录用户也能轮询订单状态
 */
async function checkPaymentStatus() {
  if (!orderId.value) {
    errorMessage.value = '缺少订单参数'
    loading.value = false
    return
  }

  try {
    const response = await api.user.getPublicOrderStatus(orderId.value)
    if (response.code !== 0) {
      throw new Error(response.message || '支付状态查询失败')
    }

    const status = response.data.status
    if (status === 'paid') {
      paymentSuccess.value = true
      loading.value = false
      await tryAutoLogin()

      timer.value = setTimeout(() => {
        goAfterSuccess()
      }, 2000)
      return
    }

    if (status === 'expired') {
      errorMessage.value = '订单已过期，请返回重新下单'
      loading.value = false
      return
    }

    loading.value = false
    scheduleNextCheck()
  } catch (error) {
    console.error('检查支付状态失败:', error)
    errorMessage.value = '支付状态检查失败，请稍后重试'
    loading.value = false
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    isPageVisible.value = true
    checkPaymentStatus()
  } else {
    isPageVisible.value = false
    clearTimer()
  }
}

/**
 * 安排下一次静默轮询
 * 不切回整页 loading，避免页面闪烁
 */
function scheduleNextCheck() {
  clearTimer()
  if (isPageVisible.value) {
    timer.value = setTimeout(() => {
      checkPaymentStatus()
    }, pollInterval)
  }
}

/**
 * 支付完成后自动登录
 * 使用注册阶段暂存的凭据，减少用户再次输入密码
 */
async function tryAutoLogin() {
  const cached = sessionStorage.getItem('pending_payment_login')
  if (!cached) {
    successMessage.value = '支付成功，请登录后查看订阅信息。'
    return
  }

  try {
    const credentials = JSON.parse(cached)
    const result = await userStore.login(credentials)
    if (result.success) {
      sessionStorage.removeItem('pending_payment_login')
      successMessage.value = '支付成功，已自动登录。'
    } else {
      successMessage.value = '支付成功，请手动登录后查看订阅信息。'
    }
  } catch (error) {
    console.error('自动登录失败:', error)
    successMessage.value = '支付成功，请手动登录后查看订阅信息。'
  }
}

/**
 * 手动重新查单
 * 保持即时反馈，不受定时轮询间隔限制
 */
function retryCheck() {
  errorMessage.value = ''
  checkPaymentStatus()
}

function goAfterSuccess() {
  if (userStore.isLoggedIn) {
    router.push('/user')
  } else {
    router.push('/login')
  }
}

function clearTimer() {
  if (timer.value) {
    clearTimeout(timer.value)
    timer.value = null
  }
}

function clearCountdownTimer() {
  if (countdownTimer.value) {
    clearInterval(countdownTimer.value)
    countdownTimer.value = null
  }
}

function startCountdown() {
  countdownTimer.value = setInterval(() => {
    if (isPageVisible.value && countdown.value > 0) {
      countdown.value--
    } else if (countdown.value <= 0) {
      clearCountdownTimer()
      clearTimer()
    }
  }, 1000)
}

onMounted(() => {
  generateQrCode()
  checkPaymentStatus()
  startCountdown()
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

watch(paymentUrl, () => {
  generateQrCode()
})

onBeforeUnmount(() => {
  clearTimer()
  clearCountdownTimer()
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>

<style scoped>
.payment-callback-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 20px;
}

.callback-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  width: 100%;
  max-width: 560px;
  padding: 48px 40px;
  text-align: center;
}

.loading-state,
.success-state,
.pending-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
}

.loading-icon {
  font-size: 64px;
  color: #409eff;
  animation: spin 2s linear infinite;
}

.success-icon {
  font-size: 64px;
  color: #67c23a;
}

.pending-icon {
  font-size: 64px;
  color: #e6a23c;
}

.state-text {
  color: #666;
  line-height: 1.6;
}

.pay-type-name {
  color: #409eff;
  font-weight: 600;
}

.payment-actions {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.qr-panel {
  width: 100%;
  display: flex;
  justify-content: center;
}

.qr-image,
.qr-fallback {
  width: 280px;
  height: 280px;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  background: #fff;
}

.qr-image {
  object-fit: contain;
  padding: 12px;
}

.qr-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6b7280;
  line-height: 1.6;
  padding: 24px;
}

.button-row {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
}

.countdown-section {
  margin: 5px 0;
}

.countdown-text {
  color: #666;
  font-size: 14px;
  margin: 0;
}

.countdown-value {
  color: #e6a23c;
  font-weight: 600;
  font-size: 18px;
}

.expired-state {
  margin: 10px 0;
}

.expired-text {
  color: #f56c6c;
  font-size: 16px;
  margin: 0;
}

h2 {
  font-size: 24px;
  color: #333;
  margin: 0;
}

p {
  color: #666;
  font-size: 16px;
  margin: 0;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}
</style>
