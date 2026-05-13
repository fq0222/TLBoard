<template>
  <div class="profile-container">
    <div class="page-header">
      <h1 class="page-title">个人中心</h1>
      <p class="page-subtitle">查看和管理您的账户信息</p>
    </div>
    
    <div class="content-card">
      <div class="user-info">
        <div class="info-item">
          <span class="info-label">邮箱：</span>
          <span class="info-value">{{ userInfo.email }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">当前套餐：</span>
          <span class="info-value">{{ userInfo.plan_name || '未订阅' }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">到期时间：</span>
          <span class="info-value">{{ userInfo.expire_text || '未订阅' }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">账号状态：</span>
          <el-tag :type="userInfo.enabled ? 'success' : 'danger'">
            {{ userInfo.enabled ? '正常' : '禁用' }}
          </el-tag>
        </div>
      </div>
    </div>
    
    <div class="content-card">
      <h2 class="card-title">流量使用情况</h2>
      <div class="traffic-info">
        <div class="traffic-text">
          <span>已用：{{ userInfo.traffic_used_text || '0 B' }}</span>
          <span>总量：{{ userInfo.traffic_limit_text || '0 B' }}</span>
        </div>
        <el-progress 
          :percentage="userInfo.traffic_percent || 0" 
          :stroke-width="20"
          :text-inside="true"
        />
      </div>
    </div>
    
    <div class="content-card">
      <h2 class="card-title">套餐续费</h2>
      <div class="renew-section">
        <div class="renew-info">
          <el-icon class="renew-icon"><InfoFilled /></el-icon>
          <span class="renew-text">续费将在现有套餐基础上累加流量，使用期限保持无限期。流量用完后 3 天内可续费当前套餐，超过 3 天需等待名额释放后重新购买。</span>
        </div>
        <el-button 
          type="primary" 
          size="large" 
          @click="showRenewDialog = true"
          :disabled="!userInfo.plan_id"
        >
          <el-icon><Refresh /></el-icon>
          续费套餐
        </el-button>
      </div>
    </div>
    
    <!-- 续费弹窗 -->
    <RenewDialog 
      v-model:visible="showRenewDialog"
      :current-plan-id="userInfo.plan_id"
      @renew="handleRenew"
    />

    <!-- 帮助弹窗 -->
    <el-dialog v-model="showHelpDialog" title="使用帮助" width="400px">
      <div class="help-content">
        <el-alert
          title="每天只可以收到 1 封教程邮件"
          type="info"
          :closable="false"
          show-icon
          style="margin-bottom: 20px;"
        />
        <p class="help-tip">点击获得按钮后，请到注册用的邮箱内查看教程。</p>
        <div class="help-items">
          <div class="help-item">
            <span class="help-label">Android-App教程</span>
            <el-button 
              type="primary" 
              size="small" 
              @click="requestTutorial('android')"
              :loading="tutorialLoading.android"
            >
              获得
            </el-button>
          </div>
          <div class="help-item">
            <span class="help-label">Windows教程</span>
            <el-button 
              type="primary" 
              size="small" 
              @click="requestTutorial('windows')"
              :loading="tutorialLoading.windows"
            >
              获得
            </el-button>
          </div>
        </div>
      </div>
    </el-dialog>

    <div class="content-card">
      <div class="card-header">
        <h2 class="card-title">订阅链接</h2>
      </div>
      
      <!-- 首次使用步骤提示 -->
      <div v-if="!userInfo.subscription_url" class="steps-guide">
        <div class="steps-title">快速开始</div>
        <div class="steps-container">
          <div class="step-item" :class="{ 'step-active': !cfOptimized }">
            <div class="step-number">1</div>
            <div class="step-content">
              <div class="step-name">优选 IP</div>
              <div class="step-desc">自动测试并选择最快的节点</div>
            </div>
          </div>
          <div class="step-arrow">
            <el-icon><ArrowRight /></el-icon>
          </div>
          <div class="step-item" :class="{ 'step-active': cfOptimized }">
            <div class="step-number">2</div>
            <div class="step-content">
              <div class="step-name">生成链接</div>
              <div class="step-desc">获取订阅链接导入客户端</div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 新手教程引导 -->
      <div class="tutorial-guide">
        <div class="tutorial-icon">
          <el-icon :size="24"><QuestionFilled /></el-icon>
        </div>
        <div class="tutorial-content">
          <div class="tutorial-title">首次使用？获取客户端配置教程</div>
          <div class="tutorial-desc">我们提供 Android 和 Windows 客户端的详细图文教程，帮助您快速完成配置</div>
        </div>
        <el-button type="primary" @click="showHelpDialog = true">
          获取教程
        </el-button>
      </div>
      
      <!-- 未优选或优选完成：显示引导说明和按钮 -->
      <div v-if="!optimizing" class="optimize-guide">
        <div class="button-group">
          <el-button 
            type="primary" 
            size="large" 
            @click="startOptimize"
            :loading="optimizing"
          >
            <el-icon><MagicStick /></el-icon>
            {{ cfOptimized ? '重新优选 IP' : '一键优选 IP' }}
          </el-button>
          <el-button 
            type="success" 
            size="large" 
            @click="generateSubscription"
            :disabled="!cfOptimized || generatingSubscription"
            :loading="generatingSubscription"
          >
            <el-icon><Link /></el-icon>
            {{ generatingSubscription ? '正在生成...' : '生成订阅链接' }}
          </el-button>
        </div>
      </div>

      <!-- 优选中：显示进度提示 -->
      <div v-if="optimizing" class="optimizing-progress">
        <el-alert
          title="正在优选 IP，请稍候..."
          description="正在测试各个 Cloudflare 节点的延迟，这可能需要 30-60 秒"
          type="warning"
          :closable="false"
          show-icon
          style="margin-bottom: 20px;"
        />
        <div class="progress-detail">
          <el-progress 
            :percentage="optimizeProgress" 
            :stroke-width="20"
            :text-inside="true"
            :status="optimizeProgress === 100 ? 'success' : ''"
          />
          <p class="progress-text">{{ optimizeStatusText }}</p>
        </div>
      </div>

      <!-- 已生成：显示订阅链接 -->
      <div v-if="userInfo.subscription_url" class="subscription-links">
        <div class="link-group">
          <span class="link-label">通用订阅：</span>
          <el-input 
            v-model="userInfo.subscription_url" 
            readonly
            size="large"
          >
            <template #append>
              <el-button @click="copyLink(userInfo.subscription_url)">
                <el-icon><CopyDocument /></el-icon>
                复制
              </el-button>
            </template>
          </el-input>
          <p class="link-tip">适用于 v2rayN、V2rayNG、Shadowrocket、Quantumult X 等</p>
        </div>
        <div class="link-group">
          <span class="link-label">Clash订阅：</span>
          <el-input 
            v-model="userInfo.clash_url" 
            readonly
            size="large"
          >
            <template #append>
              <el-button @click="copyLink(userInfo.clash_url)">
                <el-icon><CopyDocument /></el-icon>
                复制
              </el-button>
            </template>
          </el-input>
          <p class="link-tip">适用于 Clash、Clash Verge、ClashX、Clash for Windows 等</p>
        </div>
        <div class="regenerate-tip">
          <el-icon><InfoFilled /></el-icon>
          <span>如果您的订阅链接无效，请点击上方「生成订阅链接」按钮重新生成</span>
        </div>
      </div>
    </div>
    
    <div class="content-card">
      <h2 class="card-title">最近订单</h2>
      <el-table :data="orders" style="width: 100%">
        <el-table-column prop="out_trade_no" label="订单号" />
        <el-table-column prop="plan_name" label="套餐" />
        <el-table-column prop="amount_text" label="金额">
          <template #default="scope">
            ¥{{ scope.row.amount_text }}
          </template>
        </el-table-column>
        <el-table-column prop="status_text" label="状态">
          <template #default="scope">
            <el-tag :type="getStatusType(scope.row.status)">
              {{ scope.row.status_text }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="时间">
          <template #default="scope">
            {{ formatTime(scope.row.created_at) }}
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
/**
 * 个人中心组件
 * 展示用户信息、流量使用、订阅链接和订单记录
 */

import { ref, onMounted } from 'vue'
import { useUserStore } from '@/stores/user'
import { CopyDocument, MagicStick, Link, Refresh, InfoFilled, QuestionFilled, ArrowRight } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import RenewDialog from '@/components/RenewDialog.vue'
import api from '@/api'

const userStore = useUserStore()
const router = useRouter()

// 响应式数据
const userInfo = ref({})
const orders = ref([])
const loading = ref(false)
const cfOptimized = ref(false)
const optimizing = ref(false)
const optimizeProgress = ref(0)
const optimizeStatusText = ref('')
const subscriptionGenerated = ref(false)
const generatingSubscription = ref(false)
const showRenewDialog = ref(false)
const showHelpDialog = ref(false)
const tutorialLoading = ref({
  android: false,
  windows: false
})
const TEST_COUNT = 3
const TEST_TIMEOUT = 5000
const TEST_INTERVAL = 200

/**
 * 获取用户信息
 */
async function fetchUserInfo() {
  try {
    loading.value = true
    const result = await userStore.fetchUserProfile()
    if (result.success) {
      userInfo.value = result.data
      cfOptimized.value = result.data.cf_optimized || false
    }
  } catch (error) {
    console.error('获取用户信息失败:', error)
  } finally {
    loading.value = false
  }
}

/**
 * 获取订单列表
 */
async function fetchOrders() {
  try {
    const response = await api.user.getOrders({ page: 1, limit: 10 })
    if (response.code === 0) {
      // 不显示过期订单
      orders.value = response.data.list.filter(order => order.status !== 'expired')
    }
  } catch (error) {
    console.error('获取订单列表失败:', error)
  }
}

/**
 * 复制订阅链接
 * @param {string} link - 要复制的链接
 */
function copyLink(link) {
  if (link) {
    navigator.clipboard.writeText(link)
    ElMessage.success('链接已复制到剪贴板')
  }
}

/**
 * 生成订阅链接
 */
async function generateSubscription() {
  if (!cfOptimized.value) {
    ElMessage.warning('请先完成 IP 优选')
    return
  }
  
  try {
    generatingSubscription.value = true
    const response = await api.user.generateSubscription()
    if (response.code === 0) {
      // 更新订阅链接
      userInfo.value.subscription_url = response.data.subscription_url
      userInfo.value.clash_url = response.data.clash_url
      subscriptionGenerated.value = true
      ElMessage.success('订阅链接已生成')
    } else {
      ElMessage.error(response.message || '生成订阅链接失败')
    }
  } catch (error) {
    console.error('生成订阅链接失败:', error)
    ElMessage.error('生成订阅链接失败')
  } finally {
    generatingSubscription.value = false
  }
}

/**
 * 请求教程邮件
 * @param {string} type - 教程类型：android 或 windows
 */
async function requestTutorial(type) {
  tutorialLoading.value[type] = true
  try {
    const response = await api.user.requestTutorial(type)
    if (response.code === 0) {
      ElMessage.success('教程邮件已发送，请到邮箱查看')
      showHelpDialog.value = false
    } else {
      ElMessage.error(response.message)
    }
  } catch (error) {
    console.error('请求教程失败:', error)
    ElMessage.error('请求教程失败')
  } finally {
    tutorialLoading.value[type] = false
  }
}

/**
 * 开始一键优选
 */
async function startOptimize() {
  try {
    optimizing.value = true
    optimizeProgress.value = 0
    optimizeStatusText.value = '正在获取 IP 列表...'

    // 1. 获取 IP 池（返回的是 {id, ip} 对象数组）
    const response = await api.user.getCfIps()
    if (response.code !== 0) {
      throw new Error('获取 IP 列表失败')
    }

    const ipPool = response.data.ips
    if (!ipPool || ipPool.length === 0) {
      throw new Error('IP 池为空，请联系管理员')
    }

    const totalIps = ipPool.length
    let completedIps = 0

    // 2. 为每个 IP 初始化测试状态
    const ipTestData = ipPool.map(item => ({
      id: item.id,
      ip: item.ip,
      latency: -1,
      successTimes: 0,
      testedTimes: 0,
      testResults: []
    }))

    // 3. 并行测试所有 IP，每个完成后更新进度
    await Promise.all(ipTestData.map(async (ipData) => {
      await testSingleIp(ipData)
      completedIps++
      // 进度从 10% 到 80%
      optimizeProgress.value = 10 + Math.round((completedIps / totalIps) * 70)
      optimizeStatusText.value = `正在测试第 ${completedIps}/${totalIps} 个 IP...`
    }))

    // 4. 计算平均延迟和丢包率
    ipTestData.forEach(ipData => {
      if (ipData.testResults.length > 0) {
        const sum = ipData.testResults.reduce((a, b) => a + b, 0)
        ipData.avgLatency = Math.round(sum / ipData.testResults.length)
        ipData.packetLoss = Math.round((1 - ipData.successTimes / ipData.testedTimes) * 100)
      } else {
        ipData.avgLatency = -1
        ipData.packetLoss = 100
      }
    })

    optimizeProgress.value = 85
    optimizeStatusText.value = '正在筛选最优 IP...'

    // 5. 筛选可用 IP（延迟 > 0，按延迟排序）
    const availableIps = ipTestData
      .filter(item => item.latency > 0)
      .sort((a, b) => a.latency - b.latency)

    if (availableIps.length === 0) {
      throw new Error('所有 IP 测试超时，请检查网络后重试')
    }

    // 6. 选择前 5 个（优先包含 1 个 IPv6）
    const ipv4List = availableIps.filter(item => !item.ip.includes(':'))
    const ipv6List = availableIps.filter(item => item.ip.includes(':'))

    const selectedIps = []
    if (ipv6List.length > 0) {
      selectedIps.push(ipv6List[0])
    }
    for (const ip of ipv4List) {
      if (selectedIps.length >= 5) break
      if (!selectedIps.find(s => s.id === ip.id)) {
        selectedIps.push(ip)
      }
    }
    for (const ip of ipv6List) {
      if (selectedIps.length >= 5) break
      if (!selectedIps.find(s => s.id === ip.id)) {
        selectedIps.push(ip)
      }
    }

    // 7. 调用 apply 接口（传 ID）
    optimizeProgress.value = 95
    optimizeStatusText.value = '正在保存优选结果...'

    const ipIds = selectedIps.map(item => item.id)
    const applyResponse = await api.user.applyCfIps(ipIds)

    if (applyResponse.code === 0) {
      optimizeProgress.value = 100
      optimizeStatusText.value = '优选完成！'
      cfOptimized.value = true
      await fetchUserInfo()
      ElMessage.success(`已成功优选 ${selectedIps.length} 个 IP`)
    } else {
      throw new Error(applyResponse.message || '保存优选结果失败')
    }
  } catch (error) {
    console.error('一键优选失败:', error)
    ElMessage.error(error.message || '优选失败，请重试')
    optimizeProgress.value = 0
    optimizeStatusText.value = ''
  } finally {
    setTimeout(() => {
      optimizing.value = false
    }, 1500)
  }
}

/**
 * 测试单个 IP（复用 CfOptimize.vue 的逻辑）
 */
async function testSingleIp(ipData) {
  for (let i = 0; i < TEST_COUNT; i++) {
    try {
      const latency = await pingIp(ipData.ip)
      ipData.testedTimes++

      if (latency > 0) {
        ipData.successTimes++
        ipData.testResults.push(latency)
        ipData.latency = latency
      }

      if (i < TEST_COUNT - 1) {
        await new Promise(resolve => setTimeout(resolve, TEST_INTERVAL))
      }
    } catch (error) {
      ipData.testedTimes++
    }
  }
}

/**
 * 测试单个 IP 的延迟（复用 CfOptimize.vue 的逻辑）
 * @param {string} ip - IP 地址
 * @returns {Promise<number>} 延迟（毫秒），失败返回 -1
 */
function pingIp(ip) {
  return new Promise((resolve) => {
    const startTime = window.performance.now()
    // IPv6 地址需要加方括号
    const host = ip.includes(':') ? `[${ip}]` : ip
    const url = `https://${host}:443/cdn-cgi/trace`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      controller.abort()
      resolve(-1)
    }, TEST_TIMEOUT)

    fetch(url, {
      mode: 'no-cors',
      signal: controller.signal,
      cache: 'no-store'
    }).then(() => {
      clearTimeout(timeoutId)
      const endTime = window.performance.now()
      resolve(Math.round(endTime - startTime))
    }).catch(() => {
      clearTimeout(timeoutId)
      const endTime = window.performance.now()
      const elapsed = endTime - startTime
      resolve(elapsed < 50 ? -1 : Math.round(elapsed))
    })
  })
}

/**
 * 获取状态类型
 * @param {string} status - 状态值
 * @returns {string} 状态类型
 */
function getStatusType(status) {
  const typeMap = {
    'pending': 'warning',
    'paid': 'success',
    'expired': 'info'
  }
  return typeMap[status] || 'info'
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
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * 处理续费
 * @param {Object} params - 续费参数
 * @param {number} params.planId - 套餐ID
 * @param {number} params.payType - 支付方式（1=微信，2=支付宝）
 */
async function handleRenew({ planId, payType }) {
  try {
    showRenewDialog.value = false
    
    const response = await api.user.renew({ plan_id: planId, pay_type: payType })
    
    if (response.code === 0) {
      // 跳转到支付等待页
      router.push({
        path: '/payment/callback',
        query: {
          order_id: response.data.order_id,
          out_trade_no: response.data.out_trade_no,
          payment_url: response.data.payment_url,
          expire_in: response.data.expire_in
        }
      })
    } else {
      ElMessage.error(response.message || '续费失败')
    }
  } catch (error) {
    console.error('续费失败:', error)
    ElMessage.error('续费失败，请重试')
  }
}

// 组件挂载时获取数据
onMounted(() => {
  fetchUserInfo()
  fetchOrders()
})
</script>

<style scoped>
.profile-container {
  max-width: 800px;
}

.page-header {
  margin-bottom: 30px;
}

.page-title {
  font-size: 28px;
  color: #333;
  margin-bottom: 10px;
}

.page-subtitle {
  color: #666;
  font-size: 16px;
}

.content-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 30px;
  margin-bottom: 20px;
}

.card-title {
  font-size: 20px;
  color: #333;
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 1px solid #eee;
}

.user-info {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}

.info-item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.info-label {
  color: #666;
  font-weight: 500;
}

.info-value {
  color: #333;
}

.traffic-info {
  margin-top: 10px;
}

.traffic-text {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
  color: #666;
}

.renew-section {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 0;
}

.renew-info {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #909399;
  font-size: 14px;
}

.renew-icon {
  color: #909399;
  font-size: 16px;
}

.renew-text {
  flex: 1;
}

.subscription-links {
  margin-top: 10px;
}

.link-group {
  margin-bottom: 20px;
}

.link-label {
  display: block;
  margin-bottom: 8px;
  color: #333;
  font-weight: 500;
}

.link-tip {
  margin-top: 8px;
  color: #999;
  font-size: 13px;
}

.regenerate-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 16px;
  padding: 12px 16px;
  background: #fdf6ec;
  border-radius: 8px;
  color: #e6a23c;
  font-size: 13px;
}

.optimize-guide {
  text-align: center;
  padding: 20px 0;
}

.button-group {
  display: flex;
  gap: 16px;
  justify-content: center;
}

.optimizing-progress {
  padding: 20px 0;
}

.progress-detail {
  margin-top: 20px;
}

.progress-text {
  margin-top: 10px;
  color: #666;
  font-size: 14px;
  text-align: center;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 1px solid #eee;
}

.card-header .card-title {
  margin: 0;
  padding: 0;
  border: none;
}

.tutorial-guide {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12px;
  margin-bottom: 24px;
  color: #fff;
}

.tutorial-icon {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 50%;
}

.tutorial-content {
  flex: 1;
}

.tutorial-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 4px;
}

