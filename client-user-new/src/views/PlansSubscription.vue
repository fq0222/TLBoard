<template>
  <admin-layout>
    <div class="space-y-6">
      <section class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white/90 md:text-3xl">
            套餐订阅
          </h1>
          <p class="mt-2 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
            选择合适的流量套餐，也可以按地区补充家宽静态 IP 资源。
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

        <div
          v-if="loading"
          class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
          aria-live="polite"
          aria-busy="true"
        >
          <article
            v-for="index in 3"
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
            :class="plan.is_soldout ? 'opacity-70' : ''"
          >
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span
                    v-if="plan.is_soldout"
                    class="rounded-full bg-warning-50 px-2.5 py-1 text-xs font-semibold text-warning-600 dark:bg-warning-500/15 dark:text-warning-400"
                  >
                    已售罄
                  </span>
                </div>
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

            <div class="mt-auto flex items-center justify-between gap-3 border-t border-gray-100 pt-5 dark:border-gray-800">
              <span class="text-xs font-medium text-gray-400 dark:text-gray-500">
                {{ getPlanTypeText(plan) }}
              </span>
              <button
                type="button"
                class="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
                :disabled="plan.is_soldout"
              >
                {{ plan.is_soldout ? '暂不可订阅' : '立即订阅' }}
                <ArrowRight class="size-4" />
              </button>
            </div>
          </article>
        </div>
      </section>

      <section class="space-y-5">
        <div class="flex items-center gap-3">
          <h2 class="text-xl font-bold text-gray-900 dark:text-white/90">家宽静态 IP 套餐</h2>
          <span
            class="rounded-full bg-success-50 px-2.5 py-1 text-xs font-semibold text-success-600 dark:bg-success-500/15 dark:text-success-400"
          >
            {{ residentialIpPlans.length }}
          </span>
        </div>

        <div class="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          <article
            v-for="ipPlan in residentialIpPlans"
            :key="ipPlan.id"
            class="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-sm dark:border-gray-800 dark:bg-gray-900"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-400">
                <MapPin class="size-5" />
              </div>
              <span class="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600 dark:bg-white/[0.06] dark:text-gray-300">
                {{ ipPlan.shareText }}
              </span>
            </div>

            <div class="mt-5 flex items-center justify-between gap-3">
              <h3 class="break-words text-lg font-bold text-gray-900 dark:text-white/90">
                {{ ipPlan.region }}
              </h3>
              <span class="shrink-0 text-xs font-medium text-gray-400 dark:text-gray-500">
                静态住宅出口
              </span>
            </div>

            <div class="mt-4 flex items-center justify-between gap-3">
              <p class="text-2xl font-bold text-gray-900 dark:text-white/90">
                {{ ipPlan.priceText }}
              </p>

              <button
                type="button"
                class="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white transition hover:bg-brand-600"
              >
                立即订阅
                <ArrowRight class="size-4" />
              </button>
            </div>
          </article>
        </div>
      </section>
    </div>
  </admin-layout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AdminLayout from '../components/layout/AdminLayout.vue'
import { ArrowRight, MapPin, RefreshCw } from 'lucide-vue-next'

type PlanFilterValue = 'all' | 'limited' | 'unlimited'

type ApiPlan = {
  id: number
  name: string
  description?: string
  price_text: string
  duration_days: number | string
  traffic_text: string
  plan_type?: string
  show_on_home?: number | string
  sales_limit?: number
  sales_count?: number
  is_soldout?: boolean
  is_recommended?: boolean
  recommended?: boolean
}

type DisplayPlan = ApiPlan & {
  isRecommended: boolean
}

type ResidentialIpPlan = {
  id: number
  region: string
  priceText: string
  shareText: string
}

const plans = ref<ApiPlan[]>([])
const loading = ref(false)
const loadError = ref(false)
const activePlanFilter = ref<PlanFilterValue>('all')

const planFilters: Array<{ label: string; value: PlanFilterValue }> = [
  { label: '全部', value: 'all' },
  { label: '限时', value: 'limited' },
  { label: '不限时', value: 'unlimited' },
]

const residentialIpPlans: ResidentialIpPlan[] = [
  {
    id: 1,
    region: '美国洛杉矶',
    priceText: '15/月',
    shareText: '5人共享',
  },
  {
    id: 2,
    region: '日本东京',
    priceText: '15/月',
    shareText: '5人共享',
  },
  {
    id: 3,
    region: '新加坡',
    priceText: '15/月',
    shareText: '5人共享',
  },
  {
    id: 4,
    region: '德国法兰克福',
    priceText: '15/月',
    shareText: '5人共享',
  },
]

const recommendedPlanId = computed(() => {
  const preferred = plans.value.find((plan) => plan.is_recommended || plan.recommended)
  if (preferred) return preferred.id

  const availablePlans = plans.value.filter((plan) => !plan.is_soldout)
  if (availablePlans.length > 0) return availablePlans[0].id

  return plans.value[0]?.id ?? null
})

const filteredPlans = computed<DisplayPlan[]>(() =>
  plans.value
    .filter((plan) => Number(plan.show_on_home ?? 1) === 1)
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
 * 拉取用户端公开套餐列表。
 *
 * 职责：从现有后端套餐接口读取展示数据，保持新版客户端不重复定义套餐字段。
 * 关键参数：无，接口路径固定为用户端公开 `/api/user/plans`。
 * 核心分支：成功时写入套餐列表，失败时进入错误态供页面展示。
 */
async function fetchPlans() {
  try {
    loading.value = true
    loadError.value = false

    const response = await fetch('/api/user/plans')
    const result = await response.json()

    if (!response.ok || result?.success === false) {
      throw new Error(result?.message || '获取套餐列表失败')
    }

    plans.value = result?.data?.plans || []
  } catch (error) {
    console.error('获取套餐列表失败:', error)
    loadError.value = true
  } finally {
    loading.value = false
  }
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
function getPlanSummary(plan: ApiPlan) {
  if (plan.description) return plan.description

  if (Number(plan.duration_days) === 0) {
    return `提供 ${plan.traffic_text} 流量，没有使用期限，适合长期备用或低频使用。`
  }

  return `提供 ${plan.traffic_text} 流量，可使用 ${plan.duration_days} 天，适合按周期订阅。`
}

/**
 * 生成套餐类型文案。
 *
 * 职责：结合后端计划类型和时长字段，在卡片底部给出轻量分类提示。
 * 关键参数：plan 为后端返回的套餐对象。
 * 核心分支：`timed` 或非零天数视为限时套餐，其余视为不限时套餐。
 */
function getPlanTypeText(plan: ApiPlan) {
  if (plan.plan_type === 'timed' || Number(plan.duration_days) !== 0) {
    return '限时套餐'
  }

  return '不限时套餐'
}

onMounted(() => {
  fetchPlans()
})
</script>
