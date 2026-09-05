<template>
  <admin-layout>
    <div class="space-y-8">
      <section class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white/90 md:text-3xl">
            欢迎回来，{{ displayName }}
          </h1>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            这是您在天澜大陆的属性面板。
          </p>
        </div>

        <button
          type="button"
          class="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 shadow-theme-xs transition hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
          :disabled="loading"
          @click="loadDashboard"
        >
          <RefreshCw class="size-4" />
          {{ loading ? '刷新中...' : '刷新' }}
        </button>
      </section>

      <div
        v-if="loadError"
        class="rounded-2xl border border-error-200 bg-error-50 p-5 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300"
      >
        {{ loadError }}
      </div>

      <section class="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
        <article
          v-for="card in overviewCards"
          :key="card.title"
          class="rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-sm dark:border-gray-800 dark:bg-gray-900"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <p class="text-sm font-medium text-gray-500 dark:text-gray-400">{{ card.title }}</p>
              <p class="mt-4 break-words text-3xl font-bold text-gray-900 dark:text-white/90">{{ card.value }}</p>
            </div>
            <div class="flex size-12 shrink-0 items-center justify-center rounded-2xl" :class="card.iconClass">
              <component :is="card.icon" class="size-6" />
            </div>
          </div>

          <div class="mt-5 space-y-3">
            <div v-for="item in card.items" :key="item.label" class="flex items-center justify-between gap-3 text-sm">
              <span class="text-gray-500 dark:text-gray-400">{{ item.label }}</span>
              <span class="break-words text-right font-semibold text-gray-800 dark:text-white/90">{{ item.value }}</span>
            </div>
          </div>

          <div v-if="card.progress !== undefined" class="mt-5">
            <div class="h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <div class="h-full rounded-full bg-brand-500 transition-all" :style="{ width: `${card.progress}%` }"></div>
            </div>
          </div>
        </article>

        <article class="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-sm dark:border-gray-800 dark:bg-gray-900">
          <div class="flex items-center gap-3 border-b border-gray-100 px-6 py-5 dark:border-gray-800">
            <Bell class="size-5 text-brand-500" />
            <h2 class="text-lg font-bold text-gray-900 dark:text-white/90">平台公告</h2>
          </div>

          <div v-if="visibleAnnouncements.length > 0" class="divide-y divide-gray-100 dark:divide-gray-800">
            <button
              v-for="announcement in visibleAnnouncements"
              :key="announcement.id"
              type="button"
              class="flex min-h-15 w-full items-center justify-between gap-4 px-6 py-4 text-left transition hover:bg-gray-50 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:hover:bg-white/[0.03]"
              @click="openAnnouncement(announcement)"
            >
              <span class="flex min-w-0 items-center gap-3">
                <span class="size-2 shrink-0 rounded-full" :class="announcement.pinned ? 'bg-warning-500' : 'bg-brand-500'"></span>
                <span class="truncate text-sm font-semibold text-gray-800 dark:text-white/90">{{ announcement.title }}</span>
              </span>
              <span class="shrink-0 text-sm text-gray-400 dark:text-gray-500">{{ getAnnouncementDate(announcement) }}</span>
            </button>
          </div>

          <div v-else class="m-6 rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            暂无公告
          </div>
        </article>
      </section>

      <section class="space-y-4">
        <h2 class="text-2xl font-bold text-gray-900 dark:text-white/90">我的套餐</h2>

        <div class="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          <article class="rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-sm dark:border-gray-800 dark:bg-gray-900">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <p class="text-sm font-medium text-gray-500 dark:text-gray-400">套餐名称</p>
                <h3 class="mt-4 truncate text-3xl font-bold text-gray-900 dark:text-white/90">
                  {{ profile?.plan_name || '未订阅' }}
                </h3> 
              </div>
              <router-link
                to="/plans"
                class="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-brand-500 px-3 text-sm font-semibold text-white transition hover:bg-brand-600"
              >
              续订
            </router-link>
            </div>

            <div class="mt-5 space-y-3">
              <div class="flex items-center justify-between gap-3 text-sm">
                <span class="text-gray-500 dark:text-gray-400">账号状态</span>
                <span class="break-words text-right font-semibold text-gray-800 dark:text-white/90">{{ statusText }}</span>
              </div>
              <div class="flex items-center justify-between gap-3 text-sm">
                <span class="text-gray-500 dark:text-gray-400">套餐 ID</span>
                <span class="break-words text-right font-semibold text-gray-800 dark:text-white/90">{{ profile?.plan_id || '-' }}</span>
              </div>
              <div class="flex items-center justify-between gap-3 text-sm">
                <span class="text-gray-500 dark:text-gray-400">流量用量</span>
                <span class="break-words text-right font-semibold text-gray-800 dark:text-white/90">{{ trafficSummary }}</span>
              </div>
              <div class="flex items-center justify-between gap-3 text-sm">
                <span class="text-gray-500 dark:text-gray-400">到期时间</span>
                <span class="break-words text-right font-semibold text-gray-800 dark:text-white/90">{{ profile?.expire_text || profile?.expire_at || '-' }}</span>
              </div>
            </div>
          </article>
        </div>
      </section>

      <div
        v-if="selectedAnnouncement"
        class="fixed inset-0 z-99999 flex items-center justify-center bg-gray-900/50 px-4 py-6"
        @click.self="closeAnnouncement"
      >
        <section class="w-full max-w-xl rounded-2xl border border-gray-200 bg-white shadow-theme-lg dark:border-gray-800 dark:bg-gray-900">
          <div class="flex items-start justify-between gap-4 border-b border-gray-100 p-6 dark:border-gray-800">
            <div class="min-w-0">
              <p class="text-sm font-medium text-brand-500">公告详情</p>
              <h3 class="mt-2 break-words text-xl font-bold text-gray-900 dark:text-white/90">
                {{ selectedAnnouncement.title }}
              </h3>
              <p class="mt-1 text-sm text-gray-400 dark:text-gray-500">
                {{ getAnnouncementDate(selectedAnnouncement) }}
              </p>
            </div>
            <button
              type="button"
              class="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.05] dark:hover:text-gray-300"
              @click="closeAnnouncement"
            >
              <X class="size-5" />
            </button>
          </div>
          <div class="max-h-[60vh] overflow-y-auto p-6">
            <p class="whitespace-pre-wrap break-words text-sm leading-7 text-gray-600 dark:text-gray-300">
              {{ stripMarkdown(selectedAnnouncement.content) }}
            </p>
          </div>
        </section>
      </div>
    </div>
  </admin-layout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Activity, Bell, Package, RefreshCw, Wallet, X } from 'lucide-vue-next'
