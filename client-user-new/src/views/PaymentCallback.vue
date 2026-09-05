<template>
  <div class="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8 dark:bg-gray-950">
    <section class="w-full max-w-xl rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-theme-sm dark:border-gray-800 dark:bg-gray-900 sm:p-8">
      <div
        class="mx-auto flex size-16 items-center justify-center rounded-2xl"
        :class="paymentSuccess
          ? 'bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-400'
          : 'bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-400'"
      >
        <CircleCheck v-if="paymentSuccess" class="size-8" />
        <WalletCards v-else class="size-8" />
      </div>

      <h1 class="mt-6 text-2xl font-bold text-gray-900 dark:text-white/90">
        {{ title }}
      </h1>
      <p class="mt-3 text-sm leading-6 text-gray-500 dark:text-gray-400">
        {{ description }}
      </p>

      <div v-if="paymentUrl && !paymentSuccess && countdown > 0" class="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-white/[0.03]">
        <div class="mx-auto mb-4 flex size-[240px] items-center justify-center rounded-2xl border border-gray-200 bg-white p-3 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
          <img
            v-if="qrCodeDataUrl"
            :src="qrCodeDataUrl"
            alt="支付二维码"
            class="size-full object-contain"
          />
          <span v-else class="text-sm text-gray-500 dark:text-gray-400">二维码生成中...</span>
        </div>

        <p class="text-sm text-gray-500 dark:text-gray-400">
          支付剩余时间
          <span class="font-bold text-warning-600 dark:text-warning-400">{{ formatCountdown }}</span>
        </p>
      </div>

      <div
        v-if="errorMessage"
        class="mt-5 rounded-xl border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300"
      >
        {{ errorMessage }}
      </div>

      <div class="mt-6 flex flex-col gap-3 sm:flex-row">
        <button
          v-if="!paymentSuccess && countdown > 0"
          type="button"
          class="inline-flex min-h-12 w-full flex-none items-center justify-center rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 sm:h-11 sm:flex-1 sm:py-0"
          @click="retryCheck"
        >
          重新检查支付状态
        </button>
        <button
          type="button"
          class="inline-flex min-h-12 w-full flex-none items-center justify-center rounded-lg bg-brand-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-600 sm:h-11 sm:flex-1 sm:py-0"
          @click="goAfterSuccess"
        >
          {{ paymentSuccess ? '继续前往' : '返回套餐页' }}
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CircleCheck, WalletCards } from 'lucide-vue-next'
import QRCode from 'qrcode'
import api from '@/api'
import { useUserStore } from '@/stores/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const loading = ref(true)
const paymentSuccess = ref(false)
const errorMessage = ref('')
const successMessage = ref('您的订阅已激活，正在为您跳转。')
const qrCodeDataUrl = ref('')
const countdown = ref(300)
const timer = ref<number | null>(null)
const countdownTimer = ref<number | null>(null)
const paymentStartAt = ref(0)
const pollInterval = 5000

const paymentUrl = computed(() => String(route.query.payment_url || ''))
const orderId = computed(() => String(route.query.order_id || ''))
const payType = computed(() => Number(route.query.pay_type || 2))
const payTypeName = computed(() => (payType.value === 1 ? '微信' : '支付宝'))

const title = computed(() => {
  if (paymentSuccess.value) return '支付成功'
  if (countdown.value <= 0) return '支付已超时'
  return '等待支付完成'
})

const description = computed(() => {
  if (paymentSuccess.value) return successMessage.value
  if (countdown.value <= 0) return '订单支付时间已结束，请返回套餐页重新下单。'
  return `请完成${payTypeName.value}支付，系统会自动确认付款结果。`
})

const formatCountdown = computed(() => {
  const minutes = Math.floor(countdown.value / 60)
  const seconds = countdown.value % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
})

/**
 * 检查订单支付状态。
 *
 * 职责：通过公共查单接口轮询首单支付结果。
 * 关键参数：无，订单号来自路由 query。
 * 核心分支：paid 时自动登录，expired 或倒计时结束时停止轮询。
 */
