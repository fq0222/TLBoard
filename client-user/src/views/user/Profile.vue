<template>
  <div class="profile-container" v-loading="loading">
    <section class="top-grid">
      <section class="welcome-card">
        <div class="welcome-main">
          <div class="welcome-badge">会员工作台</div>
          <h1 class="welcome-title">{{ greetingText }}，{{ displayName }}</h1>

          <div class="status-pills">
            <span class="status-pill">
              账号状态：
              <el-tag size="small" :type="accountStatusType">
                {{ accountStatusText }}
              </el-tag>
            </span>
            <span class="status-pill">订阅状态：{{ userInfo.subscription_ready ? '已生成' : '未生成' }}</span>
            <span class="status-pill">CF 优选：{{ cfOptimized ? '已完成' : '未完成' }}</span>
          </div>
        </div>

        <div class="welcome-actions">
          <el-button
            size="large"
            class="guide-button"
            @click="startOnboardingGuide(true)"
          >
            新手引导
          </el-button>
          <el-button
            type="info"
            size="large"
            class="renew-button"
            @click="showRenewDialog = true"
            :disabled="!userInfo.plan_id"
          >
            <el-icon><Refresh /></el-icon>
            续费套餐
          </el-button>
          <div
            v-if="telegramChannelUrl || onlineCustomerServiceUrl"
            class="support-actions"
            :class="{ 'support-actions-single': !(telegramChannelUrl && onlineCustomerServiceUrl) }"
          >
            <el-button
              v-if="telegramChannelUrl"
              tag="a"
              :href="telegramChannelUrl"
              target="_blank"
              rel="noopener noreferrer"
              size="large"
              class="telegram-channel-button"
            >
              <el-icon><Promotion /></el-icon>
              官方电报频道
            </el-button>
            <el-button
              v-if="onlineCustomerServiceUrl"
              tag="a"
              :href="onlineCustomerServiceUrl"
              target="_blank"
              rel="noopener noreferrer"
              size="large"
              class="online-service-button"
            >
              <el-icon><Service /></el-icon>
              在线客服
            </el-button>
          </div>
        </div>
      </section>

      <article class="panel-card compact-card overview-card">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">账户概览</h2>
          </div>
        </div>

        <div class="overview-list">
          <div class="overview-item">
            <span class="overview-label">邮箱</span>
            <span class="overview-value">{{ userInfo.email || '-' }}</span>
          </div>

          <div class="overview-inline-row">
            <div class="overview-item">
              <span class="overview-label">套餐</span>
              <span class="overview-value">{{ userInfo.plan_name || '未订阅' }}</span>
            </div>
            <div class="overview-item">
              <span class="overview-label">状态</span>
              <span class="overview-value">{{ accountStatusText }}</span>
            </div>
          </div>

          <div class="overview-item">
            <span class="overview-label">流量</span>
            <span class="overview-value">{{ trafficSummaryText }}</span>
          </div>
        </div>

        <el-progress
          :percentage="userInfo.traffic_percent || 0"
          :stroke-width="16"
        />
      </article>
    </section>

    <section class="dashboard-grid">
      <div class="main-column">
        <article class="panel-card subscription-workspace">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">订阅工作区</h2>
              <p class="panel-subtitle">请按顺序完成优选和订阅生成，避免节点不可用。</p>
            </div>
          </div>

          <div class="step-actions">
            <button
              type="button"
              class="step-action-card optimize-action"
              :class="{ disabled: actionBusy }"
              :disabled="actionBusy"
              @click="startOptimize"
            >
              <span class="step-action-index">1</span>
              <span class="step-action-name">{{ cfOptimized ? '重新优选 CF IP' : '一键优选 CF IP' }}</span>
            </button>

            <button
              type="button"
              class="step-action-card generate-action"
              :class="{ disabled: actionBusy }"
              :disabled="actionBusy"
              @click="generateSubscription"
            >
              <span class="step-action-index">2</span>
              <span class="step-action-name">{{ generatingSubscription ? '生成中...' : '生成订阅链接' }}</span>
            </button>
          </div>

          <div v-if="userInfo.subscription_ready" class="subscription-links">
            <div class="subscription-copy-target">
              <div class="link-group">
                <span class="link-label">通用订阅</span>
                <el-input
                  :model-value="userInfo.subscription_url"
                  readonly
                  size="large"
                >
                  <template #append>
                    <el-button @click="copyLink(userInfo.subscription_url)">
                      <el-icon><CopyDocument /></el-icon>
                      复制
                    </el-button>
                  </template>
                </el-input>
                <p class="link-tip">适用于 v2rayN、v2rayNG、Shadowrocket、Quantumult X 等客户端。</p>
              </div>

              <div class="link-group">
                <span class="link-label">Clash 订阅</span>
                <el-input
                  :model-value="userInfo.clash_url"
                  readonly
                  size="large"
                >
                  <template #append>
                    <el-button @click="copyLink(userInfo.clash_url)">
                      <el-icon><CopyDocument /></el-icon>
                      复制
                    </el-button>
                  </template>
                </el-input>
                <p class="link-tip">适用于 Clash、Clash Verge、ClashX、Clash for Windows 等客户端。</p>
              </div>
            </div>

            <div class="inline-tip">
              <el-icon><InfoFilled /></el-icon>
              <span>如果链接失效，可先重新优选 CF IP，再重新生成订阅链接。</span>
            </div>
          </div>
        </article>
      </div>

      <div class="side-column">
        <article class="panel-card compact-card announcement-card">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">系统公告</h2>
            </div>
            <span class="panel-extra">最近更新</span>
          </div>

          <div v-if="announcements.length > 0" class="announcement-list">
            <div
              v-for="announcement in announcements"
              :key="announcement.id"
              class="announcement-item"
            >
              <div class="announcement-head">
                <div class="announcement-title-row">
                  <el-tag v-if="announcement.pinned" type="danger" size="small">置顶</el-tag>
                  <h3 class="announcement-title">{{ announcement.title }}</h3>
                </div>
                <span class="announcement-time">{{ formatDate(announcement.created_at) }}</span>
              </div>
              <div class="announcement-content" v-html="renderMarkdown(announcement.content)"></div>
            </div>
          </div>

          <el-empty v-else description="暂无公告" />
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

    <RenewDialog
      v-model:visible="showRenewDialog"
      :current-plan-id="userInfo.plan_id"
      :submitting="renewSubmitting"
      @renew="handleRenew"
    />

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
      title="CF IP 优选中"
      :width="optimizeDialogWidth"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
      class="optimize-dialog"
    >
      <div class="optimize-dialog-content">
        <el-alert
          title="正在进行 CF IP 优选，请稍候..."
          description="系统会自动测试多个 Cloudflare 节点的延迟并保存最优结果。"
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
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  CopyDocument,
  InfoFilled,
  Loading,
  Promotion,
  Refresh,
  Service
} from '@element-plus/icons-vue'
import { marked } from 'marked'
import { useUserStore } from '@/stores/user'
import RenewDialog from '@/components/RenewDialog.vue'
import api from '@/api'
import {
  getOnboardingGuideMode,
  getOnboardingGuideSteps,
  shouldCompleteOnboardingOnRouteLeave
} from '@/utils/onboarding-guide'
import {
  CF_IP_TEST_COUNT as TEST_COUNT,
  CF_IP_TEST_INTERVAL as TEST_INTERVAL,
  CF_IP_TEST_TIMEOUT as TEST_TIMEOUT
} from '@/utils/cf-ip-test-config'

