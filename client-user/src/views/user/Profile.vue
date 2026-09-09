<template>
  <div class="profile-container" v-loading="loading">
    <section class="dashboard-card-grid">
      <article class="panel-card dashboard-card referral-card">
        <div class="dashboard-card-head">
          <span class="dashboard-card-label">账户信息</span>
          <span class="dashboard-icon blue">
            <el-icon><User /></el-icon>
          </span>
        </div>
        <div class="account-email">{{ userInfo.email || '-' }}</div>
        <dl class="metric-list">
          <div class="metric-row">
            <dt>余额</dt>
            <dd>{{ userInfo.balance_text || '0.00 元' }}</dd>
          </div>
          <div class="metric-row">
            <dt>推广奖励总额</dt>
            <dd>{{ rewardAmountText }}</dd>
          </div>
        </dl>
        <div class="referral-action-row">
          <button
            type="button"
            class="text-link-button onboarding-link-button"
            @click="startOnboardingGuide(true)"
          >
            新手引导
          </button>
          <button
            type="button"
            class="text-link-button share-friend-button"
            @click="referralPosterRef?.open()"
          >
            分享给好友
          </button>
          <a
            v-if="telegramChannelUrl"
            :href="telegramChannelUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="text-link-button telegram-channel-button"
          >
            加入电报频道
          </a>
          <a
            v-if="onlineCustomerServiceUrl"
            :href="onlineCustomerServiceHref"
            target="_blank"
            rel="noopener noreferrer"
            class="text-link-button online-service-button"
          >
            在线客服
          </a>
        </div>
      </article>

      <article class="panel-card dashboard-card package-card">
        <div class="dashboard-card-head">
          <span class="dashboard-card-label">套餐信息</span>
          <el-tag class="package-status-tag" :type="accountStatusType">
            {{ accountStatusText }}
          </el-tag>
        </div>
        <div class="package-block">
          <div class="metric-row">
            <dt>流量用量</dt>
            <dd>{{ compactTrafficUsageText }}</dd>
          </div>
          <el-progress
            :percentage="userInfo.traffic_percent || 0"
            :stroke-width="8"
            :show-text="false"
          />
          <div class="metric-row">
            <dt>到期时间</dt>
            <dd>{{ userInfo.expire_text || '暂无可订阅' }}</dd>
          </div>
        </div>
        <div class="package-block home-package-block">
          <div class="package-title-row">
            <strong>家宽IP套餐</strong>
          </div>
          <div class="metric-row">
            <dt>套餐名称</dt>
            <dd>{{ userInfo.home_plan_name || '暂无可订阅' }}</dd>
          </div>
          <div class="metric-row">
            <dt>到期时间</dt>
            <dd>{{ homeExpireText }}</dd>
          </div>
        </div>
      </article>

      <article class="panel-card dashboard-card mini-subscription-card">
        <div class="dashboard-card-head">
          <span class="dashboard-card-label">订阅工作区</span>
          <el-button
            v-if="userInfo.subscription_ready"
            link
            type="primary"
            class="replace-subscription-button"
            :disabled="actionBusy"
            @click="confirmReplaceSubscriptionLink"
          >
            更换订阅链接
          </el-button>
        </div>
        <div class="mini-subscription-actions">
          <button
            type="button"
            class="step-action-card optimize-action"
            :class="{ disabled: actionBusy }"
            :disabled="actionBusy"
            @click="startOptimize"
          >
            <span class="step-action-index">步骤1</span>
            <span class="step-action-name">{{ cfOptimized ? '重新优选极速通道' : '一键开启极速通道' }}</span>
          </button>

          <button
            type="button"
            class="step-action-card generate-action"
            :class="{ disabled: actionBusy }"
            :disabled="actionBusy"
            @click="generateSubscription"
          >
            <span class="step-action-index">步骤2</span>
            <span class="step-action-name">{{ generatingSubscription ? '生成中...' : '生成订阅链接' }}</span>
          </button>
        </div>
        <div class="subscription-copy-target mini-copy-list">
          <div class="mini-copy-row">
            <div class="mini-copy-text">
              <span class="mini-copy-title">通用订阅</span>
              <span class="mini-copy-desc" aria-label="适用于 v2rayN、v2rayNG、Shadowrocket等客户端">
                <span>适用于 v2rayN、v2rayNG、</span>
                <span>Shadowrocket等客户端</span>
              </span>
            </div>
            <el-button size="small" @click="copyLink(userInfo.subscription_url)">
              <el-icon><CopyDocument /></el-icon>
              复制
            </el-button>
          </div>
          <div class="mini-copy-row">
            <div class="mini-copy-text">
              <span class="mini-copy-title">Clash订阅</span>
              <span class="mini-copy-desc" aria-label="适用于 FlClash、Clash Verge、Clash Mi等客户端">
                <span>适用于 FlClash、Clash Verge、</span>
                <span>Clash Mi等客户端</span>
              </span>
            </div>
            <el-button size="small" @click="copyLink(userInfo.clash_url)">
              <el-icon><CopyDocument /></el-icon>
              复制
            </el-button>
          </div>
        </div>
      </article>

      <article class="panel-card dashboard-card announcement-card">
        <div class="dashboard-card-head announcement-card-title">
          <div class="announcement-title-with-icon">
            <el-icon><Bell /></el-icon>
            <span>系统公告</span>
          </div>
        </div>

        <div v-if="announcements.length > 0" class="announcement-list">
          <button
            v-for="announcement in announcements"
            :key="announcement.id"
            type="button"
            class="announcement-item"
            @click="openAnnouncementDetail(announcement)"
          >
            <span class="announcement-title-row">
              <span class="announcement-dot" :class="{ pinned: announcement.pinned }"></span>
              <span class="announcement-title">{{ announcement.title }}</span>
            </span>
            <span class="announcement-time">{{ formatDate(announcement.created_at) }}</span>
          </button>
        </div>

        <el-empty v-else description="暂无公告" />
      </article>
    </section>

    <section class="current-plan-section">
      <header class="current-plan-head">
        <h2>我的套餐</h2>
        <span class="current-plan-count">{{ currentPlanCount }}</span>
      </header>

      <div class="current-plan-filter" aria-label="我的套餐类型筛选">
        <button
          v-for="filter in currentPlanFilters"
          :key="filter.value"
          type="button"
          class="current-plan-filter-button"
          :class="{ active: selectedCurrentPlanFilter === filter.value }"
          @click="selectedCurrentPlanFilter = filter.value"
        >
          <span v-if="filter.value === CURRENT_PLAN_FILTER_ALL">全部</span>
          <span v-else>{{ filter.label }}</span>
        </button>
      </div>

      <div class="current-plan-list">
        <article
          v-for="plan in filteredCurrentPlanCards"
          :key="plan.type"
          class="panel-card current-plan-card"
        >
          <div class="current-plan-top">
            <div class="current-plan-title-block">
              <h3 class="current-plan-name">{{ plan.name }}</h3>
            </div>
            <div class="current-plan-side">
              <el-tag class="package-status-tag" :type="getPlanStatusType(plan)">
                {{ getPlanStatusText(plan) }}
              </el-tag>
              <div class="current-plan-price">
                <span class="current-plan-currency">¥</span>
                <strong class="current-plan-amount">{{ plan.priceText }}</strong>
              </div>
            </div>
          </div>

          <div class="current-plan-body">
            <div class="current-plan-metric">
              <span>流量使用</span>
              <strong>{{ plan.trafficText }}</strong>
            </div>
            <div class="current-plan-metric">
              <span>时长周期</span>
              <strong>{{ plan.durationText }}</strong>
            </div>
          </div>

          <footer class="current-plan-footer">
            <span class="current-plan-expire" :class="{ warning: isPlanExpireWarning(plan) }">
              到期时间：{{ plan.expireText }}
            </span>
            <router-link :to="getCurrentPlanRenewRoute(plan)" class="renew-plan-button">
              续费
            </router-link>
          </footer>
        </article>
      </div>
    </section>

    <el-dialog
      v-model="announcementPopupVisible"
      :width="announcementDialogWidth"
      :close-on-click-modal="false"
      :show-close="false"
      class="announcement-popup-dialog"
      @close="handleAnnouncementPopupClose"
    >
      <template #header>
        <div class="announcement-popup-dialog-header">
          <span class="announcement-popup-dialog-title">系统公告</span>
          <button
            type="button"
            class="announcement-popup-close-button"
            @click="announcementPopupVisible = false"
          >
            关闭
          </button>
        </div>
      </template>
      <div v-if="popupAnnouncement" class="announcement-popup-body">
        <div class="announcement-popup-head">
          <h3 class="announcement-popup-title">{{ popupAnnouncement.title }}</h3>
          <span class="announcement-popup-time">{{ formatDate(popupAnnouncement.created_at) }}</span>
        </div>
        <div
          class="announcement-popup-content"
          v-html="renderMarkdown(popupAnnouncement.content)"
        ></div>
      </div>
    </el-dialog>

    <el-dialog
      v-model="announcementDetailVisible"
      :width="announcementDialogWidth"
      class="announcement-detail-dialog"
    >
      <template #header>
        <div class="announcement-popup-dialog-header">
          <span class="announcement-popup-dialog-title">系统公告</span>
        </div>
      </template>
      <div v-if="selectedAnnouncement" class="announcement-popup-body">
        <div class="announcement-popup-head">
          <h3 class="announcement-popup-title">{{ selectedAnnouncement.title }}</h3>
          <span class="announcement-popup-time">{{ formatDate(selectedAnnouncement.created_at) }}</span>
        </div>
        <div
          class="announcement-popup-content"
          v-html="renderMarkdown(selectedAnnouncement.content)"
        ></div>
      </div>
    </el-dialog>

    <el-dialog
      v-model="syncLoading"
      title="账户同步中"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
      width="400px"
    >
      <div class="sync-loading-content">
        <el-icon class="sync-loading-icon"><Loading /></el-icon>
        <p>您的账号信息正在同步到服务器，请稍候...</p>
        <p class="sync-loading-tip">同步完成后将自动关闭此窗口。</p>
      </div>
    </el-dialog>

    <el-dialog
      v-model="optimizing"
      title="极速通道优化中"
      :width="optimizeDialogWidth"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
      class="optimize-dialog"
    >
      <div class="optimize-dialog-content">
        <el-alert
          title="正在为您选择更快的线路，请稍候..."
          description="系统会自动检测网络质量，并应用更优的连接方案。"
          type="warning"
          :closable="false"
          show-icon
        />
        <div class="progress-panel">
          <el-progress
            :percentage="optimizeProgress"
            :stroke-width="18"
            :text-inside="true"
            :status="optimizeProgress === 100 ? 'success' : ''"
          />
          <p class="progress-text">{{ optimizeStatusText }}</p>
        </div>
      </div>
    </el-dialog>

    <el-dialog
      v-model="generatingSubscription"
      title="生成订阅中"
      :width="optimizeDialogWidth"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
      class="generate-dialog"
    >
      <div class="generate-dialog-content">
        <div class="generate-loading-orb">
          <el-icon class="generate-loading-icon"><Loading /></el-icon>
        </div>
        <h3 class="generate-dialog-title">正在生成订阅链接</h3>
        <p class="generate-dialog-text">系统正在同步节点信息并生成通用订阅和 Clash 订阅链接，请稍候。</p>
        <div class="generate-loading-dots" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    </el-dialog>

    <el-dialog
      v-model="replacingSubscription"
      title="更换订阅中"
      :width="optimizeDialogWidth"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
      class="generate-dialog"
    >
      <div class="generate-dialog-content">
        <div class="generate-loading-orb">
          <el-icon class="generate-loading-icon"><Loading /></el-icon>
        </div>
        <h3 class="generate-dialog-title">正在更换订阅链接</h3>
        <p class="generate-dialog-text">系统正在生成新的订阅链接并刷新订阅缓存，请稍候。</p>
        <div class="generate-loading-dots" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    </el-dialog>

    <el-tour
      v-if="!isMobileView"
      v-model="onboardingTourVisible"
      v-model:current="onboardingTourCurrent"
      :show-close="true"
      :scroll-into-view-options="{ block: 'center', behavior: 'smooth' }"
      @close="completeOnboardingGuide"
      @finish="completeOnboardingGuide"
      @change="handleOnboardingStepChange"
    >
      <el-tour-step
        v-for="step in onboardingTourSteps"
        :key="step.key"
        :target="step.target"
        :title="step.title"
        :description="step.description"
        :placement="step.placement"
        :prev-button-props="{ children: '上一步' }"
        :next-button-props="{ children: step.nextText }"
      />
    </el-tour>

    <div
      v-if="onboardingTourVisible && isMobileView"
      class="mobile-onboarding-layer"
      @touchmove.prevent
      @wheel.prevent
    >
      <div class="mobile-onboarding-mask"></div>
      <section class="mobile-onboarding-panel">
        <button
          type="button"
          class="mobile-onboarding-close"
          aria-label="关闭新手引导"
          @click="completeOnboardingGuide"
        >
          跳过
        </button>
        <h3 class="mobile-onboarding-title">{{ currentOnboardingStep.title }}</h3>
        <p class="mobile-onboarding-desc">{{ currentOnboardingStep.description }}</p>
        <footer class="mobile-onboarding-footer">
          <div class="mobile-onboarding-dots" aria-hidden="true">
            <span
              v-for="(step, index) in onboardingTourSteps"
              :key="step.key"
              :class="{ active: index === onboardingTourCurrent }"
            ></span>
          </div>
          <div class="mobile-onboarding-actions">
            <el-button
              v-if="onboardingTourCurrent > 0"
              class="mobile-onboarding-button mobile-onboarding-button-prev"
              @click="handleMobileOnboardingPrev"
            >
              上一步
            </el-button>
            <el-button
              type="primary"
              class="mobile-onboarding-button mobile-onboarding-button-next"
              @click="handleMobileOnboardingNext"
            >
              {{ currentOnboardingStep.nextText }}
            </el-button>
          </div>
        </footer>
      </section>
    </div>
    <ReferralPosterDialog ref="referralPosterRef" :referral-url="referralUrl" />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Bell,
  CopyDocument,
  Loading,
  User
} from '@element-plus/icons-vue'
import { marked } from 'marked'
import { useUserStore } from '@/stores/user'
import ReferralPosterDialog from '@/components/ReferralPosterDialog.vue'
import api from '@/api'
import {
  getOnboardingGuideMode,
  getOnboardingGuideSteps,
  shouldCompleteOnboardingOnRouteLeave
} from '@/utils/onboarding-guide'
import {
  CF_IP_TEST_COUNT as TEST_COUNT,
  CF_IP_TEST_INTERVAL as TEST_INTERVAL
} from '@/utils/cf-ip-test-config'
import { createCfLatencySample } from '@/utils/cf-ip-browser-test.js'
import { selectFallbackCfIp, selectRecommendedCfIps } from '@/utils/cf-ip-optimizer'
import { getSubscriptionGenerationErrorMessage } from '@/utils/subscription-error'

