<template>
  <admin-layout>
    <div class="space-y-6">
      <section class="mb-7 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white/90 md:text-3xl">
            套餐订阅
          </h1>
          <p class="mt-2 max-w-2xl text-sm leading-6 text-gray-500 dark:text-gray-400">
            当前只展示与您正在使用的套餐类型一致的可续费套餐。
          </p>
        </div>

        <button
          type="button"
          class="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 shadow-theme-xs transition hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.03]"
          @click="fetchPlans"
        >
          <RefreshCw class="size-4" />
          刷新套餐
        </button>
      </section>

      <section class="space-y-5">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex items-center gap-3">
            <h2 class="text-xl font-bold text-gray-900 dark:text-white/90">流量套餐</h2>
            <span
              class="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-500 dark:bg-brand-500/15 dark:text-brand-400"
            >
              {{ filteredPlans.length }}
            </span>
          </div>

          <div
            class="inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900"
            aria-label="套餐分类"
          >
            <button
              v-for="filter in planFilters"
              :key="filter.value"
              type="button"
              class="rounded-md px-3 py-2 text-sm font-medium transition"
              :class="activePlanFilter === filter.value
                ? 'bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400'
                : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white/90'"
              @click="activePlanFilter = filter.value"
            >
              {{ filter.label }}
            </button>
          </div>
        </div>

        <div class="rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-sm dark:border-gray-800 dark:bg-gray-900">
          <h3 class="text-base font-bold text-gray-900 dark:text-white/90">支付方式</h3>
          <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label
              v-for="method in paymentMethods"
              :key="method.value"
              class="relative flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition"
              :class="payType === method.value
                ? 'border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400'
                : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300'"
            >
              <input v-model="payType" class="sr-only" type="radio" :value="method.value" />
              <span class="inline-flex size-10 items-center justify-center rounded-xl text-sm font-bold text-white" :class="method.iconClass">
                {{ method.shortName }}
              </span>
              <span class="font-semibold">{{ method.label }}</span>
              <CheckCircle v-if="payType === method.value" class="absolute right-4 top-1/2 size-5 -translate-y-1/2" />
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

        <div
          v-if="loading"
          class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
          aria-live="polite"
          aria-busy="true"
        >
          <article
            v-for="index in 4"
            :key="index"
            class="h-64 animate-pulse rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-sm dark:border-gray-800 dark:bg-gray-900"
          >
            <div class="h-5 w-20 rounded-full bg-gray-100 dark:bg-gray-800"></div>
            <div class="mt-6 h-7 w-2/3 rounded-full bg-gray-100 dark:bg-gray-800"></div>
            <div class="mt-8 grid grid-cols-2 gap-4">
              <div class="h-20 rounded-xl bg-gray-100 dark:bg-gray-800"></div>
              <div class="h-20 rounded-xl bg-gray-100 dark:bg-gray-800"></div>
            </div>
            <div class="mt-6 h-16 rounded-xl bg-gray-100 dark:bg-gray-800"></div>
          </article>
        </div>

        <div
          v-else-if="loadError"
          class="rounded-2xl border border-error-200 bg-error-50 p-6 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300"
        >
          套餐加载失败，请稍后重试。
        </div>

        <div
          v-else-if="filteredPlans.length === 0"
          class="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
        >
          当前分类暂无套餐。
        </div>

        <div v-else class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <article
            v-for="plan in filteredPlans"
            :key="plan.id"
            class="flex min-h-[292px] flex-col rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-sm transition hover:-translate-y-0.5 hover:shadow-theme-md dark:border-gray-800 dark:bg-gray-900"
            :class="[
              isPlanDisabled(plan) ? 'opacity-70' : '',
              plan.id === currentPlanId ? 'border-brand-300 dark:border-brand-500/40' : '',
            ]"
          >
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <span
                  v-if="isPlanDisabled(plan)"
                  class="rounded-full bg-warning-50 px-2.5 py-1 text-xs font-semibold text-warning-600 dark:bg-warning-500/15 dark:text-warning-400"
                >
                  已售罄
                </span>
                <span
                  v-if="plan.id === currentPlanId"
                  class="rounded-full bg-success-50 px-2.5 py-1 text-xs font-semibold text-success-600 dark:bg-success-500/15 dark:text-success-400"
                >
                  当前套餐
                </span>
                <h3 class="mt-3 break-words text-xl font-bold text-gray-900 dark:text-white/90">
                  {{ plan.name }}
                </h3>
              </div>

              <div class="shrink-0 text-right">
                <p class="text-xs font-medium text-gray-400 dark:text-gray-500">价格</p>
                <p class="mt-1 text-2xl font-bold text-brand-500">￥{{ plan.price_text }}</p>
              </div>
            </div>

            <div class="mt-5 grid grid-cols-2 gap-3">
              <div class="rounded-xl bg-gray-50 p-3 dark:bg-white/[0.03]">
                <p class="text-xs font-semibold text-gray-400 dark:text-gray-500">流量</p>
                <p class="mt-2 text-base font-bold text-gray-900 dark:text-white/90">
                  {{ plan.traffic_text }}
                </p>
              </div>
              <div class="rounded-xl bg-gray-50 p-3 dark:bg-white/[0.03]">
                <p class="text-xs font-semibold text-gray-400 dark:text-gray-500">时长</p>
                <p class="mt-2 text-base font-bold text-gray-900 dark:text-white/90">
                  {{ formatDuration(plan.duration_days) }}
                </p>
              </div>
            </div>

            <p class="mt-4 text-sm leading-6 text-gray-500 dark:text-gray-400">
              {{ getPlanSummary(plan) }}
            </p>

            <div class="mt-auto flex flex-col gap-3 border-t border-gray-100 pt-5 dark:border-gray-800">
              <span class="text-xs font-medium text-gray-400 dark:text-gray-500">
                {{ getRenewStateText(plan) }}
              </span>
              <button
                type="button"
                class="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
                :disabled="isPlanDisabled(plan) || submitting"
                @click="selectPlan(plan)"
              >
                {{ isPlanDisabled(plan) ? '已售罄' : (submitting ? '提交中...' : '立即续费') }}
                <ArrowRight class="size-4" />
              </button>
            </div>
          </article>
        </div>
      </section>

      <section class="mt-10 space-y-5">
        <div class="flex items-center gap-3">
          <h2 class="text-xl font-bold text-gray-900 dark:text-white/90">家宽静态 IP 套餐</h2>
        </div>

        <div class="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
          家宽静态 IP 套餐待后端接口接入，当前暂不展示可购买项目。
        </div>
      </section>

      <div
        v-if="resetConfirmVisible"
        class="fixed inset-0 z-99999 flex items-center justify-center bg-gray-900/50 px-4 py-6"
        @click.self="cancelResetConfirm"
      >
        <section class="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-lg dark:border-gray-800 dark:bg-gray-900">
          <h2 class="text-xl font-bold text-gray-900 dark:text-white/90">确认续费</h2>
          <p class="mt-3 text-sm leading-6 text-gray-500 dark:text-gray-400">
            当前仍有 {{ formatBytes(resetPreview.remaining_traffic) }} 流量和 {{ formatRemainingTime(resetPreview.remaining_seconds) }} 未使用，续费后将重置流量与到期时间。
          </p>
          <div class="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              class="inline-flex h-10 items-center justify-center rounded-lg border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
              @click="cancelResetConfirm"
            >
              取消
            </button>
            <button
              type="button"
              class="inline-flex h-10 items-center justify-center rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:bg-gray-300"
              :disabled="submitting"
              @click="confirmResetRenew"
            >
              {{ submitting ? '提交中...' : '确认续费' }}
            </button>
          </div>
        </section>
      </div>
    </div>
  </admin-layout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, CheckCircle, RefreshCw } from 'lucide-vue-next'
