<template>
  <FullScreenLayout>
    <div class="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8 dark:bg-gray-950 sm:px-6">
      <div class="mx-auto grid w-full max-w-6xl items-start gap-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-stretch">
        <section class="rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-sm dark:border-gray-800 dark:bg-gray-900 sm:p-8">
          <router-link
            to="/"
            class="mb-8 inline-flex items-center gap-2 text-sm font-medium text-gray-500 transition hover:text-gray-800 dark:text-gray-400 dark:hover:text-white/90"
          >
            <ArrowLeft class="size-4" />
            返回套餐选择
          </router-link>

          <div class="mb-7">
            <h1 class="text-2xl font-bold text-gray-900 dark:text-white/90 md:text-3xl">
              {{ isRegisterMode ? '填写账号信息' : '登录您的账号' }}
            </h1>
            <p class="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">
              {{ isRegisterMode ? '账号会在支付成功后自动激活，未付款前无法登录。' : '请输入已激活账号的邮箱和密码。' }}
            </p>
          </div>

          <form class="space-y-5" @submit.prevent="handleSubmit">
            <div>
              <label for="email" class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                邮箱 <span class="text-error-500">*</span>
              </label>
              <input
                v-model.trim="form.email"
                id="email"
                type="email"
                autocomplete="email"
                placeholder="请输入邮箱"
                class="dark:bg-dark-900 h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
              />
            </div>

            <div>
              <label for="password" class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                密码 <span class="text-error-500">*</span>
              </label>
              <div class="relative">
                <input
                  v-model="form.password"
                  id="password"
                  :type="showPassword ? 'text' : 'password'"
                  autocomplete="current-password"
                  placeholder="请输入密码"
                  class="dark:bg-dark-900 h-11 w-full rounded-lg border border-gray-300 bg-transparent py-2.5 pl-4 pr-11 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
                />
                <button
                  type="button"
                  class="absolute right-3 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.05]"
                  @click="showPassword = !showPassword"
                >
                  <EyeOff v-if="showPassword" class="size-4" />
                  <Eye v-else class="size-4" />
                </button>
              </div>
              <p v-if="isRegisterMode" class="mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400">
                密码需至少 8 位，并同时包含字母和数字。
              </p>
            </div>

            <div v-if="isRegisterMode">
              <label for="confirm-password" class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                确认密码 <span class="text-error-500">*</span>
              </label>
              <div class="relative">
                <input
                  v-model="form.confirmPassword"
                  id="confirm-password"
                  :type="showConfirmPassword ? 'text' : 'password'"
                  autocomplete="new-password"
                  placeholder="请再次输入密码"
                  class="dark:bg-dark-900 h-11 w-full rounded-lg border border-gray-300 bg-transparent py-2.5 pl-4 pr-11 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
                />
                <button
                  type="button"
                  class="absolute right-3 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.05]"
                  @click="showConfirmPassword = !showConfirmPassword"
                >
                  <EyeOff v-if="showConfirmPassword" class="size-4" />
                  <Eye v-else class="size-4" />
                </button>
              </div>
            </div>

            <div v-if="isRegisterMode" class="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-white/[0.03]">
              <h2 class="text-base font-bold text-gray-900 dark:text-white/90">支付方式</h2>
              <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label
                  v-for="method in paymentMethods"
                  :key="method.value"
                  class="flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition"
                  :class="form.pay_type === method.value
                    ? 'border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300'"
                >
                  <input v-model="form.pay_type" class="sr-only" type="radio" :value="method.value" />
                  <span class="inline-flex size-10 items-center justify-center rounded-xl text-sm font-bold text-white" :class="method.iconClass">
                    {{ method.shortName }}
                  </span>
                  <span class="font-semibold">{{ method.label }}</span>
                </label>
              </div>
            </div>

            <div
              v-if="message"
              class="rounded-xl border px-4 py-3 text-sm"
              :class="messageType === 'error'
                ? 'border-error-200 bg-error-50 text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300'
                : 'border-success-200 bg-success-50 text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-300'"
            >
              {{ message }}
            </div>

            <button
              type="submit"
              class="inline-flex h-12 w-full items-center justify-center rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white shadow-theme-xs transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
              :disabled="loading || (isRegisterMode && planInfo.isSoldout)"
            >
              {{ submitText }}
            </button>
          </form>

          <div class="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm">
            <template v-if="!isRegisterMode">
              <router-link to="/forgot-password" class="font-medium text-error-500 transition hover:text-error-600">
                忘记密码？
              </router-link>
              <span class="h-4 w-px bg-gray-200 dark:bg-gray-700"></span>
              <span class="text-gray-500 dark:text-gray-400">还没有账户？</span>
              <router-link to="/" class="font-medium text-brand-600 transition hover:text-brand-700 dark:text-brand-400">
                返回首页选择套餐
              </router-link>
            </template>
            <button v-else type="button" class="font-medium text-brand-600 transition hover:text-brand-700 dark:text-brand-400" @click="switchToLogin">
              已有账号，直接登录
            </button>
            <span v-if="onlineCustomerServiceUrl" class="h-4 w-px bg-gray-200 dark:bg-gray-700"></span>
            <a
              v-if="onlineCustomerServiceUrl"
              :href="onlineCustomerServiceUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="font-medium text-blue-light-600 transition hover:text-blue-light-700 dark:text-blue-light-400"
            >
              联系我们
            </a>
          </div>
        </section>

        <aside class="flex rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-sm dark:border-gray-800 dark:bg-gray-900 sm:p-8">
          <template v-if="isRegisterMode">
            <div class="flex w-full flex-col justify-center">
              <span class="inline-flex w-fit rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-500 dark:bg-brand-500/15 dark:text-brand-400">
                确认订单
              </span>
              <div class="mt-5 rounded-2xl bg-gray-950 p-5 text-white">
                <div class="flex items-start justify-between gap-4">
                  <div class="min-w-0">
                    <p class="text-xs text-white/55">套餐名称</p>
                    <h2 class="mt-2 break-words text-2xl font-bold">{{ planInfo.name }}</h2>
                  </div>
                  <div class="shrink-0 text-right text-brand-300">
                    <p class="text-xs text-white/55">价格</p>
                    <p class="mt-1 text-3xl font-bold">￥{{ planInfo.price }}</p>
                  </div>
                </div>

                <div class="mt-5 grid grid-cols-2 gap-3">
                  <div class="rounded-xl border border-white/10 bg-white/5 p-3">
                    <p class="text-xs text-white/55">流量</p>
                    <p class="mt-2 font-bold">{{ planInfo.traffic }}</p>
                  </div>
                  <div class="rounded-xl border border-white/10 bg-white/5 p-3">
                    <p class="text-xs text-white/55">时长</p>
                    <p class="mt-2 font-bold">{{ planInfo.duration }}</p>
                  </div>
                </div>

                <p v-if="planInfo.isSoldout" class="mt-4 rounded-xl border border-error-400/30 bg-error-500/15 p-3 text-sm text-error-200">
                  该套餐已售罄，暂时无法继续创建订单。
                </p>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="flex w-full flex-col justify-center">
              <h2 class="text-3xl font-bold text-gray-900 dark:text-white/90">已激活账号才能登录</h2>
              <div class="mt-5 space-y-3">
                <div class="rounded-xl bg-gray-50 p-4 dark:bg-white/[0.03]">
                  <p class="font-semibold text-gray-900 dark:text-white/90">先选择套餐</p>
                  <p class="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
                    新账号只能从套餐页进入购买注册流程，避免自由注册入口被滥用。
                  </p>
                </div>
                <div class="rounded-xl bg-gray-50 p-4 dark:bg-white/[0.03]">
                  <p class="font-semibold text-gray-900 dark:text-white/90">支付后激活</p>
                  <p class="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
                    订单支付成功后系统会激活账号，并自动尝试登录。
                  </p>
                </div>
              </div>
            </div>
          </template>
        </aside>
      </div>
    </div>
  </FullScreenLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Eye, EyeOff } from 'lucide-vue-next'
