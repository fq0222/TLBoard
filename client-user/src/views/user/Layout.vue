<template>
  <div class="user-layout">
    <aside class="sidebar">
      <div class="sidebar-header">
        <img class="brand-logo" src="/favicon.svg" alt="天澜大陆" />
        <div class="brand-copy">
          <h2 class="brand-name">天澜大陆</h2>
          <p class="brand-subtitle">Tianlan Continent</p>
        </div>
      </div>

      <nav class="sidebar-nav">
        <button
          v-for="item in navItems"
          :key="item.to"
          type="button"
          class="nav-item nav-button"
          :class="{
            active: isNavActive(item),
            'onboarding-help-nav': item.key === 'help'
          }"
          @click="handleNavClick(item)"
        >
          <el-icon class="nav-icon"><component :is="item.icon" /></el-icon>
          <span class="nav-label">{{ item.label }}</span>
          <el-icon class="nav-arrow"><ArrowRight /></el-icon>
        </button>
      </nav>

      <div class="sidebar-footer">
        <div class="sidebar-user-card">
          <div class="user-avatar">{{ userInitial }}</div>
          <div class="user-summary">
            <strong class="user-display-name">{{ sidebarUserName }}</strong>
            <span class="user-role">USER</span>
          </div>
        </div>

        <button type="button" class="logout-button" @click="handleLogout">
          <el-icon><SwitchButton /></el-icon>
          <span>退出登录</span>
        </button>
      </div>
    </aside>

    <main class="main-content">
      <div v-if="contentLoading" class="page-loading-state">
        <el-icon class="page-loading-icon"><Loading /></el-icon>
        <p class="page-loading-text">页面加载中，请稍候...</p>
      </div>
      <router-view v-else />
    </main>

    <button
      type="button"
      class="ticket-reminder-button"
      :class="{ shaking: unreadTicketCount > 0 }"
      aria-label="查看我的工单"
      @click="goToTickets"
    >
      <el-icon :size="24"><Bell /></el-icon>
      <span v-if="unreadTicketCount > 0" class="ticket-reminder-dot"></span>
    </button>

    <nav class="bottom-nav">
      <button
        v-for="item in mobileNavItems"
        :key="item.to"
        type="button"
        class="bottom-nav-item"
        :class="{
          active: isNavActive(item),
          'onboarding-help-bottom-nav': item.key === 'help'
        }"
        @click="handleNavClick(item)"
      >
        <el-icon :size="20">
          <component :is="item.icon" />
        </el-icon>
        <span>{{ item.label }}</span>
      </button>
    </nav>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useUserStore } from '@/stores/user'
import api from '@/api'
import {
  ArrowRight,
  Bell,
  House,
  Link,
  Loading,
  QuestionFilled,
  SwitchButton,
  User
} from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const pendingNavPath = ref('')
const contentLoading = ref(false)
const unreadTicketCount = ref(0)
let unreadTicketTimer = null

const navItems = [
  { key: 'home', label: '首页', to: '/user', icon: House },
  { key: 'subscription', label: '订阅', to: '/user/subscription', icon: Link },
  { key: 'help', label: '教程', to: '/user/help', icon: QuestionFilled },
  { key: 'my', label: '我的', to: '/user/my', icon: User }
]
const mobileNavItems = navItems
const currentNavPath = computed(() => pendingNavPath.value || route.path)
const sidebarUserName = computed(() => {
  const email = String(userStore.userEmail || '').trim()
  if (!email) return 'USER'

  return email.split('@')[0] || email
})
const userInitial = computed(() => sidebarUserName.value.charAt(0).toUpperCase() || 'U')

/**
 * 判断导航项是否处于当前激活状态。
 * 核心分支语义：存在待跳转路径时优先使用待跳转路径，确保点击后立即反馈选中态。
 *
 * @param {{ to: string }} item - 导航项配置
 * @returns {boolean} 是否高亮显示
 */
function isNavActive(item) {
  if (item.to === '/user') {
    return currentNavPath.value === '/user'
  }

  return currentNavPath.value === item.to || currentNavPath.value.startsWith(`${item.to}/`)
}

/**
 * 预加载用户中心常用标签页组件，减少首次切换时等待懒加载 chunk 的时间。
 * 核心分支语义：优先利用浏览器空闲时段执行；不支持时退化为短延迟异步预加载。
 *
 * @returns {void}
 */
function preloadNavPages() {
  const preloadTasks = [
    () => import('@/views/user/Profile.vue'),
    () => import('@/views/user/Subscription.vue'),
    () => import('@/views/user/HelpCenter.vue'),
    () => import('@/views/user/My.vue')
  ]

  const runPreload = () => {
    preloadTasks.forEach(task => {
      task().catch(error => {
        console.error('预加载用户中心页面失败:', error)
      })
    })
  }

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(runPreload, { timeout: 1500 })
    return
  }

  window.setTimeout(runPreload, 300)
}

