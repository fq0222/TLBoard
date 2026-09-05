<template>
  <FullScreenLayout>
    <div class="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8 dark:bg-gray-950 sm:px-6">
      <section class="w-full max-w-xl rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-sm dark:border-gray-800 dark:bg-gray-900 sm:p-8">
        <router-link
          to="/signin"
          class="mb-8 inline-flex items-center gap-2 text-sm font-medium text-gray-500 transition hover:text-gray-800 dark:text-gray-400 dark:hover:text-white/90"
        >
          <ArrowLeft class="size-4" />
          返回登录
        </router-link>

        <div class="mb-7">
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white/90 md:text-3xl">找回密码</h1>
          <p class="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">
            输入注册邮箱后，系统会发送一次性密码重置链接。
          </p>
        </div>

        <form class="space-y-5" @submit.prevent="handleSubmit">
          <div>
            <label for="email" class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
              邮箱 <span class="text-error-500">*</span>
            </label>
            <input
              v-model.trim="email"
              id="email"
              type="email"
              autocomplete="email"
              placeholder="请输入邮箱"
              class="dark:bg-dark-900 h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
            />
          </div>

          <div
            v-if="message"
            class="rounded-xl border px-4 py-3 text-sm"
            :class="messageType === 'error'
              ? 'border-error-200 bg-error-50 text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300'
              : 'border-success-200 bg-success-50 text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-300'"
          >
            {{ message }}
          </div>

          <button
            type="submit"
            class="inline-flex h-12 w-full items-center justify-center rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white shadow-theme-xs transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
            :disabled="loading"
          >
            {{ loading ? '提交中...' : '提交' }}
          </button>
        </form>
      </section>
    </div>
  </FullScreenLayout>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ArrowLeft } from 'lucide-vue-next'
import FullScreenLayout from '@/components/layout/FullScreenLayout.vue'
import api, { getApiErrorMessage } from '@/api'

type MessageType = 'error' | 'success'

const email = ref('')
const loading = ref(false)
const message = ref('')
const messageType = ref<MessageType>('error')

/**
 * 设置找回密码页面反馈。
 *
 * 职责：在页面内展示成功或错误提示，避免弹窗打断用户流程。
 * 关键参数：text 为提示文案，type 控制样式。
 * 核心分支：成功提示使用绿色状态，错误提示使用红色状态。
 */
function setMessage(text: string, type: MessageType = 'error') {
  message.value = text
  messageType.value = type
}

/**
 * 提交密码重置申请。
 *
 * 职责：调用后端 `/forgot-password`，保持后端模糊提示语义。
 * 关键参数：email 为用户输入的注册邮箱。
 * 核心分支：邮箱格式错误前端拦截，接口成功展示后端提示，异常展示错误信息。
 */
async function handleSubmit() {
  if (!email.value) {
    setMessage('请输入邮箱')
    return
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) {
    setMessage('请输入有效的邮箱地址')
    return
  }

  try {
    loading.value = true
    message.value = ''
    const response = await api.user.requestPasswordReset({ email: email.value })
    setMessage(response.message || response.data?.message || '如果该邮箱已注册，重置密码邮件已发送，请查收。', 'success')
  } catch (error) {
    setMessage(getApiErrorMessage(error, '提交失败'))
  } finally {
    loading.value = false
  }
}
</script>
