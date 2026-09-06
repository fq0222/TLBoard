<template>
  <div class="user-layout">
    <aside class="sidebar">
      <div class="sidebar-header">
        <h2 class="sidebar-title">用户中心</h2>
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
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <el-button type="danger" plain @click="handleLogout">
          <el-icon><SwitchButton /></el-icon>
          <span>退出登录</span>
        </el-button>
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
  width: 240px;
  background: #fff;
  box-shadow: 2px 0 8px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 100;
}

.sidebar-header {
  padding: 20px;
  border-bottom: 1px solid #eee;
}

.sidebar-title {
  margin: 0;
  font-size: 20px;
  color: #409eff;
  text-align: center;
}

.sidebar-nav {
  flex: 1;
  padding: 20px 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 15px 20px;
  border: 0;
  background: transparent;
  color: #333;
  font: inherit;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.3s;
}

.nav-button {
  appearance: none;
}

.nav-item:hover,
.nav-item.active {
  background: #ecf5ff;
  color: #409eff;
}

.sidebar-footer {
  padding: 20px;
  border-top: 1px solid #eee;
}

.sidebar-footer .el-button {
  width: 100%;
}

.main-content {
  flex: 1;
  margin-left: 240px;
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