.tutorial-desc {
  font-size: 13px;
  opacity: 0.9;
}

.tutorial-guide .el-button {
  flex-shrink: 0;
  background: #fff;
  color: #667eea;
  border: none;
  font-weight: 600;
}

.tutorial-guide .el-button:hover {
  background: #f0f0f0;
}

.steps-guide {
  margin: 20px 0;
  padding: 20px;
  background: #f8f9fb;
  border-radius: 12px;
  border: 1px solid #e8eaed;
}

.steps-title {
  font-size: 14px;
  font-weight: 600;
  color: #333;
  margin-bottom: 16px;
}

.steps-container {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
}

.step-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  background: #fff;
  border-radius: 10px;
  border: 2px solid #e8eaed;
  transition: all 0.3s ease;
}

.step-item.step-active {
  border-color: #667eea;
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.05) 0%, rgba(118, 75, 162, 0.05) 100%);
}

.step-number {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #e8eaed;
  color: #666;
  font-size: 16px;
  font-weight: 700;
  border-radius: 50%;
  transition: all 0.3s ease;
}

.step-active .step-number {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
}

.step-content {
  flex: 1;
}

.step-name {
  font-size: 15px;
  font-weight: 600;
  color: #333;
  margin-bottom: 2px;
}

.step-desc {
  font-size: 12px;
  color: #999;
}

.step-arrow {
  color: #ccc;
  font-size: 20px;
}

.step-active + .step-arrow {
  color: #667eea;
}

.help-content {
  padding: 10px 0;
}

.help-tip {
  color: #666;
  margin-bottom: 20px;
}

.help-items {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.help-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #f5f7fa;
  border-radius: 8px;
}

.help-label {
  font-weight: 500;
  color: #333;
}
</style>