<template>
  <div class="reset-container">
    <section class="reset-card">
      <div class="reset-card-head">
        <h2>找回密码</h2>
        <p>输入注册邮箱后，我们会发送一次性密码重置链接。</p>
      </div>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        class="reset-form"
        @submit.prevent="handleSubmit"
      >
        <el-form-item prop="email">
          <el-input
            v-model="form.email"
            placeholder="请输入邮箱"
            :prefix-icon="Message"
            size="large"
            @keyup.enter="handleSubmit"
          />
        </el-form-item>

        <el-button
          type="primary"
          size="large"
          class="reset-btn"
          :loading="loading"
          @click="handleSubmit"
        >
          提交
        </el-button>
      </el-form>

      <div class="reset-footer">
        <router-link to="/login" class="link">返回登录</router-link>
      </div>
    </section>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Message } from '@element-plus/icons-vue'
import api from '@/api'

const formRef = ref(null)
const loading = ref(false)

const form = reactive({
  email: ''
})

const rules = {
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '请输入有效的邮箱地址', trigger: 'blur' }
  ]
}

/**
 * 提交密码重置申请。
 * 职责：发送邮箱到后端，并始终展示后端返回的模糊提示，避免暴露账号是否存在。
 */
async function handleSubmit() {
  try {
    await formRef.value.validate()
    loading.value = true
    const response = await api.user.requestPasswordReset({
      email: form.email
    })
    ElMessage.success(response.message || '如果该邮箱已注册，重置密码邮件已发送，请查收。')
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
  margin-bottom: 28px;
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

.reset-form {
  margin-bottom: 24px;
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
