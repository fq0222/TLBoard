<template>
  <div class="home-container">
    <header class="header">
      <div class="header-content">
        <h1 class="logo">天澜大陆</h1>
        <nav class="nav">
          <router-link to="/" class="nav-item">首页</router-link>
          <router-link v-if="!isLoggedIn" to="/login" class="nav-item">登录</router-link>
          <router-link v-else to="/user" class="nav-item">个人中心</router-link>
        </nav>
      </div>
    </header>

    <main class="main">
      <section class="plans-section">
        <div class="section-head">
          <div>
            <h2 class="section-title">选择适合你的套餐</h2>
          </div>
        </div>

        <div class="plan-filter" aria-label="套餐分类">
          <button
            v-for="filter in planFilters"
            :key="filter.value"
            type="button"
            class="filter-button"
            :class="{ active: activePlanFilter === filter.value }"
            @click="activePlanFilter = filter.value"
          >
            {{ filter.label }}
          </button>
        </div>

        <div
          v-if="loading"
          class="plans-grid plans-loading"
          aria-live="polite"
          aria-busy="true"
        >
          <article v-for="index in 3" :key="index" class="plan-card plan-skeleton">
            <div class="skeleton-pill"></div>
            <div class="skeleton-row">
              <div class="skeleton-line title"></div>
              <div class="skeleton-line price"></div>
            </div>
            <div class="plan-metrics">
              <div class="metric-card skeleton-block"></div>
              <div class="metric-card skeleton-block"></div>
            </div>
            <div class="plan-summary skeleton-summary"></div>
            <div class="skeleton-line note"></div>
            <div class="skeleton-button"></div>
          </article>
        </div>

        <div v-else-if="loadError" class="plans-state" role="status">
          <div class="state-title">套餐加载失败</div>
          <p>网络可能有点慢，请刷新页面或稍后再试。</p>
          <button type="button" class="state-retry" @click="fetchPlans">重新加载</button>
        </div>

        <div v-else-if="displayPlans.length === 0" class="plans-state" role="status">
          <div class="state-title">当前分类暂无套餐</div>
          <p>可以切换到其他分类查看可购买套餐。</p>
        </div>

        <div v-else class="plans-grid">
          <article
            v-for="plan in displayPlans"
            :key="plan.id"
            class="plan-card"
            :class="{
              'is-recommended': plan.isRecommended,
              'is-soldout': plan.is_soldout
            }"
          >
            <div class="plan-badges">
              <span v-if="plan.isRecommended" class="plan-badge recommend">推荐套餐</span>
              <span v-if="plan.is_soldout" class="plan-badge soldout">已售罄</span>
            </div>

            <div class="plan-top">
              <div>
                <h3 class="plan-name">{{ plan.name }}</h3>
              </div>
              <div class="plan-price">
                <span class="price-symbol">¥</span>
                <span class="price-value">{{ plan.price_text }}</span>
              </div>
            </div>

            <div class="plan-metrics">
              <div class="metric-card">
                <span class="metric-label">流量</span>
                <strong class="metric-value">{{ plan.traffic_text }}</strong>
              </div>
              <div class="metric-card">
                <span class="metric-label">时长</span>
                <strong class="metric-value">{{ formatDuration(plan.duration_days) }}</strong>
              </div>
            </div>

            <div class="plan-summary">
              <div class="summary-row">
                <el-icon><User /></el-icon>
                <span>适合人群</span>
              </div>
              <p>{{ plan.summary }}</p>
            </div>

            <div class="plan-footer">
              <div class="plan-highlight">
                <span>{{ plan.is_soldout ? '当前暂不可下单，你仍可先查看套餐信息。' : '点击立即购买，完成付款后系统会自动注册并开通账号。' }}</span>
              </div>
              <el-button
                type="primary"
                size="large"
                class="buy-btn"
                :disabled="plan.is_soldout"
                @click="selectPlan(plan)"
              >
                {{ plan.is_soldout ? '已售罄' : '立即购买' }}
                <el-icon class="btn-icon"><ArrowRight /></el-icon>
              </el-button>
            </div>
          </article>
        </div>
      </section>

    </main>

    <footer class="footer">
      <p>© 2026 天澜大陆. All rights reserved.</p>
    </footer>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { ArrowRight, User } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import api from '@/api'