import FullScreenLayout from '@/components/layout/FullScreenLayout.vue'
import api from '@/api'
import { useUserStore } from '@/stores/user'

type MessageType = 'error' | 'success'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const loading = ref(false)
const showPassword = ref(false)
const showConfirmPassword = ref(false)
const message = ref('')
const messageType = ref<MessageType>('error')
const onlineCustomerServiceUrl = ref('')

const form = reactive({
  email: '',
  password: '',
  confirmPassword: '',
  pay_type: 1,
})

const paymentMethods = [
  { value: 2, label: '支付宝', shortName: '支', iconClass: 'bg-blue-500' },
  { value: 1, label: '微信支付', shortName: '微', iconClass: 'bg-success-500' },
]

const selectedPlanId = computed(() => {
  const planId = Number(route.query.plan_id || 0)
  return planId > 0 ? planId : null
})

const isRegisterMode = computed(() => Boolean(selectedPlanId.value))

const referralCode = computed(() => String(route.query.ref || sessionStorage.getItem('referral_code') || '').trim())

const planInfo = computed(() => ({
  name: String(route.query.plan_name || '未知套餐'),
  price: String(route.query.plan_price || '0.00'),
  traffic: String(route.query.plan_traffic || '0 B'),
  duration: Number(route.query.plan_duration) === 0 ? '不限时' : `${route.query.plan_duration || '0'} 天`,
  isSoldout: route.query.plan_soldout === '1',
}))

