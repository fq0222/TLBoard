<template>
  <div class="user-layout">
    <!-- 侧边栏 -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <h2 class="sidebar-title">用户中心</h2>
      </div>
      
      <nav class="sidebar-nav">
        <router-link to="/user" class="nav-item" exact-active-class="active">
          <el-icon><User /></el-icon>
          <span>个人中心</span>
        </router-link>
        <router-link to="/user/subscription" class="nav-item" active-class="active">
          <el-icon><Link /></el-icon>
          <span>订阅信息</span>
        </router-link>
        <router-link to="/user/cf-optimize" class="nav-item" active-class="active">
          <el-icon><Connection /></el-icon>
          <span>CF IP优选</span>
        </router-link>
        <router-link to="/user/tickets" class="nav-item" active-class="active">
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

import { ref, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { User, Link, Connection, SwitchButton, ChatDotRound } from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'
import api from '@/api'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const unreadTicketCount = ref(0)

// 监听路由变化，当离开工单详情页时刷新未读数量
watch(() => route.path, (newPath, oldPath) => {
  if (oldPath && oldPath.startsWith('/user/tickets/')) {
    fetchUnreadCount()
  }
})

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
</style>