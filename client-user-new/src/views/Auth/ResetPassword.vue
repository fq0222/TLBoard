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
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white/90 md:text-3xl">重置密码</h1>
          <p class="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">
            请输入新密码。链接只能提交一次，提交后会立即失效。
          </p>
        </div>

        <div
          v-if="!token"
          class="mb-5 rounded-xl border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300"
        >
          重置链接无效，请重新申请。
        </div>

        <form class="space-y-5" @submit.prevent="handleSubmit">
          <div>
            <label for="password" class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
              新密码 <span class="text-error-500">*</span>
            </label>
            <div class="relative">
              <input
                v-model="form.password"
                id="password"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="new-password"
                placeholder="请输入新密码"
                class="dark:bg-dark-900 h-11 w-full rounded-lg border border-gray-300 bg-transparent py-2.5 pl-4 pr-11 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
              />
              <button
                type="button"
                class="absolute right-3 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.05]"
                @click="showPassword = !showPassword"
              >
                <EyeOff v-if="showPassword" class="size-4" />
                <Eye v-else class="size-4" />
              </button>
            </div>
            <p class="mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400">
              密码需至少 8 位，并同时包含字母和数字。
            </p>
          </div>

          <div>
            <label for="confirm-password" class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
              确认新密码 <span class="text-error-500">*</span>
            </label>
            <input
              v-model="form.confirmPassword"
              id="confirm-password"
              type="password"
              autocomplete="new-password"
              placeholder="请再次输入新密码"
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
            :disabled="loading || !token"
          >
            {{ loading ? '修改中...' : '修改密码' }}
          </button>
        </form>
      </section>
    </div>
  </FullScreenLayout>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Eye, EyeOff } from 'lucide-vue-next'
import FullScreenLayout from '@/components/layout/FullScreenLayout.vue'
import api, { getApiErrorMessage } from '@/api'

type MessageType = 'error' | 'success'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const showPassword = ref(false)
const message = ref('')
const messageType = ref<MessageType>('error')
const passwordPattern = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/

const token = computed(() => String(route.query.token || '').trim())

const form = reactive({
  password: '',
  confirmPassword: '',
})

/**
 * 设置重置密码页面反馈。
 *
 * 职责：在页面内展示成功或错误提示。
 * 关键参数：text 为提示文案，type 控制样式。
 * 核心分支：成功后仍保留提示，并稍后跳回登录页。
 */
function setMessage(text: string, type: MessageType = 'error') {
  message.value = text
  messageType.value = type
}

/**
 * 校验重置密码表单。
 *
 * 职责：在提交后端前校验 token、密码强度和两次输入一致。
 * 关键参数：无，读取 URL token 与响应式表单。
 * 核心分支：任一校验失败返回对应中文错误，全部通过返回空字符串。
 */
function validateForm() {
  if (!token.value) return '重置链接无效，请重新申请'
  if (!form.password) return '请输入新密码'
  if (!passwordPattern.test(form.password)) return '密码需至少8位，并同时包含字母和数字'
  if (!form.confirmPassword) return '请再次输入新密码'
  if (form.confirmPassword !== form.password) return '两次输入的密码不一致'
  return ''
}

/**
 * 提交新密码。
 *
 * 职责：调用后端 `/reset-password` 完成一次性 token 密码重置。
 * 关键参数：token 来自邮件链接 query，password 来自用户输入。
 * 核心分支：成功后提示并跳转登录页，失败展示后端错误。
 */
async function handleSubmit() {
  const error = validateForm()
  if (error) {
    setMessage(error)
    return
  }

  try {
    loading.value = true
    message.value = ''
    const response = await api.user.resetPassword({
      token: token.value,
      password: form.password,
    })
    setMessage(response.message || '密码重置成功，请使用新密码登录', 'success')
    window.setTimeout(() => {
      router.push('/signin')
    }, 800)
  } catch (error) {
    setMessage(getApiErrorMessage(error, '密码重置失败'))
  } finally {
    loading.value = false
  }
}
</script>