import AdminLayout from '@/components/layout/AdminLayout.vue'
import api, { type Announcement, type UserProfile } from '@/api'
import { useUserStore } from '@/stores/user'

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

const userStore = useUserStore()
const profile = ref<UserProfile | null>(userStore.userInfo.value)
const announcements = ref<Announcement[]>([])
const selectedAnnouncement = ref<Announcement | null>(null)
const loading = ref(false)
const loadError = ref('')

const displayName = computed(() => {
  const email = profile.value?.email || userStore.userInfo.value?.email || ''
  return email ? email.split('@')[0] : '用户'
})

const statusText = computed(() => profile.value?.status_text || (profile.value?.enabled ? '正常' : '待激活'))
const trafficPercent = computed(() => Math.min(100, Math.max(0, Number(profile.value?.traffic_percent || 0))))
const trafficSummary = computed(() => `${profile.value?.traffic_used_text || '0 B'} / ${profile.value?.traffic_limit_text || '0 B'}`)

const overviewCards = computed<OverviewCard[]>(() => [
  {
    title: '推广余额',
    value: profile.value?.balance_text || '0.00 元',
    icon: Wallet,
    iconClass: 'bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400',
    items: [
      { label: '可抵扣', value: profile.value?.balance_text || '0.00 元' },
      { label: '支付次数', value: String(profile.value?.payment_count || 0) },
    ],
  },
  {
    title: '账号状态',
    value: statusText.value,
    icon: Activity,
    iconClass: 'bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-400',
    items: [
      { label: '流量用量', value: trafficSummary.value },
      { label: '使用比例', value: `${trafficPercent.value}%` },
    ],
    progress: trafficPercent.value,
  },
  {
    title: '套餐类型',
    value: profile.value?.plan_name || '未订阅',
    icon: Package,
    iconClass: 'bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-400',
    items: [
      { label: '套餐 ID', value: profile.value?.plan_id ? String(profile.value.plan_id) : '-' },
      { label: '到期时间', value: profile.value?.expire_text || profile.value?.expire_at || '-' },
    ],
  },
])