async function checkPaymentStatus() {
  if (!orderId.value) {
    loading.value = false
    errorMessage.value = '缺少订单参数'
    return
  }

  if (countdown.value <= 0 && !paymentSuccess.value) {
    setExpiredState()
    return
  }

  try {
    loading.value = true
    const response = await api.user.getPublicOrderStatus(orderId.value)

    if (response.data.status === 'paid') {
      paymentSuccess.value = true
      errorMessage.value = ''
      clearPaymentSession()
      await tryAutoLogin()
      scheduleSuccessRedirect()
      return
    }

    if (response.data.status === 'expired') {
      clearPaymentSession()
      setExpiredState()
      return
    }

    scheduleNextCheck()
  } catch (error) {
    console.error('检查支付状态失败:', error)
    errorMessage.value = '支付状态检查失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

/**
 * 支付完成后尝试自动登录。
 *
 * 职责：复用注册购买阶段暂存的邮箱密码，减少用户二次输入。
 * 关键参数：无，凭据来自 sessionStorage。
 * 核心分支：登录成功进入个人中心，失败则提示用户手动登录。
 */
async function tryAutoLogin() {
  if (userStore.isLoggedIn.value) {
    await userStore.fetchUserProfile()
    successMessage.value = '支付成功，续费已完成。'
    return
  }

  const cached = sessionStorage.getItem('pending_payment_login')
  if (!cached) {
    successMessage.value = '支付成功，请登录后查看订阅信息。'
    return
  }

  try {
    const credentials = JSON.parse(cached) as { email: string; password: string }
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
 * 恢复支付页倒计时。
 *
 * 职责：刷新页面后继续沿用同一订单的五分钟支付窗口。
 * 关键参数：无，缓存 key 由订单号派生。
 * 核心分支：已有缓存按 elapsed 扣减，无缓存则从当前时间开始。
 */
function restorePaymentSession() {
  const now = Date.now()
  const key = getPaymentSessionKey()
  const cached = key ? sessionStorage.getItem(key) : ''
  const startAt = cached ? Number(JSON.parse(cached).startAt || 0) : 0
  paymentStartAt.value = startAt > 0 ? startAt : now

  if (key) {
    sessionStorage.setItem(key, JSON.stringify({ startAt: paymentStartAt.value }))
  }

  const elapsedSeconds = Math.floor((now - paymentStartAt.value) / 1000)
  countdown.value = Math.max(0, 300 - elapsedSeconds)
}

/**
 * 生成当前订单的支付会话缓存键。
 *
 * 职责：隔离不同订单的倒计时缓存。
 * 关键参数：无，读取 route query 中的订单号。
 * 核心分支：无订单号时返回空字符串，调用方跳过缓存。
 */
function getPaymentSessionKey() {
  return orderId.value ? `payment_callback_session_${orderId.value}` : ''
}

function clearPaymentSession() {
  const key = getPaymentSessionKey()
  if (key) {
    sessionStorage.removeItem(key)
  }
}

/**
 * 根据支付链接生成本地二维码。
 *
 * 职责：沿用旧版 client-user 的 qrcode 方案，把后端 payment_url 转成可扫码图片。
 * 关键参数：无，读取当前路由 query 中的 payment_url。
 * 核心分支：没有支付链接时清空二维码，生成失败时只保留后台轮询。
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
        light: '#ffffff',
      },
    })
  } catch (error) {
    console.error('生成二维码失败:', error)
    qrCodeDataUrl.value = ''
  }
}

function setExpiredState() {
  clearTimer()
  clearCountdownTimer()
  loading.value = false
  countdown.value = 0
  errorMessage.value = '支付超时，请返回重新下单'
}

function scheduleNextCheck() {
  clearTimer()
  timer.value = window.setTimeout(() => {
    checkPaymentStatus()
  }, pollInterval)
}

function scheduleSuccessRedirect() {
  clearTimer()
  clearCountdownTimer()
  timer.value = window.setTimeout(() => {
    goAfterSuccess()
  }, 2000)
}

function retryCheck() {
  errorMessage.value = ''
  checkPaymentStatus()
}

function goAfterSuccess() {
  if (paymentSuccess.value && userStore.isLoggedIn.value) {
    router.push('/profile')
    return
  }

  if (paymentSuccess.value) {
    router.push('/signin')
    return
  }

  router.push('/')
}

function startCountdown() {
  clearCountdownTimer()
  countdownTimer.value = window.setInterval(() => {
    if (countdown.value > 0) {
      countdown.value -= 1
      return
    }

    setExpiredState()
  }, 1000)
}

function clearTimer() {
  if (timer.value) {
    window.clearTimeout(timer.value)
    timer.value = null
  }
}

function clearCountdownTimer() {
  if (countdownTimer.value) {
    window.clearInterval(countdownTimer.value)
    countdownTimer.value = null
  }
}

onMounted(() => {
  restorePaymentSession()
  generateQrCode()
  if (countdown.value <= 0) {
    setExpiredState()
    return
  }

  startCountdown()
  checkPaymentStatus()
})

watch(paymentUrl, () => {
  generateQrCode()
})

onBeforeUnmount(() => {
  clearTimer()
  clearCountdownTimer()
})
</script>
