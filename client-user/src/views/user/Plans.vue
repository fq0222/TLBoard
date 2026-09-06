<template>
  <div class="plans-page" v-loading="pageLoading">
    <section class="plans-main">
      <section class="plans-content-grid">
        <div class="plans-left">
          <section class="plan-section">
            <div class="section-head">
              <div>
                <h2>流量套餐</h2>
                <p>{{ renewTipText }}</p>
              </div>
              <span class="section-count">{{ plans.length }} 个可续费套餐</span>
            </div>

            <div v-if="plansLoading" class="state-container">
              <el-icon class="is-loading"><Loading /></el-icon>
              <span>加载套餐中...</span>
            </div>

            <div v-else-if="plans.length === 0" class="state-container">
              <el-empty description="暂无可用套餐" />
            </div>

            <div v-else class="plans-grid">
              <article
                v-for="plan in displayPlans"
                :key="plan.id"
                class="plan-card"
                :class="{
                  'is-selected': selectedPlanId === plan.id,
                  'is-current': plan.id === currentPlanId,
                  'is-soldout': plan.is_soldout
                }"
                @click="selectPlan(plan)"
              >
                <div class="plan-badges">
                  <span v-if="plan.id === currentPlanId" class="plan-badge current">当前套餐</span>
                  <span v-if="plan.is_soldout && plan.id !== currentPlanId" class="plan-badge soldout">已售罄</span>
                </div>

                <div class="plan-top">
                  <h3 class="plan-name">{{ plan.name }}</h3>
                  <div class="plan-price">
                    <span class="currency">¥</span>
                    <span class="amount">{{ formatPrice(plan.price) }}</span>
                  </div>
                </div>

                <div class="plan-metrics">
                  <div class="metric-item">
                    <span>流量</span>
                    <strong>{{ formatTraffic(plan.traffic_limit) }}</strong>
                  </div>
                  <div class="metric-item">
                    <span>时长</span>
                    <strong>{{ plan.durationText }}</strong>
                  </div>
                </div>

                <p v-if="plan.description" class="plan-description">{{ plan.description }}</p>

                <div class="plan-state">
                  <span>{{ getStateText(plan) }}</span>
                  <el-icon v-if="selectedPlanId === plan.id" class="plan-check"><CircleCheck /></el-icon>
                </div>
              </article>
            </div>
          </section>

          <aside
            class="mobile-payment-panel traffic-mobile-payment"
            v-if="selectedPlanCategory === 'traffic'"
          >
            <section class="selection-summary summary-card">
              <template v-if="selectedPlan">
                <div class="summary-card-head">
                  <strong class="summary-name">{{ selectedPlan.name }}</strong>
                  <div class="summary-price">
                    <span class="summary-currency">¥</span>
                    <strong>{{ formatPrice(selectedPlan.price) }}</strong>
                  </div>
                </div>
                <div class="summary-metrics">
                  <div class="summary-metric">
                    <span>流量</span>
                    <strong class="summary-traffic">{{ formatTraffic(selectedPlan.traffic_limit) }}</strong>
                  </div>
                  <div class="summary-metric">
                    <span>时长</span>
                    <strong class="summary-duration">{{ selectedPlan.durationText }}</strong>
                  </div>
                </div>
              </template>
              <div v-else class="summary-empty">
                <span class="summary-label">已选套餐</span>
                <strong>请选择套餐</strong>
              </div>
            </section>

            <section class="pay-section">
              <h2>支付方式</h2>
              <div class="pay-type-options">
                <label
                  class="pay-type-card"
                  :class="{ 'is-selected': payType === 9 }"
                >
                  <input
                    v-model="payType"
                    type="radio"
                    class="pay-type-input"
                    :value="9"
                  >
                  <span class="pay-type-icon balance">余</span>
                  <span class="pay-type-copy">
                    <strong>余额支付</strong>
                    <small>余额足够时立即完成</small>
                  </span>
                  <span class="pay-balance-amount">¥{{ formatPrice(userInfo.balance) }}</span>
                  <el-icon v-if="payType === 9" class="pay-type-check"><CircleCheck /></el-icon>
                </label>

                <label
                  class="pay-type-card"
                  :class="{ 'is-selected': payType === 2 }"
                >
                  <input
                    v-model="payType"
                    type="radio"
                    class="pay-type-input"
                    :value="2"
                  >
                  <span class="pay-type-icon alipay">支</span>
                  <span class="pay-type-copy">
                    <strong>支付宝</strong>
                    <small>跳转支付页扫码付款</small>
                  </span>
                  <el-icon v-if="payType === 2" class="pay-type-check"><CircleCheck /></el-icon>
                </label>

                <label
                  class="pay-type-card"
                  :class="{ 'is-selected': payType === 1 }"
                >
                  <input
                    v-model="payType"
                    type="radio"
                    class="pay-type-input"
                    :value="1"
                  >
                  <span class="pay-type-icon wechat">微</span>
                  <span class="pay-type-copy">
                    <strong>微信支付</strong>
                    <small>跳转支付页扫码付款</small>
                  </span>
                  <el-icon v-if="payType === 1" class="pay-type-check"><CircleCheck /></el-icon>
                </label>
              </div>
            </section>

            <section class="payment-notes">
              <h2>套餐选择说明</h2>
              <p>每次支付每种套餐只能选择一个进行购买，不能够组合支付。</p>
              <p>如果想要购买的套餐已经售罄，请联系客服进行处理。</p>
              <h2>支付说明</h2>
              <p>余额大于套餐价格就可以直接支付。</p>
              <p>微信或支付宝手机用户支付时，请把待支付二维码截图，去微信或支付宝中使用扫码支付，选择刚才的截图去支付。</p>
            </section>

            <el-button
              type="primary"
              class="pay-button"
              :disabled="!selectedPlanId || renewSubmitting"
              :loading="renewSubmitting"
              @click="handleRenew"
            >
              立即支付
            </el-button>
          </aside>

          <section class="plan-section broadband-section">
            <div class="section-head">
              <div>
                <h2>家宽IP套餐</h2>
                <p>家宽 IP 套餐接口还未接入，后续获取后会在这里展示。</p>
              </div>
              <span class="section-count pending">未获取</span>
            </div>
            <div class="broadband-placeholder">
              <el-empty description="未获取家宽 IP 套餐" />
            </div>
          </section>

          <aside
            class="mobile-payment-panel broadband-mobile-payment"
            v-if="selectedPlanCategory === 'broadband'"
          >
            <section class="selection-summary summary-card">
              <template v-if="selectedPlan">
                <div class="summary-card-head">
                  <strong class="summary-name">{{ selectedPlan.name }}</strong>
                  <div class="summary-price">
                    <span class="summary-currency">¥</span>
                    <strong>{{ formatPrice(selectedPlan.price) }}</strong>
                  </div>
                </div>
                <div class="summary-metrics">
                  <div class="summary-metric">
                    <span>流量</span>
                    <strong class="summary-traffic">{{ formatTraffic(selectedPlan.traffic_limit) }}</strong>
                  </div>
                  <div class="summary-metric">
                    <span>时长</span>
                    <strong class="summary-duration">{{ selectedPlan.durationText }}</strong>
                  </div>
                </div>
              </template>
              <div v-else class="summary-empty">
                <span class="summary-label">已选套餐</span>
                <strong>请选择套餐</strong>
              </div>
            </section>

            <section class="pay-section">
              <h2>支付方式</h2>
              <div class="pay-type-options">
                <label
                  class="pay-type-card"
                  :class="{ 'is-selected': payType === 9 }"
                >
                  <input
                    v-model="payType"
                    type="radio"
                    class="pay-type-input"
                    :value="9"
                  >
                  <span class="pay-type-icon balance">余</span>
                  <span class="pay-type-copy">
                    <strong>余额支付</strong>
                    <small>余额足够时立即完成</small>
                  </span>
                  <span class="pay-balance-amount">¥{{ formatPrice(userInfo.balance) }}</span>
                  <el-icon v-if="payType === 9" class="pay-type-check"><CircleCheck /></el-icon>
                </label>

                <label
                  class="pay-type-card"
                  :class="{ 'is-selected': payType === 2 }"
                >
                  <input
                    v-model="payType"
                    type="radio"
                    class="pay-type-input"
                    :value="2"
                  >
                  <span class="pay-type-icon alipay">支</span>
                  <span class="pay-type-copy">
                    <strong>支付宝</strong>
                    <small>跳转支付页扫码付款</small>
                  </span>
                  <el-icon v-if="payType === 2" class="pay-type-check"><CircleCheck /></el-icon>
                </label>

                <label
                  class="pay-type-card"
                  :class="{ 'is-selected': payType === 1 }"
                >
                  <input
                    v-model="payType"
                    type="radio"
                    class="pay-type-input"
                    :value="1"
                  >
                  <span class="pay-type-icon wechat">微</span>
                  <span class="pay-type-copy">
                    <strong>微信支付</strong>
                    <small>跳转支付页扫码付款</small>
                  </span>
                  <el-icon v-if="payType === 1" class="pay-type-check"><CircleCheck /></el-icon>
                </label>
              </div>
            </section>

            <section class="payment-notes">
              <h2>套餐选择说明</h2>
              <p>每次支付每种套餐只能选择一个进行购买，不能够组合支付。</p>
              <p>如果想要购买的套餐已经售罄，请联系客服进行处理。</p>
              <h2>支付说明</h2>
              <p>余额大于套餐价格就可以直接支付。</p>
              <p>微信或支付宝手机用户支付时，请把待支付二维码截图，去微信或支付宝中使用扫码支付，选择刚才的截图去支付。</p>
            </section>

            <el-button
              type="primary"
              class="pay-button"
              :disabled="!selectedPlanId || renewSubmitting"
              :loading="renewSubmitting"
              @click="handleRenew"
            >
              立即支付
            </el-button>
          </aside>
        </div>

        <aside class="desktop-payment-panel payment-panel">
          <section class="selection-summary summary-card">
            <template v-if="selectedPlan">
              <div class="summary-card-head">
                <strong class="summary-name">{{ selectedPlan.name }}</strong>
                <div class="summary-price">
                  <span class="summary-currency">¥</span>
                  <strong>{{ formatPrice(selectedPlan.price) }}</strong>
                </div>
              </div>
              <div class="summary-metrics">
                <div class="summary-metric">
                  <span>流量</span>
                  <strong class="summary-traffic">{{ formatTraffic(selectedPlan.traffic_limit) }}</strong>
                </div>
                <div class="summary-metric">
                  <span>时长</span>
                  <strong class="summary-duration">{{ selectedPlan.durationText }}</strong>
                </div>
              </div>
            </template>
            <div v-else class="summary-empty">
              <span class="summary-label">已选套餐</span>
              <strong>请选择套餐</strong>
            </div>
          </section>

          <section class="pay-section">
            <h2>支付方式</h2>
            <div class="pay-type-options">
              <label
                class="pay-type-card"
                :class="{ 'is-selected': payType === 9 }"
              >
                <input
                  v-model="payType"
                  type="radio"
                  class="pay-type-input"
                  :value="9"
                >
                <span class="pay-type-icon balance">余</span>
                <span class="pay-type-copy">
                  <strong>余额支付</strong>
                  <small>余额足够时立即完成</small>
                </span>
                <span class="pay-balance-amount">¥{{ formatPrice(userInfo.balance) }}</span>
                <el-icon v-if="payType === 9" class="pay-type-check"><CircleCheck /></el-icon>
              </label>

              <label
                class="pay-type-card"
                :class="{ 'is-selected': payType === 2 }"
              >
                <input
                  v-model="payType"
                  type="radio"
                  class="pay-type-input"
                  :value="2"
                >
                <span class="pay-type-icon alipay">支</span>
                <span class="pay-type-copy">
                  <strong>支付宝</strong>
                  <small>跳转支付页扫码付款</small>
                </span>
                <el-icon v-if="payType === 2" class="pay-type-check"><CircleCheck /></el-icon>
              </label>

              <label
                class="pay-type-card"
                :class="{ 'is-selected': payType === 1 }"
              >
                <input
                  v-model="payType"
                  type="radio"
                  class="pay-type-input"
                  :value="1"
                >
                <span class="pay-type-icon wechat">微</span>
                <span class="pay-type-copy">
                  <strong>微信支付</strong>
                  <small>跳转支付页扫码付款</small>
                </span>
                <el-icon v-if="payType === 1" class="pay-type-check"><CircleCheck /></el-icon>
              </label>
            </div>
          </section>

          <section class="payment-notes">
            <h2>套餐选择说明</h2>
            <p>每次支付每种套餐只能选择一个进行购买，不能够组合支付。</p>
            <p>如果想要购买的套餐已经售罄，请联系客服进行处理。</p>
            <h2>支付说明</h2>
            <p>余额大于套餐价格就可以直接支付。</p>
            <p>微信或支付宝手机用户支付时，请把待支付二维码截图，去微信或支付宝中使用扫码支付，选择刚才的截图去支付。</p>
          </section>

          <el-button
            type="primary"
            class="pay-button"
            :disabled="!selectedPlanId || renewSubmitting"
            :loading="renewSubmitting"
            @click="handleRenew"
          >
            立即支付
          </el-button>
        </aside>
      </section>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { CircleCheck, Loading } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useUserStore } from '@/stores/user'