/**
 * 获取未读工单数量，用于控制全局提醒铃铛的红点和动画。
 * 核心分支语义：接口异常不打断页面使用，保留当前提醒状态并记录错误。
 *
 * @returns {Promise<void>}
 */
async function fetchUnreadTicketCount() {
  try {
    const response = await api.user.getTicketUnreadCount()
    if (response.code === 0) {
      unreadTicketCount.value = response.data.count || 0
    }
  } catch (error) {
    console.error('获取未读工单数量失败:', error)
  }
}

/**
 * 处理导航点击后的即时高亮和过渡 loading。
 * 核心分支语义：先切换导航选中态并显示内容区 loading，再发起路由跳转；失败时回滚状态。
 *
 * @param {{ to: string }} item - 目标导航项
 * @returns {Promise<void>}
 */
async function handleNavClick(item) {
  if (isNavActive(item) && route.path === item.to) {
    return
  }

  pendingNavPath.value = item.to
  contentLoading.value = true

  try {
    await router.push(item.to)
  } catch (error) {
    pendingNavPath.value = ''
    contentLoading.value = false
    console.error('用户中心导航跳转失败:', error)
  }
}

/**
 * 跳转到我的工单列表。
 * 核心分支语义：当前已在工单页时只刷新未读数，不重复触发路由跳转。
 *
 * @returns {Promise<void>}
 */
async function goToTickets() {
  if (route.path.startsWith('/user/tickets')) {
    await fetchUnreadTicketCount()
    return
  }

  await router.push('/user/tickets')
}

async function handleLogout() {
  try {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })

    userStore.logout()
    router.push('/')
  } catch {
    // 用户取消操作
  }
}

watch(() => route.path, async (newPath) => {
  fetchUnreadTicketCount()

  if (!pendingNavPath.value) {
    return
  }

  if (newPath === pendingNavPath.value || newPath.startsWith(`${pendingNavPath.value}/`)) {
    await nextTick()
    pendingNavPath.value = ''
    contentLoading.value = false
  }
})

onMounted(() => {
  preloadNavPages()
  fetchUnreadTicketCount()
  unreadTicketTimer = window.setInterval(fetchUnreadTicketCount, 60 * 1000)
})

onBeforeUnmount(() => {
  if (unreadTicketTimer) {
    window.clearInterval(unreadTicketTimer)
    unreadTicketTimer = null
  }
})
</script>

<style scoped>
.user-layout {
  display: flex;
  min-height: 100vh;
  background: #f5f7fa;
}

.bottom-nav {
  display: none;
}

.sidebar {
  width: 260px;
  background: #fff;
  box-shadow: 10px 0 30px rgba(31, 45, 61, 0.06);
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 100;
}

.sidebar-header {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 120px;
  padding: 32px 28px 24px;
}

.brand-logo {
  width: 50px;
  height: 50px;
  flex: 0 0 auto;
  border-radius: 16px;
  box-shadow: 0 14px 30px rgba(64, 158, 255, 0.18);
}

.brand-copy {
  min-width: 0;
}

.brand-name {
  margin: 0;
  color: #111827;
  font-size: 22px;
  font-weight: 800;
  line-height: 1.1;
}

.brand-subtitle {
  margin: 8px 0 0;
  color: #2563eb;
  font-size: 12px;
  font-weight: 800;
  line-height: 1;
  text-transform: uppercase;
}

.sidebar-nav {
  flex: 1;
  padding: 10px 20px 20px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  min-height: 54px;
  margin: 0 0 10px;
  padding: 0 18px;
  border: 0;
  border-radius: 16px;
  background: transparent;
  color: #8a95a8;
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease, transform 0.2s ease;
}

.nav-button {
  appearance: none;
}

.nav-icon {
  flex: 0 0 auto;
  font-size: 22px;
}

.nav-label {
  flex: 1;
  min-width: 0;
}

.nav-arrow {
  flex: 0 0 auto;
  color: #2563eb;
  font-size: 16px;
  opacity: 0;
  transform: translateX(-4px);
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.nav-item:hover {
  background: #f4f8ff;
  color: #2563eb;
}

.nav-item.active {
  border-radius: 16px;
  background: #edf5ff;
  color: #2563eb;
  transform: translateX(0);
}

.nav-item.active .nav-arrow {
  opacity: 1;
  transform: translateX(0);
}

.sidebar-footer {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 20px 24px;
}

.sidebar-user-card {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 90px;
  padding: 18px;
  border: 1px solid #eef2f7;
  border-radius: 10px;
  background: #fbfcfe;
  cursor: default;
  transition: border-color 0.2s ease, background 0.2s ease;
}

.sidebar-user-card:hover {
  border-color: #2563eb;
  background: #fbfcfe;
}

.user-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #2563eb;
  color: #fff;
  box-shadow: 0 3px 8px rgba(37, 99, 235, 0.28);
  font-size: 18px;
  font-weight: 800;
}

