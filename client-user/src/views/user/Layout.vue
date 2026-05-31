<template>
  <div class="user-layout">
    <aside class="sidebar">
      <div class="sidebar-header">
        <h2 class="sidebar-title">用户中心</h2>
      </div>

      <nav class="sidebar-nav">
        <router-link to="/user" class="nav-item" exact-active-class="active">
          <el-icon><House /></el-icon>
          <span>首页</span>
        </router-link>
        <router-link to="/user/my" class="nav-item" active-class="active">
          <el-icon><User /></el-icon>
          <span>我的</span>
        </router-link>
        <router-link
          v-if="subscriptionReady"
          to="/user/subscription"
          class="nav-item"
          active-class="active"
        >
          <el-icon><Link /></el-icon>
          <span>订阅</span>
        </router-link>
        <router-link
          v-if="subscriptionReady"
          to="/user/cf-optimize"
          class="nav-item"
          active-class="active"
        >
          <el-icon><Connection /></el-icon>
          <span>IP 优选</span>
        </router-link>
        <router-link to="/user/tickets" class="nav-item" active-class="active">
          <el-icon><ChatDotRound /></el-icon>
          <span>工单</span>
          <span v-if="unreadTicketCount > 0" class="badge"></span>
        </router-link>
        <router-link to="/user/help" class="nav-item onboarding-help-nav" active-class="active">
          <el-icon><QuestionFilled /></el-icon>
          <span>帮助</span>
        </router-link>
      </nav>

      <div class="sidebar-footer">
        <el-button type="danger" plain @click="handleLogout">
          <el-icon><SwitchButton /></el-icon>
          <span>退出登录</span>
        </el-button>
      </div>
    </aside>

    <main class="main-content">
      <router-view />
    </main>

    <nav class="bottom-nav">
      <router-link
        v-for="item in mobileNavItems"
        :key="item.to"
        :to="item.to"
        class="bottom-nav-item"
        :class="{ active: isMobileNavActive(item), 'onboarding-help-bottom-nav': item.key === 'help' }"
      >
        <el-icon :size="20">
          <component :is="item.icon" />
        </el-icon>
        <span>{{ item.label }}</span>
      </router-link>
    </nav>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useUserStore } from '@/stores/user'
import {
  ChatDotRound,
  Connection,
  House,
  Link,
  QuestionFilled,
  SwitchButton,
  User
} from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'
import api from '@/api'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const unreadTicketCount = ref(0)

const subscriptionReady = computed(() => userStore.userInfo?.subscription_ready || false)

const mobileNavItems = [
  { key: 'home', label: '首页', to: '/user', icon: House },
  { key: 'subscription', label: '订阅', to: '/user/subscription', icon: Link },
  { key: 'help', label: '帮助', to: '/user/help', icon: QuestionFilled },
  { key: 'my', label: '我的', to: '/user/my', icon: User }
]

watch(
  () => route.path,
  () => {
    fetchUnreadCount()
  }
)

function isMobileNavActive(item) {
  if (item.to === '/user') {
    return route.path === '/user'
  }

  return route.path === item.to || route.path.startsWith(`${item.to}/`)
}

async function fetchUnreadCount() {
  try {
    const response = await api.user.getTicketUnreadCount()
    if (response.code === 0) {
      unreadTicketCount.value = response.data.count
    }
  } catch (error) {
    console.error('获取未读工单数量失败:', error)
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

onMounted(() => {
  fetchUnreadCount()
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
  padding: 15px 20px;
  color: #333;
  text-decoration: none;
  transition: all 0.3s;
}

.nav-item:hover,
.nav-item.active {
  background: #ecf5ff;
  color: #409eff;
}

.badge {
  display: inline-block;
  width: 8px;
  height: 8px;
  background: #f56c6c;
  border-radius: 50%;
  margin-left: 5px;
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
    border-radius: 12px;
    color: #606266;
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
</style>