const userStore = useUserStore()
const userInfo = ref({})
const referralUrl = ref('')
const referralSummary = ref({})
const referralPosterRef = ref(null)
const announcements = ref([])
const loading = ref(false)
const cfOptimized = ref(false)
const optimizing = ref(false)
const onlineCustomerServiceUrl = ref('')
const optimizeProgress = ref(0)
const optimizeStatusText = ref('')
const generatingSubscription = ref(false)
const replacingSubscription = ref(false)
const announcementPopupVisible = ref(false)
const popupAnnouncement = ref(null)
const announcementDetailVisible = ref(false)
const selectedAnnouncement = ref(null)
const popupClosing = ref(false)
const syncLoading = ref(false)
const syncTimer = ref(null)
const windowWidth = ref(window.innerWidth)
const onboardingTourVisible = ref(false)
const onboardingTourCurrent = ref(0)
const onboardingCompletionSaving = ref(false)
const optimizeFailureCount = ref(0)

const MOBILE_ONBOARDING_TARGET_CLASS = 'mobile-onboarding-target'
const MOBILE_ONBOARDING_TARGET_HOST_CLASS = 'mobile-onboarding-target-host'
const MAX_OPTIMIZE_FAILURE_COUNT = 3
const CURRENT_PLAN_FILTER_ALL = 'all'
const CURRENT_PLAN_TYPE_LABELS = {
  timed: '限时套餐',
  lifetime: '不限时套餐',
  home_ip: '家宽套餐'
}

const selectedCurrentPlanFilter = ref('all')

const actionBusy = computed(() => optimizing.value || generatingSubscription.value || replacingSubscription.value)
const optimizeDialogWidth = computed(() => (windowWidth.value <= 768 ? '94%' : '420px'))
const announcementDialogWidth = computed(() => (windowWidth.value <= 768 ? '92vw' : '720px'))
const onboardingGuideMode = computed(() => getOnboardingGuideMode(windowWidth.value))
const isMobileView = computed(() => onboardingGuideMode.value === 'mobile')
const onboardingTourSteps = computed(() => getOnboardingGuideSteps({
  isMobile: isMobileView.value,
  subscriptionReady: !!userInfo.value.subscription_ready
}))
const currentOnboardingStep = computed(() => onboardingTourSteps.value[onboardingTourCurrent.value] || onboardingTourSteps.value[0] || {})

const displayName = computed(() => {
  if (!userInfo.value.email) return '欢迎回来'
  return userInfo.value.email.split('@')[0]
})

const telegramChannelUrl = computed(() => {
  return String(userInfo.value.telegram_channel_url || '').trim()
})

const onlineCustomerServiceHref = computed(() => {
  const serviceUrl = onlineCustomerServiceUrl.value
  const userEmail = String(userInfo.value.email || '').trim()
  if (!serviceUrl || !userEmail) return serviceUrl

  try {
    const url = new URL(serviceUrl)
    url.searchParams.set('user', userEmail)
    return url.toString()
  } catch (error) {
    const separator = serviceUrl.includes('?') ? '&' : '?'
    return `${serviceUrl}${separator}user=${encodeURIComponent(userEmail)}`
  }
})

const greetingText = computed(() => {
  const hour = new Date().getHours()
  if (hour < 12) return '早上好'
  if (hour < 18) return '下午好'
  return '晚上好'
})

const compactTrafficUsageText = computed(() => {
  const usedTrafficText = userInfo.value.traffic_used_text || '0 B'
  const totalTrafficText = userInfo.value.total_traffic_limit_text || userInfo.value.traffic_limit_text || '0 B'

  return `${usedTrafficText} / ${totalTrafficText}`
})

const currentPlanCards = computed(() => {
  const cards = []
  if (userInfo.value.plan_id) {
    cards.push(createCurrentPlanCard({
      type: 'traffic',
      planId: userInfo.value.plan_id,
      name: userInfo.value.plan_name,
      price: userInfo.value.plan_price,
      priceText: userInfo.value.plan_price_text,
      durationDays: userInfo.value.plan_duration_days,
      planType: resolveCurrentPlanType(userInfo.value.plan_type),
      trafficText: compactTrafficUsageText.value,
      expireAt: userInfo.value.expire_at
    }))
  }

  if (userInfo.value.home_plan_id) {
    cards.push(createCurrentPlanCard({
      type: 'home_ip',
      planId: userInfo.value.home_plan_id,
      name: userInfo.value.home_plan_name,
      price: userInfo.value.home_plan_price,
      priceText: userInfo.value.home_plan_price_text,
      durationDays: userInfo.value.home_plan_duration_days,
      planType: 'home_ip',
      trafficText: '无限制',
      expireAt: userInfo.value.home_expire_at
    }))
  }

  return cards
})