import api from '@/api'

const router = useRouter()
const userStore = useUserStore()

const userInfo = ref({})
const plans = ref([])
const selectedPlanId = ref(null)
const selectedPlanCategory = ref('traffic')
const payType = ref(1)
const pageLoading = ref(false)
const plansLoading = ref(false)
const renewSubmitting = ref(false)

const currentPlanId = computed(() => userInfo.value.plan_id || null)
const selectedPlan = computed(() => displayPlans.value.find((plan) => plan.id === selectedPlanId.value) || null)
const renewTipText = computed(() => {
  if (selectedPlan.value?.plan_type === 'timed') {
    return '限时套餐续费会从支付完成时重新计算流量和到期时间。'
  }
  return '不限时套餐续费会在现有套餐基础上累加流量。'
})

const recommendedPlanId = computed(() => {
  const preferred = plans.value.find((plan) => plan.is_recommended || plan.recommended)
  if (preferred) return preferred.id

  const availablePlans = plans.value.filter((plan) => !plan.is_soldout)
  if (availablePlans.length > 0) return availablePlans[0].id

  return plans.value[0]?.id ?? null
})

const displayPlans = computed(() =>
  plans.value.map((plan) => ({
    ...plan,
    isRecommended: plan.id === recommendedPlanId.value,
    durationText: Number(plan.duration_days) === 0 ? '不限时套餐' : `${plan.duration_days} 天周期`
  }))
)

