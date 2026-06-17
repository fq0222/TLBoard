<template>
  <div class="login-container">
    <div
      class="login-shell"
      :class="{ 'register-layout': isRegisterMode }"
    >
      <section
        class="login-card"
        :class="{ 'register-card': isRegisterMode }"
      >
        <div class="login-card-head">
          <h2>{{ isRegisterMode ? '填写账号信息' : '欢迎回来' }}</h2>
          <p v-if="!isRegisterMode">输入账号密码后进入个人中心。</p>
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
              :prefix-icon="Message"
              size="large"
            />
          </el-form-item>

          <el-form-item prop="password">
            <el-input
              v-model="form.password"
              type="password"
              placeholder="请输入密码"
              :prefix-icon="Lock"
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
              :prefix-icon="Lock"
              size="large"
              show-password
              @keyup.enter="handleSubmit"
            />
          </el-form-item>

          <div v-if="isRegisterMode" class="pay-section">
            <div class="pay-section-head">
              <div>
                <h3>支付方式</h3>
              </div>
            </div>

            <el-form-item prop="pay_type" class="pay-form-item">
              <el-radio-group v-model="form.pay_type" class="pay-type-group">
                <label
                  class="pay-option"
                  :class="{ 'is-selected': form.pay_type === 2 }"
                >
                  <el-radio :value="2" class="pay-radio">
                    <span class="pay-option-main">
                      <span class="pay-icon alipay">支</span>
                      <span class="pay-copy">
                        <strong>支付宝</strong>
                      </span>
                    </span>
                  </el-radio>
                </label>

                <label
                  class="pay-option"
                  :class="{ 'is-selected': form.pay_type === 1 }"
                >
                  <el-radio :value="1" class="pay-radio">
                    <span class="pay-option-main">
                      <span class="pay-icon wechat">微</span>
                      <span class="pay-copy">
                        <strong>微信支付</strong>
                      </span>
                    </span>
                  </el-radio>
                </label>
              </el-radio-group>
            </el-form-item>
          </div>

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
          <p v-else class="login-footer-row">
            <router-link to="/forgot-password" class="forgot-link">忘记密码？</router-link>
            <span class="footer-separator"></span>
            <span class="footer-account-text">还没有账户？</span>
            <router-link to="/" class="link">
              <span class="footer-link-desktop">返回首页选择套餐</span>
              <span class="footer-link-mobile">返回选择套餐</span>
            </router-link>
            <template v-if="onlineCustomerServiceUrl">
              <span class="footer-separator"></span>
              <a
                :href="onlineCustomerServiceUrl"
                class="link contact-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                联系我们
              </a>
            </template>
          </p>
        </div>
      </section>

      <section
        class="login-aside"
        :class="{ 'register-aside': isRegisterMode }"
      >
        <span v-if="isRegisterMode" class="aside-badge">确认订单</span>
        <h1 v-if="!isRegisterMode" class="login-title">登录您的账号</h1>
        <p v-if="!isRegisterMode" class="login-subtitle">请使用已激活账号登录，未完成购买和激活的账号暂时无法登录。</p>

        <div
          v-if="isRegisterMode && selectedPlanId"
          class="plan-info-card"
        >
          <div class="order-head">
            <h2 class="order-title">{{ planInfo.name }}</h2>
            <div class="order-price">
              <span class="price-symbol">¥</span>
              <strong>{{ planInfo.price }}</strong>
            </div>
          </div>

          <div class="order-metrics">
            <div class="order-metric">
              <span>流量</span>
              <strong>{{ planInfo.traffic }}</strong>
            </div>
            <div class="order-metric">
              <span>时长</span>
              <strong>{{ planInfo.duration }}</strong>
            </div>
          </div>

          <div v-if="planInfo.is_soldout" class="sold-out-warning">
            该套餐已售罄，暂时无法继续创建订单
          </div>
        </div>

        <div v-if="!isRegisterMode" class="aside-tips">
          <div class="aside-tip">
            <span class="tip-index">1</span>
            <div>
              <strong>激活后才能登录</strong>
              <p>购买套餐并完成支付后，系统才会自动激活账号，随后可使用填写的邮箱和密码登录。</p>
            </div>
          </div>
          <div class="aside-tip">
            <span class="tip-index">2</span>
            <div>
              <strong>未付款前无法使用</strong>
              <p>如果订单尚未支付完成，账号不会立即开通，请先完成付款并等待页面回调。</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import api from '@/api'
import { ElMessage } from 'element-plus'
import { Lock, Message } from '@element-plus/icons-vue'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

const formRef = ref(null)
const loading = ref(false)
const onlineCustomerServiceUrl = ref('')

const selectedPlanId = computed(() => {
  const planId = Number(route.query.plan_id || 0)
  return planId > 0 ? planId : null
})

const referralCode = computed(() => String(route.query.ref || sessionStorage.getItem('referral_code') || '').trim())

const planInfo = computed(() => ({
  name: route.query.plan_name || '未知套餐',
  price: route.query.plan_price || '0.00',
  traffic: route.query.plan_traffic || '0 B',
  duration: Number(route.query.plan_duration) === 0 ? '不限时' : `${route.query.plan_duration || '0'} 天`,
  is_soldout: route.query.plan_soldout === '1'
}))