const currentPlanCount = computed(() => currentPlanCards.value.length)
const currentPlanFilters = computed(() => {
  const typeSet = new Set(currentPlanCards.value.map((plan) => plan.planType))
  const typeFilters = Array.from(typeSet)
    .filter((type) => CURRENT_PLAN_TYPE_LABELS[type])
    .map((type) => ({
      value: type,
      label: CURRENT_PLAN_TYPE_LABELS[type]
    }))

  return [
    { value: CURRENT_PLAN_FILTER_ALL, label: '全部' },
    ...typeFilters
  ]
})
const filteredCurrentPlanCards = computed(() => {
  if (selectedCurrentPlanFilter.value === CURRENT_PLAN_FILTER_ALL) {
    return currentPlanCards.value
  }

  return currentPlanCards.value.filter((plan) => plan.planType === selectedCurrentPlanFilter.value)
})

const rewardAmountText = computed(() => {
  if (referralSummary.value.reward_amount_text) {
    return referralSummary.value.reward_amount_text
  }

  return `${((Number(referralSummary.value.reward_amount) || 0) / 100).toFixed(2)} 元`
})

const homeExpireText = computed(() => {
  if (!userInfo.value.home_plan_name) return '暂无可订阅'
  return formatTime(userInfo.value.home_expire_at) || '暂无可订阅'
})

const accountStatusText = computed(() => {
  return userInfo.value.status_text || (userInfo.value.enabled ? '正常' : '禁用')
})

const accountStatusType = computed(() => {
  const status = userInfo.value.status || (userInfo.value.enabled ? 'active' : 'disabled')
  const typeMap = { active: 'success', disabled: 'danger', renew: 'warning' }
  return typeMap[status] || 'info'
})

async function fetchUserInfo() {
  try {
    loading.value = true
    const result = await userStore.fetchUserProfile()
    if (result.success) {
      userInfo.value = result.data
      cfOptimized.value = result.data.cf_optimized || false
      userStore.userInfo = result.data
    }
  } catch (error) {
    console.error('获取用户信息失败:', error)
  } finally {
    loading.value = false
  }
}

async function fetchAnnouncements() {
  try {
    const response = await api.user.getAnnouncements({ page: 1, limit: 3 })
    if (response.code === 0) {
      announcements.value = response.data.list || []
    }
  } catch (error) {
    console.error('获取公告列表失败:', error)
  }
}

/**
 * 加载用户首页需要展示的公开外链设置。
 * 核心分支：管理端未配置在线客服链接时保持空字符串，模板会自动隐藏入口。
 */
async function loadPublicSettings() {
  try {
    const res = await api.user.getPublicSettings()
    if (res.code === 0) {
      onlineCustomerServiceUrl.value = String(res.data?.online_customer_service_url || '').trim()
    }
  } catch (error) {
    console.error('加载公开设置失败:', error)
  }
}

/**
 * 拉取首页公告弹窗判断结果。
 * 后端负责判断最新公告和用户关闭次数，前端只在 should_popup 为 true 时展示。
 */
async function fetchAnnouncementPopup() {
  try {
    const response = await api.user.getLatestAnnouncementPopup()
    if (response.code === 0 && response.data?.should_popup && response.data?.announcement) {
      popupAnnouncement.value = response.data.announcement
      announcementPopupVisible.value = true
    }
  } catch (error) {
    console.error('获取公告弹窗失败:', error)
  }
}

/**
 * 处理公告弹窗关闭。
 * 先关闭界面，再异步上报关闭次数，避免接口异常影响用户操作。
 */
async function handleAnnouncementPopupClose() {
  const announcementId = popupAnnouncement.value?.id
  announcementPopupVisible.value = false

  if (!announcementId || popupClosing.value) {
    return
  }

  try {
    popupClosing.value = true
    await api.user.reportAnnouncementPopupClose(announcementId)
  } catch (error) {
    console.error('上报公告弹窗关闭失败:', error)
  } finally {
    popupClosing.value = false
  }
}

async function checkSyncStatus(profileData = null) {
  try {
    const data = profileData || (await userStore.fetchUserProfile()).data
    if (data) {
      userInfo.value = data
      cfOptimized.value = data.cf_optimized || false

      if (data.payment_count === 1 && data.sync_status !== 2) {
        syncLoading.value = true
        startSyncPolling()
      } else {
        await scheduleOnboardingGuide(data)
      }
    }
  } catch (error) {
    console.error('获取用户信息失败:', error)
  }
}

function startSyncPolling() {
  syncTimer.value = setInterval(async () => {
    try {
      const response = await api.user.getSyncStatus()
      if (response.code === 0 && response.data.sync_status === 2) {
        syncLoading.value = false
        clearInterval(syncTimer.value)
        syncTimer.value = null
        await fetchUserInfo()
        await scheduleOnboardingGuide(userInfo.value)
      }
    } catch (error) {
      console.error('检查同步状态失败:', error)
    }
  }, 5000)
}

/**
 * 判断当前用户是否需要展示新手引导。
 * 仅首单账号、同步完成且后端未标记完成时展示，避免老账号和已完成账号重复弹出。
 *
 * @param {Object} profile - 用户资料
 * @returns {boolean} 是否需要展示
 */
function shouldShowOnboardingGuide(profile) {
  return Number(profile?.payment_count) === 1 &&
    Number(profile?.sync_status) === 2 &&
    profile?.onboarding_completed !== true
}

/**
 * 在同步弹窗关闭和 DOM 更新后启动新手引导。
 * 移动端会先滚动到订阅工作区，解决首页首屏看不到操作区的问题。
 *
 * @param {Object} profile - 用户资料
 * @returns {Promise<void>}
 */
async function scheduleOnboardingGuide(profile) {
  if (!shouldShowOnboardingGuide(profile) || syncLoading.value || onboardingTourVisible.value) {
    return
  }

  await startOnboardingGuide(false)
}

/**
 * 启动新手引导流程。
 * 自动触发时遵循后端完成状态，手动触发时允许用户重复查看。
 *
 * @param {boolean} manual - 是否用户手动触发
 * @returns {Promise<void>}
 */
async function startOnboardingGuide(manual = false) {
  if (!manual && !shouldShowOnboardingGuide(userInfo.value)) {
    return
  }

  if (onboardingTourVisible.value) {
    return
  }

  await nextTick()

  if (isMobileView.value) {
    scrollToOnboardingTarget(onboardingTourSteps.value[0]?.target)
    await waitForScroll()
  }

  onboardingTourCurrent.value = 0
    onboardingTourVisible.value = true

  if (isMobileView.value) {
    lockMobileOnboardingPage()
    await nextTick()
    activateMobileOnboardingTarget()
  }
}

/**
 * 引导步骤切换时确保目标可见，并在移动端刷新高亮元素。
 *
 * @param {number} current - 当前步骤索引
 */
function handleOnboardingStepChange(current) {
  if (!isMobileView.value) {
    return
  }

  const target = onboardingTourSteps.value[current]?.target
  if (target) {
    scrollToOnboardingTarget(target)
  }
}

/**
 * 移动端切换到指定引导步骤。
 *
 * @param {number} nextStep - 目标步骤索引
 * @returns {Promise<void>}
 */
async function goToOnboardingStep(nextStep) {
  onboardingTourCurrent.value = nextStep
  const target = onboardingTourSteps.value[nextStep]?.target
  if (target) {
    scrollToOnboardingTarget(target)
    await waitForScroll()
    adjustMobileCopyStepScroll(nextStep)
    await waitForScroll(120)
  }
  activateMobileOnboardingTarget()
}

/**
 * 移动端处理下一步或完成。
 */
async function handleMobileOnboardingNext() {
  blurActiveElement()

  if (onboardingTourCurrent.value >= onboardingTourSteps.value.length - 1) {
    await completeOnboardingGuide()
    return
  }

  await goToOnboardingStep(onboardingTourCurrent.value + 1)
}

/**
 * 移动端处理上一步。
 *
 * @returns {Promise<void>}
 */
async function handleMobileOnboardingPrev() {
  blurActiveElement()
  await goToOnboardingStep(onboardingTourCurrent.value - 1)
}

/**
 * 清理移动端按钮触摸后的焦点态，避免按钮看起来像禁用。
 */
function blurActiveElement() {
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur()
  }
}

/**
 * 为移动端当前目标添加高亮类。
 */
function activateMobileOnboardingTarget() {
  clearMobileOnboardingTarget()
  const target = currentOnboardingStep.value?.target
  const element = target ? document.querySelector(target) : null
  if (element) {
    element.classList.add(MOBILE_ONBOARDING_TARGET_CLASS)
    const fixedHost = element.closest('.bottom-nav')
    if (fixedHost) {
      fixedHost.classList.add(MOBILE_ONBOARDING_TARGET_HOST_CLASS)
    }
  }
}

/**
 * 清理移动端目标高亮类。
 */
function clearMobileOnboardingTarget() {
  document
    .querySelectorAll(`.${MOBILE_ONBOARDING_TARGET_CLASS}`)
    .forEach(element => element.classList.remove(MOBILE_ONBOARDING_TARGET_CLASS))
  document
    .querySelectorAll(`.${MOBILE_ONBOARDING_TARGET_HOST_CLASS}`)
    .forEach(element => element.classList.remove(MOBILE_ONBOARDING_TARGET_HOST_CLASS))
}

/**
 * 第三步目标较高，滚动后按说明面板位置修正，确保蓝框底部停在白色面板上方。
 *
 * @param {number} stepIndex - 步骤索引
 */