import api, { ApiRequestError, getApiErrorMessage, type Plan } from '@/api'
import AdminLayout from '@/components/layout/AdminLayout.vue'
import { useUserStore } from '@/stores/user'

type PlanFilterValue = 'all' | 'limited' | 'unlimited'

type DisplayPlan = Plan & {
  isRecommended: boolean
}

const router = useRouter()
const userStore = useUserStore()

const plans = ref<Plan[]>([])
const loading = ref(false)
const loadError = ref(false)
const submitting = ref(false)
const payType = ref(1)
const message = ref('')
const messageType = ref<'error' | 'success'>('error')
const resetConfirmVisible = ref(false)
const pendingRenewPlanId = ref<number | null>(null)
const pendingRenewPayType = ref<number | null>(null)
const resetPreview = ref<{ remaining_traffic?: number | string; remaining_seconds?: number | string }>({})
const activePlanFilter = ref<PlanFilterValue>('all')

const planFilters: Array<{ label: string; value: PlanFilterValue }> = [
  { label: '全部', value: 'all' },
  { label: '限时', value: 'limited' },
  { label: '不限时', value: 'unlimited' },
]

const paymentMethods = [
  { value: 9, label: '余额支付', shortName: '余', iconClass: 'bg-warning-500' },
  { value: 2, label: '支付宝', shortName: '支', iconClass: 'bg-blue-500' },
  { value: 1, label: '微信支付', shortName: '微', iconClass: 'bg-success-500' },
]

const currentPlanId = computed(() => userStore.userInfo.value?.plan_id ?? null)

