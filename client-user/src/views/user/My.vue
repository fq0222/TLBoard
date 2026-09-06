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
          <h2 class="section-title">推广</h2>
          <p class="section-subtitle">分享专属链接，查看点击和奖励余额</p>
        </div>
        <router-link to="/user/referral" class="section-link">
          <span>查看详情</span>
          <el-icon><ArrowRight /></el-icon>
        </router-link>
      </div>

      <div class="referral-overview">
        <div class="referral-stat">
          <span class="referral-stat-label">推广链接</span>
          <div class="referral-link-row">
            <span class="referral-link-text">{{ referralSummary.referral_url || '加载中...' }}</span>
            <div class="referral-actions">
              <el-button
                class="copy-button"
                size="small"
                :disabled="!referralSummary.referral_url"
                @click="showReferralPoster"
              >
                海报
              </el-button>
              <el-button
                class="copy-button"
                size="small"
                :disabled="!referralSummary.referral_url"
                @click="copyReferralLink"
              >
                复制
              </el-button>
            </div>
          </div>
        </div>

        <div class="referral-metrics">
          <div class="metric-card">
            <span class="metric-label">点击量</span>
            <span class="metric-value">{{ referralSummary.click_count || 0 }}</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">奖励总余额</span>
            <span class="metric-value">{{ rewardAmountText }}</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">奖励订单数</span>
            <span class="metric-value">{{ referralSummary.reward_count || 0 }}</span>
          </div>
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
        <router-link to="/user/orders" class="action-item">
          <div class="action-main">
            <span class="action-title">我的订单</span>
            <span class="action-desc">查看当前账号的套餐购买、续费和支付记录</span>
          </div>
          <el-icon><ArrowRight /></el-icon>
        </router-link>

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

        <router-link to="/user/feedback" class="action-item">
          <div class="action-main">
            <span class="action-title">留言</span>
            <span class="action-desc">提交建议、参与优质留言投票和需求反馈</span>
          </div>
          <el-icon><ArrowRight /></el-icon>
        </router-link>

        <router-link v-if="subscriptionReady" to="/user/cf-optimize" class="action-item">
          <div class="action-main">
            <span class="action-title">线路优选</span>
            <span class="action-desc">测试并应用更优节点入口，改善连接体验</span>
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

    <ReferralPosterDialog
      ref="posterDialogRef"
      :referral-url="referralSummary.referral_url || ''"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowRight } from '@element-plus/icons-vue'
import api from '@/api'
import ReferralPosterDialog from '@/components/ReferralPosterDialog.vue'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()
const unreadTicketCount = ref(0)
const referralSummary = ref({})
const posterDialogRef = ref(null)

const userInfo = computed(() => userStore.userInfo || {})
const subscriptionReady = computed(() => !!userStore.userInfo?.subscription_ready)
const currentPlanText = computed(() => `当前套餐：${userInfo.value.plan_name || '未订阅'}`)
const rewardAmountText = computed(() => {
  if (referralSummary.value.reward_amount_text) {
    return referralSummary.value.reward_amount_text
  }

  return formatAmount(referralSummary.value.reward_amount)
})

function formatAmount(amount) {
  const cents = Number(amount)
  if (!Number.isFinite(cents) || cents <= 0) {
    return '0.00 元'
  }

  return `${(cents / 100).toFixed(2)} 元`
}

/**
 * 格式化流量显示，兼容空值和字符串数字。
 *
 * @param {*} bytes - 原始字节数
 * @returns {string} 格式化后的流量文本
 */
function formatTraffic(bytes) {
  if (bytes === null || bytes === undefined || bytes === '') return '0 B'

  const numericValue = Number(bytes)
  if (Number.isNaN(numericValue) || numericValue === 0) return '0 B'

  const unitBase = 1024
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unitIndex = Math.min(
    Math.floor(Math.log(numericValue) / Math.log(unitBase)),
    units.length - 1
  )

  return `${parseFloat((numericValue / (unitBase ** unitIndex)).toFixed(2))} ${units[unitIndex]}`
}

/**
 * 获取未读工单数量。
 *
 * @returns {Promise<void>}
 */
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

/**
 * 获取推广概览，用于“我的”页面的快捷预览。
 *
 * @returns {Promise<void>}
 */
async function fetchReferralSummary() {
  try {
    const response = await api.user.getReferralSummary()
    if (response.code === 0) {
      referralSummary.value = response.data || {}
    }
  } catch (error) {
    console.error('获取推广概览失败:', error)
  }
}

/**
 * 兼容 HTTP、非安全上下文和旧浏览器的复制实现。
 *
 * @param {string} text - 需要复制的文本
 * @returns {Promise<void>}
 */
async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'readonly')
  textarea.style.position = 'fixed'
  textarea.style.top = '-9999px'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  try {
    const copied = document.execCommand('copy')
    if (!copied) {
      throw new Error('execCommand copy failed')
    }
  } finally {
    document.body.removeChild(textarea)
  }
}