const isRegisterMode = computed(() => !!selectedPlanId.value)

const form = reactive({
  email: '',
  password: '',
  confirmPassword: '',
  pay_type: 1
})

const passwordPattern = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/

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
      const result = await userStore.registerAndPay({
        email: form.email,
        password: form.password,
        plan_id: selectedPlanId.value,
        pay_type: form.pay_type,
        referral_code: referralCode.value || undefined
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
  router.push({
    name: 'Login',
    query: referralCode.value ? { ref: referralCode.value } : undefined
  })
}

/**
 * 初始化推广归因信息。
 * 核心分支：有 ref 时先落本地再上报点击；无 ref 时沿用已缓存推广码，保证后续下单仍能归因。
 */
async function initializeReferralTracking() {
  const queryCode = String(route.query.ref || '').trim()
  if (!queryCode) {
    return
  }

  sessionStorage.setItem('referral_code', queryCode)

  try {
    await api.user.recordReferralClick(queryCode)
  } catch (error) {
    console.error('记录推广点击失败:', error)
  }
}

/**
 * 加载登录页公开设置。
 * 核心分支：后端未配置客服链接时保持空字符串，模板会隐藏“联系我们”入口。
 */
async function loadPublicSettings() {
  try {
    const res = await api.user.getPublicSettings()
    if (res.code === 0) {
      onlineCustomerServiceUrl.value = String(res.data?.online_customer_service_url || '').trim()
    }
  } catch (error) {
    console.error('加载公开设置失败:', error)
  }
}

onMounted(() => {
  initializeReferralTracking()
  loadPublicSettings()
})
</script>

<style scoped>
.login-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background:
    radial-gradient(circle at top left, rgba(15, 118, 110, 0.22), transparent 28%),
    linear-gradient(135deg, #f4f3ed 0%, #eef4f2 48%, #f8f8fb 100%);
}

.login-shell {
  width: 100%;
  max-width: 1120px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(380px, 420px);
  gap: 24px;
  align-items: stretch;
}

.login-aside,
.login-card {
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(20, 33, 61, 0.08);
  box-shadow: 0 24px 60px rgba(20, 33, 61, 0.08);
}

.login-aside {
  padding: 30px;
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.aside-badge {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  padding: 8px 14px;
  border-radius: 999px;
  background: rgba(15, 118, 110, 0.1);
  color: #0b5f58;
  font-size: 13px;
  font-weight: 700;
}

.login-title {
  margin: 0;
  font-size: clamp(32px, 4vw, 44px);
  line-height: 1.08;
  color: #14213d;
}

.login-subtitle {
  margin: -8px 0 0;
  color: #5f6c8d;
  font-size: 15px;
  line-height: 1.8;
}

.plan-info-card {
  border-radius: 24px;
  padding: 22px;
  background:
    radial-gradient(circle at top right, rgba(15, 118, 110, 0.18), transparent 30%),
    linear-gradient(145deg, #102542 0%, #173d39 100%);
  color: #fff;
}

.order-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.order-title {
  margin: 0;
  font-size: 28px;
  line-height: 1.15;
}

.order-price {
  display: flex;
  align-items: baseline;
  gap: 4px;
  color: #f7c66b;
}

.order-price strong {
  font-size: 34px;
  line-height: 1;
}

.order-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 18px;
}

.order-metric {
  padding: 14px 16px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.09);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.order-metric span {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  opacity: 0.74;
}

.order-metric strong {
  font-size: 17px;
}

.sold-out-warning {
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(245, 108, 108, 0.18);
  border: 1px solid rgba(245, 108, 108, 0.3);
  color: #ffd0d0;
  font-size: 13px;
}

.aside-tips {
  display: grid;
  gap: 12px;
}

.aside-tip {
  display: flex;
  gap: 14px;
  padding: 16px 18px;
  border-radius: 20px;
  background: #f7f8fa;
  border: 1px solid rgba(20, 33, 61, 0.05);
}

.tip-index {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #0f766e;
  color: #fff;
  font-weight: 700;
}

.aside-tip strong {
  display: block;
  margin-bottom: 6px;
  color: #14213d;
  font-size: 15px;
}

.aside-tip p {
  margin: 0;
  color: #5f6c8d;
  font-size: 13px;
  line-height: 1.7;
}

.login-card {
  padding: 28px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.login-card-head {
  margin-bottom: 28px;
}

.login-card-head h2 {
  margin: 0 0 8px;
  font-size: 28px;
  color: #14213d;
}

.login-card-head p {
  margin: 0;
  color: #5f6c8d;
  line-height: 1.7;
}

.login-form {
  margin-bottom: 28px;
}

.login-form :deep(.el-input__wrapper) {
  padding-left: 1em;
}

.password-tip {
  margin: -6px 0 16px;
  color: #76839f;
  font-size: 13px;
  line-height: 1.7;
}

.pay-section {
  margin: 8px 0 24px;
  padding: 18px;
  border-radius: 22px;
  background: #f8fafc;
  border: 1px solid rgba(20, 33, 61, 0.06);
}

.pay-section-head h3 {
  margin: 0;
  font-size: 18px;
  color: #14213d;
}

.pay-section-head p {
  margin: 6px 0 0;
  color: #5f6c8d;
  font-size: 13px;
  line-height: 1.7;
}

.pay-form-item {
  margin: 16px 0 0;
}

.pay-type-group {
  width: 100%;
  display: grid;
  gap: 12px;
}

.pay-option {
  display: block;
  padding: 14px 16px;
  border-radius: 18px;
  border: 1.5px solid rgba(20, 33, 61, 0.08);
  background: #fff;
  transition: 0.25s ease;
  cursor: pointer;
}

.pay-option.is-selected {
  border-color: rgba(15, 118, 110, 0.38);
  background: rgba(15, 118, 110, 0.05);
  box-shadow: 0 14px 28px rgba(15, 118, 110, 0.08);
}

.pay-radio {
  width: 100%;
  margin-right: 0;
}

.pay-radio :deep(.el-radio__label) {
  width: 100%;
  padding-left: 10px;
}

.pay-option-main {
  display: flex;
  align-items: center;
  gap: 12px;
}

.pay-icon {
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
}

.pay-icon.alipay {
  background: linear-gradient(135deg, #1677ff, #0958d9);
}

.pay-icon.wechat {
  background: linear-gradient(135deg, #07c160, #06ad56);
}

.pay-copy {
  display: flex;
  flex-direction: column;
}

.pay-copy strong {
  color: #14213d;
  font-size: 15px;
}

.login-btn {
  width: 100%;
  height: 52px;
  border-radius: 16px;
  border: none;
  font-size: 16px;
  font-weight: 700;
  background: linear-gradient(135deg, #0f766e 0%, #115e59 100%);
}

.login-footer {
  text-align: center;
  color: #5f6c8d;
}

.login-footer-row {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 12px;
}

.footer-link-mobile {
  display: none;
}

.forgot-link {
  color: #ff4d4f;
  text-decoration: none;
}

.forgot-link:hover,
.contact-link:hover,
.link:hover {
  text-decoration: underline;
}

.footer-separator {
  width: 1px;
  height: 16px;
  background: rgba(95, 108, 141, 0.25);
}

.link {
  color: #0f766e;
  text-decoration: none;
}

@media (max-width: 1024px) {
  .login-shell {
    grid-template-columns: 1fr;
    max-width: 700px;
  }
}

@media (max-width: 768px) {
  .login-container {
    padding: 10px;
    align-items: flex-start;
  }

  .login-shell {
    gap: 10px;
  }

  .login-aside,
  .login-card {
    border-radius: 20px;
  }

  .login-aside {
    padding: 16px 14px;
    gap: 12px;
  }

  .register-layout .login-aside {
    order: -1;
  }

  .login-subtitle {
    font-size: 14px;
  }

  .plan-info-card {
    padding: 16px;
    border-radius: 18px;
  }

  .order-head {
    gap: 8px;
  }

  .order-title {
    font-size: 22px;
  }

  .order-price strong {
    font-size: 28px;
  }

  .order-metrics {
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-top: 14px;
  }

  .order-metric {
    padding: 12px 14px;
  }

  .aside-tip {
    padding: 14px 16px;
    border-radius: 18px;
  }

  .login-card {
    padding: 18px 14px;
    justify-content: flex-start;
  }

  .register-card {
    padding-top: 14px;
    padding-bottom: 14px;
  }

  .login-card-head {
    margin-bottom: 16px;
  }

  .login-card-head h2 {
    font-size: 22px;
    margin-bottom: 4px;
  }

  .login-form {
    margin-bottom: 14px;
  }

  .password-tip {
    margin: -8px 0 10px;
    font-size: 12px;
  }

  .pay-section {
    margin: 4px 0 16px;
    padding: 12px;
    border-radius: 16px;
  }

  .pay-section-head h3 {
    font-size: 16px;
  }

  .pay-form-item {
    margin-top: 12px;
  }

  .pay-type-group {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .pay-option {
    padding: 10px 12px;
    border-radius: 16px;
  }

  .pay-radio :deep(.el-radio) {
    align-items: center;
  }

  .pay-radio :deep(.el-radio__label) {
    padding-left: 8px;
  }

  .pay-icon {
    width: 36px;
    height: 36px;
    border-radius: 12px;
    font-size: 14px;
  }

  .pay-copy strong {
    font-size: 14px;
  }

  .pay-option-main {
    gap: 8px;
  }

  .login-btn {
    height: 48px;
    border-radius: 14px;
  }

  .login-footer p {
    margin: 0;
    font-size: 12px;
  }

  .login-footer-row {
    flex-wrap: nowrap;
    gap: 6px;
    white-space: nowrap;
  }

  .footer-link-desktop {
    display: none;
  }

  .footer-account-text {
    display: inline;
  }

  .footer-link-mobile {
    display: inline;
  }

  .footer-separator {
    height: 13px;
  }

  .register-aside .aside-badge {
    padding: 6px 12px;
    font-size: 12px;
  }
}
</style>