import { filterPlansByDurationType } from '@/utils/plan-filter'
import { loadPlansWithRetry } from '@/utils/plan-loader'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const plans = ref([])
const loading = ref(false)
const loadError = ref(false)
const activePlanFilter = ref('all')
const planFilters = [
  { label: '全部', value: 'all' },
  { label: '限时', value: 'limited' },
  { label: '不限时', value: 'unlimited' }
]

const isLoggedIn = computed(() => userStore.isLoggedIn)

const recommendedPlanId = computed(() => {
  const preferred = plans.value.find((plan) => plan.is_recommended || plan.recommended)
  if (preferred) return preferred.id

  const availablePlans = plans.value.filter((plan) => !plan.is_soldout)
  if (availablePlans.length > 0) return availablePlans[0].id

  return plans.value[0]?.id ?? null
})

const displayPlans = computed(() =>
  filterPlansByDurationType(plans.value, activePlanFilter.value).map((plan) => ({
    ...plan,
    isRecommended: plan.id === recommendedPlanId.value,
    summary: getPlanSummary(plan)
  }))
)

async function fetchPlans() {
  try {
    loading.value = true
    loadError.value = false
    plans.value = await loadPlansWithRetry(() => api.user.getPlans())
  } catch (error) {
    console.error('获取套餐列表失败:', error)
    loadError.value = true
  } finally {
    loading.value = false
  }
}

function formatDuration(durationDays) {
  return Number(durationDays) === 0 ? '不限时' : `${durationDays} 天`
}

function getPlanSummary(plan) {
  if (plan.description) return plan.description

  const duration = Number(plan.duration_days)
  if (duration === 0) {
    return `提供 ${plan.traffic_text} 流量，没有使用期限，更适合希望省心续用的用户。`
  }

  return `提供 ${plan.traffic_text} 流量，可使用 ${duration} 天，适合想先明确预算和周期的用户。`
}

/**
 * 初始化首页推广跟踪。
 *
 * 职责：处理落地页推广码缓存和点击记录，保证后续选套餐后仍能归因。
 * 关键参数：推广码来自当前路由 query 中的 ref。
 * 核心分支：存在 ref 时写入 sessionStorage 并上报点击，不存在时保持现有流程。
 */
async function initializeReferralTracking() {
  const referralCode = String(route.query.ref || '').trim()
  if (!referralCode) {
    return
  }

  sessionStorage.setItem('referral_code', referralCode)

  try {
    await api.user.recordReferralClick(referralCode)
  } catch (error) {
    console.error('记录首页推广点击失败:', error)
  }
}

function selectPlan(plan) {
  if (plan.is_soldout) {
    ElMessage.warning('该套餐已售罄')
    return
  }

  if (isLoggedIn.value) {
    router.push({ path: '/user' })
  } else {
    router.push({
      name: 'Login',
      query: {
        plan_id: plan.id,
        plan_name: plan.name,
        plan_price: plan.price_text,
        plan_traffic: plan.traffic_text,
        plan_duration: plan.duration_days,
        plan_soldout: plan.is_soldout ? '1' : '0'
      }
    })
  }
}

onMounted(() => {
  initializeReferralTracking()
  fetchPlans()
})
</script>

