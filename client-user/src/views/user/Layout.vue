<template>
  <div class="user-layout">
    <!-- 移动端顶部栏 -->
    <header class="mobile-header">
      <button class="menu-btn" @click="toggleSidebar">
        <el-icon :size="24"><Expand /></el-icon>
      </button>
      <h1 class="mobile-title">用户中心</h1>
    </header>

    <!-- 遮罩层 -->
    <div 
      v-if="sidebarOpen" 
      class="sidebar-overlay" 
      @click="closeSidebar"
    />

    <!-- 侧边栏 -->
    <aside class="sidebar" :class="{ 'sidebar-open': sidebarOpen }">
      <div class="sidebar-header">
        <h2 class="sidebar-title">用户中心</h2>
        <button class="close-btn" @click="closeSidebar">
          <el-icon><Close /></el-icon>
        </button>
      </div>
      
      <nav class="sidebar-nav">
        <router-link to="/user" class="nav-item" exact-active-class="active" @click="closeSidebar">
          <el-icon><User /></el-icon>
          <span>个人中心</span>
        </router-link>
        <router-link 
          v-if="subscriptionReady" 
          to="/user/subscription" 
          class="nav-item" 
          active-class="active" 
          @click="closeSidebar"
        >
          <el-icon><Link /></el-icon>
          <span>订阅信息</span>
        </router-link>
        <router-link 
          v-if="subscriptionReady" 
          to="/user/cf-optimize" 
          class="nav-item" 
          active-class="active" 
          @click="closeSidebar"
        >
          <el-icon><Connection /></el-icon>
          <span>CF IP优选</span>
        </router-link>
        <router-link to="/user/tickets" class="nav-item" active-class="active" @click="closeSidebar">
          <el-icon><ChatDotRound /></el-icon>
          <span>工单支持</span>
          <span v-if="unreadTicketCount > 0" class="badge"></span>
        </router-link>
      </nav>
      
      <div class="sidebar-footer">
        <el-button type="danger" plain @click="handleLogout">
          <el-icon><SwitchButton /></el-icon>
          <span>退出登录</span>
        </el-button>
      </div>
    </aside>
    
    <!-- 主要内容 -->
    <main class="main-content">
      <router-view />
    </main>
  </div>
</template>

<script setup>
/**
 * 用户布局组件
 * 提供侧边栏导航和内容区域
 */

import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { User, Link, Connection, SwitchButton, ChatDotRound, Expand, Close } from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'
import api from '@/api'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const unreadTicketCount = ref(0)
const sidebarOpen = ref(false)

// 使用 computed 从 store 中获取 subscription_ready，确保与 Profile 组件同步
const subscriptionReady = computed(() => userStore.userInfo?.subscription_ready || false)

// 监听路由变化，切换导航时刷新未读数量
watch(() => route.path, () => {
  fetchUnreadCount()
})

/**
 * 切换侧边栏显示状态
 */
function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value
}

/**
 * 关闭侧边栏
 */
function closeSidebar() {
  sidebarOpen.value = false
}

/**
 * 获取未读工单数量
 */
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

/**
 * 处理退出登录
 */
async function handleLogout() {
  try {
    await ElMessageBox.confirm(
      '确定要退出登录吗？',
      '提示',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
    
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

/* 移动端顶部栏 - 桌面端隐藏 */
.mobile-header {
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
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sidebar-title {
  font-size: 20px;
  color: #409eff;
  text-align: center;
  flex: 1;
}

/* 关闭按钮 - 桌面端隐藏 */
.close-btn {
  display: none;
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

/* ========== 平板端适配 (768px - 1024px) ========== */
@media (max-width: 1024px) {
  .sidebar {
    width: 200px;
  }
  
  .main-content {
    margin-left: 200px;
  }
}

/* ========== 移动端适配 (< 768px) ========== */
@media (max-width: 768px) {
  /* 显示移动端顶部栏 */
  .mobile-header {
    display: flex;
    align-items: center;
    gap: 12px;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 56px;
    background: #fff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    padding: 0 16px;
    z-index: 200;
  }

  .menu-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border: none;
    background: none;
    cursor: pointer;
    border-radius: 8px;
    color: #333;
  }

  .menu-btn:hover {
    background: #f5f7fa;
  }

  .mobile-title {
    font-size: 18px;
    color: #409eff;
    font-weight: 600;
  }

  /* 遮罩层 */
  .sidebar-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 299;
  }

  /* 侧边栏 - 移动端默认隐藏 */
  .sidebar {
    transform: translateX(-100%);
    transition: transform 0.3s ease;
    width: 280px;
    z-index: 300;
  }

  /* 侧边栏打开状态 */
  .sidebar.sidebar-open {
    transform: translateX(0);
  }

  /* 显示关闭按钮 */
  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    background: none;
    cursor: pointer;
    border-radius: 6px;
    color: #666;
  }

  .close-btn:hover {
    background: #f5f7fa;
  }

  /* 主内容区域 */
  .main-content {
    margin-left: 0;
    padding: 72px 16px 20px;
    width: 100%;
    overflow-x: hidden;
  }
}
</style>