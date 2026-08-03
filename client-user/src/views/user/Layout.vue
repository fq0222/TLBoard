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
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useUserStore } from '@/stores/user'
import {
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
    padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
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
    gap: 4px;
    min-height: 52px;
    border: 0;
    border-radius: 12px;
    background: transparent;
    color: #606266;
    font: inherit;
    text-decoration: none;
    transition: color 0.2s ease, background 0.2s ease;
  }

  .bottom-nav-item span {
    font-size: 12px;
    line-height: 1;
  }

  .bottom-nav-item.active {
    color: #409eff;
    background: #ecf5ff;
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
</style>