<style scoped>
.home-container {
  --bg-soft: linear-gradient(180deg, #f7f8f4 0%, #fcfbf6 38%, #f6f7fb 100%);
  --surface: rgba(255, 255, 255, 0.94);
  --surface-strong: #ffffff;
  --text-main: #14213d;
  --text-muted: #5f6c8d;
  --line: rgba(20, 33, 61, 0.08);
  --accent: #0f766e;
  --accent-strong: #0b5f58;
  --accent-soft: rgba(15, 118, 110, 0.1);
  --warn: #d97706;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-soft);
  color: var(--text-main);
}

.header {
  position: sticky;
  top: 0;
  z-index: 50;
  backdrop-filter: blur(14px);
  background: rgba(247, 248, 244, 0.82);
  border-bottom: 1px solid rgba(20, 33, 61, 0.06);
}

.header-content {
  max-width: 1180px;
  margin: 0 auto;
  padding: 0 20px;
  min-height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.logo {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.nav {
  display: flex;
  gap: 10px;
}

.nav-item {
  padding: 8px 14px;
  border-radius: 999px;
  color: var(--text-main);
  text-decoration: none;
  transition: 0.25s ease;
}

.nav-item:hover,
.nav-item.router-link-active {
  background: rgba(20, 33, 61, 0.08);
  color: var(--accent-strong);
}

.main {
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: 28px 20px 56px;
}

.section-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 20px;
}

.section-head.compact {
  margin-bottom: 16px;
}

.section-kicker {
  margin: 0 0 8px;
  color: var(--accent-strong);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.section-title {
  margin: 0;
  font-size: clamp(24px, 4vw, 34px);
  line-height: 1.2;
}

.section-note {
  margin: 0;
  max-width: 320px;
  color: var(--text-muted);
  font-size: 14px;
  line-height: 1.7;
  text-align: right;
}

.plan-filter {
  display: inline-flex;
  width: 370px;
  gap: 6px;
  padding: 5px;
  margin-bottom: 18px;
  border: 1px solid rgba(20, 33, 61, 0.08);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.76);
  box-shadow: 0 10px 28px rgba(20, 33, 61, 0.06);
}

.filter-button {
  flex: 1;
  min-width: 70px;
  padding: 8px 14px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: 0.2s ease;
}

.filter-button:hover,
.filter-button.active {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.plans-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}

.plans-loading {
  pointer-events: none;
}

.plan-skeleton {
  overflow: hidden;
}

.skeleton-pill,
.skeleton-line,
.skeleton-block,
.skeleton-summary,
.skeleton-button {
  position: relative;
  overflow: hidden;
  background: #eef3f3;
}

.skeleton-pill::after,
.skeleton-line::after,
.skeleton-block::after,
.skeleton-summary::after,
.skeleton-button::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.72), transparent);
  animation: skeleton-shimmer 1.2s ease-in-out infinite;
}

.skeleton-pill {
  width: 74px;
  height: 28px;
  border-radius: 999px;
}

.skeleton-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.skeleton-line {
  height: 22px;
  border-radius: 999px;
}

.skeleton-line.title {
  width: 42%;
}

.skeleton-line.price {
  width: 30%;
  height: 30px;
}

.skeleton-block {
  min-height: 78px;
  border-color: transparent;
}

.skeleton-summary {
  height: 88px;
  border-radius: 18px;
}

.skeleton-line.note {
  width: 76%;
  height: 16px;
}

.skeleton-button {
  width: 100%;
  height: 50px;
  border-radius: 16px;
}

.plans-state {
  min-height: 260px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 34px 24px;
  border: 1px dashed rgba(20, 33, 61, 0.14);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.72);
  color: var(--text-muted);
  text-align: center;
}

.state-title {
  color: var(--text-main);
  font-size: 18px;
  font-weight: 800;
}

.plans-state p {
  max-width: 360px;
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
}

.state-retry {
  min-width: 108px;
  min-height: 42px;
  padding: 0 18px;
  border: none;
  border-radius: 999px;
  background: var(--accent);
  color: #ffffff;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: 0.2s ease;
}

.state-retry:hover {
  background: var(--accent-strong);
}

@keyframes skeleton-shimmer {
  100% {
    transform: translateX(100%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton-pill::after,
  .skeleton-line::after,
  .skeleton-block::after,
  .skeleton-summary::after,
  .skeleton-button::after {
    animation: none;
  }
}

.plan-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px;
  border-radius: 26px;
  border: 1px solid var(--line);
  background: var(--surface-strong);
  box-shadow: 0 18px 42px rgba(20, 33, 61, 0.07);
  transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease;
}

.plan-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 24px 56px rgba(20, 33, 61, 0.11);
}

.plan-card.is-recommended {
  border-color: rgba(15, 118, 110, 0.3);
  background:
    radial-gradient(circle at top right, rgba(15, 118, 110, 0.12), transparent 28%),
    #ffffff;
}