function adjustMobileCopyStepScroll(stepIndex) {
  if (!isMobileView.value || onboardingTourSteps.value[stepIndex]?.key !== 'copy') {
    return
  }

  const target = document.querySelector(currentOnboardingStep.value?.target)
  const panel = document.querySelector('.mobile-onboarding-panel')
  if (!target || !panel) {
    return
  }

  const targetRect = target.getBoundingClientRect()
  const panelRect = panel.getBoundingClientRect()
  const gap = 14
  const overlap = targetRect.bottom - panelRect.top + gap

  if (overlap > 0) {
    window.scrollBy({
      top: overlap,
      behavior: 'smooth'
    })
  }
}

/**
 * 滚动到新手引导目标元素。
 *
 * @param {string} selector - 目标选择器
 */
function scrollToOnboardingTarget(selector) {
  const element = document.querySelector(selector)
  if (element) {
    element.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
}

/**
 * 等待平滑滚动完成一个短周期，让 Tour 定位能拿到稳定位置。
 *
 * @returns {Promise<void>}
 */
function waitForScroll() {
  return new Promise(resolve => setTimeout(resolve, 320))
}

/**
 * 将当前用户的新手引导标记为完成。
 * 完成或手动关闭都会写回后端，避免同一账号跨设备重复提示。
 */
async function completeOnboardingGuide() {
  onboardingTourVisible.value = false
  clearMobileOnboardingTarget()
  unlockMobileOnboardingPage()

  if (onboardingCompletionSaving.value || userInfo.value.onboarding_completed === true) {
    return
  }

  try {
    onboardingCompletionSaving.value = true
    const response = await api.user.completeOnboarding()
    if (response.code === 0) {
      userInfo.value = {
        ...userInfo.value,
        onboarding_completed: true
      }
      userStore.userInfo = {
        ...(userStore.userInfo || {}),
        onboarding_completed: true
      }
    }
  } catch (error) {
    console.error('标记新手引导完成失败:', error)
  } finally {
    onboardingCompletionSaving.value = false
  }
}

function handleResize() {
  windowWidth.value = window.innerWidth
  if (onboardingTourVisible.value && isMobileView.value) {
    lockMobileOnboardingPage()
    activateMobileOnboardingTarget()
  } else {
    unlockMobileOnboardingPage()
  }
}

/**
 * 移动端引导期间锁住页面滚动，避免灰色背景区域仍可滑动。
 */
function lockMobileOnboardingPage() {
  document.body.style.overflow = 'hidden'
  document.documentElement.style.overflow = 'hidden'
}

/**
 * 恢复移动端页面滚动。
 */
function unlockMobileOnboardingPage() {
  document.body.style.overflow = ''
  document.documentElement.style.overflow = ''
}

function renderMarkdown(content) {
  if (!content) return ''
  return marked(content)
}

/**
 * 打开公告详情弹窗。
 * @param {Object} announcement - 当前点击的公告对象。
 */
function openAnnouncementDetail(announcement) {
  selectedAnnouncement.value = announcement
  announcementDetailVisible.value = true
}

async function copyLink(link) {
  if (!link) {
    ElMessage.warning('没有订阅链接，需要先生成')
    return
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(link)
    } else {
      fallbackCopyText(link)
    }
    ElMessage.success('链接已复制到剪贴板')
  } catch (error) {
    try {
      fallbackCopyText(link)
      ElMessage.success('链接已复制到剪贴板')
    } catch (fallbackError) {
      console.error('复制链接失败:', error, fallbackError)
      ElMessage.error('复制失败，请手动复制')
    }
  }
}

function fallbackCopyText(text) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'readonly')
  textarea.style.position = 'fixed'
  textarea.style.top = '-9999px'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)
  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)

  if (!copied) {
    throw new Error('execCommand copy failed')
  }
}

async function generateSubscription() {
  if (generatingSubscription.value || optimizing.value || replacingSubscription.value) {
    return
  }

  if (!cfOptimized.value) {
    ElMessage.warning('请先开启极速通道')
    return
  }

  try {
    generatingSubscription.value = true
    const response = await api.user.generateSubscription()
    if (response.code === 0) {
      userInfo.value = {
        ...userInfo.value,
        subscription_url: response.data.subscription_url,
        clash_url: response.data.clash_url,
        subscription_ready: true
      }
      userStore.userInfo = {
        ...(userStore.userInfo || {}),
        subscription_url: response.data.subscription_url,
        clash_url: response.data.clash_url,
        subscription_ready: true
      }
      ElMessage.success('订阅链接已生成')
    } else {
      ElMessage.error(response.message || '生成订阅链接失败')
    }
  } catch (error) {
    console.error('生成订阅链接失败:', error)
    ElMessage.error(getSubscriptionGenerationErrorMessage(error))
  } finally {
    generatingSubscription.value = false
  }
}

/**
 * 确认并更换当前用户的公开订阅链接。
 * 职责：二次确认风险提示，成功后刷新页面中的通用/Clash 订阅地址。
 * 核心分支：用户取消时直接返回；后端失败时保留原链接并展示错误提示。
 *
 * @returns {Promise<void>}
 */