const submitText = computed(() => {
  if (loading.value) return '处理中...'
  if (isRegisterMode.value && planInfo.value.isSoldout) return '套餐已售罄'
  return isRegisterMode.value ? '提交并前往支付' : '登录'
})

const passwordPattern = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/

/**
 * 展示页面内反馈信息。
 *
 * 职责：用新版页面状态块替代旧版 Element Plus Message。
 * 关键参数：text 为展示文案，type 控制成功或错误样式。
 * 核心分支：后续提交会覆盖前一次消息。
 */
function setMessage(text: string, type: MessageType = 'error') {
  message.value = text
  messageType.value = type
}

/**
 * 校验登录或注册购买表单。
 *
 * 职责：在调用 API 前完成前端最小校验，减少无效请求。
 * 关键参数：无，读取当前响应式表单和模式状态。
 * 核心分支：注册购买模式额外校验密码强度、确认密码、套餐售罄与支付方式。
 */
function validateForm() {
  if (!form.email) return '请输入邮箱'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return '请输入有效的邮箱地址'
  if (!form.password) return '请输入密码'

  if (isRegisterMode.value) {
    if (!passwordPattern.test(form.password)) return '密码需至少8位，并同时包含字母和数字'
    if (!form.confirmPassword) return '请再次输入密码'
    if (form.confirmPassword !== form.password) return '两次输入的密码不一致'
    if (planInfo.value.isSoldout) return '该套餐已售罄'
    if (![1, 2].includes(Number(form.pay_type))) return '请选择支付方式'
  }

  return ''
}

/**
 * 提交登录或注册购买。
 *
 * 职责：沿用旧版流程，登录写入 token，注册购买创建订单后进入支付回调页。
 * 关键参数：无，读取当前表单、套餐 query 和推广码缓存。
 * 核心分支：isRegisterMode 为 true 调 registerAndPay，否则调 login。
 */
async function handleSubmit() {
  const error = validateForm()
  if (error) {
    setMessage(error)
    return
  }

  loading.value = true
  message.value = ''

  try {
    if (isRegisterMode.value && selectedPlanId.value) {
      const result = await userStore.registerAndPay({
        email: form.email,
        password: form.password,
        plan_id: selectedPlanId.value,
        pay_type: Number(form.pay_type),
        referral_code: referralCode.value || undefined,
      })

      if (!result.success || !result.data) {
        setMessage(result.message || '注册失败')
        return
      }

      sessionStorage.setItem('pending_payment_login', JSON.stringify({
        email: form.email,
        password: form.password,
      }))

      router.push({
        name: 'PaymentCallback',
        query: {
          order_id: result.data.out_trade_no,
          payment_url: result.data.payment_url,
          pay_type: String(form.pay_type),
        },
      })
      return
    }

    const result = await userStore.login({
      email: form.email,
      password: form.password,
    })

    if (result.success) {
      setMessage('登录成功', 'success')
      const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/profile'
      router.push(redirect)
      return
    }

    setMessage(result.message || '登录失败')
  } finally {
    loading.value = false
  }
}

/**
 * 从注册购买模式切回登录模式。
 *
 * 职责：保留推广码，但移除套餐 query，回到普通登录流程。
 * 关键参数：无。
 * 核心分支：有推广码时继续透传 ref，无推广码时只跳 `/signin`。
 */
function switchToLogin() {
  router.push({
    name: 'Signin',
    query: referralCode.value ? { ref: referralCode.value } : {},
  })
}

/**
 * 加载匿名公开设置。
 *
 * 职责：读取客服链接等无需登录的站点配置。
 * 关键参数：无。
 * 核心分支：后端未配置时保持空字符串，模板会隐藏入口。
 */
async function loadPublicSettings() {
  try {
    const response = await api.user.getPublicSettings()
    onlineCustomerServiceUrl.value = String(response.data?.online_customer_service_url || '').trim()
  } catch (error) {
    console.error('加载公开设置失败:', error)
  }
}

onMounted(() => {
  loadPublicSettings()
})
</script>