/**
 * 复制推广链接，便于用户直接分享。
 *
 * @returns {Promise<void>}
 */
async function copyReferralLink() {
  if (!referralSummary.value.referral_url) {
    return
  }

  try {
    await copyToClipboard(referralSummary.value.referral_url)
    ElMessage.success('推广链接已复制')
  } catch (error) {
    console.error('复制推广链接失败:', error)
    ElMessage.error('复制失败，请手动复制')
  }
}

/** 打开共享推广海报弹窗。 */
function showReferralPoster() {
  posterDialogRef.value?.open()
}

/**
 * 退出当前登录账户。
 *
 * @returns {Promise<void>}
 */
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
    fetchUnreadCount(),
    fetchReferralSummary()
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

.profile-shortcut,
.section-link {
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
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.section-title {
  margin: 0;
  font-size: 18px;
  color: #303133;
}

.section-subtitle {
  margin: 8px 0 0;
  color: #909399;
  line-height: 1.5;
}

.referral-overview {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.referral-stat {
  padding: 16px;
  border-radius: 14px;
  background: linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%);
}

.referral-stat-label {
  display: block;
  margin-bottom: 10px;
  color: #606266;
  font-size: 13px;
}

.referral-link-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.referral-link-text {
  flex: 1;
  min-width: 0;
  color: #303133;
  font-weight: 600;
  word-break: break-all;
}

.referral-actions {
  display: flex;
  flex-shrink: 0;
  gap: 10px;
}

.copy-button {
  flex-shrink: 0;
  min-width: 84px;
  height: 40px;
  padding: 0 18px;
  border: none;
  border-radius: 999px;
  color: #fff;
  font-weight: 700;
  background: linear-gradient(135deg, #2563eb 0%, #14b8a6 100%);
  box-shadow: 0 14px 30px rgba(37, 99, 235, 0.22);
}

.copy-button:hover,
.copy-button:focus-visible {
  color: #fff;
  background: linear-gradient(135deg, #1d4ed8 0%, #0f9f94 100%);
}

.copy-button.is-disabled,
.copy-button.is-disabled:hover {
  color: rgba(255, 255, 255, 0.78);
  background: linear-gradient(135deg, #94a3b8 0%, #cbd5e1 100%);
  box-shadow: none;
}

.referral-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.metric-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: 12px;
  background: #f8fafc;
}

.metric-label {
  color: #909399;
  font-size: 13px;
}

.metric-value {
  color: #303133;
  font-size: 20px;
  font-weight: 600;
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
  .my-container {
    gap: 14px;
  }

  .profile-top,
  .section-head,
  .referral-link-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .content-card {
    border-radius: 14px;
    padding: 15px;
  }

  .profile-card,
  .referral-overview {
    gap: 14px;
  }

  .profile-label {
    margin-bottom: 7px;
    font-size: 12px;
  }

  .profile-email {
    font-size: 19px;
    line-height: 1.25;
  }

  .profile-plan {
    margin-top: 7px;
  }

  .profile-shortcut,
  .section-link {
    min-height: 38px;
    padding: 8px 12px;
    border-radius: 14px;
  }

  .profile-meta,
  .management-grid,
  .referral-metrics {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .meta-item,
  .metric-card {
    gap: 6px;
    padding: 13px 14px;
    border-radius: 11px;
  }

  .meta-label,
  .metric-label,
  .referral-stat-label,
  .action-desc,
  .manage-desc,
  .section-subtitle {
    font-size: 13px;
  }

  .metric-value {
    font-size: 18px;
  }

  .section-head {
    margin-bottom: 12px;
  }

  .section-title {
    font-size: 17px;
  }

  .section-subtitle {
    margin-top: 6px;
    line-height: 1.4;
  }

  .section-link {
    width: 100%;
    justify-content: center;
  }

  .profile-shortcut {
    width: 100%;
    justify-content: center;
  }

  .referral-link-row {
    align-items: stretch;
  }

  .referral-stat {
    padding: 13px;
    border-radius: 12px;
  }

  .referral-stat-label {
    margin-bottom: 8px;
  }

  .referral-link-text {
    line-height: 1.35;
  }

  .referral-actions {
    width: 100%;
    gap: 10px;
  }

  .copy-button {
    flex: 1;
    width: 0;
    min-width: 0;
    height: 36px;
    padding: 0 14px;
    justify-content: center;
    margin-left: 0;
  }

  .action-item {
    align-items: center;
    gap: 12px;
    padding: 13px 0;
  }

  .action-main {
    gap: 5px;
  }

  .action-desc,
  .manage-desc {
    line-height: 1.4;
  }

  .action-extra {
    align-self: center;
  }

  .management-grid {
    gap: 10px;
  }

  .manage-tile {
    gap: 6px;
    padding: 14px;
    border-radius: 12px;
  }

  .manage-title {
    font-size: 15px;
  }
}
</style>