async function confirmReplaceSubscriptionLink() {
  if (replacingSubscription.value || optimizing.value || generatingSubscription.value) {
    return
  }

  try {
    await ElMessageBox.confirm(
      '更换后，当前已导入到客户端中的订阅链接将失效，需要重新导入更换后的新订阅链接。',
      '更换订阅链接',
      {
        confirmButtonText: '确认更换',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
  } catch (error) {
    return
  }

  try {
    replacingSubscription.value = true
    const response = await api.user.replaceSubscriptionLink()
    if (response.code === 0) {
      userInfo.value = {
        ...userInfo.value,
        subscription_url: response.data.subscription_url,
        clash_url: response.data.clash_url,
        subscription_ready: true
      }
      userStore.userInfo = {
        ...(userStore.userInfo || {}),
        subscription_url: response.data.subscription_url,
        clash_url: response.data.clash_url,
        subscription_ready: true
      }
      ElMessage.success('订阅链接已更换，请重新导入客户端')
    } else {
      ElMessage.error(response.message || '更换订阅链接失败')
    }
  } catch (error) {
    console.error('更换订阅链接失败:', error)
    ElMessage.error(getSubscriptionGenerationErrorMessage(error))
  } finally {
    replacingSubscription.value = false
  }
}

async function startOptimize() {
  if (optimizing.value || generatingSubscription.value || replacingSubscription.value) {
    return
  }

  try {
    optimizing.value = true
    optimizeProgress.value = 0
    optimizeStatusText.value = '正在准备线路检测...'

    const response = await api.user.getCfIps()
    if (response.code !== 0) {
      throw new Error('线路检测服务暂不可用')
    }

    const ipPool = response.data.ips
    if (!ipPool || ipPool.length === 0) {
      throw new Error('暂无可用线路，请联系管理员')
    }

    const totalIps = ipPool.length
    let completedIps = 0

    const ipTestData = ipPool.map(item => ({
      id: item.id,
      ip: item.ip,
      latency: -1,
      successTimes: 0,
      testedTimes: 0,
      testResults: [],
      testStatus: 'pending'
    }))

    await Promise.all(ipTestData.map(async (ipData) => {
      await testSingleIp(ipData)
      completedIps += 1
      optimizeProgress.value = 10 + Math.round((completedIps / totalIps) * 70)
      optimizeStatusText.value = '正在检测线路质量...'
    }))

    ipTestData.forEach(ipData => {
      if (ipData.testResults.length > 0) {
        const sum = ipData.testResults.reduce((acc, item) => acc + item, 0)
        ipData.avgLatency = Math.round(sum / ipData.testResults.length)
        ipData.packetLoss = Math.round((1 - ipData.successTimes / ipData.testedTimes) * 100)
      } else {
        ipData.avgLatency = -1
        ipData.packetLoss = 100
      }
    })

    optimizeProgress.value = 85
    optimizeStatusText.value = '正在匹配最佳线路...'

    const selectedIps = selectRecommendedCfIps(ipTestData)
    if (selectedIps.length === 0) {
      optimizeFailureCount.value += 1
      if (optimizeFailureCount.value >= MAX_OPTIMIZE_FAILURE_COUNT) {
        await applyFallbackOptimize(ipPool)
        return
      }
      throw new Error(`当前网络暂时无法完成线路检测，请稍后重试（${optimizeFailureCount.value}/3）`)
    }

    optimizeProgress.value = 95
    optimizeStatusText.value = '正在应用优化结果...'

    const ipIds = selectedIps.map(item => item.id)
    const applyResponse = await api.user.applyCfIps(ipIds)

    if (applyResponse.code === 0) {
      optimizeProgress.value = 100
      optimizeStatusText.value = '极速通道已开启'
      cfOptimized.value = true
      optimizeFailureCount.value = 0
      await fetchUserInfo()
      ElMessage.success('已成功开启极速通道')
    } else {
      throw new Error(applyResponse.message || '应用优化结果失败')
    }
  } catch (error) {
    console.error('一键优选失败:', error)
    ElMessage.error(error.message || '线路优化失败，请重试')
    optimizeProgress.value = 0
    optimizeStatusText.value = ''
  } finally {
    setTimeout(() => {
      optimizing.value = false
    }, 1500)
  }
}

/**
 * 连续检测失败后的备用配置入口。
 * @param {Object[]} ipPool - 本轮后端返回的候选线路池。
 * @returns {Promise<void>} 备用配置保存并提示用户后完成。
 */
async function applyFallbackOptimize(ipPool) {
  const fallbackIp = selectFallbackCfIp(ipPool)
  if (!fallbackIp) {
    throw new Error('暂无可用线路，请联系管理员')
  }

  optimizeProgress.value = 95
  optimizeStatusText.value = '正在启用备用配置...'

  const applyResponse = await api.user.applyCfIps([fallbackIp.id])
  if (applyResponse.code !== 0) {
    throw new Error(applyResponse.message || '启用备用配置失败')
  }

  optimizeProgress.value = 100
  optimizeStatusText.value = '备用配置已启用'
  cfOptimized.value = true
  optimizeFailureCount.value = 0
  await fetchUserInfo()
  await ElMessageBox.alert(
    '当前网络环境无法完成线路检测。这通常与您当前使用的网络有关，并不是系统故障。我们已为您启用备用配置，您可以继续生成订阅；除极速线路以外的其他节点不受影响，可以正常使用。',
    '已启用备用配置',
    {
      confirmButtonText: '我知道了',
      type: 'warning'
    }
  )
}

async function testSingleIp(ipData) {
  for (let i = 0; i < TEST_COUNT; i += 1) {
    try {
      const latency = await pingIp(ipData.ip)
      ipData.testedTimes += 1

      if (latency > 0) {
        ipData.successTimes += 1
        ipData.testResults.push(latency)
        ipData.latency = latency
      }

      if (i < TEST_COUNT - 1) {
        await new Promise(resolve => setTimeout(resolve, TEST_INTERVAL))
      }
    } catch {
      ipData.testedTimes += 1
    }
  }
  ipData.testStatus = 'done'
}

function pingIp(ip) {
  return createCfLatencySample(ip)
}

/**
 * 构建“我的套餐”单张卡片展示数据。
 * 核心分支：家宽套餐由调用方传入“无限制”流量文案，限时套餐按独立到期时间判断状态。
 *
 * @param {Object} options - 套餐字段集合
 * @returns {Object} 套餐卡片展示对象
 */
function createCurrentPlanCard(options) {
  const planType = resolveCurrentPlanType(options.planType)
  const expireAt = Number(options.expireAt || 0)
  return {
    type: options.type,
    planId: options.planId,
    planType,
    name: options.name || '暂无套餐',
    priceText: formatPlanPriceText(options.priceText, options.price),
    trafficText: options.trafficText,
    durationText: formatPlanDurationText(options.durationDays, planType),
    expireAt,
    expireText: formatPlanExpireText(expireAt, planType)
  }
}

/**
 * 构建首页套餐卡片的定向续费路由。
 * 核心分支：普通套餐和家宽套餐都使用数据库套餐 ID，套餐页再按 plan_type 切换对应分区。
 *
 * @param {Object} plan - 当前套餐卡片
 * @returns {{path:string,query:Object}} 套餐页路由对象
 */
function getCurrentPlanRenewRoute(plan) {
  return {
    path: '/user/plans',
    query: {
      plan_id: plan.planId,
      plan_type: plan.planType
    }
  }
}

/**
 * 规范化当前套餐类型。
 * 核心分支：数据库历史空类型按不限时套餐处理，仅显式 timed/home_ip 才进入对应分类。
 *
 * @param {string} planType - 后端返回的套餐类型
 * @returns {'timed'|'lifetime'|'home_ip'} 前端筛选使用的稳定类型
 */
function resolveCurrentPlanType(planType) {
  if (planType === 'timed') return 'timed'
  if (planType === 'home_ip') return 'home_ip'
  return 'lifetime'
}

/**
 * 格式化套餐价格，优先使用后端已格式化金额。
 *
 * @param {string} priceText - 后端返回的价格文本
 * @param {number|string} price - 分为单位的价格
 * @returns {string} 两位小数金额
 */
function formatPlanPriceText(priceText, price) {
  if (priceText) return priceText

  const planPrice = Number(price)
  if (Number.isFinite(planPrice)) {
    return (planPrice / 100).toFixed(2)
  }

  return '0.00'
}

/**
 * 格式化套餐周期。
 *
 * @param {number|string} durationDays - 周期天数
 * @param {string} planType - 套餐类型
 * @returns {string} 周期展示文本
 */
function formatPlanDurationText(durationDays, planType) {
  const days = Number(durationDays)
  if (Number.isFinite(days) && days > 0) {
    return `${days} 天周期`
  }
  if ((Number.isFinite(days) && days === 0) || planType === 'lifetime') {
    return '不限时套餐'
  }

  return '周期待确认'
}

/**
 * 格式化套餐到期时间。
 *
 * @param {number} expireAt - 秒级到期时间
 * @param {string} planType - 套餐类型
 * @returns {string} 到期时间展示文本
 */
function formatPlanExpireText(expireAt, planType) {
  if (planType === 'lifetime' || Number(expireAt || 0) === 0) {
    return '长期有效'
  }

  return formatCurrentPlanExpireTime(expireAt) || '暂无可订阅'
}

/**
 * 判断套餐是否已过期。
 *
 * @param {Object} plan - 当前套餐卡片
 * @returns {boolean} 已过期返回 true
 */
function isPlanExpired(plan) {
  const expireAt = Number(plan?.expireAt || 0)
  return Number.isFinite(expireAt) && expireAt > 0 && expireAt <= Math.floor(Date.now() / 1000)
}

/**
 * 判断套餐是否临近到期。
 *
 * @param {Object} plan - 当前套餐卡片
 * @returns {boolean} 到期时间小于三天且未过期时返回 true
 */
function isPlanExpiringSoon(plan) {
  if (isPlanExpired(plan)) {
    return false
  }

  const expireAt = Number(plan?.expireAt || 0)
  if (!Number.isFinite(expireAt) || expireAt <= 0) {
    return false
  }

  const remainingSeconds = expireAt - Math.floor(Date.now() / 1000)
  return remainingSeconds > 0 && remainingSeconds < 3 * 24 * 60 * 60
}

function isPlanExpireWarning(plan) {
  return isPlanExpired(plan) || isPlanExpiringSoon(plan)
}

function getPlanStatusText(plan) {
  return isPlanExpired(plan) ? '过期' : '正常'
}

function getPlanStatusType(plan) {
  return isPlanExpired(plan) ? 'warning' : 'success'
}

function formatDate(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp * 1000)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
}

function formatTime(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp * 1000)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
}

function formatCurrentPlanExpireTime(timestamp) {
  if (!timestamp) return ''

  const date = new Date(Number(timestamp) * 1000)
  if (Number.isNaN(date.getTime())) return ''

  const pad = (value) => String(value).padStart(2, '0')
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hour = pad(date.getHours())
  const minute = pad(date.getMinutes())
  const second = pad(date.getSeconds())

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}

/**
 * 获取当前用户的推广链接。
 *
 * @returns {Promise<void>} 成功时保存推广链接；请求失败时仅记录错误，不阻塞页面加载。
 */
async function fetchReferralUrl() {
  try {
    const response = await api.user.getReferralSummary()
    if (response.code === 0) {
      referralSummary.value = response.data || {}
      referralUrl.value = response.data?.referral_url || ''
    }
  } catch (error) {
    console.error('获取推广链接失败:', error)
  }
}

onMounted(async () => {
  window.addEventListener('resize', handleResize)
  await fetchUserInfo()
  loadPublicSettings()
  fetchReferralUrl()
  fetchAnnouncements()
  fetchAnnouncementPopup()
  checkSyncStatus(userInfo.value)
})

onBeforeRouteLeave(async () => {
  if (shouldCompleteOnboardingOnRouteLeave({
    visible: onboardingTourVisible.value,
    current: onboardingTourCurrent.value,
    steps: onboardingTourSteps.value
  })) {
    await completeOnboardingGuide()
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  clearMobileOnboardingTarget()
  unlockMobileOnboardingPage()
  if (syncTimer.value) {
    clearInterval(syncTimer.value)
    syncTimer.value = null
  }
})
</script>

<style scoped>
.profile-container {
  --dashboard-card-radius: 8px;
  --dashboard-border: #e5e7eb;
  --dashboard-muted: #64748b;
  --dashboard-title: #0f172a;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.dashboard-card-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 20px;
  width: 100%;
  max-width: 1680px;
  margin: 0 auto;
}

.welcome-card,
.panel-card {
  background: #fff;
  border: 1px solid var(--dashboard-border);
  border-radius: var(--dashboard-card-radius);
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
}

.dashboard-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: clamp(188px, 18vw, 260px);
  min-height: 0;
  padding: 18px;
}

.dashboard-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.dashboard-card-label {
  color: #475569;
  font-size: 14px;
  font-weight: 700;
}

.dashboard-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  border-radius: 14px;
  font-size: 22px;
}

.dashboard-icon.blue {
  background: #eef2ff;
  color: #2563eb;
}

.dashboard-icon.green {
  background: #ecfdf5;
  color: #059669;
}

.package-status-tag {
  height: 24px;
  padding: 0 10px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 700;
  line-height: 22px;
}

.account-email {
  margin-bottom: 14px;
  color: #020617;
  font-size: 23px;
  font-weight: 900;
  letter-spacing: 0;
  line-height: 1.15;
  overflow-wrap: anywhere;
}

.metric-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
}

.metric-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  color: var(--dashboard-muted);
  font-size: 14px;
}

.metric-row dt {
  flex: 0 0 auto;
  margin: 0;
}

.metric-row dd {
  min-width: 0;
  margin: 0;
  color: var(--dashboard-title);
  font-weight: 800;
  text-align: right;
  overflow-wrap: anywhere;
}

.text-link-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: flex-start;
  margin-top: auto;
  padding: 0;
  border: 0;
  background: transparent;
  color: #2563eb;
  cursor: pointer;
  font-size: 14px;
  font-weight: 700;
}

.text-link-button:hover,
.text-link-button:focus-visible {
  color: #1d4ed8;
  outline: none;
  text-decoration: underline;
}

.referral-action-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  margin-top: auto;
}

.referral-action-row .text-link-button {
  margin-top: 0;
  line-height: 1.3;
  text-decoration: none;
}

.referral-action-row .text-link-button:hover,
.referral-action-row .text-link-button:focus-visible {
  text-decoration: underline;
}

