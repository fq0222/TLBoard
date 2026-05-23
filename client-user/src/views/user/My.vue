<template>
  <div class="my-container">
    <section class="content-card profile-card">
      <div class="profile-top">
        <div class="profile-main">
          <p class="profile-label">账户信息</p>
          <div class="profile-email">{{ userInfo.email || '-' }}</div>
          <div class="profile-plan">{{ currentPlanText }}</div>
        </div>
        <router-link to="/user" class="profile-shortcut">
          <span>前往服务台</span>
          <el-icon><ArrowRight /></el-icon>
        </router-link>
      </div>

      <div class="profile-meta">
        <div class="meta-item">
          <span class="meta-label">到期时间</span>
          <span class="meta-value">{{ userInfo.expire_text || '未订阅' }}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">流量使用</span>
          <span class="meta-value">{{ userInfo.traffic_used_text || '0 B' }}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">订阅状态</span>
          <span class="meta-value">{{ subscriptionReady ? '已生成' : '未生成' }}</span>
        </div>
      </div>
    </section>

    <section class="content-card">
      <div class="section-head">
        <div>
          <h2 class="section-title">我的服务</h2>
        </div>
      </div>

      <div class="action-list">
        <router-link to="/user/tickets" class="action-item">
          <div class="action-main">
            <span class="action-title">工单支持</span>
            <span class="action-desc">提交问题、查看回复和跟进处理进度</span>
          </div>
          <div class="action-extra">
            <span v-if="unreadTicketCount > 0" class="action-badge">{{ unreadTicketCount }} 条未读</span>
            <el-icon><ArrowRight /></el-icon>
          </div>
        </router-link>

        <router-link to="/user/help" class="action-item">
          <div class="action-main">
            <span class="action-title">帮助中心</span>
            <span class="action-desc">查看使用文档、常见问题和接入说明</span>
          </div>
          <el-icon><ArrowRight /></el-icon>
        </router-link>

        <router-link v-if="subscriptionReady" to="/user/subscription" class="action-item">
          <div class="action-main">
            <span class="action-title">订阅信息</span>
            <span class="action-desc">复制通用订阅与 Clash 订阅链接</span>
          </div>
          <el-icon><ArrowRight /></el-icon>
        </router-link>

        <router-link v-if="subscriptionReady" to="/user/cf-optimize" class="action-item">
          <div class="action-main">
            <span class="action-title">CF IP 优选</span>
            <span class="action-desc">测试并应用更优节点入口，改善连接体验</span>
          </div>
          <el-icon><ArrowRight /></el-icon>
        </router-link>

        <router-link to="/user" class="action-item">
          <div class="action-main">
            <span class="action-title">套餐与续费</span>
            <span class="action-desc">返回服务台查看套餐、续费或处理订阅生成</span>
          </div>
          <el-icon><ArrowRight /></el-icon>
        </router-link>
      </div>
    </section>

    <section class="content-card">
      <div class="section-head">
        <div>
          <h2 class="section-title">常用管理</h2>
        </div>
      </div>

      <div class="management-grid">
        <router-link to="/user" class="manage-tile">
          <span class="manage-title">返回首页</span>
          <span class="manage-desc">回到会员工作台</span>
        </router-link>

        <button type="button" class="manage-tile danger-tile" @click="handleLogout">
          <span class="manage-title">退出登录</span>
          <span class="manage-desc">安全退出当前账户</span>
        </button>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { ArrowRight } from '@element-plus/icons-vue'
import api from '@/api'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()
const unreadTicketCount = ref(0)

const userInfo = computed(() => userStore.userInfo || {})
const subscriptionReady = computed(() => !!userStore.userInfo?.subscription_ready)
const currentPlanText = computed(() => `当前套餐：${userInfo.value.plan_name || '未订阅'}`)

async function fetchUnreadCount() {
  try {
    const response = await api.user.getTicketUnreadCount()
    if (response.code === 0) {
      unreadTicketCount.value = response.data.count || 0
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

onMounted(async () => {
  if (!userStore.isLoggedIn) {
    return
  }

  await Promise.allSettled([
    userStore.fetchUserProfile(),
    fetchUnreadCount()
  ])
})
</script>

<style scoped>
.my-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.content-card {
  background: #fff;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
}

.profile-card {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.profile-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.profile-main {
  min-width: 0;
}

.profile-label {
  margin: 0 0 10px;
  font-size: 13px;
  color: #909399;
}

.profile-email {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
  word-break: break-all;
}

.profile-plan {
  margin-top: 10px;
  color: #606266;
}

.profile-shortcut {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  border-radius: 999px;
  color: #409eff;
  text-decoration: none;
  background: #ecf5ff;
  white-space: nowrap;
}

.profile-meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.meta-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border-radius: 12px;
  background: #f8fafc;
}

.meta-label {
  font-size: 13px;
  color: #909399;
}

.meta-value {
  color: #303133;
  font-weight: 500;
}

.section-head {
  margin-bottom: 16px;
}

.section-title {
  margin: 0;
  font-size: 18px;
  color: #303133;
}

.action-list {
  display: flex;
  flex-direction: column;
}

.action-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 0;
  color: #303133;
  text-decoration: none;
  border-bottom: 1px solid #f0f2f5;
}

.action-item:last-child {
  padding-bottom: 0;
  border-bottom: none;
}

.action-item:first-child {
  padding-top: 0;
}

.action-main {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.action-title {
  font-weight: 600;
}

.action-desc {
  color: #909399;
  line-height: 1.5;
}

.action-extra {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.action-badge {
  padding: 4px 10px;
  border-radius: 999px;
  background: #fff1f0;
  color: #f56c6c;
  font-size: 12px;
}

.management-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.manage-tile {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 18px;
  border: 1px solid #ebeef5;
  border-radius: 14px;
  background: #fff;
  color: #303133;
  text-decoration: none;
  text-align: left;
  cursor: pointer;
}

.danger-tile {
  color: #f56c6c;
  border-color: #fbc4c4;
}

.manage-title {
  font-size: 16px;
  font-weight: 600;
}

.manage-desc {
  color: #909399;
  line-height: 1.5;
}

@media (max-width: 1024px) {
  .management-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .profile-top {
    flex-direction: column;
    align-items: flex-start;
  }

  .content-card {
    border-radius: 14px;
    padding: 16px;
  }

  .profile-meta,
  .management-grid {
    grid-template-columns: 1fr;
  }

  .action-item {
    align-items: flex-start;
  }

  .action-extra {
    align-self: center;
  }
}
</style>
