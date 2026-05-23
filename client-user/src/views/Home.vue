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

        <div class="plans-grid">
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

      <section class="announcements-section">
        <div class="announcements-list">
          <article
            v-for="announcement in announcements"
            :key="announcement.id"
            class="announcement-item"
          >
            <div class="announcement-header">
              <div class="announcement-title-row">
                <el-tag v-if="announcement.pinned" type="danger" size="small">置顶</el-tag>
                <h3 class="announcement-title">{{ announcement.title }}</h3>
              </div>
              <span class="announcement-time">{{ formatTime(announcement.created_at) }}</span>
            </div>
            <div class="announcement-content" v-html="renderMarkdown(announcement.content)"></div>
          </article>

          <div v-if="announcements.length === 0" class="empty-tip">
            暂无公告
          </div>
        </div>

        <div v-if="announcementTotal > announcementLimit" class="pagination-container">
          <el-pagination
            v-model:current-page="announcementPage"
            :page-size="announcementLimit"
            :total="announcementTotal"
            layout="prev, pager, next"
            @current-change="handleAnnouncementPageChange"
          />
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
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { ArrowRight, User } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { marked } from 'marked'
import api from '@/api'

const router = useRouter()
const userStore = useUserStore()

const plans = ref([])
const announcements = ref([])
const loading = ref(false)

const announcementPage = ref(1)
const announcementTotal = ref(0)
const announcementLimit = 3

const isLoggedIn = computed(() => userStore.isLoggedIn)

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
    summary: getPlanSummary(plan)
  }))
)

async function fetchPlans() {
  try {
    loading.value = true
    const response = await api.user.getPlans()
    if (response.code === 0) {
      plans.value = response.data.plans || []
    }
  } catch (error) {
    console.error('获取套餐列表失败:', error)
  } finally {
    loading.value = false
  }
}

async function fetchAnnouncements() {
  try {
    const response = await api.user.getAnnouncements({ page: announcementPage.value, limit: announcementLimit })
    if (response.code === 0) {
      announcements.value = response.data.list || []
      announcementTotal.value = Number(response.data.total) || 0
    }
  } catch (error) {
    console.error('获取公告列表失败:', error)
  }
}

function handleAnnouncementPageChange(page) {
  announcementPage.value = page
  fetchAnnouncements()
}

function renderMarkdown(content) {
  if (!content) return ''
  return marked(content)
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

function formatTime(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp * 1000)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
}

onMounted(() => {
  fetchPlans()
  fetchAnnouncements()
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

.plans-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 18px;
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

.announcements-section {
  margin-top: 42px;
}

.announcements-list {
  border-radius: 24px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 18px 42px rgba(20, 33, 61, 0.06);
  overflow: hidden;
}

.announcement-item {
  padding: 20px 22px;
  border-bottom: 1px solid rgba(20, 33, 61, 0.06);
}

.announcement-item:last-child {
  border-bottom: none;
}

.announcement-header {
  display: flex;
  align-items: center;
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
  font-size: 18px;
}

.announcement-time {
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 13px;
}

.announcement-content {
  color: var(--text-muted);
  line-height: 1.8;
}

.announcement-content :deep(h1),
.announcement-content :deep(h2),
.announcement-content :deep(h3),
.announcement-content :deep(h4),
.announcement-content :deep(h5),
.announcement-content :deep(h6) {
  margin: 16px 0 8px;
  color: var(--text-main);
}

.announcement-content :deep(p),
.announcement-content :deep(ul),
.announcement-content :deep(ol),
.announcement-content :deep(pre),
.announcement-content :deep(blockquote),
.announcement-content :deep(table) {
  margin-bottom: 12px;
}

.announcement-content :deep(ul),
.announcement-content :deep(ol) {
  padding-left: 20px;
}

.announcement-content :deep(code) {
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(20, 33, 61, 0.06);
}

.announcement-content :deep(pre) {
  padding: 16px;
  border-radius: 14px;
  overflow-x: auto;
  background: #f7f8fa;
}

.announcement-content :deep(blockquote) {
  padding-left: 14px;
  border-left: 3px solid var(--accent);
  color: var(--text-muted);
}

.announcement-content :deep(a) {
  color: var(--accent-strong);
}

.announcement-content :deep(table) {
  width: 100%;
  border-collapse: collapse;
}

.announcement-content :deep(th),
.announcement-content :deep(td) {
  border: 1px solid rgba(20, 33, 61, 0.08);
  padding: 8px 12px;
  text-align: left;
}

.announcement-content :deep(th) {
  background: #f7f8fa;
}

.empty-tip {
  padding: 44px 20px;
  text-align: center;
  color: var(--text-muted);
}

.pagination-container {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
  padding: 0 4px;
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
}

@media (max-width: 768px) {
  .header-content {
    padding: 0 16px;
    min-height: 58px;
  }

  .logo {
    font-size: 20px;
  }

  .nav {
    gap: 6px;
  }

  .nav-item {
    padding: 8px 10px;
    font-size: 14px;
  }

  .main {
    padding: 18px 16px 44px;
  }

  .section-title {
    font-size: 28px;
  }

  .plans-grid {
    grid-template-columns: 1fr;
  }

  .plan-card {
    padding: 18px;
    border-radius: 22px;
  }

  .plan-top {
    flex-direction: column;
  }

  .price-value {
    font-size: 32px;
  }

  .metric-card {
    padding: 12px 14px;
  }

  .announcement-item {
    padding: 18px 16px;
  }

  .announcement-header {
    align-items: start;
    flex-direction: column;
  }

  .pagination-container {
    justify-content: center;
  }
}
</style>
