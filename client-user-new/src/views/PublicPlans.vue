<template>
  <div class="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-white/90">
    <header class="sticky top-0 z-50 border-b border-gray-200 bg-white/90 backdrop-blur dark:border-gray-800 dark:bg-gray-950/85">
      <div class="mx-auto flex min-h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <router-link to="/" class="flex items-center gap-3">
          <img src="/images/logo/logo-icon.svg" alt="天澜大陆" class="size-9" />
          <span class="text-lg font-bold tracking-wide">天澜大陆</span>
        </router-link>

        <router-link
          :to="userStore.hasVerifiedSession.value ? '/profile' : '/signin'"
          class="inline-flex h-10 items-center rounded-lg border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 shadow-theme-xs transition hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
        >
          {{ userStore.hasVerifiedSession.value ? '个人中心' : '登录' }}
        </router-link>
      </div>
    </header>

    <main class="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-10">
      <section class="mb-7 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white/90 md:text-3xl">
            套餐订阅
          </h1>
          <p class="mt-2 max-w-2xl text-sm leading-6 text-gray-500 dark:text-gray-400">
            先选择流量套餐，完成支付后系统会自动创建并激活账号。
          </p>
        </div>

        <button
          type="button"
          class="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 shadow-theme-xs transition hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
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
            <span class="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-500 dark:bg-brand-500/15 dark:text-brand-400">
              {{ filteredPlans.length }}
            </span>
          </div>

          <div class="inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
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

        <div v-if="loading" class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
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
            :class="plan.is_soldout ? 'opacity-70' : ''"
          >
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <span
                  v-if="plan.is_soldout"
                  class="rounded-full bg-warning-50 px-2.5 py-1 text-xs font-semibold text-warning-600 dark:bg-warning-500/15 dark:text-warning-400"
                >
                  已售罄
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
                <p class="mt-2 text-base font-bold text-gray-900 dark:text-white/90">{{ plan.traffic_text }}</p>
              </div>
              <div class="rounded-xl bg-gray-50 p-3 dark:bg-white/[0.03]">
                <p class="text-xs font-semibold text-gray-400 dark:text-gray-500">时长</p>
                <p class="mt-2 text-base font-bold text-gray-900 dark:text-white/90">{{ formatDuration(plan.duration_days) }}</p>
              </div>
            </div>

            <p class="mt-4 text-sm leading-6 text-gray-500 dark:text-gray-400">
              {{ getPlanSummary(plan) }}
            </p>

            <div class="mt-auto flex flex-col gap-3 border-t border-gray-100 pt-5 dark:border-gray-800">
              <span class="text-xs font-medium text-gray-400 dark:text-gray-500">
                {{ plan.is_soldout ? '当前暂不可下单' : '购买并支付后自动激活账号' }}
              </span>
              <button
                type="button"
                class="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
                :disabled="plan.is_soldout"
                @click="selectPlan(plan)"
              >
                {{ plan.is_soldout ? '已售罄' : '立即购买' }}
                <ArrowRight class="size-4" />
              </button>
            </div>
          </article>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowRight, RefreshCw } from 'lucide-vue-next'
import api, { type Plan } from '@/api'
import { useUserStore } from '@/stores/user'

type PlanFilterValue = 'all' | 'limited' | 'unlimited'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const plans = ref<Plan[]>([])
const loading = ref(false)
const loadError = ref(false)
const activePlanFilter = ref<PlanFilterValue>('all')

const planFilters: Array<{ label: string; value: PlanFilterValue }> = [
  { label: '全部', value: 'all' },
  { label: '限时', value: 'limited' },
  { label: '不限时', value: 'unlimited' },
]

const filteredPlans = computed(() =>
  plans.value
    .filter((plan) => Number(plan.show_on_home ?? 1) === 1)
    .filter((plan) => {
      if (activePlanFilter.value === 'limited') return Number(plan.duration_days) !== 0
      if (activePlanFilter.value === 'unlimited') return Number(plan.duration_days) === 0
      return true
    }),
)

/**
 * 拉取匿名首页流量套餐。
 *
 * 职责：通过统一 API 层读取后端上架套餐，不展示静态 IP 区域。
 * 关键参数：无。
 * 核心分支：成功写入套餐列表，失败显示错误状态。
 */
async function fetchPlans() {
  try {
    loading.value = true
    loadError.value = false
    const response = await api.user.getPlans()
    plans.value = response.data.plans || []
  } catch (error) {
    console.error('获取套餐列表失败:', error)
    loadError.value = true
  } finally {
    loading.value = false
  }
}

/**
 * 处理匿名用户选择套餐。
 *
 * 职责：沿用旧版注册购买入口，携带套餐 query 进入 `/signin`。
 * 关键参数：plan 为用户点击的后端套餐。
 * 核心分支：已售罄不跳转，已登录去个人中心，未登录进入注册购买模式。
 */
function selectPlan(plan: Plan) {
  if (plan.is_soldout) return

  if (userStore.hasVerifiedSession.value) {
    router.push('/profile')
    return
  }

  router.push({
    name: 'Signin',
    query: {
      plan_id: String(plan.id),
      plan_name: plan.name,
      plan_price: plan.price_text,
      plan_traffic: plan.traffic_text,
      plan_duration: String(plan.duration_days),
      plan_soldout: plan.is_soldout ? '1' : '0',
      ...(route.query.ref ? { ref: String(route.query.ref) } : {}),
    },
  })
}

/**
 * 格式化套餐时长。
 *
 * 职责：把后端天数字段转换为展示文本。
 * 关键参数：durationDays 可能是数字或字符串。
 * 核心分支：0 为不限时，其余显示天数。
 */
function formatDuration(durationDays: number | string) {
  return Number(durationDays) === 0 ? '不限时' : `${durationDays} 天`
}

/**
 * 生成套餐摘要。
 *
 * 职责：优先展示后端描述，缺省时生成简短说明。
 * 关键参数：plan 为后端套餐对象。
 * 核心分支：不限时和限时套餐使用不同文案。
 */
function getPlanSummary(plan: Plan) {
  if (plan.description) return plan.description
  if (Number(plan.duration_days) === 0) return `提供 ${plan.traffic_text} 流量，没有使用期限，适合长期备用。`
  return `提供 ${plan.traffic_text} 流量，可使用 ${plan.duration_days} 天，适合按周期订阅。`
}

/**
 * 初始化推广归因缓存。
 *
 * 职责：保留入口 ref，供后续注册下单提交。
 * 关键参数：ref 来自当前路由 query。
 * 核心分支：有 ref 时写入 sessionStorage，无 ref 时不处理。
 */
function initializeReferralTracking() {
  const referralCode = String(route.query.ref || '').trim()
  if (referralCode) {
    sessionStorage.setItem('referral_code', referralCode)
  }
}

onMounted(() => {
  initializeReferralTracking()
  fetchPlans()
})
</script>