/**
 * 初始化套餐页所需数据。
 * 职责：并行加载用户信息和续费套餐，进入页面时自动选中当前套餐。
 *
 * @returns {Promise<void>}
 */
async function loadPageData() {
  pageLoading.value = true
  try {
    await Promise.all([fetchUserInfo(), fetchPlans()])
    selectedPlanId.value = currentPlanId.value || recommendedPlanId.value
  } finally {
    pageLoading.value = false
  }
}

/**
 * 获取当前用户信息。
 * 职责：为当前套餐高亮、余额支付完成后刷新账号状态提供数据。
 *
 * @returns {Promise<void>}
 */
async function fetchUserInfo() {
  const result = await userStore.fetchUserProfile()
  if (result.success) {
    userInfo.value = result.data
    userStore.userInfo = result.data
  }
}

/**
 * 获取当前账号可续费套餐。
 * 核心分支语义：接口失败时保留空列表并给出页面提示，不阻断页面其他区域展示。
 *
 * @returns {Promise<void>}
 */
async function fetchPlans() {
  try {
    plansLoading.value = true
    const result = await api.user.getRenewPlans()
    if (result.code === 0) {
      plans.value = result.data.plans || []
    } else {
      ElMessage.error(result.message || '获取套餐列表失败')
    }
  } catch (error) {
    console.error('获取套餐列表失败:', error)
    ElMessage.error('获取套餐列表失败')
  } finally {
    plansLoading.value = false
  }
}