const visibleAnnouncements = computed(() => [...announcements.value]
  .sort((current, next) => Number(next.pinned) - Number(current.pinned))
  .slice(0, 3)
)

/**
 * 加载属性面板数据。
 *
 * 职责：从后端读取用户资料和公告列表，替代模板静态数据。
 * 关键参数：无，鉴权 token 来自用户状态层。
 * 核心分支：资料读取失败时提示错误，公告失败不阻断个人资料展示。
 */
async function loadDashboard() {
  try {
    loading.value = true
    loadError.value = ''

    const profileResult = await userStore.fetchUserProfile()
    if (!profileResult.success || !profileResult.data) {
      loadError.value = profileResult.message || '获取用户信息失败'
      return
    }

    profile.value = profileResult.data

    try {
      const announcementResult = await api.user.getAnnouncements({ page: 1, limit: 3 })
      announcements.value = announcementResult.data.list || []
    } catch (error) {
      console.error('加载公告失败:', error)
      announcements.value = []
    }
  } finally {
    loading.value = false
  }
}

/**
 * 去除公告 Markdown 标记。
 *
 * 职责：在属性面板摘要中展示纯文本预览，避免额外引入 Markdown 渲染依赖。
 * 关键参数：content 为后端公告正文。
 * 核心分支：空内容返回占位符，有内容时做轻量清理。
 */
function stripMarkdown(content = '') {
  const text = content
    .replace(/[`*_>#-]/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

  return text || '暂无内容'
}

/**
 * 打开公告详情弹窗。
 *
 * 职责：记录用户当前点击的公告，供弹窗展示完整标题与正文。
 * 关键参数：announcement 为后端公告列表中的单条公告。
 * 核心分支：每次点击都会覆盖上一次选中公告。
 */
function openAnnouncement(announcement: Announcement) {
  selectedAnnouncement.value = announcement
}

/**
 * 关闭公告详情弹窗。
 *
 * 职责：清空当前公告选择，让弹窗从页面中移除。
 * 关键参数：无。
 * 核心分支：无论当前是否有公告，调用后都回到未选中状态。
 */
function closeAnnouncement() {
  selectedAnnouncement.value = null
}

/**
 * 读取公告创建时间。
 *
 * 职责：兼容后端蛇形字段和可能的驼峰字段，确保列表右侧日期正常展示。
 * 关键参数：announcement 为后端返回的公告对象。
 * 核心分支：优先使用 created_at，缺失时回退到 createdAt。
 */
function getAnnouncementDate(announcement: Announcement) {
  return formatDate(announcement.created_at ?? announcement.createdAt)
}

/**
 * 格式化公告日期。
 *
 * 职责：将后端时间字段转成短日期展示。
 * 关键参数：value 为可选时间字符串或时间戳。
 * 核心分支：秒级时间戳会转成毫秒，数字字符串按时间戳处理，其它字符串按日期解析。
 */
function formatDate(value?: string | number | null) {
  if (value === undefined || value === null || value === '') return '-'

  const timestamp = Number(value)
  const date = Number.isFinite(timestamp) && String(value).trim() !== ''
    ? new Date(timestamp < 1000000000000 ? timestamp * 1000 : timestamp)
    : new Date(value)

  if (Number.isNaN(date.getTime())) return '-'

  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).replace(/\//g, '-')
}

onMounted(() => {
  loadDashboard()
})
</script>
