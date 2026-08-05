<template>
  <div class="admin-layout">
    <aside class="sidebar" :class="{ collapsed: isCollapsed }">
      <div class="sidebar-header">
        <h1 v-if="!isCollapsed" class="sidebar-title">管理端</h1>
        <h1 v-else class="sidebar-title collapsed-title">管</h1>
      </div>

      <nav class="sidebar-nav">
        <router-link to="/admin" class="nav-item" exact-active-class="active">
          <el-icon><DataBoard /></el-icon>
          <span v-if="!isCollapsed">仪表盘</span>
        </router-link>
        <router-link to="/admin/traffic-stats" class="nav-item" active-class="active">
          <el-icon><DataAnalysis /></el-icon>
          <span v-if="!isCollapsed">数据统计</span>
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
          <span v-if="!isCollapsed">CF IP 池</span>
        </router-link>
        <router-link to="/admin/tickets" class="nav-item" active-class="active">
          <el-icon><ChatDotRound /></el-icon>
          <span v-if="!isCollapsed">工单管理</span>
        </router-link>
        <router-link to="/admin/feedback" class="nav-item" active-class="active">
          <el-icon><ChatLineRound /></el-icon>
          <span v-if="!isCollapsed">留言板管理</span>
        </router-link>
        <router-link to="/admin/email" class="nav-item" active-class="active">
          <el-icon><Message /></el-icon>
          <span v-if="!isCollapsed">邮件管理</span>
        </router-link>
        <router-link to="/admin/resources" class="nav-item" active-class="active">
          <el-icon><Folder /></el-icon>
          <span v-if="!isCollapsed">资源管理</span>
        </router-link>
        <router-link to="/admin/blogs" class="nav-item" active-class="active">
          <el-icon><Reading /></el-icon>
          <span v-if="!isCollapsed">博客管理</span>
        </router-link>
        <router-link to="/admin/referrals" class="nav-item" active-class="active">
          <el-icon><Share /></el-icon>
          <span v-if="!isCollapsed">推广管理</span>
        </router-link>
        <router-link to="/admin/settings" class="nav-item" active-class="active">
          <el-icon><Setting /></el-icon>
          <span v-if="!isCollapsed">系统设置</span>
        </router-link>
      </nav>

      <div class="sidebar-footer">
        <el-button type="danger" plain :icon="SwitchButton" @click="handleLogout">
          <span v-if="!isCollapsed">退出登录</span>
        </el-button>
      </div>
    </aside>

    <main class="main-content">
      <header class="header">
        <div class="header-left">
          <el-button
            class="collapse-btn"
            :icon="isCollapsed ? Expand : Fold"
            @click="toggleCollapse"
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

      <div class="content">
        <router-view />
      </div>
    </main>
  </div>
</template>

<script setup>
/**
 * 管理端布局组件。
 * 负责左侧导航、页头面包屑和退出登录交互。
 */

import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAdminStore } from '@/stores/admin'
import {
  ArrowDown,
  Bell,
  ChatDotRound,
  ChatLineRound,
  Connection,
  DataAnalysis,
  DataBoard,
  Document,
  Expand,
  Fold,
  Folder,
  Goods,
  Message,
  Monitor,
  Reading,
  Setting,
  Share,
  SwitchButton,
  User
} from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus/es/components/message-box/index.mjs'

const router = useRouter()
const currentRoute = useRoute()
const adminStore = useAdminStore()
const isCollapsed = ref(false)

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value
}

function handleCommand(command) {
  if (command === 'settings') {
    router.push('/admin/settings')
    return
  }

  if (command === 'logout') {
    handleLogout()
  }
}

/**
 * 退出登录前二次确认，避免误触中断后台操作。
 */
async function handleLogout() {
  try {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })

    adminStore.logout()
    router.push('/admin/login')
  } catch {
    // 用户取消时不执行额外操作。
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
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 100;
  display: flex;
  width: 240px;
  flex-direction: column;
  background: #304156;
  box-shadow: 2px 0 8px rgba(0, 0, 0, 0.1);
  transition: width 0.3s;
}

.sidebar.collapsed {
  width: 64px;
}

.sidebar-header {
  padding: 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.sidebar-title {
  overflow: hidden;
  color: #fff;
  text-align: center;
  white-space: nowrap;
  font-size: 20px;
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
  position: sticky;
  top: 0;
  z-index: 99;
  display: flex;
  height: 60px;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 15px;
}

.collapse-btn {
  border: none;
  background: none;
  cursor: pointer;
  padding: 5px;
  font-size: 20px;
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