const recommendedPlanId = computed(() => {
  const preferred = plans.value.find((plan) => plan.is_recommended || plan.recommended)
  if (preferred) return preferred.id

  const availablePlans = plans.value.filter((plan) => !plan.is_soldout)
  if (availablePlans.length > 0) return availablePlans[0].id

  return plans.value[0]?.id ?? null
})

const filteredPlans = computed<DisplayPlan[]>(() =>
  plans.value
    .filter((plan) => {
      if (activePlanFilter.value === 'limited') {
        return Number(plan.duration_days) !== 0
      }

      if (activePlanFilter.value === 'unlimited') {
        return Number(plan.duration_days) === 0
      }

      return true
    })
    .map((plan) => ({
      ...plan,
      isRecommended: plan.id === recommendedPlanId.value,
    })),
)

/**
 * 拉取当前账号可续费套餐列表。
 *
 * 职责：沿用旧版续费接口，只展示与当前套餐类型一致的套餐。
 * 关键参数：无。
 * 核心分支：成功时写入套餐列表，失败时进入错误态供页面展示。
 */
async function fetchPlans() {
  try {
    loading.value = true
    loadError.value = false
    const response = await api.user.getRenewPlans(userStore.token.value)
    plans.value = response.data.plans || []
  } catch (error) {
    console.error('获取套餐列表失败:', error)
    loadError.value = true
  } finally {
    loading.value = false
  }
}

/**
 * 确保续费页已有当前用户资料。
 *
 * 职责：页面刷新后根据 token 重新拉取用户资料，用于识别当前套餐 ID。
 * 关键参数：无。
 * 核心分支：已有用户资料时不重复请求，缺失时调用用户状态层刷新。
 */
async function ensureUserProfile() {
  if (userStore.userInfo.value) return

  const result = await userStore.fetchUserProfile()
  if (!result.success) {
    setMessage(result.message || '获取用户信息失败')
  }
}

/**
 * 处理套餐选择。
 *
 * 职责：提交续费订单，保留旧版当前套餐可续费和限时套餐二次确认逻辑。
 * 关键参数：plan 为用户点击的套餐卡片。
 * 核心分支：不可选择的售罄套餐不提交，其余套餐进入续费请求。
 */
async function selectPlan(plan: Plan) {
  if (isPlanDisabled(plan)) return

  await submitRenewRequest({ planId: plan.id, selectedPayType: payType.value })
}

/**
 * 格式化套餐时长。
 *
 * 职责：把后端 `duration_days` 展示为限时或不限时文案。
 * 关键参数：durationDays 为套餐有效天数，可能来自 JSON 数字或字符串。
 * 核心分支：0 表示不限时，非 0 按天数展示。
 */
function formatDuration(durationDays: number | string) {
  return Number(durationDays) === 0 ? '不限时' : `${durationDays} 天`
}

/**
 * 生成套餐说明。
 *
 * 职责：优先使用后端描述，缺省时按套餐流量和时长生成稳定摘要。
 * 关键参数：plan 为后端返回的套餐对象。
 * 核心分支：不限时套餐强调长期使用，限时套餐强调周期权益。
 */
function getPlanSummary(plan: Plan) {
  if (plan.description) return plan.description

  if (Number(plan.duration_days) === 0) {
    return `提供 ${plan.traffic_text} 流量，没有使用期限，适合长期备用或低频使用。`
  }

  return `提供 ${plan.traffic_text} 流量，可使用 ${plan.duration_days} 天，适合按周期订阅。`
}

/**
 * 判断续费套餐是否不可选。
 *
 * 职责：保留旧版“当前套餐即使售罄也允许续费”的前端选择语义。
 * 关键参数：plan 为当前渲染的续费套餐。
 * 核心分支：非当前套餐且已售罄时禁用，其余均交给后端续费资格校验。
 */
function isPlanDisabled(plan: Plan) {
  return Boolean(plan.is_soldout && plan.id !== currentPlanId.value)
}

/**
 * 生成续费套餐卡片底部状态文案。
 *
 * 职责：向用户说明当前套餐、售罄套餐和可续费套餐的不同状态。
 * 关键参数：plan 为当前渲染的续费套餐。
 * 核心分支：当前套餐优先，其次售罄状态，最后展示普通续费说明。
 */
function getRenewStateText(plan: Plan) {
  if (plan.id === currentPlanId.value) return '当前正在使用的套餐'
  if (isPlanDisabled(plan)) return '暂不可选择该套餐'
  return '续费成功后将按当前账号规则更新权益'
}

/**
 * 展示页面内续费反馈。
 *
 * 职责：用新版页面提示块展示成功或失败信息。
 * 关键参数：text 为提示文案，type 控制提示样式。
 * 核心分支：后续提示会覆盖前一次提示。
 */
