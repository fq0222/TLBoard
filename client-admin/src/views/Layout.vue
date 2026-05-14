<template>
  <div class="admin-layout">
    <!-- 侧边栏 -->
    <aside class="sidebar" :class="{ collapsed: isCollapsed }">
      <div class="sidebar-header">
        <h1 class="sidebar-title" v-if="!isCollapsed">管理端</h1>
        <h1 class="sidebar-title collapsed-title" v-else>管</h1>
      </div>
      
      <nav class="sidebar-nav">
        <router-link to="/admin" class="nav-item" exact-active-class="active">
          <el-icon><DataBoard /></el-icon>
          <span v-if="!isCollapsed">仪表盘</span>
        </router-link>
        <router-link to="/admin/servers" class="nav-item" active-class="active">
          <el-icon><Monitor /></el-icon>
          <span v-if="!isCollapsed">服务器管理</span>
        </router-link>
        <router-link to="/admin/plans" class="nav-item" active-class="active">
          <el-icon><Goods /></el-icon>
          <span v-if="!isCollapsed">套餐管理</span>
        </router-link>
        <router-link to="/admin/users" class="nav-item" active-class="active">
          <el-icon><User /></el-icon>
          <span v-if="!isCollapsed">用户管理</span>
        </router-link>
        <router-link to="/admin/orders" class="nav-item" active-class="active">
          <el-icon><Document /></el-icon>
          <span v-if="!isCollapsed">订单管理</span>
        </router-link>
        <router-link to="/admin/announcements" class="nav-item" active-class="active">
          <el-icon><Bell /></el-icon>
          <span v-if="!isCollapsed">公告管理</span>
        </router-link>
        <router-link to="/admin/cf-ips" class="nav-item" active-class="active">
          <el-icon><Connection /></el-icon>
          <span v-if="!isCollapsed">CF IP池</span>
        </router-link>
        <router-link to="/admin/tickets" class="nav-item" active-class="active">
          <el-icon><ChatDotRound /></el-icon>
          <span v-if="!isCollapsed">工单管理</span>
        </router-link>
        <router-link to="/admin/email" class="nav-item" active-class="active">
          <el-icon><Message /></el-icon>
          <span v-if="!isCollapsed">邮件管理</span>
        </router-link>
        <router-link to="/admin/resources" class="nav-item" active-class="active">
          <el-icon><Folder /></el-icon>
          <span v-if="!isCollapsed">资源管理</span>
        </router-link>
        <router-link to="/admin/settings" class="nav-item" active-class="active">
          <el-icon><Setting /></el-icon>
          <span v-if="!isCollapsed">系统设置</span>
        </router-link>
      </nav>
      
      <div class="sidebar-footer">
        <el-button type="danger" plain @click="handleLogout" :icon="SwitchButton">
          <span v-if="!isCollapsed">退出登录</span>
        </el-button>
      </div>
    </aside>
    
    <!-- 主要内容 -->
    <main class="main-content">
      <!-- 顶部导航 -->
      <header class="header">
        <div class="header-left">
          <el-button 
            class="collapse-btn" 
            @click="toggleCollapse"
            :icon="isCollapsed ? Expand : Fold"
          />
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/admin' }">首页</el-breadcrumb-item>
            <el-breadcrumb-item v-if="currentRoute.meta.title">
              {{ currentRoute.meta.title }}
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        
        <div class="header-right">
          <el-dropdown @command="handleCommand">
            <span class="user-info">
              <el-icon><User /></el-icon>
              <span>{{ adminStore.username }}</span>
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="settings">系统设置</el-dropdown-item>
                <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>
      
      <!-- 内容区域 -->
      <div class="content">
        <router-view />
      </div>
    </main>
  </div>
</template>

<script setup>
/**
 * 管理端布局组件
 * 提供侧边栏导航和内容区域
 */

import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAdminStore } from '@/stores/admin'
import { 
  DataBoard, Monitor, Goods, User, Document, 
  Bell, Connection, Setting, SwitchButton, 
  Expand, Fold, ArrowDown, ChatDotRound,
  Message, Folder
} from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'

const router = useRouter()
const currentRoute = useRoute()
const adminStore = useAdminStore()

// 侧边栏折叠状态
const isCollapsed = ref(false)

/**
 * 切换侧边栏折叠状态
 */
function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value
}

/**
 * 处理下拉菜单命令
 * @param {string} command - 命令名称
 */
function handleCommand(command) {
  if (command === 'settings') {
    router.push('/admin/settings')
  } else if (command === 'logout') {
    handleLogout()
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
    
    adminStore.logout()
    router.push('/admin/login')
  } catch {
    // 用户取消操作
  }
}
</script>

<style scoped>
.admin-layout {
  display: flex;
  min-height: 100vh;
  background: #f5f7fa;
}

.sidebar {
  width: 240px;
  background: #304156;
  box-shadow: 2px 0 8px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  transition: width 0.3s;
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 100;
}

.sidebar.collapsed {
  width: 64px;
}

.sidebar-header {
  padding: 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.sidebar-title {
  font-size: 20px;
  color: #fff;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
}

.collapsed-title {
  font-size: 24px;
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
  color: #bfcbd9;
  text-decoration: none;
  transition: all 0.3s;
}

.nav-item:hover,
.nav-item.active {
  background: #263445;
  color: #409eff;
}

.sidebar-footer {
  padding: 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.sidebar-footer .el-button {
  width: 100%;
}

.main-content {
  flex: 1;
  margin-left: 240px;
  transition: margin-left 0.3s;
}

.sidebar.collapsed + .main-content {
  margin-left: 64px;
}

.header {
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  padding: 0 20px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: sticky;
  top: 0;
  z-index: 99;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 15px;
}

.collapse-btn {
  border: none;
  background: none;
  font-size: 20px;
  cursor: pointer;
  padding: 5px;
}

.header-right {
  display: flex;
  align-items: center;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  color: #333;
}

.content {
  padding: 20px;
}
</style>