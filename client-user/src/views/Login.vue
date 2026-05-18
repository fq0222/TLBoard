<template>
  <div class="login-container">
    <div class="login-card">
      <div class="login-header">
        <h1 class="login-title">{{ isRegisterMode ? '注册并支付' : '用户登录' }}</h1>
        <p class="login-subtitle">
          {{ isRegisterMode ? '完成注册后即可发起套餐支付' : '登录您的账户管理订阅' }}
        </p>
      </div>

      <div
        v-if="isRegisterMode && selectedPlanId"
        class="plan-info-card"
      >
        <h3 class="plan-info-title">购买套餐</h3>
        <div class="plan-info-details">
          <div class="plan-info-item">
            <span class="plan-info-label">套餐名称：</span>
            <span class="plan-info-value">{{ planInfo.name }}</span>
          </div>
          <div class="plan-info-item">
            <span class="plan-info-label">价格：</span>
            <span class="plan-info-value price">¥{{ planInfo.price }}</span>
          </div>
          <div class="plan-info-item">
            <span class="plan-info-label">流量：</span>
            <span class="plan-info-value">{{ planInfo.traffic }}</span>
          </div>
          <div class="plan-info-item">
            <span class="plan-info-label">有效期：</span>
            <span class="plan-info-value">{{ planInfo.duration }}</span>
          </div>
        </div>
        <div v-if="planInfo.is_soldout" class="sold-out-warning">该套餐已售罄</div>
      </div>

      <el-form
        ref="formRef"
        :model="form"
        :rules="formRules"
        class="login-form"
        @submit.prevent="handleSubmit"
      >
        <el-form-item prop="email">
          <el-input
            v-model="form.email"
            placeholder="请输入邮箱"
            prefix-icon="Message"
            size="large"
          />
        </el-form-item>

        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            prefix-icon="Lock"
            size="large"
            show-password
            @keyup.enter="handleSubmit"
          />
        </el-form-item>

        <p v-if="isRegisterMode" class="password-tip">
          密码需至少 8 位，并同时包含字母和数字
        </p>

        <el-form-item v-if="isRegisterMode" prop="confirmPassword">
          <el-input
            v-model="form.confirmPassword"
            type="password"
            placeholder="请再次输入密码"
            prefix-icon="Lock"
            size="large"
            show-password
            @keyup.enter="handleSubmit"
          />
        </el-form-item>

        <el-form-item v-if="isRegisterMode" prop="pay_type">
          <el-radio-group v-model="form.pay_type" class="pay-type-group">
            <el-radio-button :label="2">支付宝</el-radio-button>
            <el-radio-button :label="1">微信</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <el-form-item>
          <el-button
            type="primary"
            size="large"
            class="login-btn"
            :loading="loading"
            :disabled="isRegisterMode && planInfo.is_soldout"
            @click="handleSubmit"
          >
            {{ isRegisterMode && planInfo.is_soldout ? '套餐已售罄' : (isRegisterMode ? '提交并前往支付' : '登录') }}
          </el-button>
        </el-form-item>
      </el-form>

      <div class="login-footer">
        <p v-if="isRegisterMode">
          已有账户？
          <el-button text type="primary" @click="switchToLogin">直接登录</el-button>
        </p>
        <p v-else>
          还没有账户？
          <router-link to="/" class="link">选择套餐注册</router-link>
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * 登录页组件
 * 处理用户登录与注册支付流程
 */