function setMessage(text: string, type: 'error' | 'success' = 'error') {
  message.value = text
  messageType.value = type
}

/**
 * 提交续费请求。
 *
 * 职责：沿用旧版续费逻辑，余额支付成功后刷新资料，VMQ 支付跳转支付回调页。
 * 关键参数：planId 为套餐 ID，selectedPayType 为支付方式，confirmReset 表示是否确认限时套餐重置。
 * 核心分支：后端返回 409/code=4091 时打开二次确认弹窗，其它错误展示业务提示。
 */
async function submitRenewRequest({
  planId,
  selectedPayType,
  confirmReset = false,
}: {
  planId: number
  selectedPayType: number
  confirmReset?: boolean
}) {
  if (submitting.value) return

  try {
    submitting.value = true
    message.value = ''

    const response = await api.user.renew(userStore.token.value, {
      plan_id: planId,
      pay_type: selectedPayType,
      confirm_reset: confirmReset,
    })

    if (response.data?.paid && response.data.payment_method === 'balance') {
      setMessage('余额支付成功，续费已完成', 'success')
      await userStore.fetchUserProfile()
      router.push('/profile')
      return
    }

    router.push({
      name: 'PaymentCallback',
      query: {
        order_id: response.data.order_id,
        out_trade_no: response.data.out_trade_no,
        payment_url: response.data.payment_url,
        expire_in: response.data.expire_in,
        pay_type: selectedPayType,
      },
    })
  } catch (error) {
    if (isRenewResetConfirmError(error)) {
      pendingRenewPlanId.value = planId
      pendingRenewPayType.value = selectedPayType
      resetPreview.value = (error as ApiRequestError).data as typeof resetPreview.value
      resetConfirmVisible.value = true
      return
    }

    console.error('续费失败:', error)
    setMessage(getApiErrorMessage(error, '续费失败，请重试'))
  } finally {
    submitting.value = false
  }
}

/**
 * 判断续费错误是否为限时套餐重置确认分支。
 *
 * 职责：只识别后端约定的 409/code=4091，避免普通错误误触发确认框。
 * 关键参数：error 为 API 层抛出的异常。
 * 核心分支：必须同时满足 HTTP 409 和业务 code 4091。
 */
function isRenewResetConfirmError(error: unknown) {
  return error instanceof ApiRequestError && Number(error.status) === 409 && Number(error.code) === 4091
}

/**
 * 确认限时套餐重置并重新提交续费。
 *
 * 职责：用户确认后带 confirm_reset=true 复用同一个续费提交流程。
 * 关键参数：无，读取待确认的套餐和支付方式状态。
 * 核心分支：缺少待确认数据时直接返回，避免发起无效请求。
 */
async function confirmResetRenew() {
  if (!pendingRenewPlanId.value || !pendingRenewPayType.value) return

  resetConfirmVisible.value = false
  await submitRenewRequest({
    planId: pendingRenewPlanId.value,
    selectedPayType: pendingRenewPayType.value,
    confirmReset: true,
  })
}

/**
 * 取消限时套餐重置确认。
 *
 * 职责：关闭确认弹窗并清空待续费上下文。
 * 关键参数：无。
 * 核心分支：始终回到未确认状态。
 */
function cancelResetConfirm() {
  resetConfirmVisible.value = false
  pendingRenewPlanId.value = null
  pendingRenewPayType.value = null
  resetPreview.value = {}
}

/**
 * 格式化字节数。
 *
 * 职责：用于限时套餐重置确认文案中的剩余流量展示。
 * 关键参数：bytes 为后端返回的字节数。
 * 核心分支：空值、非法值和非正数返回 0 B。
 */
function formatBytes(bytes?: number | string) {
  const value = Number(bytes || 0)
  if (!Number.isFinite(value) || value <= 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${parseFloat((value / (1024 ** index)).toFixed(2))} ${units[index]}`
}

/**
 * 格式化剩余时间。
 *
 * 职责：用于限时套餐重置确认文案中的剩余时间展示。
 * 关键参数：seconds 为后端返回的剩余秒数。
 * 核心分支：优先展示天和小时，不足一小时展示分钟。
 */
function formatRemainingTime(seconds?: number | string) {
  const value = Math.max(0, Number(seconds || 0))
  const days = Math.floor(value / 86400)
  const hours = Math.floor((value % 86400) / 3600)
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时`
  return `${Math.floor(value / 60)} 分钟`
}

/**
 * 初始化推广归因缓存。
 *
 * 职责：把入口 ref 留到后续注册下单请求中。
 * 关键参数：ref 来自当前路由 query。
 * 核心分支：无 ref 时不写缓存，有 ref 时写入 sessionStorage。
 */
onMounted(async () => {
  await ensureUserProfile()
  fetchPlans()
})
</script>