/**
 * 选择续费套餐。
 * 核心分支语义：允许选择已售罄的当前套餐续费，禁止切换到其他售罄套餐。
 *
 * @param {Object} plan - 后端返回的套餐对象。
 */
function selectPlan(plan) {
  if (plan.is_soldout && plan.id !== currentPlanId.value) {
    ElMessage.warning('该套餐已售罄')
    return
  }
  selectedPlanCategory.value = 'traffic'
  selectedPlanId.value = plan.id
}

/**
 * 格式化金额分值。
 * @param {number|string} price - 后端返回的分值价格。
 * @returns {string} 元单位金额。
 */
function formatPrice(price) {
  return (Number(price) / 100).toFixed(2)
}

/**
 * 格式化流量字节数。
 * @param {number|string|null} bytes - 字节数，非正数表示不限量。
 * @returns {string} 可读流量。
 */
function formatTraffic(bytes) {
  if (bytes === null || bytes === undefined || bytes === '') return '0 B'

  const numBytes = Number(bytes)
  if (Number.isNaN(numBytes)) return '0 B'
  if (numBytes <= 0) return '不限量'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(numBytes) / Math.log(1024)), units.length - 1)
  return `${parseFloat((numBytes / (1024 ** index)).toFixed(2))} ${units[index]}`
}

