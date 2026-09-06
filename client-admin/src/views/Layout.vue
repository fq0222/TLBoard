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

    <button
      type="button"
      class="ticket-reminder-button"
      :class="{ shaking: actionRequiredTicketCount > 0 }"
      aria-label="查看待处理工单"
      @click="goToTickets"
    >
      <el-icon :size="24"><Bell /></el-icon>
      <span v-if="actionRequiredTicketCount > 0" class="ticket-reminder-dot"></span>
    </button>
  </div>
</template>

<script setup>
/**
 * 管理端布局组件。
 * 负责左侧导航、页头面包屑和退出登录交互。
 */

import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAdminStore } from '@/stores/admin'
import api from '@/api'
import { AdminTicketReminderRefresher } from '@/utils/admin-ticket-reminder-refresher'
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
const actionRequiredTicketCount = ref(0)
let ticketReminderRefresher = null

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
 * 创建管理端工单提醒刷新器。
 * 核心分支语义：接口异常由刷新器吞掉，避免影响管理端主流程。
 */
function createTicketReminderRefresher() {
  return new AdminTicketReminderRefresher({
    fetchActionRequiredCount: () => api.admin.getTicketActionRequiredCount(),
    setActionRequiredCount: (count) => {
      actionRequiredTicketCount.value = count
    }
  })
}

async function refreshTicketReminder(options) {
  if (!ticketReminderRefresher) {
    ticketReminderRefresher = createTicketReminderRefresher()
  }

  await ticketReminderRefresher.refresh(options)
}

async function refreshTicketReminderAfterRouteChange() {
  if (!ticketReminderRefresher) {
    ticketReminderRefresher = createTicketReminderRefresher()
  }

  await ticketReminderRefresher.refreshAfterRouteChange()
}

function handleVisibilityChange() {
  if (!document.hidden) {
    refreshTicketReminder({ force: true })
  }
}

function handleTicketReadStateChanged() {
  refreshTicketReminder({ force: true })
}

/**
 * 跳转到工单管理页面。
 * 核心分支语义：当前已在工单页时只刷新提醒数量，不重复触发路由跳转。
 */
async function goToTickets() {
  if (currentRoute.path.startsWith('/admin/tickets')) {
    await refreshTicketReminder({ force: true })
    return
  }

  await router.push('/admin/tickets')
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

watch(() => currentRoute.path, () => {
  refreshTicketReminderAfterRouteChange()
})

onMounted(() => {
  refreshTicketReminderAfterRouteChange()
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('ticket-read-state-changed', handleTicketReadStateChanged)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  window.removeEventListener('ticket-read-state-changed', handleTicketReadStateChanged)
})
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
