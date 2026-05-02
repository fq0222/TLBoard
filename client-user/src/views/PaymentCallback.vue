<template>
  <div class="payment-callback-container">
    <div class="callback-card">
      <div v-if="loading" class="loading-state">
        <el-icon class="loading-icon"><Loading /></el-icon>
        <h2>正在处理支付结果...</h2>
        <p>请稍候，我们正在确认您的支付状态</p>
      </div>
      
      <div v-else-if="paymentSuccess" class="success-state">
        <el-icon class="success-icon"><CircleCheck /></el-icon>
        <h2>支付成功！</h2>
        <p>您的订阅已激活，正在跳转到用户中心...</p>
        <el-button type="primary" size="large" @click="goToProfile">
          立即跳转
        </el-button>
      </div>
      
      <div v-else class="fail-state">
        <el-icon class="fail-icon"><CircleClose /></el-icon>
        <h2>支付失败</h2>
        <p>{{ errorMessage }}</p>
        <el-button type="primary" size="large" @click="goToHome">
          返回首页
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * 支付回调组件
 * 处理支付完成后的回调逻辑
 */

import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Loading, CircleCheck, CircleClose } from '@element-plus/icons-vue'
import api from '@/api'

const router = useRouter()
const route = useRoute()

// 响应式数据
const loading = ref(true)
const paymentSuccess = ref(false)
const errorMessage = ref('')

/**
 * 检查支付状态
 */
async function checkPaymentStatus() {
  try {
    const orderId = route.query.order_id
    
    if (!orderId) {
      errorMessage.value = '缺少订单ID参数'
      loading.value = false
      return
    }
    
    // 轮询订单状态
    let retryCount = 0
    const maxRetry = 10
    
    const checkStatus = async () => {
      try {
        const response = await api.user.getOrderStatus(orderId)
        
        if (response.code === 0) {
          if (response.data.status === 'paid') {
            paymentSuccess.value = true
            loading.value = false
            
            // 3秒后自动跳转
            setTimeout(() => {
              goToProfile()
            }, 3000)
            return
          } else if (response.data.status === 'expired') {
            errorMessage.value = '订单已过期'
            loading.value = false
            return
          }
        }
        
        retryCount++
        if (retryCount < maxRetry) {
          setTimeout(checkStatus, 2000)
        } else {
          errorMessage.value = '支付状态确认超时，请手动检查订单状态'
          loading.value = false
        }
      } catch (error) {
        console.error('检查支付状态失败:', error)
        errorMessage.value = '检查支付状态失败，请稍后重试'
        loading.value = false
      }
    }
    
    // 开始检查
    setTimeout(checkStatus, 1000)
  } catch (error) {
    console.error('支付回调处理错误:', error)
    errorMessage.value = '支付回调处理失败'
    loading.value = false
  }
}

/**
 * 跳转到个人中心
 */
function goToProfile() {
  router.push('/user')
}

/**
 * 跳转到首页
 */
function goToHome() {
  router.push('/')
}

// 组件挂载时检查支付状态
onMounted(() => {
  checkPaymentStatus()
})
</script>

<style scoped>
.payment-callback-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 20px;
}

.callback-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  width: 100%;
  max-width: 500px;
  padding: 60px 40px;
  text-align: center;
}

.loading-state,
.success-state,
.fail-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
}

.loading-icon {
  font-size: 64px;
  color: #409eff;
  animation: spin 2s linear infinite;
}

.success-icon {
  font-size: 64px;
  color: #67c23a;
}

.fail-icon {
  font-size: 64px;
  color: #f56c6c;
}

h2 {
  font-size: 24px;
  color: #333;
  margin: 0;
}

p {
  color: #666;
  font-size: 16px;
  margin: 0;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>