/**
 * 获取套餐状态说明。
 * @param {Object} plan - 套餐对象。
 * @returns {string} 用户可见状态文案。
 */
function getStateText(plan) {
  if (plan.id === currentPlanId.value) return '当前正在使用的套餐'
  if (plan.is_soldout) return '暂不可选择该套餐'
  if (selectedPlanId.value === plan.id) return '已选中，提交后进入原续费流程'
  return '点击卡片即可切换为该续费方案'
}

/**
 * 提交续费并保持提交锁。
 * 职责：覆盖首次提交、限时套餐二次确认和确认后重试，避免重复订单。
 *
 * @returns {Promise<void>}
 */
async function handleRenew() {
  if (renewSubmitting.value) {
    return
  }

  if (!selectedPlanId.value) {
    ElMessage.warning('请选择套餐')
    return
  }

  renewSubmitting.value = true
  try {
    await submitRenewRequest({ planId: selectedPlanId.value, payType: payType.value })
  } finally {
    renewSubmitting.value = false
  }
}

/**
 * 调用续费接口并处理支付结果。
 * 核心分支语义：余额支付成功留在当前页刷新信息，第三方支付沿用原回调页。
 *
 * @param {Object} payload - 续费提交数据。
 * @param {number} payload.planId - 套餐 ID。
 * @param {number} payload.payType - 支付方式。
 * @param {boolean} [payload.confirmReset] - 是否确认重置限时套餐权益。
 * @returns {Promise<void>}
 */
