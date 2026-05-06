<template>
  <div class="home-container">
    <!-- 顶部导航 -->
    <header class="header">
      <div class="header-content">
        <h1 class="logo">天澜大陆</h1>
        <nav class="nav">
          <router-link to="/" class="nav-item">首页</router-link>
          <router-link v-if="!isLoggedIn" to="/login" class="nav-item">登录</router-link>
          <router-link v-else to="/user" class="nav-item">个人中心</router-link>
        </nav>
      </div>
    </header>

    <!-- 主要内容 -->
    <main class="main">
      <!-- 套餐展示区域 -->
      <section class="plans-section">
        <h2 class="section-title">选择套餐</h2>
        <div class="plans-grid">
          <div 
            v-for="plan in plans" 
            :key="plan.id" 
            class="plan-card"
          >
            <div class="plan-header">
              <h3 class="plan-name">{{ plan.name }}</h3>
              <div class="plan-price">
                <span class="price-symbol">¥</span>
                <span class="price-value">{{ plan.price_text }}</span>
              </div>
            </div>
            <div class="plan-body">
              <p class="plan-description">{{ plan.description }}</p>
              <div class="plan-features">
                <div class="feature">
                  <el-icon><Check /></el-icon>
                  <span>{{ plan.traffic_text }} 流量</span>
                </div>
                <div class="feature">
                  <el-icon><Check /></el-icon>
                  <span>{{ plan.duration_days === 0 ? '无限期' : plan.duration_days + ' 天有效期' }}</span>
                </div>
              </div>
              <div v-if="plan.is_soldout" class="sold-out-tag">已售罄</div>
            </div>
            <div class="plan-footer">
              <el-button 
                type="primary" 
                size="large" 
                class="buy-btn" 
                :disabled="plan.is_soldout"
                @click="selectPlan(plan)"
              >
                {{ plan.is_soldout ? '已售罄' : '立即购买' }}
              </el-button>
            </div>
          </div>
        </div>
      </section>

      <!-- 公告区域 -->
      <section class="announcements-section">
        <h2 class="section-title">系统公告</h2>
        <div class="announcements-list">
          <div 
            v-for="announcement in announcements" 
            :key="announcement.id" 
            class="announcement-item"
          >
            <div class="announcement-header">
              <el-tag v-if="announcement.pinned" type="danger" size="small">置顶</el-tag>
              <h3 class="announcement-title">{{ announcement.title }}</h3>
              <span class="announcement-time">{{ formatTime(announcement.created_at) }}</span>
            </div>
            <div class="announcement-content" v-html="announcement.content"></div>
          </div>
          <div v-if="announcements.length === 0" class="empty-tip">
            暂无公告
          </div>
        </div>
      </section>
    </main>

    <!-- 底部 -->
    <footer class="footer">
      <p>© 2026 天澜大陆. All rights reserved.</p>
    </footer>
  </div>
</template>

<script setup>
/**
 * 首页组件
 * 展示套餐列表和系统公告
 */

import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { Check } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import api from '@/api'

const router = useRouter()
const userStore = useUserStore()

// 响应式数据
const plans = ref([])
const announcements = ref([])
const loading = ref(false)

// 计算属性
const isLoggedIn = ref(userStore.isLoggedIn)

/**
 * 获取套餐列表
 */
async function fetchPlans() {
  try {
    loading.value = true
    const response = await api.user.getPlans()
    if (response.code === 0) {
      plans.value = response.data.plans
    }
  } catch (error) {
    console.error('获取套餐列表失败:', error)
  } finally {
    loading.value = false
  }
}

/**
 * 获取公告列表
 */
async function fetchAnnouncements() {
  try {
    const response = await api.user.getAnnouncements({ page: 1, limit: 10 })
    if (response.code === 0) {
      announcements.value = response.data.list
    }
  } catch (error) {
    console.error('获取公告列表失败:', error)
  }
}

/**
 * 选择套餐
 * @param {Object} plan - 套餐信息
 */
function selectPlan(plan) {
  if (plan.is_soldout) {
    ElMessage.warning('该套餐已售罄')
    return
  }
  
  if (isLoggedIn.value) {
    router.push({ name: 'UserProfile' })
  } else {
    router.push({ 
      name: 'Login', 
      query: { 
        plan_id: plan.id,
        plan_name: plan.name,
        plan_price: plan.price_text,
        plan_traffic: plan.traffic_text,
        plan_duration: plan.duration_days
      } 
    })
  }
}

/**
 * 格式化时间
 * @param {number} timestamp - 时间戳
 * @returns {string} 格式化后的时间
 */
function formatTime(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp * 1000)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
}

// 组件挂载时获取数据
onMounted(() => {
  fetchPlans()
  fetchAnnouncements()
})
</script>

<style scoped>
.home-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.header {
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  position: sticky;
  top: 0;
  z-index: 100;
}

.header-content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 20px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.logo {
  font-size: 24px;
  color: #409eff;
  font-weight: bold;
}

.nav {
  display: flex;
  gap: 20px;
}

.nav-item {
  text-decoration: none;
  color: #333;
  font-size: 16px;
  padding: 8px 16px;
  border-radius: 4px;
  transition: all 0.3s;
}

.nav-item:hover,
.nav-item.router-link-active {
  color: #409eff;
  background: #ecf5ff;
}

.main {
  flex: 1;
  max-width: 1200px;
  margin: 0 auto;
  padding: 40px 20px;
  width: 100%;
}

.section-title {
  font-size: 28px;
  text-align: center;
  margin-bottom: 40px;
  color: #333;
}

.plans-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 30px;
  margin-bottom: 60px;
}

.plan-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  transition: all 0.3s;
}

.plan-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
}

.plan-header {
  padding: 30px 20px 20px;
  text-align: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
}

.plan-name {
  font-size: 24px;
  margin-bottom: 15px;
}

.plan-price {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 5px;
}

.price-symbol {
  font-size: 20px;
}

.price-value {
  font-size: 48px;
  font-weight: bold;
}

.price-unit {
  font-size: 16px;
  opacity: 0.8;
}

.plan-body {
  padding: 30px 20px;
}

.plan-description {
  color: #666;
  margin-bottom: 20px;
  text-align: center;
}

.plan-features {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.feature {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #67c23a;
}

.plan-footer {
  padding: 0 20px 30px;
}

.buy-btn {
  width: 100%;
  height: 50px;
  font-size: 18px;
}

.sold-out-tag {
  display: inline-block;
  background: #f56c6c;
  color: #fff;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  margin-top: 8px;
}

.announcements-section {
  margin-top: 40px;
}

.announcements-list {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.announcement-item {
  padding: 20px;
  border-bottom: 1px solid #eee;
}

.announcement-item:last-child {
  border-bottom: none;
}

.announcement-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.announcement-title {
  flex: 1;
  font-size: 18px;
  color: #333;
}

.announcement-time {
  color: #999;
  font-size: 14px;
}

.announcement-content {
  color: #666;
  line-height: 1.6;
}

.empty-tip {
  text-align: center;
  padding: 40px;
  color: #999;
}

.footer {
  background: #333;
  color: #fff;
  text-align: center;
  padding: 20px;
  margin-top: auto;
}
</style>