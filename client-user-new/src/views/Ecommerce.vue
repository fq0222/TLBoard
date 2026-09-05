<template>
  <admin-layout>
    <div class="space-y-8">
      <section class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white/90 md:text-3xl">
            欢迎回来，{{ account.email }}
          </h1>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            这是您在天澜大陆的资源概览。
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <button
            type="button"
            class="inline-flex h-11 items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 shadow-theme-xs transition hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.03]"
          >
            <RefreshCw class="size-4" />
            刷新
          </button>
        </div>
      </section>

      <section class="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
        <article
          v-for="card in overviewCards"
          :key="card.title"
          class="rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-sm dark:border-gray-800 dark:bg-gray-900"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <p class="text-sm font-medium text-gray-500 dark:text-gray-400">{{ card.title }}</p>
              <p class="mt-4 text-3xl font-bold text-gray-900 dark:text-white/90">{{ card.value }}</p>
            </div>
            <div
              class="flex size-12 shrink-0 items-center justify-center rounded-2xl"
              :class="card.iconClass"
            >
              <component :is="card.icon" class="size-6" />
            </div>
          </div>

          <div class="mt-5 space-y-3">
            <div
              v-for="item in card.items"
              :key="item.label"
              class="flex items-center justify-between gap-3 text-sm"
            >
              <span class="text-gray-500 dark:text-gray-400">{{ item.label }}</span>
              <span class="font-semibold text-gray-800 dark:text-white/90">{{ item.value }}</span>
            </div>
          </div>

          <div v-if="card.progress !== undefined" class="mt-5">
            <div class="h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <div
                class="h-full rounded-full bg-brand-500 transition-all"
                :style="{ width: `${card.progress}%` }"
              ></div>
            </div>
          </div>
        </article>
      </section>

      <section class="space-y-5">
        <div class="flex items-center gap-3">
          <h2 class="text-2xl font-bold text-gray-900 dark:text-white/90">我的套餐</h2>
          <span
            class="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-500 dark:bg-brand-500/15 dark:text-brand-400"
          >
            {{ packages.length }}
          </span>
        </div>

        <div class="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <article
            v-for="plan in packages"
            :key="plan.id"
            class="rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-sm dark:border-gray-800 dark:bg-gray-900"
          >
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <p class="text-xs font-semibold uppercase text-gray-400 dark:text-gray-500">套餐名称</p>
                <h3 class="mt-2 break-words text-xl font-bold text-gray-900 dark:text-white/90">
                  {{ plan.name }}
                </h3>
              </div>
              <span
                class="shrink-0 rounded-full px-3 py-1 text-xs font-semibold"
                :class="plan.statusClass"
              >
                {{ plan.statusText }}
              </span>
            </div>

            <div class="mt-6 grid grid-cols-2 gap-4">
              <div>
                <p class="text-xs font-semibold text-gray-400 dark:text-gray-500">流量多少</p>
                <p class="mt-2 text-lg font-bold text-gray-900 dark:text-white/90">{{ plan.trafficLimit }}</p>
              </div>
              <div>
                <p class="text-xs font-semibold text-gray-400 dark:text-gray-500">套餐时长</p>
                <p class="mt-2 text-lg font-bold text-gray-900 dark:text-white/90">{{ plan.duration }}</p>
              </div>
            </div>

            <div class="mt-6">
              <div class="flex items-center justify-between gap-3 text-sm">
                <span class="font-medium text-gray-500 dark:text-gray-400">流量使用情况</span>
                <span class="font-semibold text-gray-800 dark:text-white/90">
                  {{ plan.trafficUsed }} / {{ plan.trafficLimit }}
                </span>
              </div>
              <div class="mt-3 h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                <div
                  class="h-full rounded-full transition-all"
                  :class="plan.progressClass"
                  :style="{ width: `${plan.trafficPercent}%` }"
                ></div>
              </div>
            </div>

            <div class="mt-6 border-t border-gray-100 pt-5 dark:border-gray-800">
              <p class="text-xs font-semibold text-gray-400 dark:text-gray-500">续费价格</p>
              <div class="mt-2 flex items-end justify-between gap-4">
                <p class="text-2xl font-bold text-brand-500">{{ plan.renewPrice }}</p>
                <p class="text-right text-xs text-gray-400 dark:text-gray-500">
                  到期时间：{{ plan.expireAt }}
                </p>
              </div>
            </div>
          </article>
        </div>
      </section>
    </div>
  </admin-layout>