.plan-card.is-soldout {
  opacity: 0.78;
}

.plan-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 28px;
}

.plan-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.plan-badge.recommend {
  background: rgba(15, 118, 110, 0.12);
  color: var(--accent-strong);
}

.plan-badge.soldout {
  background: rgba(217, 119, 6, 0.12);
  color: var(--warn);
}

.plan-top {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.plan-name {
  margin: 0;
  font-size: 24px;
  line-height: 1.15;
}

.plan-price {
  display: flex;
  align-items: baseline;
  gap: 4px;
  color: var(--accent-strong);
  white-space: nowrap;
}

.price-symbol {
  font-size: 18px;
}

.price-value {
  font-size: 34px;
  font-weight: 800;
  line-height: 1;
}

.plan-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.metric-card {
  padding: 14px 16px;
  border-radius: 18px;
  background: #f7f8fa;
  border: 1px solid rgba(20, 33, 61, 0.05);
}

.metric-label {
  display: block;
  color: var(--text-muted);
  font-size: 12px;
  margin-bottom: 8px;
}

.metric-value {
  font-size: 18px;
  line-height: 1.35;
}

.plan-summary {
  padding: 16px;
  border-radius: 18px;
  background: rgba(15, 118, 110, 0.05);
}

.summary-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  color: var(--accent-strong);
  font-size: 13px;
  font-weight: 700;
}

.plan-summary p {
  margin: 0;
  color: var(--text-main);
  font-size: 14px;
  line-height: 1.8;
}

.plan-footer {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: auto;
}

.plan-highlight {
  display: flex;
  align-items: start;
  gap: 8px;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.7;
}

.buy-btn {
  width: 100%;
  height: 50px;
  border-radius: 16px;
  font-size: 16px;
  font-weight: 700;
  border: none;
  background: linear-gradient(135deg, #0f766e 0%, #115e59 100%);
}

.buy-btn :deep(span) {
  display: inline-flex;
  align-items: center;
}

.btn-icon {
  margin-left: 6px;
}

.footer {
  margin-top: auto;
  padding: 22px 20px 30px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

@media (max-width: 1024px) {
  .section-head {
    align-items: start;
    flex-direction: column;
  }

  .section-note {
    max-width: none;
    text-align: left;
  }

  .plans-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .header-content {
    padding: 0 14px;
    min-height: 52px;
  }

  .logo {
    font-size: 19px;
  }

  .nav {
    gap: 6px;
  }

  .nav-item {
    padding: 7px 10px;
    font-size: 13px;
  }

  .main {
    padding: 14px 14px 34px;
  }

  .section-head {
    gap: 10px;
    margin-bottom: 14px;
  }

  .section-title {
    font-size: 25px;
  }

  .plan-filter {
    display: flex;
    width: 100%;
    gap: 4px;
    padding: 4px;
    margin-bottom: 14px;
  }

  .filter-button {
    flex: 1;
    min-width: 0;
    padding: 7px 10px;
    font-size: 13px;
  }

  .plans-grid {
    grid-template-columns: 1fr;
    gap: 14px;
  }

  .plan-card {
    gap: 12px;
    padding: 14px;
    border-radius: 20px;
  }

  .plan-badges {
    gap: 6px;
    min-height: 24px;
  }

  .plan-badge {
    padding: 5px 9px;
  }

  .plan-name {
    font-size: 22px;
  }

  .plan-top {
    flex-direction: column;
    gap: 8px;
  }

  .price-value {
    font-size: 29px;
  }

  .plan-metrics {
    gap: 10px;
  }

  .metric-card {
    padding: 10px 12px;
    border-radius: 15px;
  }

  .metric-label {
    margin-bottom: 5px;
  }

  .metric-value {
    font-size: 17px;
  }

  .plan-summary {
    padding: 12px;
    border-radius: 15px;
  }

  .summary-row {
    margin-bottom: 7px;
  }

  .plan-summary p,
  .plan-highlight {
    line-height: 1.55;
  }

  .plan-footer {
    gap: 10px;
  }

  .buy-btn {
    height: 44px;
    border-radius: 14px;
    font-size: 15px;
  }

}
</style>