.referral-action-row .telegram-channel-button,
.referral-action-row .online-service-button {
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  color: #2563eb;
  font-weight: 700;
}

.referral-action-row .telegram-channel-button:hover,
.referral-action-row .telegram-channel-button:focus,
.referral-action-row .online-service-button:hover,
.referral-action-row .online-service-button:focus {
  background: transparent;
  color: #1d4ed8;
  text-decoration: underline;
}

.package-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.package-block + .package-block {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #eef2f7;
}

.package-title-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  color: var(--dashboard-title);
}

.package-title-row strong {
  min-width: 0;
  font-size: 20px;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.package-title-row span {
  flex: 0 0 auto;
  font-weight: 800;
}

.current-plan-section {
  width: 100%;
  max-width: 1680px;
  margin: 0 auto;
}

.current-plan-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
}

.current-plan-head h2 {
  margin: 0;
  color: #020617;
  font-size: 28px;
  font-weight: 900;
  line-height: 1.2;
  letter-spacing: 0;
}

.current-plan-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 30px;
  padding: 0 12px;
  border-radius: 15px;
  background: #eff6ff;
  color: #0b63ff;
  font-size: 15px;
  font-weight: 800;
  line-height: 1;
}

.current-plan-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 20px;
}

.current-plan-filter-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 62px;
  height: 28px;
  padding: 0 16px;
  border: 1px solid #e5e7eb;
  border-radius: 999px;
  background: #ffffff;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08);
  color: #020617;
  cursor: pointer;
  font-size: 14px;
  font-weight: 800;
  line-height: 1;
  transition: background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, color 0.2s ease;
}

.current-plan-filter-button:hover {
  border-color: #bfdbfe;
  color: #2563eb;
}

.current-plan-filter-button.active {
  border-color: #2563eb;
  background: #2563eb;
  box-shadow: 0 6px 12px rgba(37, 99, 235, 0.22);
  color: #ffffff;
}

.current-plan-list {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 20px;
}

.current-plan-card {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 178px;
  padding: 20px;
}

.current-plan-top,
.current-plan-footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  min-width: 0;
}

.current-plan-name {
  min-width: 0;
  margin: 0;
  color: var(--dashboard-title);
  font-size: 22px;
  font-weight: 900;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.current-plan-title-block {
  min-width: 0;
}

.current-plan-side {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: flex-end;
  min-width: 0;
}

.current-plan-price {
  display: flex;
  align-items: baseline;
  gap: 2px;
  margin-top: 16px;
}

.current-plan-currency {
  color: #0f766e;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
}

.current-plan-amount {
  color: #0f766e;
  font-size: 27px;
  font-weight: 900;
  line-height: 1;
}

.current-plan-body {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.current-plan-metric {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
  padding: 14px 16px;
  border: 1px solid #eef2f7;
  border-radius: var(--dashboard-card-radius);
  background: #f8fafc;
}

.current-plan-metric span {
  color: var(--dashboard-muted);
  font-size: 13px;
  font-weight: 700;
}

.current-plan-metric strong {
  color: var(--dashboard-title);
  font-size: 18px;
  font-weight: 900;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.current-plan-footer {
  align-items: center;
  margin-top: auto;
}

.current-plan-expire {
  min-width: 0;
  color: #111827;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.current-plan-expire.warning {
  color: #f59e0b;
}

.renew-plan-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  min-width: 64px;
  height: 30px;
  padding: 0 13px;
  border: 1px solid #b9efcc;
  border-radius: 4px;
  background: #e9f9ef;
  color: #009b51;
  font-size: 13px;
  font-weight: 800;
  line-height: 1;
  text-decoration: none;
}

.renew-plan-button:hover,
.renew-plan-button:focus-visible {
  border-color: #8ee5b1;
  background: #dcf7e7;
  color: #008b49;
  outline: none;
  text-decoration: none;
}

.mini-subscription-card {
  gap: 10px;
  justify-content: space-between;
}

.mini-subscription-card .dashboard-card-head {
  margin-bottom: 2px;
}

.replace-subscription-button {
  flex: 0 0 auto;
  min-height: 0;
  padding: 0;
  font-weight: 700;
}

.mini-subscription-actions {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.mini-copy-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: auto;
}

.mini-copy-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  height: 42px;
  padding: 5px 10px;
  border: 1px solid #eef2f7;
  border-radius: var(--dashboard-card-radius);
  background: #f8fafc;
  box-sizing: border-box;
}

.mini-copy-text {
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
}

.mini-copy-title {
  flex: 0 0 auto;
}

.mini-copy-desc {
  min-width: 0;
  margin-left: 12px;
  color: #64748b;
  display: flex;
  flex-direction: column;
  font-size: 10px;
  font-weight: 500;
  line-height: 1.15;
}

.mini-copy-row span {
  min-width: 0;
  color: var(--dashboard-title);
  font-size: 14px;
  font-weight: 700;
}

.mini-copy-row .mini-copy-desc span {
  color: inherit;
  font-size: inherit;
  font-weight: inherit;
  line-height: inherit;
}

.mini-copy-row .mini-copy-desc {
  color: #64748b;
  font-size: 10px;
  font-weight: 500;
}

.mini-copy-row :deep(.el-button) {
  margin-left: 0;
}

.welcome-card {
  padding: 24px;
  position: relative;
}

.welcome-main {
  min-width: 0;
}

.welcome-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  background: #f1f5f9;
  color: #475569;
  font-size: 12px;
}

.welcome-title {
  margin: 14px 0 8px;
  color: #0f172a;
  font-size: 28px;
  line-height: 1.3;
}

.status-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 999px;
  background: #f8fafc;
  color: #475569;
  font-size: 13px;
}

.welcome-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 20px;
}

.welcome-actions :deep(.el-button) {
  min-width: 140px;
}

.welcome-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.support-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.support-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.telegram-channel-button,
.online-service-button {
  border: none;
  border-radius: 16px;
  font-weight: 600;
  text-decoration: none;
}

.telegram-channel-button {
  background: #0088cc;
  box-shadow: 0 12px 24px rgba(0, 136, 204, 0.22);
}

.telegram-channel-button:hover,
.telegram-channel-button:focus {
  background: #0a9fe3;
  text-decoration: none;
}

.online-service-button {
  background: #0f766e;
  box-shadow: 0 12px 24px rgba(15, 118, 110, 0.22);
}

.online-service-button:hover,
.online-service-button:focus {
  background: #14a39a;
  text-decoration: none;
}

.telegram-channel-button:deep(span),
.telegram-channel-button:deep(.el-icon),
.online-service-button:deep(span),
.online-service-button:deep(.el-icon) {
  color: #fff;
  text-decoration: none;
}

.guide-button {
  min-width: 140px;
  border: 1px solid rgba(37, 99, 235, 0.16);
  border-radius: 16px;
  background: #eff6ff;
  color: #2563eb;
  font-weight: 600;
}

.guide-button:hover,
.guide-button:focus {
  border-color: rgba(37, 99, 235, 0.28);
  background: #dbeafe;
  color: #1d4ed8;
}

.share-friend-button {
  flex: 0 0 auto;
}

.subscription-head-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  flex: 0 0 auto;
}

.subscription-head-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.replace-subscription-button {
  flex: 0 0 auto;
}

.progress-panel {
  margin-top: 14px;
  padding: 16px;
  border-radius: 16px;
  background: #f8fafc;
}

.progress-text {
  margin: 10px 0 0;
  color: #64748b;
  font-size: 13px;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(320px, 0.9fr);
  gap: 20px;
}

.main-column,
.side-column {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}

.panel-card {
  padding: 24px;
}

.compact-card {
  padding: 22px;
}