async function submitRenewRequest({ planId, payType, confirmReset = false }) {
  try {
    const response = await api.user.renew({
      plan_id: planId,
      pay_type: payType,
      confirm_reset: confirmReset
    })
    if (response.code === 0) {
      if (response.data?.paid && response.data?.payment_method === 'balance') {
        ElMessage.success('余额支付成功，续费已完成')
        await fetchUserInfo()
        return
      }

      await router.push({
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
 * 判断续费失败是否为限时套餐重置确认分支。
 * @param {Error|Object} error - 续费接口错误对象。
 * @returns {boolean} 是否需要二次确认。
 */
function isRenewResetConfirmError(error) {
  return Number(error?.response?.status) === 409 && Number(error?.response?.data?.code) === 4091
}

/**
 * 弹出限时套餐续费重置确认框。
 * @param {Object} preview - 后端返回的重置预览数据。
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
 * @param {number|string} bytes - 字节数。
 * @returns {string} 可读流量。
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
 * @param {number|string} seconds - 剩余秒数。
 * @returns {string} 可读时间。
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
 * @param {Error|Object} error - 续费接口错误对象。
 * @returns {string} 用户可见错误提示。
 */
function getRenewErrorMessage(error) {
  return error?.userMessage || error?.response?.data?.message || '续费失败，请重试'
}

onMounted(() => {
  loadPageData()
})
</script>

<style scoped>
.plans-page {
  --text-main: #111827;
  --text-muted: #637083;
  --line: #e5e7eb;
  --soft-bg: #f8fafc;
  --accent: #2563eb;
  --accent-strong: #0f766e;
  min-height: calc(100vh - 40px);
}

.plans-main {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.plans-content-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 18px;
  align-items: start;
}

.plans-left {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.plan-section,
.payment-panel,
.mobile-payment-panel {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
}

.plan-section {
  padding: 20px;
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.section-head h2,
.pay-section h2,
.payment-notes h2 {
  margin: 0;
  color: var(--text-main);
  font-size: 20px;
  line-height: 1.25;
}

.section-head p,
.payment-notes p {
  margin: 8px 0 0;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.7;
}

.section-count {
  flex: 0 0 auto;
  padding: 6px 10px;
  border-radius: 8px;
  background: #eef6ff;
  color: var(--accent);
  font-size: 12px;
  font-weight: 800;
}

.section-count.pending {
  background: #f1f5f9;
  color: #64748b;
}

.state-container,
.broadband-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 210px;
  color: #909399;
}

.state-container .is-loading {
  margin-bottom: 10px;
  font-size: 30px;
}

.plans-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(235px, 1fr));
  gap: 14px;
}

.plan-card {
  display: flex;
  flex-direction: column;
  gap: 13px;
  min-height: 260px;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

.plan-card:hover {
  transform: translateY(-2px);
  border-color: #bfdbfe;
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.08);
}

.plan-card.is-selected {
  border-color: rgba(15, 118, 110, 0.45);
  background: #f3fbf8;
  box-shadow: 0 14px 28px rgba(15, 118, 110, 0.1);
}

.plan-card.is-current {
  border-color: rgba(34, 197, 94, 0.45);
}

.plan-card.is-soldout {
  opacity: 0.72;
}

.plan-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  min-height: 26px;
}

.plan-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px 9px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 800;
}

.plan-badge.current {
  background: rgba(34, 197, 94, 0.12);
  color: #15803d;
}

.plan-badge.soldout {
  background: rgba(245, 108, 108, 0.12);
  color: #d9534f;
}

.plan-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.plan-name {
  margin: 0;
  color: var(--text-main);
  font-size: 19px;
  line-height: 1.3;
}

.plan-price {
  flex: 0 0 auto;
  color: var(--accent-strong);
  white-space: nowrap;
}

.currency {
  font-size: 15px;
}

.amount {
  font-size: 28px;
  font-weight: 800;
  line-height: 1;
}

.plan-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.metric-item {
  padding: 11px 12px;
  border-radius: 8px;
  background: var(--soft-bg);
}

.metric-item span {
  display: block;
  margin-bottom: 5px;
  color: var(--text-muted);
  font-size: 12px;
}

.metric-item strong {
  color: var(--text-main);
  font-size: 14px;
}

.plan-description {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.7;
}

.plan-state {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: auto;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.6;
}

.plan-check {
  flex: 0 0 auto;
  color: var(--accent-strong);
  font-size: 20px;
}

.broadband-section {
  min-height: 330px;
}

.payment-panel,
.mobile-payment-panel {
  position: sticky;
  top: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 18px;
}

.mobile-payment-panel {
  display: none;
  position: static;
}

.selection-summary {
  padding: 15px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--soft-bg);
}

.summary-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.summary-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.summary-name {
  min-width: 0;
  color: var(--text-main);
  font-size: 18px;
  font-weight: 800;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.summary-price {
  display: inline-flex;
  align-items: baseline;
  flex: 0 0 auto;
  color: var(--accent-strong);
  line-height: 1;
}

.summary-currency {
  font-size: 12px;
}

.summary-price strong {
  font-size: 22px;
  font-weight: 800;
}

.summary-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.summary-metric {
  min-width: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #fff;
}

.summary-metric span,
.summary-label {
  display: block;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.25;
}

.summary-metric strong,
.summary-empty strong {
  display: block;
  margin-top: 6px;
  color: var(--text-main);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.summary-empty {
  min-height: 84px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.pay-type-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 13px;
}

.pay-type-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 64px;
  padding: 12px 38px 12px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease;
}

.pay-type-card.is-selected {
  border-color: rgba(15, 118, 110, 0.45);
  background: #f3fbf8;
}

.pay-type-input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.pay-type-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  border-radius: 8px;
  color: #fff;
  font-size: 14px;
  font-weight: 800;
}

.pay-type-icon.alipay {
  background: #1677ff;
}

.pay-type-icon.wechat {
  background: #07c160;
}

.pay-type-icon.balance {
  background: #d97706;
}

.pay-type-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1 1 auto;
}