.user-summary {
  min-width: 0;
}

.user-display-name {
  display: block;
  overflow: hidden;
  color: #111827;
  font-size: 15px;
  font-weight: 800;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.2s ease;
}

.sidebar-user-card:hover .user-display-name {
  color: #2563eb;
}

.user-role {
  display: block;
  margin-top: 4px;
  color: #6b7280;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
}

.logout-button {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  min-height: 48px;
  padding: 0 16px;
  border: 0;
  border-radius: 18px;
  background: transparent;
  color: #ff2d3d;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease;
}

.logout-button .el-icon {
  font-size: 19px;
}

.logout-button:hover {
  background: #fff1f2;
  color: #ff2d3d;
}

.main-content {
  flex: 1;
  margin-left: 260px;
  padding: 20px;
}

.page-loading-state {
  min-height: calc(100vh - 40px);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 12px;
  color: #606266;
}

.page-loading-icon {
  font-size: 30px;
  color: #409eff;
  animation: nav-loading-spin 1s linear infinite;
}

.page-loading-text {
  margin: 0;
  font-size: 14px;
}

.ticket-reminder-button {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 230;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border: 0;
  border-radius: 50%;
  background: #409eff;
  color: #fff;
  box-shadow: 0 12px 28px rgba(64, 158, 255, 0.32);
  cursor: pointer;
  transition: transform 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
}

.ticket-reminder-button:hover {
  background: #337ecc;
  transform: translateY(-2px);
  box-shadow: 0 16px 34px rgba(64, 158, 255, 0.38);
}

.ticket-reminder-button.shaking {
  animation: ticket-bell-shake 1.8s ease-in-out infinite;
}

.ticket-reminder-dot {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 10px;
  height: 10px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: #f56c6c;
}

@media (max-width: 1024px) {
  .sidebar {
    width: 200px;
  }

  .sidebar-header {
    gap: 10px;
    min-height: 106px;
    padding: 26px 16px 20px;
  }

  .brand-logo {
    width: 42px;
    height: 42px;
    border-radius: 14px;
  }

  .brand-name {
    font-size: 18px;
  }

  .brand-subtitle {
    font-size: 10px;
  }

  .sidebar-nav {
    padding: 8px 12px 18px;
  }

  .nav-item {
    min-height: 50px;
    padding: 0 14px;
  }

  .sidebar-footer {
    padding: 16px 12px 20px;
  }

  .sidebar-user-card {
    gap: 10px;
    min-height: 78px;
    padding: 14px;
  }

  .user-avatar {
    width: 40px;
    height: 40px;
    font-size: 18px;
  }

  .user-display-name {
    font-size: 13px;
  }

  .logout-button {
    min-height: 44px;
    border-radius: 14px;
  }

  .main-content {
    margin-left: 200px;
  }
}

@media (max-width: 768px) {
  .sidebar {
    display: none;
  }

  .main-content {
    margin-left: 0;
    width: 100%;
    min-width: 0;
    padding: 16px 16px calc(84px + env(safe-area-inset-bottom)) 16px;
    overflow-x: hidden;
  }

  .page-loading-state {
    min-height: calc(100vh - 132px);
  }

  .bottom-nav {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 7px 8px calc(7px + env(safe-area-inset-bottom));
    background: rgba(255, 255, 255, 0.96);
    border-top: 1px solid #e4e7ed;
    backdrop-filter: blur(12px);
    z-index: 220;
  }

  .bottom-nav-item {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    min-height: 50px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: #606266;
    font: inherit;
    text-decoration: none;
    transition: color 0.2s ease, background 0.2s ease;
  }

  .bottom-nav-item span {
    font-size: 11px;
    line-height: 1;
  }

  .bottom-nav-item.active {
    color: #409eff;
    background: #ecf5ff;
  }

  .ticket-reminder-button {
    right: 18px;
    bottom: calc(92px + env(safe-area-inset-bottom));
    width: 48px;
    height: 48px;
  }
}

@keyframes nav-loading-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes ticket-bell-shake {
  0%,
  70%,
  100% {
    transform: rotate(0deg);
  }
  76% {
    transform: rotate(10deg);
  }
  82% {
    transform: rotate(-8deg);
  }
  88% {
    transform: rotate(6deg);
  }
  94% {
    transform: rotate(-4deg);
  }
}
</style>