const userStore = useUserStore()
const router = useRouter()

const userInfo = ref({})
const announcements = ref([])
const loading = ref(false)
const cfOptimized = ref(false)
const optimizing = ref(false)
const onlineCustomerServiceUrl = ref('')
const optimizeProgress = ref(0)
const optimizeStatusText = ref('')
const generatingSubscription = ref(false)
const showRenewDialog = ref(false)
const renewSubmitting = ref(false)
const announcementPopupVisible = ref(false)
const popupAnnouncement = ref(null)
const popupClosing = ref(false)
const syncLoading = ref(false)
const syncTimer = ref(null)
const windowWidth = ref(window.innerWidth)
const onboardingTourVisible = ref(false)
const onboardingTourCurrent = ref(0)
const onboardingCompletionSaving = ref(false)

const MOBILE_ONBOARDING_TARGET_CLASS = 'mobile-onboarding-target'
const MOBILE_ONBOARDING_TARGET_HOST_CLASS = 'mobile-onboarding-target-host'

const actionBusy = computed(() => optimizing.value || generatingSubscription.value)
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

const greetingText = computed(() => {
  const hour = new Date().getHours()
  if (hour < 12) return '早上好'
  if (hour < 18) return '下午好'
  return '晚上好'
})

const trafficSummaryText = computed(() => {
  const usedTrafficText = userInfo.value.traffic_used_text || '0 B'
  const totalTrafficText = userInfo.value.total_traffic_limit_text || userInfo.value.traffic_limit_text || '0 B'
  const planTrafficText = userInfo.value.plan_traffic_limit_text || '0 B'
  const referralBalanceText = userInfo.value.balance_text || '0.00 元'

  return `${usedTrafficText} / ${totalTrafficText}（套餐：${planTrafficText} + 推广：${referralBalanceText}）`
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

async function checkSyncStatus() {
  try {
    const result = await userStore.fetchUserProfile()
    if (result.success) {
      userInfo.value = result.data
      cfOptimized.value = result.data.cf_optimized || false

      if (result.data.payment_count === 1 && result.data.sync_status !== 2) {
        syncLoading.value = true
        startSyncPolling()
      } else {
        await scheduleOnboardingGuide(result.data)
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

async function copyLink(link) {
  if (!link) {
    ElMessage.warning('请先生成订阅链接')
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
  if (generatingSubscription.value || optimizing.value) {
    return
  }

  if (!cfOptimized.value) {
    ElMessage.warning('请先进行 CF IP 优选')
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
    ElMessage.error('生成订阅链接失败')
  } finally {
    generatingSubscription.value = false
  }
}

async function startOptimize() {
  if (optimizing.value || generatingSubscription.value) {
    return
  }

  try {
    optimizing.value = true
    optimizeProgress.value = 0
    optimizeStatusText.value = '正在获取 IP 列表...'

    const response = await api.user.getCfIps()
    if (response.code !== 0) {
      throw new Error('获取 IP 列表失败')
    }

    const ipPool = response.data.ips
    if (!ipPool || ipPool.length === 0) {
      throw new Error('IP 池为空，请联系管理员')
    }

    const totalIps = ipPool.length
    let completedIps = 0

    const ipTestData = ipPool.map(item => ({
      id: item.id,
      ip: item.ip,
      latency: -1,
      successTimes: 0,
      testedTimes: 0,
      testResults: []
    }))

    await Promise.all(ipTestData.map(async (ipData) => {
      await testSingleIp(ipData)
      completedIps += 1
      optimizeProgress.value = 10 + Math.round((completedIps / totalIps) * 70)
      optimizeStatusText.value = `正在测试第 ${completedIps}/${totalIps} 个 IP...`
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
    optimizeStatusText.value = '正在筛选最优 IP...'

    const availableIps = ipTestData
      .filter(item => item.latency > 0)
      .sort((a, b) => a.latency - b.latency)

    if (availableIps.length === 0) {
      throw new Error('所有 IP 测试超时，请检查网络后重试')
    }

    const ipv4List = availableIps.filter(item => !item.ip.includes(':'))
    const ipv6List = availableIps.filter(item => item.ip.includes(':'))
    const selectedIps = []

    if (ipv6List.length > 0) {
      selectedIps.push(ipv6List[0])
    }

    for (const ip of ipv4List) {
      if (selectedIps.length >= 5) break
      if (!selectedIps.find(selected => selected.id === ip.id)) {
        selectedIps.push(ip)
      }
    }

    for (const ip of ipv6List) {
      if (selectedIps.length >= 5) break
      if (!selectedIps.find(selected => selected.id === ip.id)) {
        selectedIps.push(ip)
      }
    }

    optimizeProgress.value = 95
    optimizeStatusText.value = '正在保存优选结果...'

    const ipIds = selectedIps.map(item => item.id)
    const applyResponse = await api.user.applyCfIps(ipIds)

    if (applyResponse.code === 0) {
      optimizeProgress.value = 100
      optimizeStatusText.value = '优选完成'
      cfOptimized.value = true
      await fetchUserInfo()
      ElMessage.success(`已成功优选 ${selectedIps.length} 个 IP`)
    } else {
      throw new Error(applyResponse.message || '保存优选结果失败')
    }
  } catch (error) {
    console.error('一键优选失败:', error)
    ElMessage.error(error.message || '优选失败，请重试')
    optimizeProgress.value = 0
    optimizeStatusText.value = ''
  } finally {
    setTimeout(() => {
      optimizing.value = false
    }, 1500)
  }
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
}

function pingIp(ip) {
  return new Promise((resolve) => {
    const startTime = window.performance.now()
    const host = ip.includes(':') ? `[${ip}]` : ip
    const url = `https://${host}:443/cdn-cgi/trace`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      controller.abort()
      resolve(-1)
    }, TEST_TIMEOUT)

    fetch(url, {
      mode: 'no-cors',
      signal: controller.signal,
      cache: 'no-store'
    }).then(() => {
      clearTimeout(timeoutId)
      const endTime = window.performance.now()
      resolve(Math.round(endTime - startTime))
    }).catch(() => {
      clearTimeout(timeoutId)
      const endTime = window.performance.now()
      const elapsed = endTime - startTime
      resolve(elapsed < 50 ? -1 : Math.round(elapsed))
    })
  })
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

async function submitRenewRequest({ planId, payType, confirmReset = false }) {
  try {
    const response = await api.user.renew({
      plan_id: planId,
      pay_type: payType,
      confirm_reset: confirmReset
    })
    if (response.code === 0) {
      showRenewDialog.value = false
      if (response.data?.paid && response.data?.payment_method === 'balance') {
        ElMessage.success('余额支付成功，续费已完成')
        await fetchUserInfo()
        return
      }

      router.push({
        path: '/payment/callback',
        query: {
          order_id: response.data.order_id,
          out_trade_no: response.data.out_trade_no,
          payment_url: response.data.payment_url,
          expire_in: response.data.expire_in,
          pay_type: payType
        }
      })
    } else {
      ElMessage.error(response.message || '续费失败')
    }
  } catch (error) {
    console.error('续费失败:', error)
    if (isRenewResetConfirmError(error)) {
      try {
        await confirmTimedRenewReset(error.response.data.data)
      } catch {
        return
      }
      await submitRenewRequest({ planId, payType, confirmReset: true })
      return
    }
    ElMessage.error(getRenewErrorMessage(error))
  }
}

/**
 * 处理续费提交并在父组件保持提交锁。
 * 职责：覆盖首次提交、409 确认和确认后重试的完整生命周期，避免重复订单。
 * 关键参数：planId/payType 来自续费弹窗当前选择。
 * 核心分支：提交中直接忽略新的点击，直到本轮请求/确认流程结束。
 *
 * @param {Object} payload - 续费提交参数
 * @param {number} payload.planId - 套餐 ID
 * @param {number} payload.payType - 支付方式
 * @returns {Promise<void>}
 */
async function handleRenew({ planId, payType }) {
  if (renewSubmitting.value) {
    return
  }

  renewSubmitting.value = true
  try {
    await submitRenewRequest({ planId, payType })
  } finally {
    renewSubmitting.value = false
  }
}

/**
 * 判断续费失败是否为限时套餐重置确认分支。
 * 职责：只识别后端 4091 业务码，避免把普通错误误当成二次确认。
 * 关键参数：error 为 axios 拦截器抛出的错误对象。
 * 核心分支：HTTP 409 且业务 code=4091 时返回 true。
 *
 * @param {Error|Object} error - 续费接口错误对象
 * @returns {boolean} 是否需要弹出重置确认
 */
function isRenewResetConfirmError(error) {
  return Number(error?.response?.status) === 409 && Number(error?.response?.data?.code) === 4091
}

/**
 * 弹出限时套餐续费重置确认框。
 * 职责：展示剩余流量和剩余时间，让用户明确选择是否继续续费。
 * 关键参数：preview 为后端返回的重置预览数据。
 * 核心分支：用户确认后 resolve，取消时抛出 Element Plus cancel 异常。
 *
 * @param {Object} preview - 限时套餐重置预览
 * @returns {Promise<void>}
 */
async function confirmTimedRenewReset(preview = {}) {
  await ElMessageBox.confirm(
    `当前仍有 ${formatBytes(preview.remaining_traffic)} 流量和 ${formatRemainingTime(preview.remaining_seconds)} 未使用，续费后将重置流量与到期时间。`,
    '确认续费',
    {
      confirmButtonText: '确认续费',
      cancelButtonText: '取消',
      type: 'warning'
    }
  )
}

/**
 * 格式化字节数用于续费确认提示。
 * @param {number|string} bytes - 字节数
 * @returns {string} 可读流量
 */
function formatBytes(bytes) {
  const value = Number(bytes || 0)
  if (!Number.isFinite(value) || value <= 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${parseFloat((value / (1024 ** index)).toFixed(2))} ${units[index]}`
}

/**
 * 格式化剩余秒数用于续费确认提示。
 * @param {number|string} seconds - 剩余秒数
 * @returns {string} 可读时间
 */
function formatRemainingTime(seconds) {
  const value = Math.max(0, Number(seconds || 0))
  const days = Math.floor(value / 86400)
  const hours = Math.floor((value % 86400) / 3600)
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时`
  const minutes = Math.floor(value / 60)
  return `${minutes} 分钟`
}

/**
 * 提取续费接口错误提示。
 * 职责：优先展示后端业务错误，例如余额不足；缺失时回退通用提示。
 * 关键参数：error 为 axios 拦截器抛出的错误对象，可能包含 userMessage 或 response.data.message。
 * 核心分支：业务提示存在则透传，不存在才显示兜底文案。
 *
 * @param {Error|Object} error - 续费接口错误对象
 * @returns {string} 用户可见错误提示
 */
function getRenewErrorMessage(error) {
  return error?.userMessage || error?.response?.data?.message || '续费失败，请重试'
}

onMounted(() => {
  window.addEventListener('resize', handleResize)
  fetchUserInfo()
  loadPublicSettings()
  fetchAnnouncements()
  fetchAnnouncementPopup()
  checkSyncStatus()
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
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.top-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(320px, 0.9fr);
  gap: 20px;
  align-items: stretch;
}

.welcome-card,
.panel-card {
  background: #fff;
  border-radius: 20px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
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

.renew-button {
  border: none;
  border-radius: 16px;
  background: linear-gradient(135deg, #38bdf8 0%, #2563eb 100%);
  box-shadow: 0 12px 24px rgba(37, 99, 235, 0.2);
}

.renew-button:not(.is-disabled):hover {
  background: linear-gradient(135deg, #22c55e 0%, #0f766e 100%);
}

.renew-button:deep(span),
.renew-button:deep(.el-icon) {
  color: #fff;
}

.renew-button.is-disabled {
  background: linear-gradient(135deg, #cbd5e1 0%, #94a3b8 100%);
  box-shadow: none;
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
  gap: 18px;
}

.announcement-card {
  min-height: 100%;
}

.announcement-item {
  padding-bottom: 18px;
  border-bottom: 1px solid #eef2f7;
}

.announcement-item:last-child {
  padding-bottom: 0;
  border-bottom: none;
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
  gap: 10px;
  min-width: 0;
}

.announcement-title {
  margin: 0;
  color: #0f172a;
  font-size: 18px;
}

.announcement-time {
  color: #94a3b8;
  font-size: 13px;
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

.announcement-popup-dialog :deep(.el-dialog) {
  max-width: 92vw;
  border-radius: 22px;
  box-sizing: border-box;
}

.announcement-popup-dialog :deep(.el-dialog__body) {
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

@media (max-width: 1024px) {
  .top-grid,
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .welcome-card,
  .panel-card,
  .compact-card {
    padding: 18px;
    border-radius: 18px;
  }

  .welcome-title {
    font-size: 26px;
  }

  .welcome-actions {
    flex-direction: column;
  }

  .welcome-actions :deep(.el-button) {
    width: 100%;
  }

  .welcome-actions :deep(.el-button + .el-button) {
    margin-left: 0;
  }

  .support-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
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
    top: 18px;
    right: 18px;
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

  .step-actions {
    grid-template-columns: 1fr;
  }

  .step-action-card {
    padding: 10px 48px;
  }

  .step-action-name {
    font-size: 16px;
  }

  .announcement-head,
  .overview-item {
    flex-direction: column;
    align-items: flex-start;
  }

  .overview-inline-row {
    gap: 8px;
  }

  .overview-inline-row .overview-item {
    gap: 6px;
  }

  .announcement-time,
  .overview-value {
    text-align: left;
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