.overview-card {
  display: flex;
  flex-direction: column;
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.panel-title {
  margin: 0;
  color: #0f172a;
  font-size: 20px;
}

.panel-subtitle {
  margin: 8px 0 0;
  color: #64748b;
  line-height: 1.6;
}

.panel-extra {
  color: #94a3b8;
  font-size: 13px;
  white-space: nowrap;
}

.step-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.mini-subscription-actions .step-action-card {
  min-height: 40px;
  padding: 8px 12px 8px 64px;
  border-radius: var(--dashboard-card-radius);
}

.mini-subscription-actions .step-action-index {
  left: 12px;
  min-width: 42px;
  padding-right: 10px;
  font-size: 14px;
  line-height: 20px;
}

.mini-subscription-actions .step-action-name {
  font-size: 13px;
}

.step-action-card {
  position: relative;
  width: 100%;
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 52px;
  border: 1px solid;
  border-radius: 14px;
  appearance: none;
  overflow: hidden;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
}

.step-action-card:hover:not(:disabled) {
  transform: translateY(-1px);
}

.step-action-card:active:not(:disabled) {
  transform: scale(0.985);
}

.step-action-card:focus-visible {
  outline: 3px solid rgba(37, 99, 235, 0.24);
  outline-offset: 2px;
}

.step-action-card.disabled,
.step-action-card:disabled {
  opacity: 0.56;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.optimize-action {
  color: #155bd7;
  border-color: #8bbcff;
  border-bottom: 3px solid #2563eb;
  background: linear-gradient(180deg, #f3f7ff 0%, #e8f1ff 100%);
}

.optimize-action:hover:not(:disabled) {
  background: linear-gradient(180deg, #eaf2ff 0%, #dceaff 100%);
  box-shadow: 0 6px 14px rgba(37, 99, 235, 0.12);
}

.generate-action {
  color: #07833f;
  border-color: #81dda4;
  border-bottom: 3px solid #16a34a;
  background: linear-gradient(180deg, #f2fff7 0%, #e7f9ee 100%);
}

.generate-action:hover:not(:disabled) {
  background: linear-gradient(180deg, #e9fbf0 0%, #d9f4e4 100%);
  box-shadow: 0 6px 14px rgba(22, 163, 74, 0.12);
}

.step-action-index {
  position: absolute;
  left: 18px;
  top: 50%;
  min-width: 24px;
  padding-right: 14px;
  border-right: 1px solid currentColor;
  transform: translateY(-50%);
  font-size: 17px;
  font-weight: 800;
  line-height: 24px;
}

.step-action-name {
  color: currentColor;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.25;
  text-align: center;
  letter-spacing: 0.01em;
}

@media (prefers-reduced-motion: reduce) {
  .step-action-card {
    transition: none;
  }
}

.subscription-links {
  margin-top: 22px;
}

.link-group + .link-group {
  margin-top: 18px;
}

.link-label {
  display: block;
  margin-bottom: 8px;
  color: #0f172a;
  font-weight: 600;
}

.link-tip {
  margin: 8px 0 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
}

.inline-tip {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 14px 16px;
  border-radius: 14px;
  background: #fffbeb;
  color: #b45309;
  line-height: 1.6;
}

.announcement-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin: 0 -18px -18px;
}

.announcement-card {
  min-height: 100%;
}

.announcement-card-title {
  padding-bottom: 14px;
  border-bottom: 1px solid #eef2f7;
}

.announcement-title-with-icon {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--dashboard-title);
  font-size: 18px;
  font-weight: 800;
}

.announcement-title-with-icon .el-icon {
  color: #2563eb;
  font-size: 20px;
}

.announcement-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 48px;
  padding: 0 18px;
  border: 0;
  border-bottom: 1px solid #eef2f7;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.announcement-item:last-child {
  border-bottom: none;
}

.announcement-item:hover .announcement-title {
  color: #2563eb;
}

.announcement-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.announcement-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.announcement-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: #4f63ff;
}

.announcement-dot.pinned {
  background: #f59e0b;
}

.announcement-title {
  overflow: hidden;
  margin: 0;
  color: #0f172a;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.announcement-time {
  color: #94a3b8;
  font-size: 14px;
  white-space: nowrap;
}

.announcement-content {
  color: #475569;
  line-height: 1.8;
  word-break: break-word;
}

.announcement-content :deep(h1),
.announcement-content :deep(h2),
.announcement-content :deep(h3),
.announcement-content :deep(h4),
.announcement-content :deep(h5),
.announcement-content :deep(h6) {
  margin: 14px 0 10px;
  color: #0f172a;
  line-height: 1.4;
}

.announcement-content :deep(p) {
  margin: 0 0 10px;
}

.announcement-content :deep(ul),
.announcement-content :deep(ol) {
  margin: 0 0 10px 18px;
  padding: 0;
}

.announcement-content :deep(li) {
  margin-bottom: 6px;
}

.announcement-content :deep(code) {
  padding: 2px 6px;
  border-radius: 6px;
  background: #eff6ff;
  color: #1d4ed8;
}

.announcement-content :deep(pre) {
  overflow-x: auto;
  padding: 14px;
  border-radius: 12px;
  background: #0f172a;
  color: #e2e8f0;
}

.announcement-content :deep(pre code) {
  padding: 0;
  background: transparent;
  color: inherit;
}

.announcement-content :deep(a) {
  color: #1d4ed8;
  text-decoration: none;
}

.announcement-popup-dialog :deep(.el-dialog),
.announcement-detail-dialog :deep(.el-dialog) {
  max-width: 92vw;
  border-radius: var(--dashboard-card-radius);
  box-sizing: border-box;
}

.announcement-popup-dialog :deep(.el-dialog__body),
.announcement-detail-dialog :deep(.el-dialog__body) {
  overflow: hidden;
}

.announcement-popup-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
}

.announcement-popup-dialog-title {
  color: #0f172a;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.4;
}

.announcement-popup-body {
  display: flex;
  flex-direction: column;
  max-height: 80vh;
  min-width: 0;
}

.announcement-popup-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid #eef2f7;
}

.announcement-popup-title {
  margin: 0;
  color: #0f172a;
  font-size: 22px;
  line-height: 1.4;
  word-break: break-word;
}

.announcement-popup-time {
  flex-shrink: 0;
  color: #94a3b8;
  font-size: 13px;
  white-space: nowrap;
}

.announcement-popup-content {
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 4px;
  color: #475569;
  line-height: 1.8;
  word-break: break-word;
}

.announcement-popup-content :deep(h1),
.announcement-popup-content :deep(h2),
.announcement-popup-content :deep(h3),
.announcement-popup-content :deep(h4),
.announcement-popup-content :deep(h5),
.announcement-popup-content :deep(h6) {
  margin: 16px 0 10px;
  color: #0f172a;
  line-height: 1.4;
}

.announcement-popup-content :deep(p) {
  margin: 0 0 12px;
}

.announcement-popup-content :deep(a) {
  color: #1d4ed8;
  overflow-wrap: anywhere;
  text-decoration: none;
}

.announcement-popup-content :deep(code) {
  padding: 2px 6px;
  border-radius: 6px;
  background: #eff6ff;
  color: #1d4ed8;
}

.announcement-popup-content :deep(pre) {
  max-width: 100%;
  overflow-x: auto;
  padding: 14px;
  border-radius: 12px;
  background: #0f172a;
  color: #e2e8f0;
}

.announcement-popup-content :deep(pre code) {
  padding: 0;
  background: transparent;
  color: inherit;
}

.announcement-popup-content :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
}

.announcement-popup-content :deep(th),
.announcement-popup-content :deep(td) {
  border: 1px solid #e5e7eb;
  padding: 8px 10px;
}

.announcement-popup-close-button {
  flex-shrink: 0;
  min-width: 88px;
  min-height: 40px;
  padding: 0.58em 1.35em;
  border: 1px solid #e8e8e8;
  border-radius: 0.6em;
  background: #e8e8e8;
  box-shadow: 6px 6px 12px #c5c5c5, -6px -6px 12px #ffffff;
  color: #090909;
  cursor: pointer;
  font-size: 15px;
  font-weight: 600;
  line-height: 1;
  transition: border-color 0.3s ease, box-shadow 0.3s ease, transform 0.2s ease;
}

.announcement-popup-close-button:hover,
.announcement-popup-close-button:focus-visible {
  border-color: #ffffff;
  outline: none;
}

.announcement-popup-close-button:focus-visible {
  box-shadow:
    6px 6px 12px #c5c5c5,
    -6px -6px 12px #ffffff,
    0 0 0 3px rgba(64, 158, 255, 0.28);
}

.announcement-popup-close-button:active {
  box-shadow: 4px 4px 12px #c5c5c5, -4px -4px 12px #ffffff;
  transform: translateY(1px);
}

.overview-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-bottom: 18px;
}

.overview-item {
  display: flex;
  justify-content: space-between;
  gap: 14px;
}

.overview-inline-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.overview-inline-row .overview-item {
  min-width: 0;
}

.overview-label {
  color: #64748b;
  flex-shrink: 0;
}

.overview-value {
  color: #0f172a;
  font-weight: 600;
  text-align: right;
  word-break: break-all;
}

.sync-loading-content,
.optimize-dialog-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 0;
}

.optimize-dialog-content :deep(.el-alert) {
  min-width: 0;
}

.generate-dialog-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 16px;
  padding: 20px 8px 12px;
}

.generate-loading-orb {
  width: 72px;
  height: 72px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 24px;
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.16), rgba(15, 118, 110, 0.22));
  box-shadow: 0 16px 30px rgba(15, 118, 110, 0.14);
}

.generate-loading-icon {
  font-size: 34px;
  color: #0f766e;
  animation: spin 1.2s linear infinite;
}

.generate-dialog-title {
  margin: 0;
  color: #0f172a;
  font-size: 22px;
}

.generate-dialog-text {
  margin: 0;
  color: #64748b;
  line-height: 1.8;
}

.generate-loading-dots {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.generate-loading-dots span {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: linear-gradient(135deg, #22c55e, #0f766e);
  animation: dotPulse 1.2s ease-in-out infinite;
}

.generate-loading-dots span:nth-child(2) {
  animation-delay: 0.18s;
}

.generate-loading-dots span:nth-child(3) {
  animation-delay: 0.36s;
}

.sync-loading-content {
  align-items: center;
  text-align: center;
}

.sync-loading-icon {
  font-size: 48px;
  color: #409eff;
  animation: spin 2s linear infinite;
}

.sync-loading-tip {
  color: #909399;
  font-size: 13px;
}

.optimize-dialog :deep(.el-dialog) {
  border-radius: 20px;
  box-sizing: border-box;
}

.generate-dialog :deep(.el-dialog) {
  border-radius: 20px;
  box-sizing: border-box;
}

.mobile-onboarding-layer {
  position: fixed;
  inset: 0;
  z-index: 240;
  pointer-events: auto;
  touch-action: none;
}

.mobile-onboarding-mask {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.52);
}

.mobile-onboarding-panel {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: calc(84px + env(safe-area-inset-bottom));
  z-index: 270;
  padding: 22px 16px 16px;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.22);
  pointer-events: auto;
}

.mobile-onboarding-close {
  position: absolute;
  top: 16px;
  right: 16px;
  min-width: 52px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid #dbe3ef;
  border-radius: 10px;
  background: #f8fafc;
  color: #475569;
  font-size: 15px;
  font-weight: 600;
  line-height: 1;
}

.mobile-onboarding-close:active {
  background: #edf2f7;
}

.mobile-onboarding-title {
  margin: 0 42px 12px 0;
  color: #0f172a;
  font-size: 21px;
  line-height: 1.35;
}

.mobile-onboarding-desc {
  margin: 0;
  color: #334155;
  font-size: 16px;
  line-height: 1.75;
}

.mobile-onboarding-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 22px;
}

