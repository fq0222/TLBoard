/**
 * 用户状态管理
 * 管理用户登录状态、个人信息和订阅信息
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/api'

export const useUserStore = defineStore('user', () => {
  // 状态
  const token = ref(localStorage.getItem('user_token') || '')
  const userInfo = ref(null)
  const loading = ref(false)

  // 计算属性
  const isLoggedIn = computed(() => !!token.value)
  const userEmail = computed(() => userInfo.value?.email || '')
  const planName = computed(() => userInfo.value?.plan_name || '')
  const expireAt = computed(() => userInfo.value?.expire_at || null)
  const trafficUsed = computed(() => userInfo.value?.traffic_used || 0)
  const trafficLimit = computed(() => userInfo.value?.traffic_limit || 0)
  const trafficPercent = computed(() => userInfo.value?.traffic_percent || 0)

  /**
   * 设置Token
   * @param {string} newToken - JWT Token
   */
  function setToken(newToken) {
    token.value = newToken
    localStorage.setItem('user_token', newToken)
  }

  /**
   * 清除Token
   */
  function clearToken() {
    token.value = ''
    userInfo.value = null
    localStorage.removeItem('user_token')
  }

  /**
   * 用户登录
   * @param {Object} loginData - 登录数据
   * @param {string} loginData.email - 邮箱
   * @param {string} loginData.password - 密码
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
      } else {
        return { success: false, message: response.message }
      }
    } catch (error) {
      console.error('登录失败:', error)
      return { success: false, message: error.message || '登录失败' }
    } finally {
      loading.value = false
    }
  }

  /**
   * 用户注册并支付
   * @param {Object} registerData - 注册数据
   * @param {string} registerData.email - 邮箱
   * @param {string} registerData.password - 密码
   * @param {number} registerData.plan_id - 套餐ID
   * @returns {Promise<Object>} 注册结果
   */
  async function registerAndPay(registerData) {
    try {
      loading.value = true
      const response = await api.user.registerAndPay(registerData)
      
      if (response.code === 0) {
        return { success: true, data: response.data }
      } else {
        return { success: false, message: response.message }
      }
    } catch (error) {
      console.error('注册失败:', error)
      return { success: false, message: error.message || '注册失败' }
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
      } else {
        return { success: false, message: response.message }
      }
    } catch (error) {
      console.error('获取用户信息失败:', error)
      return { success: false, message: error.message || '获取用户信息失败' }
    } finally {
      loading.value = false
    }
  }

  /**
   * 用户登出
   */
  function logout() {
    clearToken()
    // 可以在这里添加其他清理逻辑
  }

  return {
    // 状态
    token,
    userInfo,
    loading,
    
    // 计算属性
    isLoggedIn,
    userEmail,
    planName,
    expireAt,
    trafficUsed,
    trafficLimit,
    trafficPercent,
    
    // 方法
    setToken,
    clearToken,
    login,
    registerAndPay,
    fetchUserProfile,
    logout
  }
})