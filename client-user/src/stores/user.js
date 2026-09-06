/**
 * 用户状态管理
 * 管理用户登录状态、个人信息和订阅信息
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/api'
import { SessionValidator } from './session-validator'

/**
 * 提取可直接展示给用户的错误文案
 * 优先使用后端 message，其次使用拦截器整理后的 userMessage
 * @param {Object} error - 请求错误对象
 * @param {string} fallback - 默认提示
 * @returns {string} 面向用户的错误文案
 */
function getErrorMessage(error, fallback) {
  return error?.response?.data?.message || error?.userMessage || error?.message || fallback
}

export const useUserStore = defineStore('user', () => {
  const token = ref(localStorage.getItem('user_token') || '')
  const userInfo = ref(null)
  const loading = ref(false)
  const sessionValidator = new SessionValidator({
    getToken: () => token.value,
    getUserInfo: () => userInfo.value,
    fetchProfile: () => api.user.getProfile({ skipAuthRedirect: true }),
    setUserInfo: (profile) => {
      userInfo.value = profile
    },
    clearToken
  })

  const isLoggedIn = computed(() => !!token.value)
  const userEmail = computed(() => userInfo.value?.email || '')
  const planName = computed(() => userInfo.value?.plan_name || '')
  const expireAt = computed(() => userInfo.value?.expire_at || null)
  const trafficUsed = computed(() => userInfo.value?.traffic_used || 0)
  const trafficLimit = computed(() => userInfo.value?.traffic_limit || 0)
  const trafficPercent = computed(() => userInfo.value?.traffic_percent || 0)

  function setToken(newToken) {
    token.value = newToken
    localStorage.setItem('user_token', newToken)
  }

  function clearToken() {
    token.value = ''
    userInfo.value = null
    localStorage.removeItem('user_token')
  }

  /**
   * 用户登录
   * @param {Object} loginData - 登录数据
   * @returns {Promise<Object>} 登录结果
   */
  async function login(loginData) {
    try {
      loading.value = true
      const response = await api.user.login(loginData)

      if (response.code === 0) {
        setToken(response.data.token)
        userInfo.value = response.data.user
        return { success: true, data: response.data }
      }

      return { success: false, message: response.message }
    } catch (error) {
      console.error('登录失败:', error)
      return { success: false, message: getErrorMessage(error, '登录失败') }
    } finally {
      loading.value = false
    }
  }

  /**
   * 用户注册并支付
   * @param {Object} registerData - 注册数据
   * @returns {Promise<Object>} 注册结果
   */
  async function registerAndPay(registerData) {
    try {
      loading.value = true
      const response = await api.user.registerAndPay(registerData)

      if (response.code === 0) {
        return { success: true, data: response.data }
      }

      return { success: false, message: response.message }
    } catch (error) {
      console.error('注册失败:', error)
      return { success: false, message: getErrorMessage(error, '注册失败') }
    } finally {
      loading.value = false
    }
  }

  /**
   * 获取用户个人信息
   * @returns {Promise<Object>} 用户信息
   */
  async function fetchUserProfile() {
    try {
      loading.value = true
      const response = await api.user.getProfile()

      if (response.code === 0) {
        userInfo.value = response.data
        return { success: true, data: response.data }
      }

      return { success: false, message: response.message }
    } catch (error) {
      console.error('获取用户信息失败:', error)
      return { success: false, message: getErrorMessage(error, '获取用户信息失败') }
    } finally {
      loading.value = false
    }
  }

  /**
   * 校验当前本地登录态是否仍然有效。
   * 核心分支：无 token 直接视为未登录；已有用户信息复用；后端拒绝时清空本地 token。
   * @returns {Promise<boolean>} token 可用时返回 true，否则返回 false
   */
  async function ensureValidSession() {
    return sessionValidator.ensureValidSession()
  }

  function logout() {
    clearToken()
  }

  return {
    token,
    userInfo,
    loading,
    isLoggedIn,
    userEmail,
    planName,
    expireAt,
    trafficUsed,
    trafficLimit,
    trafficPercent,
    setToken,
    clearToken,
    ensureValidSession,
    login,
    registerAndPay,
    fetchUserProfile,
    logout
  }
})