import { computed, reactive, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { ElMessage } from 'element-plus'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

const formRef = ref(null)
const loading = ref(false)

const selectedPlanId = computed(() => {
  const planId = Number(route.query.plan_id || 0)
  return planId > 0 ? planId : null
})

const planInfo = computed(() => ({
  name: route.query.plan_name || '未知套餐',
  price: route.query.plan_price || '0.00',
  traffic: route.query.plan_traffic || '0 B',
  duration: Number(route.query.plan_duration) === 0 ? '无限期' : (route.query.plan_duration || '0') + ' 天',
  is_soldout: route.query.plan_soldout === '1'
}))

const isRegisterMode = computed(() => !!selectedPlanId.value)

const form = reactive({
  email: '',
  password: '',
  confirmPassword: '',
  pay_type: 1
})

// 注册场景的密码规则与后端保持一致：至少 8 位，且必须包含字母和数字
const passwordPattern = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/

/**
 * 校验密码复杂度
 * 登录模式只校验非空，注册模式额外校验复杂度规则
 */
function validatePassword(rule, value, callback) {
  if (!value) {
    callback(new Error('请输入密码'))
    return
  }

  if (isRegisterMode.value && !passwordPattern.test(value)) {
    callback(new Error('密码需至少8位，并同时包含字母和数字'))
    return
  }

  callback()
}

/**
 * 校验确认密码
 * 仅在注册模式下启用
 */
function validateConfirmPassword(rule, value, callback) {
  if (!isRegisterMode.value) {
    callback()
    return
  }

  if (!value) {
    callback(new Error('请再次输入密码'))
    return
  }

  if (value !== form.password) {
    callback(new Error('两次输入的密码不一致'))
    return
  }

  callback()
}

const formRules = computed(() => ({
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '请输入有效的邮箱地址', trigger: 'blur' }
  ],
  password: [
    { validator: validatePassword, trigger: 'blur' }
  ],
  confirmPassword: [
    { validator: validateConfirmPassword, trigger: 'blur' }
  ],
  pay_type: [
    { required: isRegisterMode.value, message: '请选择支付方式', trigger: 'change' }
  ]
}))

async function handleSubmit() {
  try {
    await formRef.value.validate()
    loading.value = true

    if (isRegisterMode.value) {
      // 注册成功后立即跳转到支付等待页，并缓存登录信息用于支付完成后的自动登录
      const result = await userStore.registerAndPay({
        email: form.email,
        password: form.password,
        plan_id: selectedPlanId.value,
        pay_type: form.pay_type
      })

      if (!result.success) {
        ElMessage.error(result.message || '注册失败')
        return
      }

      sessionStorage.setItem('pending_payment_login', JSON.stringify({
        email: form.email,
        password: form.password
      }))

      ElMessage.success('订单创建成功，请完成支付')
      router.push({
        name: 'PaymentCallback',
        query: {
          order_id: result.data.out_trade_no,
          payment_url: result.data.payment_url,
          pay_type: form.pay_type
        }
      })
      return
    }

    // 非注册模式按普通登录流程处理
    const result = await userStore.login({
      email: form.email,
      password: form.password
    })

    if (result.success) {
      ElMessage.success('登录成功')
      const redirect = route.query.redirect || '/user'
      router.push(redirect)
    } else {
      ElMessage.error(result.message || '登录失败')
    }
  } catch (error) {
    console.error('提交表单错误:', error)
  } finally {
    loading.value = false
  }
}

function switchToLogin() {
  router.push({ name: 'Login' })
}
</script>

<style scoped>
.login-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 20px;
}

.login-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  width: 100%;
  max-width: 420px;
  padding: 40px;
}

.login-header {
  text-align: center;
  margin-bottom: 24px;
}

.login-title {
  font-size: 28px;
  color: #333;
  margin-bottom: 10px;
}

.login-subtitle {
  color: #666;
  font-size: 16px;
  margin: 0;
}

.plan-alert {
  margin-bottom: 20px;
}

.plan-info-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 24px;
  color: #fff;
}

.plan-info-title {
  font-size: 18px;
  margin: 0 0 16px 0;
  text-align: center;
  opacity: 0.9;
}

.plan-info-details {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.plan-info-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.plan-info-label {
  font-size: 12px;
  opacity: 0.8;
  margin-bottom: 4px;
}

.plan-info-value {
  font-size: 16px;
  font-weight: 600;
}

.plan-info-value.price {
  font-size: 24px;
  color: #ffd700;
}

.sold-out-warning {
  margin-top: 12px;
  padding: 8px 12px;
  background: rgba(255, 77, 79, 0.2);
  border: 1px solid rgba(255, 77, 79, 0.4);
  border-radius: 6px;
  text-align: center;
  font-size: 14px;
  color: #ffa39e;
}

.login-form {
  margin-bottom: 20px;
}

.password-tip {
  margin: -8px 0 16px;
  color: #909399;
  font-size: 13px;
  line-height: 1.5;
}

.pay-type-group {
  width: 100%;
  display: flex;
}

.pay-type-group :deep(.el-radio-button) {
  flex: 1;
}

.pay-type-group :deep(.el-radio-button__inner) {
  width: 100%;
}

.login-btn {
  width: 100%;
  height: 50px;
  font-size: 18px;
}

.login-footer {
  text-align: center;
  color: #666;
}

.link {
  color: #409eff;
  text-decoration: none;
}

.link:hover {
  text-decoration: underline;
}
</style>