</template>

<script setup lang="ts">
import AdminLayout from '../components/layout/AdminLayout.vue'
import { Activity, Bell, Package, RefreshCw, Wallet } from 'lucide-vue-next'

type DetailItem = {
  label: string
  value: string
}

type OverviewCard = {
  title: string
  value: string
  icon: object
  iconClass: string
  items: DetailItem[]
  progress?: number
}

type PackageCard = {
  id: number
  name: string
  statusText: string
  statusClass: string
  trafficLimit: string
  trafficUsed: string
  trafficPercent: number
  progressClass: string
  duration: string
  renewPrice: string
  expireAt: string
}

const account = {
  email: 'fuqiang_2015@163.com',
  status: '修行中',
  trafficUsed: '179 GB',
  trafficLimit: '400 GB',
  trafficPercent: 45,
  planType: '筑基月卡',
  duration: '30 天',
  referralBalance: '0.00 元',
}

const latestAnnouncements = [
  { title: '速率说明', date: '2026-06-17' },
  { title: '使用必读说明', date: '2026-05-15' },
]

const packages: PackageCard[] = [
  {
    id: 1,
    name: '天澜大陆筑基月卡',
    statusText: '生效中',
    statusClass: 'bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-400',
    trafficLimit: '400 GB',
    trafficUsed: '179 GB',
    trafficPercent: 45,
    progressClass: 'bg-brand-500',
    duration: '30 天',
    renewPrice: '￥28.00',
    expireAt: '2026-10-02 22:35',
  },
  {
    id: 2,
    name: '天澜大陆结丹季卡',
    statusText: '可续费',
    statusClass: 'bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-400',
    trafficLimit: '1000 GB',
    trafficUsed: '271 GB',
    trafficPercent: 27,
    progressClass: 'bg-success-500',
    duration: '90 天',
    renewPrice: '￥78.00',
    expireAt: '2026-12-29 18:37',
  },
  {
    id: 3,
    name: '天澜大陆元婴年卡',
    statusText: '推荐',
    statusClass: 'bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400',
    trafficLimit: '500 GB',
    trafficUsed: '84.9 GB',
    trafficPercent: 17,
    progressClass: 'bg-blue-light-500',
    duration: '365 天',
    renewPrice: '￥268.00',
    expireAt: '2027-09-28 21:45',
  },
]

const overviewCards: OverviewCard[] = [
  {
    title: '推广余额',
    value: account.referralBalance,
    icon: Wallet,
    iconClass: 'bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400',
    items: [
      { label: '可抵扣', value: account.referralBalance },
      { label: '奖励来源', value: '好友首单' },
    ],
  },
  {
    title: '账号状态',
    value: account.status,
    icon: Activity,
    iconClass: 'bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-400',
    items: [
      { label: '流量用量', value: `${account.trafficUsed} / ${account.trafficLimit}` },
      { label: '使用比例', value: `${account.trafficPercent}%` },
    ],
    progress: account.trafficPercent,
  },
  {
    title: '套餐类型',
    value: account.planType,
    icon: Package,
    iconClass: 'bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-400',
    items: [
      { label: '套餐时长', value: account.duration },
      { label: '剩余权益', value: '可正常续费' },
    ],
  },
  {
    title: '系统公告',
    value: `${latestAnnouncements.length} 条`,
    icon: Bell,
    iconClass: 'bg-blue-light-50 text-blue-light-600 dark:bg-blue-light-500/15 dark:text-blue-light-400',
    items: latestAnnouncements.map((announcement) => ({
      label: announcement.title,
      value: announcement.date,
    })),
  },
]
</script>
