import { computed, ref } from 'vue'
import api, { getApiErrorMessage, type LoginPayload, type RegisterAndPayPayload, type UserProfile } from '@/api'

const token = ref(localStorage.getItem('user_token') || '')
const userInfo = ref<UserProfile | null>(null)
const loading = ref(false)

const isLoggedIn = computed(() => Boolean(token.value))
const hasVerifiedSession = computed(() => Boolean(token.value && userInfo.value))

/**
 * 持久化用户登录令牌。
 *
 * 职责：同步响应式 token 与 localStorage，供路由守卫和 API 鉴权复用。
 * 关键参数：newToken 为后端登录接口返回的 JWT。
 * 核心分支：空 token 不在这里处理，登出统一走 clearToken。
 */
function setToken(newToken: string) {
  token.value = newToken
  localStorage.setItem('user_token', newToken)
}

/**
 * 清除当前登录状态。
 *
 * 职责：退出登录或鉴权失败时清理本地 token 和用户资料。
 * 关键参数：无。
 * 核心分支：始终清理，保证页面不会继续展示过期身份。
 */
function clearToken() {
  token.value = ''
  userInfo.value = null
  localStorage.removeItem('user_token')
}

/**
 * 提供用户状态和认证动作。
 *
 * 职责：用轻量响应式单例替代旧版 Pinia store，保持新版依赖架构简单。
 * 关键参数：无。
 * 核心分支：登录成功写 token，注册并支付只返回订单数据，不提前激活登录态。
 */
export function useUserStore() {
  async function login(payload: LoginPayload) {
    try {
      loading.value = true
      const response = await api.user.login(payload)
      setToken(response.data.token)
      userInfo.value = response.data.user
      return { success: true, data: response.data }
    } catch (error) {
      return { success: false, message: getApiErrorMessage(error, '登录失败') }
    } finally {
      loading.value = false
    }
  }

  async function registerAndPay(payload: RegisterAndPayPayload) {
    try {
      loading.value = true
      const response = await api.user.registerAndPay(payload)
      return { success: true, data: response.data }
    } catch (error) {
      return { success: false, message: getApiErrorMessage(error, '注册失败') }
    } finally {
      loading.value = false
    }
  }

  async function fetchUserProfile() {
    if (!token.value) {
      return { success: false, message: '请先登录' }
    }

    try {
      loading.value = true
      const response = await api.user.getProfile(token.value)
      userInfo.value = response.data
      return { success: true, data: response.data }
    } catch (error) {
      clearToken()
      return { success: false, message: getApiErrorMessage(error, '获取用户信息失败') }
    } finally {
      loading.value = false
    }
  }

  function logout() {
    clearToken()
  }

  return {
    token,
    userInfo,
    loading,
    isLoggedIn,
    hasVerifiedSession,
    setToken,
    clearToken,
    login,
    registerAndPay,
    fetchUserProfile,
    logout,
  }
}
