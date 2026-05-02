/**
 * 用户端API封装
 * 统一管理所有API请求
 */

import axios from 'axios'
import { ElMessage } from 'element-plus'

// 创建axios实例
const apiClient = axios.create({
  baseURL: '/api/user',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// 请求拦截器
apiClient.interceptors.request.use(
  (config) => {
    // 从localStorage获取token
    const token = localStorage.getItem('user_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    console.error('请求拦截器错误:', error)
    return Promise.reject(error)
  }
)

// 响应拦截器
apiClient.interceptors.response.use(
  (response) => {
    return response.data
  },
  (error) => {
    console.error('响应拦截器错误:', error)
    
    if (error.response) {
      const { status, data } = error.response
      
      switch (status) {
        case 401:
          // Token无效或过期，清除token并跳转到登录页
          localStorage.removeItem('user_token')
          window.location.href = '/login'
          break
        case 403:
          ElMessage.error('没有权限访问')
          break
        case 404:
          ElMessage.error('请求的资源不存在')
          break
        case 429:
          ElMessage.error('请求过于频繁，请稍后再试')
          break
        case 500:
          ElMessage.error('服务器内部错误')
          break
        default:
          ElMessage.error(data?.message || '请求失败')
      }
    } else if (error.code === 'ECONNABORTED') {
      ElMessage.error('请求超时，请检查网络连接')
    } else {
      ElMessage.error('网络连接失败')
    }
    
    return Promise.reject(error)
  }
)

/**
 * 用户端API
 */
const userApi = {
  /**
   * 用户登录
   * @param {Object} data - 登录数据
   * @param {string} data.email - 邮箱
   * @param {string} data.password - 密码
   * @returns {Promise<Object>} 响应数据
   */
  login(data) {
    return apiClient.post('/login', data)
  },

  /**
   * 用户注册并支付
   * @param {Object} data - 注册数据
   * @param {string} data.email - 邮箱
   * @param {string} data.password - 密码
   * @param {number} data.plan_id - 套餐ID
   * @returns {Promise<Object>} 响应数据
   */
  registerAndPay(data) {
    return apiClient.post('/register-and-pay', data)
  },

  /**
   * 获取用户个人信息
   * @returns {Promise<Object>} 响应数据
   */
  getProfile() {
    return apiClient.get('/profile')
  },

  /**
   * 获取套餐列表
   * @returns {Promise<Object>} 响应数据
   */
  getPlans() {
    return apiClient.get('/plans')
  },

  /**
   * 获取公告列表
   * @param {Object} params - 查询参数
   * @param {number} params.page - 页码
   * @param {number} params.limit - 每页条数
   * @returns {Promise<Object>} 响应数据
   */
  getAnnouncements(params) {
    return apiClient.get('/announcements', { params })
  },

  /**
   * 获取订单列表
   * @param {Object} params - 查询参数
   * @param {number} params.page - 页码
   * @param {number} params.limit - 每页条数
   * @param {string} params.status - 订单状态
   * @returns {Promise<Object>} 响应数据
   */
  getOrders(params) {
    return apiClient.get('/orders', { params })
  },

  /**
   * 轮询订单状态
   * @param {number} orderId - 订单ID
   * @returns {Promise<Object>} 响应数据
   */
  getOrderStatus(orderId) {
    return apiClient.get(`/orders/${orderId}/status`)
  },

  /**
   * 获取订阅信息
   * @returns {Promise<Object>} 响应数据
   */
  getSubscription() {
    return apiClient.get('/subscription')
  },

  /**
   * 获取CF优选IP池
   * @returns {Promise<Object>} 响应数据
   */
  getCfIps() {
    return apiClient.get('/cf-ips')
  },

  /**
   * 测试CF IP延迟
   * @param {Array} ips - IP列表
   * @returns {Promise<Object>} 响应数据
   */
  testCfIps(ips) {
    return apiClient.post('/cf-ips/test', { ips })
  },

  /**
   * 应用CF优选IP
   * @param {Array} ipIds - IP ID列表
   * @returns {Promise<Object>} 响应数据
   */
  applyCfIps(ipIds) {
    return apiClient.post('/cf-ips/apply', { ip_ids: ipIds })
  }
}

export default {
  user: userApi
}