/**
 * 管理员状态管理
 * 管理管理员登录状态和权限信息
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/api'

export const useAdminStore = defineStore('admin', () => {
  // 状态
  const token = ref(localStorage.getItem('admin_token') || '')
  const adminInfo = ref(null)
  const loading = ref(false)

  // 计算属性
  const isLoggedIn = computed(() => !!token.value)
  const username = computed(() => adminInfo.value?.username || '')
  const isSuper = computed(() => adminInfo.value?.is_super || false)

  /**
   * 设置Token
   * @param {string} newToken - JWT Token
   */
  function setToken(newToken) {
    token.value = newToken
    localStorage.setItem('admin_token', newToken)
  }

  /**
   * 清除Token
   */
  function clearToken() {
    token.value = ''
    adminInfo.value = null
    localStorage.removeItem('admin_token')
  }

  /**
   * 管理员登录
   * @param {Object} loginData - 登录数据
   * @param {string} loginData.username - 用户名
   * @param {string} loginData.password - 密码
   * @returns {Promise<Object>} 登录结果
   */
  async function login(loginData) {
    try {
      loading.value = true
      const response = await api.admin.login(loginData)
      
      if (response.code === 0) {
        setToken(response.data.token)
        adminInfo.value = response.data.admin
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
   * 修改密码
   * @param {Object} passwordData - 密码数据
   * @param {string} passwordData.old_password - 原密码
   * @param {string} passwordData.new_password - 新密码
   * @returns {Promise<Object>} 修改结果
   */
  async function changePassword(passwordData) {
    try {
      loading.value = true
      const response = await api.admin.changePassword(passwordData)
      
      if (response.code === 0) {
        return { success: true, data: response.data }
      } else {
        return { success: false, message: response.message }
      }
    } catch (error) {
      console.error('修改密码失败:', error)
      return { success: false, message: error.message || '修改密码失败' }
    } finally {
      loading.value = false
    }
  }

  /**
   * 管理员登出
   */
  function logout() {
    clearToken()
    // 可以在这里添加其他清理逻辑
  }

  return {
    // 状态
    token,
    adminInfo,
    loading,
    
    // 计算属性
    isLoggedIn,
    username,
    isSuper,
    
    // 方法
    setToken,
    clearToken,
    login,
    changePassword,
    logout
  }
})