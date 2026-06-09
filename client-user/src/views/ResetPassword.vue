<template>
  <div class="reset-container">
    <section class="reset-card">
      <div class="reset-card-head">
        <h2>重置密码</h2>
        <p>请输入新密码。链接只能提交一次，提交后会立即失效。</p>
      </div>

      <el-alert
        v-if="!token"
        title="重置链接无效，请重新申请。"
        type="error"
        :closable="false"
        class="reset-alert"
      />

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        class="reset-form"
        @submit.prevent="handleSubmit"
      >
        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入新密码"
            prefix-icon="Lock"
            size="large"
            show-password
          />
        </el-form-item>

        <el-form-item prop="confirmPassword">
          <el-input
            v-model="form.confirmPassword"
            type="password"
            placeholder="请再次输入新密码"
            prefix-icon="Lock"
            size="large"
            show-password
            @keyup.enter="handleSubmit"
          />
        </el-form-item>

        <p class="password-tip">密码需至少 8 位，并同时包含字母和数字。</p>

        <el-button
          type="primary"
          size="large"
          class="reset-btn"
          :loading="loading"
          :disabled="!token"
          @click="handleSubmit"
        >
          修改密码
        </el-button>
      </el-form>

      <div class="reset-footer">
        <router-link to="/login" class="link">返回登录</router-link>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import api from '@/api'

const route = useRoute()
const router = useRouter()
const formRef = ref(null)
const loading = ref(false)

const token = computed(() => String(route.query.token || '').trim())

const form = reactive({
  password: '',
  confirmPassword: ''
})

const passwordPattern = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/

/**
 * 校验新密码强度。
 * 职责：与后端保持一致，要求至少 8 位且同时包含字母和数字。
 */
function validatePassword(rule, value, callback) {
  if (!value) {
    callback(new Error('请输入新密码'))
    return
  }

  if (!passwordPattern.test(value)) {
    callback(new Error('密码需至少8位，并同时包含字母和数字'))
    return
  }

  callback()
}

/**
 * 校验重复输入的新密码。
 * 职责：确保用户本地两次输入一致，减少无效提交。
 */
function validateConfirmPassword(rule, value, callback) {
  if (!value) {
    callback(new Error('请再次输入新密码'))
    return
  }

  if (value !== form.password) {
    callback(new Error('两次输入的密码不一致'))
    return
  }

  callback()
}

const rules = {
  password: [
    { validator: validatePassword, trigger: 'blur' }
  ],
  confirmPassword: [
    { validator: validateConfirmPassword, trigger: 'blur' }
  ]
}

/**
 * 提交新密码。
 * 职责：把 URL Token 与新密码一起提交，成功后引导用户回登录页。
 */
async function handleSubmit() {
  if (!token.value) {
    ElMessage.error('重置链接无效，请重新申请')
    return
  }

  try {
    await formRef.value.validate()
    loading.value = true
    const response = await api.user.resetPassword({
      token: token.value,
      password: form.password
    })
    ElMessage.success(response.message || '密码重置成功，请使用新密码登录')
    router.push('/login')
  } catch (error) {
    if (error?.userMessage) {
      ElMessage.error(error.userMessage)
    }
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.reset-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background:
    radial-gradient(circle at top left, rgba(15, 118, 110, 0.2), transparent 28%),
    linear-gradient(135deg, #f4f3ed 0%, #eef4f2 48%, #f8f8fb 100%);
}

.reset-card {
  width: 100%;
  max-width: 520px;
  padding: 32px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(20, 33, 61, 0.08);
  box-shadow: 0 24px 60px rgba(20, 33, 61, 0.08);
}

.reset-card-head {
  margin-bottom: 24px;
}

.reset-card-head h2 {
  margin: 0 0 8px;
  font-size: 28px;
  color: #14213d;
}

.reset-card-head p {
  margin: 0;
  color: #5f6c8d;
  line-height: 1.7;
}

.reset-alert {
  margin-bottom: 18px;
}

.reset-form {
  margin-bottom: 24px;
}

.password-tip {
  margin: -4px 0 18px;
  color: #76839f;
  font-size: 13px;
  line-height: 1.7;
}

.reset-btn {
  width: 100%;
  height: 52px;
  border-radius: 16px;
  border: none;
  font-size: 16px;
  font-weight: 700;
  background: linear-gradient(135deg, #0f766e 0%, #115e59 100%);
}

.reset-footer {
  text-align: center;
}

.link {
  color: #0f766e;
  text-decoration: none;
}

.link:hover {
  text-decoration: underline;
}

@media (max-width: 768px) {
  .reset-container {
    padding: 10px;
    align-items: flex-start;
  }

  .reset-card {
    padding: 20px 14px;
    border-radius: 20px;
  }

  .reset-card-head {
    margin-bottom: 18px;
  }

  .reset-card-head h2 {
    font-size: 22px;
  }
}
</style>