.pay-type-copy strong {
  color: var(--text-main);
  font-size: 14px;
}

.pay-type-copy small {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 12px;
}

.pay-balance-amount {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--text-main);
  font-size: 16px;
  font-weight: 400;
  line-height: 1;
  white-space: nowrap;
}

.pay-type-check {
  position: absolute;
  top: 21px;
  right: 12px;
  color: var(--accent-strong);
  font-size: 20px;
}

.payment-notes {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.payment-notes h2 {
  margin-top: 4px;
  font-size: 16px;
}

.pay-button {
  width: 100%;
  min-height: 46px;
  border: 0;
  border-radius: 8px;
  background: linear-gradient(135deg, #22c55e 0%, #0f766e 100%);
  font-weight: 800;
}

@media (max-width: 1180px) {
  .plans-content-grid {
    grid-template-columns: minmax(0, 1fr) 280px;
  }
}

@media (max-width: 920px) {
  .plans-content-grid {
    grid-template-columns: 1fr;
  }

  .payment-panel {
    position: static;
    order: -1;
  }
}

@media (max-width: 768px) {
  .plans-page {
    min-height: calc(100vh - 116px);
  }

  .desktop-payment-panel {
    display: none;
  }

  .mobile-payment-panel {
    display: flex;
  }

  .plan-section,
  .payment-panel,
  .mobile-payment-panel {
    padding: 14px;
  }

  .section-head {
    flex-direction: column;
    gap: 10px;
  }

  .section-head h2 {
    font-size: 19px;
  }

  .plans-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .plan-card {
    min-height: 0;
    padding: 14px;
  }

  .plan-top {
    flex-direction: column;
    gap: 8px;
  }

  .plan-metrics {
    gap: 8px;
  }

  .broadband-section {
    min-height: 260px;
  }
}
</style>