.mobile-onboarding-dots {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.mobile-onboarding-dots span {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #e2e8f0;
}

.mobile-onboarding-dots span.active {
  background: #409eff;
}

.mobile-onboarding-actions {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.mobile-onboarding-button {
  min-width: 86px;
  height: 44px;
  border-radius: 10px;
  font-size: 16px;
  -webkit-tap-highlight-color: transparent;
}

.mobile-onboarding-button-prev,
.mobile-onboarding-button-prev:focus,
.mobile-onboarding-button-prev:hover {
  border-color: #dcdfe6;
  background: #fff;
  color: #606266;
}

.mobile-onboarding-button-next,
.mobile-onboarding-button-next:focus,
.mobile-onboarding-button-next:hover {
  border-color: #409eff;
  background: #409eff;
  color: #fff;
}

.mobile-onboarding-button-next:active {
  border-color: #337ecc;
  background: #337ecc;
}

.mobile-onboarding-button-prev:active {
  border-color: #cdd0d6;
  background: #f5f7fa;
}

:global(.mobile-onboarding-target) {
  position: relative !important;
  z-index: 260 !important;
  scroll-margin-bottom: 360px;
  outline: 3px solid rgba(64, 158, 255, 0.96);
  outline-offset: 2px;
  box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.05), 0 16px 40px rgba(64, 158, 255, 0.24) !important;
}

:global(.subscription-copy-target.mobile-onboarding-target) {
  scroll-margin-top: 64px;
}

:global(.mobile-onboarding-target-host) {
  z-index: 260 !important;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes dotPulse {
  0%,
  80%,
  100% {
    transform: scale(0.7);
    opacity: 0.45;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}

@media (min-width: 1600px) {
  .profile-container {
    padding-top: clamp(12px, 1.5vw, 28px);
  }

  .dashboard-card-grid,
  .current-plan-list {
    gap: 32px;
  }

  .mini-copy-list {
    margin-top: 0;
  }
}

@media (max-width: 1024px) {
  .dashboard-card-grid,
  .current-plan-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    min-height: 0;
  }
}

@media (max-width: 768px) {
  .profile-container,
  .dashboard-card-grid,
  .dashboard-grid,
  .main-column,
  .side-column {
    gap: 14px;
  }

  .dashboard-card-grid {
    grid-template-columns: 1fr;
  }

  .current-plan-list {
    grid-template-columns: 1fr;
  }

  .dashboard-card {
    height: auto;
    min-height: 0;
    padding: 15px;
  }

  .account-email {
    font-size: 18px;
  }

  .referral-card {
    padding-bottom: 12px;
  }

  .referral-action-row {
    flex-wrap: nowrap;
    justify-content: space-between;
    gap: 10px;
    margin-top: 18px;
    margin-bottom: 0;
  }

  .referral-action-row .text-link-button {
    flex: 0 0 auto;
    min-width: 0;
    padding: 0;
    font-size: 13px;
    line-height: 1.2;
    white-space: nowrap;
  }

  .metric-row {
    align-items: flex-start;
    font-size: 13px;
  }

  .package-title-row strong {
    font-size: 18px;
  }

  .current-plan-head {
    gap: 12px;
    margin-bottom: 12px;
  }

  .current-plan-head h2 {
    font-size: 25px;
  }

  .current-plan-count {
    min-width: 34px;
    height: 28px;
    padding: 0 11px;
    font-size: 14px;
  }

  .current-plan-filter {
    gap: 8px;
    margin-bottom: 16px;
  }

  .current-plan-filter-button {
    min-width: 56px;
    height: 26px;
    padding: 0 13px;
    font-size: 13px;
  }

  .current-plan-card {
    gap: 14px;
    min-height: 0;
    padding: 15px;
  }

  .current-plan-name {
    font-size: 20px;
  }

  .current-plan-amount {
    font-size: 24px;
  }

  .current-plan-metric {
    padding: 12px;
  }

  .current-plan-metric strong {
    font-size: 16px;
  }

  .current-plan-footer {
    align-items: flex-end;
  }

  .mini-copy-list {
    margin-top: 0;
  }

  .announcement-list {
    margin: 0 -15px -15px;
  }

  .announcement-item {
    min-height: 50px;
    padding: 0 15px;
  }

  .subscription-workspace-head {
    flex-direction: row;
    align-items: flex-start;
  }

  .welcome-card,
  .panel-card,
  .compact-card {
    padding: 15px;
    border-radius: var(--dashboard-card-radius);
  }

  .welcome-badge {
    padding: 3px 9px;
    font-size: 11px;
  }

  .welcome-title {
    margin: 10px 0 6px;
    font-size: 23px;
    line-height: 1.25;
  }

  .status-pills {
    gap: 8px;
    margin-top: 12px;
  }

  .status-pill {
    padding: 6px 10px;
    font-size: 12px;
  }

  .welcome-actions {
    flex-direction: column;
    gap: 10px;
    margin-top: 16px;
  }

  .welcome-actions :deep(.el-button) {
    width: 100%;
    min-height: 40px;
    border-radius: 14px;
  }

  .welcome-actions :deep(.el-button + .el-button) {
    margin-left: 0;
  }

  .support-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    width: 100%;
  }

  .support-actions-single {
    grid-template-columns: 1fr;
  }

  .support-actions :deep(.el-button) {
    min-width: 0;
  }

  .guide-button {
    position: absolute;
    top: 15px;
    right: 15px;
    display: inline-flex !important;
    flex: 0 0 auto !important;
    width: fit-content !important;
    min-width: 0 !important;
    height: auto !important;
    min-height: 0 !important;
    padding: 4px 10px !important;
    border: 1px solid rgba(37, 99, 235, 0.16);
    border-radius: 999px;
    background: #eff6ff;
    color: #2563eb;
    font-size: 12px;
    font-weight: 700;
    line-height: 1.2 !important;
    box-sizing: border-box;
    box-shadow: none;
  }

  .guide-button:hover,
  .guide-button:focus {
    border-color: rgba(37, 99, 235, 0.28);
    background: #dbeafe;
    color: #1d4ed8;
  }

  .subscription-head-actions {
    align-items: flex-end;
    gap: 5px;
  }

  .subscription-head-actions .guide-button {
    position: static;
    flex: 0 0 auto !important;
    width: 112px !important;
    min-width: 0 !important;
    padding: 4px 10px !important;
    border-radius: 999px;
    font-size: 12px;
    justify-content: center;
    white-space: nowrap;
  }

  .step-actions {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .step-action-card {
    min-height: 44px;
    padding: 8px 42px;
    border-radius: 12px;
  }

  .step-action-index {
    left: 16px;
    min-width: 22px;
    padding-right: 12px;
    font-size: 16px;
  }

  .step-action-name {
    font-size: 15px;
  }

  .panel-head {
    gap: 10px;
    margin-bottom: 12px;
  }

  .panel-title {
    font-size: 18px;
  }

  .panel-subtitle {
    margin-top: 6px;
    line-height: 1.45;
  }

  .overview-list {
    gap: 10px;
    margin-bottom: 12px;
  }

  .overview-label,
  .overview-value,
  .link-tip,
  .announcement-time,
  .announcement-content {
    font-size: 13px;
  }

  .announcement-head,
  .overview-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 5px;
  }

  .overview-inline-row {
    gap: 7px;
  }

  .overview-inline-row .overview-item {
    gap: 6px;
  }

  .announcement-time,
  .overview-value {
    text-align: left;
  }

  .subscription-links {
    margin-top: 16px;
  }

  .link-group + .link-group {
    margin-top: 14px;
  }

  .link-label {
    margin-bottom: 6px;
  }

  .link-tip {
    margin-top: 6px;
    line-height: 1.45;
  }

  .inline-tip {
    gap: 6px;
    margin-top: 12px;
    padding: 11px 12px;
    border-radius: 12px;
    line-height: 1.45;
  }

  .announcement-list {
    gap: 14px;
  }

  .announcement-item {
    padding-bottom: 14px;
  }

  .announcement-head {
    margin-bottom: 8px;
  }

  .announcement-title-row {
    gap: 8px;
  }

  .announcement-title {
    font-size: 16px;
  }

  .announcement-content {
    line-height: 1.55;
  }

  .announcement-content :deep(h1),
  .announcement-content :deep(h2),
  .announcement-content :deep(h3),
  .announcement-content :deep(h4),
  .announcement-content :deep(h5),
  .announcement-content :deep(h6) {
    margin: 10px 0 7px;
  }

  .announcement-content :deep(p) {
    margin-bottom: 8px;
  }

  .optimize-dialog :deep(.el-dialog) {
    margin-top: 4vh !important;
  }

  .optimize-dialog :deep(.el-dialog__body) {
    padding: 16px !important;
    max-height: 72vh;
    overflow-y: auto;
  }

  .optimize-dialog-content {
    padding: 0;
  }

  .generate-dialog :deep(.el-dialog) {
    margin-top: 4vh !important;
  }

  .generate-dialog :deep(.el-dialog__body) {
    padding: 16px !important;
    max-height: 72vh;
    overflow-y: auto;
  }

  .generate-dialog-content {
    padding: 4px 0 0;
  }

  .announcement-popup-dialog :deep(.el-dialog) {
    width: 92vw !important;
    max-width: 92vw;
    margin-top: 4vh !important;
  }

  .announcement-popup-dialog :deep(.el-dialog__body) {
    max-height: 80vh;
    overflow: hidden;
    padding: 16px !important;
  }

  .announcement-popup-body {
    max-height: 74vh;
  }

  .announcement-popup-head {
    flex-direction: column;
    gap: 8px;
  }

  .announcement-popup-time {
    white-space: normal;
  }

  .announcement-popup-close-button {
    min-width: 68px;
    min-height: 34px;
    padding: 0.48em 1em;
    border-radius: 0.55em;
    font-size: 13px;
    box-shadow: 4px 4px 9px #c5c5c5, -4px -4px 9px #ffffff;
  }
}
</style>
