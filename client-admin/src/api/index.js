/**
 * 管理端API封装
 * 统一管理所有API请求
 */

import axios from 'axios'
import { ElMessage } from 'element-plus'

// 创建axios实例
const apiClient = axios.create({
  baseURL: '/api/admin',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// 请求拦截器
apiClient.interceptors.request.use(
  (config) => {
    // 从localStorage获取token
    const token = localStorage.getItem('admin_token')
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
          localStorage.removeItem('admin_token')
          window.location.href = '/admin/login'
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
 * 管理端API
 */
const adminApi = {
  /**
   * 管理员登录
   * @param {Object} data - 登录数据
   * @param {string} data.username - 用户名
   * @param {string} data.password - 密码
   * @returns {Promise<Object>} 响应数据
   */
  login(data) {
    return apiClient.post('/login', data)
  },

  /**
   * 修改密码
   * @param {Object} data - 密码数据
   * @param {string} data.old_password - 原密码
   * @param {string} data.new_password - 新密码
   * @returns {Promise<Object>} 响应数据
   */
  changePassword(data) {
    return apiClient.put('/password', data)
  },

  /**
   * 获取管理员列表
   * @returns {Promise<Object>} 响应数据
   */
  getAdmins() {
    return apiClient.get('/admins')
  },

  /**
   * 添加管理员
   * @param {Object} data - 管理员数据
   * @param {string} data.username - 用户名
   * @param {string} data.password - 密码
   * @param {boolean} data.is_super - 是否超级管理员
   * @returns {Promise<Object>} 响应数据
   */
  addAdmin(data) {
    return apiClient.post('/admins', data)
  },

  /**
   * 删除管理员
   * @param {number} id - 管理员ID
   * @returns {Promise<Object>} 响应数据
   */
  deleteAdmin(id) {
    return apiClient.delete(`/admins/${id}`)
  },

  /**
   * 获取服务器列表
   * @returns {Promise<Object>} 响应数据
   */
  getServers() {
    return apiClient.get('/servers')
  },

  /**
   * 添加服务器
   * @param {Object} data - 服务器数据
   * @param {string} data.name - 服务器名称
   * @param {string} data.api_url - 面板地址
   * @param {string} data.api_username - API用户名
   * @param {string} data.api_password - API密码
   * @returns {Promise<Object>} 响应数据
   */
  addServer(data) {
    return apiClient.post('/servers', data)
  },

  /**
   * 修改服务器
   * @param {number} id - 服务器ID
   * @param {Object} data - 服务器数据
   * @returns {Promise<Object>} 响应数据
   */
  updateServer(id, data) {
    return apiClient.put(`/servers/${id}`, data)
  },

  /**
   * 删除服务器
   * @param {number} id - 服务器ID
   * @returns {Promise<Object>} 响应数据
   */
  deleteServer(id) {
    return apiClient.delete(`/servers/${id}`)
  },

  /**
   * 获取服务器详情
   * @param {number} id - 服务器ID
   * @returns {Promise<Object>} 响应数据
   */
  getServerDetail(id) {
    return apiClient.get(`/servers/${id}/detail`)
  },

  /**
   * 同步服务器状态
   * @param {number} id - 服务器ID
   * @returns {Promise<Object>} 响应数据
   */
  syncServer(id) {
    return apiClient.post(`/servers/${id}/sync`)
  },

  /**
   * 更新3X-UI用户信息
   * @param {number} serverId - 服务器ID
   * @param {Object} data - 用户数据
   * @param {number} data.inboundId - 入站ID
   * @param {string} data.email - 用户标识
   * @param {number} data.expiryTime - 到期时间戳
   * @param {number} data.totalGB - 流量上限(GB)
   * @param {boolean} data.enabled - 是否启用
   * @returns {Promise<Object>} 响应数据
   */
  updateXuiUser(serverId, data) {
    return apiClient.put(`/servers/${serverId}/users`, data)
  },

  /**
   * 删除3X-UI用户
   * @param {number} serverId - 服务器ID
   * @param {Object} data - 用户数据
   * @param {number} data.inboundId - 入站ID
   * @param {string} data.email - 用户标识
   * @returns {Promise<Object>} 响应数据
   */
  deleteXuiUser(serverId, data) {
    return apiClient.delete(`/servers/${serverId}/users`, { data })
  },

  /**
   * 获取套餐列表
   * @returns {Promise<Object>} 响应数据
   */
  getPlans() {
    return apiClient.get('/plans')
  },

  /**
   * 添加套餐
   * @param {Object} data - 套餐数据
   * @returns {Promise<Object>} 响应数据
   */
  addPlan(data) {
    return apiClient.post('/plans', data)
  },

  /**
   * 修改套餐
   * @param {number} id - 套餐ID
   * @param {Object} data - 套餐数据
   * @returns {Promise<Object>} 响应数据
   */
  updatePlan(id, data) {
    return apiClient.put(`/plans/${id}`, data)
  },

  /**
   * 删除套餐
   * @param {number} id - 套餐ID
   * @returns {Promise<Object>} 响应数据
   */
  deletePlan(id) {
    return apiClient.delete(`/plans/${id}`)
  },

  /**
   * 获取用户列表
   * @param {Object} params - 查询参数
   * @returns {Promise<Object>} 响应数据
   */
  getUsers(params) {
    return apiClient.get('/users', { params })
  },

  /**
   * 获取用户详情
   * @param {number} id - 用户ID
   * @returns {Promise<Object>} 响应数据
   */
  getUserDetail(id) {
    return apiClient.get(`/users/${id}`)
  },

  /**
   * 修改用户信息
   * @param {number} id - 用户ID
   * @param {Object} data - 用户数据
   * @returns {Promise<Object>} 响应数据
   */
  updateUser(id, data) {
    return apiClient.put(`/users/${id}`, data)
  },

  /**
   * 获取订单列表
   * @param {Object} params - 查询参数
   * @returns {Promise<Object>} 响应数据
   */
  getOrders(params) {
    return apiClient.get('/orders', { params })
  },

  /**
   * 获取公告列表
   * @param {Object} params - 查询参数
   * @returns {Promise<Object>} 响应数据
   */
  getAnnouncements(params) {
    return apiClient.get('/announcements', { params })
  },

  /**
   * 添加公告
   * @param {Object} data - 公告数据
   * @returns {Promise<Object>} 响应数据
   */
  addAnnouncement(data) {
    return apiClient.post('/announcements', data)
  },

  /**
   * 修改公告
   * @param {number} id - 公告ID
   * @param {Object} data - 公告数据
   * @returns {Promise<Object>} 响应数据
   */
  updateAnnouncement(id, data) {
    return apiClient.put(`/announcements/${id}`, data)
  },

  /**
   * 删除公告
   * @param {number} id - 公告ID
   * @returns {Promise<Object>} 响应数据
   */
  deleteAnnouncement(id) {
    return apiClient.delete(`/announcements/${id}`)
  },

  /**
   * 获取CF IP池列表
   * @param {Object} params - 查询参数
   * @returns {Promise<Object>} 响应数据
   */
  getCfIps(params) {
    return apiClient.get('/cf-ips', { params })
  },

  /**
   * 添加CF IP
   * @param {Object} data - IP数据
   * @returns {Promise<Object>} 响应数据
   */
  addCfIp(data) {
    return apiClient.post('/cf-ips', data)
  },

  /**
   * 修改CF IP
   * @param {number} id - IP ID
   * @param {Object} data - IP数据
   * @returns {Promise<Object>} 响应数据
   */
  updateCfIp(id, data) {
    return apiClient.put(`/cf-ips/${id}`, data)
  },

  /**
   * 删除CF IP
   * @param {number} id - IP ID
   * @returns {Promise<Object>} 响应数据
   */
  deleteCfIp(id) {
    return apiClient.delete(`/cf-ips/${id}`)
  },

  /**
   * 批量导入CF IP
   * @param {Object} data - 导入数据
   * @returns {Promise<Object>} 响应数据
   */
  importCfIps(data) {
    return apiClient.post('/cf-ips/import', data)
  }
}

export default {
  admin: adminApi
}