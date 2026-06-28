/**
 * 用户端 API 封装
 * 统一管理所有 API 请求
 */

import axios from 'axios'
import { ElMessage } from 'element-plus'

const apiClient = axios.create({
  baseURL: '/api/user',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
})

apiClient.interceptors.request.use(
  (config) => {
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

apiClient.interceptors.response.use(
  (response) => response.data,
  (error) => {
    console.error('响应拦截器错误:', error)

    let userMessage = '请求失败'

    if (error.response) {
      const { status, data } = error.response
      userMessage = data?.message || userMessage

      switch (status) {
        case 400:
          // 400 多为表单校验错误，交给具体页面决定如何提示，避免重复弹窗
          break
        case 409:
          // 4091 用于续费重置确认，交给续费页面弹出确认内容；其他 409 仍正常提示。
          if (Number(data?.code) !== 4091) {
            ElMessage.error(userMessage)
          }
          break
        case 401:
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
          ElMessage.error(userMessage)
      }
    } else if (error.code === 'ECONNABORTED') {
      userMessage = '请求超时，请检查网络连接'
      ElMessage.error(userMessage)
    } else {
      userMessage = '网络连接失败'
      ElMessage.error(userMessage)
    }

    // 将后端返回的业务提示挂到错误对象，供 store 和页面优先展示
    error.userMessage = userMessage
    return Promise.reject(error)
  }
)

const userApi = {
  /**
   * 用户登录
   * @param {Object} data - 登录数据
   * @returns {Promise<Object>} 响应数据
   */
  login(data) {
    return apiClient.post('/login', data)
  },

  /**
   * 用户注册并支付
   * @param {Object} data - 注册数据
   * @returns {Promise<Object>} 响应数据
   */
  registerAndPay(data) {
    return apiClient.post('/register-and-pay', data, { timeout: 30000 })
  },

  /**
   * 申请密码重置邮件
   * @param {Object} data - 申请数据
   * @param {string} data.email - 用户邮箱
   * @returns {Promise<Object>} 统一模糊提示响应
   */
  requestPasswordReset(data) {
    return apiClient.post('/forgot-password', data)
  },

  /**
   * 使用一次性 Token 重置密码
   * @param {Object} data - 重置数据
   * @param {string} data.token - 邮件链接中的一次性 Token
   * @param {string} data.password - 新密码
   * @returns {Promise<Object>} 重置结果
   */
  resetPassword(data) {
    return apiClient.post('/reset-password', data)
  },

  /**
   * 获取匿名公开设置
   * @returns {Promise<Object>} 公开设置响应
   */
  getPublicSettings() {
    return apiClient.get('/public-settings')
  },

  /**
   * 获取用户个人信息
   * @returns {Promise<Object>} 响应数据
   */
  getProfile() {
    return apiClient.get('/profile')
  },

  /**
   * 标记当前账号已完成新手引导
   * @returns {Promise<Object>} 响应数据
   */
  completeOnboarding() {
    return apiClient.post('/onboarding/complete')
  },

  /**
   * 获取套餐列表
   * @returns {Promise<Object>} 响应数据
   */
  getPlans() {
    return apiClient.get('/plans')
  },

  /**
   * 获取当前账号可续费套餐列表
   * @returns {Promise<Object>} 同类型续费套餐响应
   */
  getRenewPlans() {
    return apiClient.get('/renew/plans')
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
   * 获取当前用户首页公告弹窗信息。
   * @returns {Promise<Object>} 公告弹窗判断结果
   */
  getLatestAnnouncementPopup() {
    return apiClient.get('/announcements/popup/latest')
  },

  /**
   * 上报用户已关闭公告弹窗。
   * @param {number|string} id - 公告 ID
   * @returns {Promise<Object>} 上报结果
   */
  reportAnnouncementPopupClose(id) {
    return apiClient.post(`/announcements/${id}/popup-close`, {})
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
   * 登录态下轮询订单状态
   * @param {number|string} orderId - 订单 ID
   * @returns {Promise<Object>} 响应数据
   */
  getOrderStatus(orderId) {
    return apiClient.get(`/orders/${orderId}/status`)
  },

  /**
   * 公共轮询订单状态
   * 用于支付页在未登录状态下查询订单支付结果
   * @param {string} orderId - 订单 ID 或商户订单号
   * @returns {Promise<Object>} 响应数据
   */
  getPublicOrderStatus(orderId) {
    return apiClient.get(`/orders/status/${orderId}`)
  },

  /**
   * 获取订阅信息
   * @returns {Promise<Object>} 响应数据
   */
  getSubscription() {
    return apiClient.get('/subscription')
  },

  /**
   * 生成订阅链接（会同步节点信息）
   * @returns {Promise<Object>} 响应数据
   */
  generateSubscription() {
    return apiClient.post('/subscription/generate', {}, { timeout: 120000 })
  },

  /**
   * 获取 CF IP 池
   * @returns {Promise<Object>} 响应数据
   */
  getCfIps() {
    return apiClient.get('/cf-ips')
  },

  /**
   * 测试 CF IP 延迟
   * @param {Array} ips - IP 列表
   * @returns {Promise<Object>} 响应数据
   */
  testCfIps(ips) {
    return apiClient.post('/cf-ips/test', { ips })
  },

  /**
   * 应用 CF 优选 IP
   * @param {Array} ipIds - IP ID 列表
   * @returns {Promise<Object>} 响应数据
   */
  applyCfIps(ipIds) {
    return apiClient.post('/cf-ips/apply', { ip_ids: ipIds }, { timeout: 60000 })
  },

  /**
   * 用户续费
   * @param {Object} data - 续费数据
   * @param {number} data.plan_id - 套餐ID
   * @param {boolean} [data.confirm_reset] - 是否确认重置限时套餐权益
   * @returns {Promise<Object>} 响应数据
   */
  renew(data) {
    return apiClient.post('/renew', data)
  },

  /**
   * 获取同步状态
   * @returns {Promise<Object>} 响应数据
   */
  getSyncStatus() {
    return apiClient.get('/sync-status')
  },

  /**
   * 获取当前用户推广概览
   * @returns {Promise<Object>} 响应数据
   */
  getReferralSummary() {
    return apiClient.get('/referral')
  },

  /**
   * 获取当前用户推广奖励明细
   * @param {Object} params - 查询参数
   * @returns {Promise<Object>} 响应数据
   */
  getReferralRewards(params) {
    return apiClient.get('/referral/rewards', { params })
  },

  /**
   * 记录推广链接点击，用于后续首单归因统计。
   * @param {string} code - 推广码
   * @returns {Promise<Object>} 响应数据
   */
  recordReferralClick(code) {
    return apiClient.post('/referral/click', { code })
  },

  /**
   * 获取未读工单数量
   * @returns {Promise<Object>} 响应数据
   */
  getTicketUnreadCount() {
    return apiClient.get('/tickets/unread-count')
  },

  /**
   * 获取工单列表
   * @param {Object} params - 查询参数
   * @returns {Promise<Object>} 响应数据
   */
  getTickets(params) {
    return apiClient.get('/tickets', { params })
  },

  /**
   * 创建工单
   * @param {Object} data - 工单数据
   * @returns {Promise<Object>} 响应数据
   */
  createTicket(data) {
    return apiClient.post('/tickets', data)
  },

  /**
   * 获取工单详情
   * @param {number} id - 工单ID
   * @returns {Promise<Object>} 响应数据
   */
  getTicketDetail(id) {
    return apiClient.get(`/tickets/${id}`)
  },

  /**
   * 回复工单
   * @param {number} id - 工单ID
   * @param {Object} data - 回复数据
   * @returns {Promise<Object>} 响应数据
   */
  replyTicket(id, data) {
    return apiClient.post(`/tickets/${id}/replies`, data)
  },

  /**
   * 关闭工单
   * @param {number} id - 工单ID
   * @returns {Promise<Object>} 响应数据
   */
  closeTicket(id) {
    return apiClient.put(`/tickets/${id}/close`)
  },

  /**
   * 获取帮助页下载资源列表
   * @returns {Promise<Object>} 响应数据
   */
  getDownloadResources() {
    return apiClient.get('/download/resources')
  },

  /**
   * 按资源 ID 获取下载链接
   * @param {number|string} resourceId - 下载资源 ID
   * @returns {Promise<Object>} 响应数据
   */
  getDownloadLink(resourceId) {
    return apiClient.post(`/download/link/${resourceId}`, {}, { timeout: 30000 })
  },

  /**
   * 获取帮助中心文章列表
   * @param {Object} params - 查询参数
   * @returns {Promise<Object>} 响应数据
   */
  getHelpArticles(params) {
    return apiClient.get('/help/articles', { params })
  },

  /**
   * 获取帮助文章详情
   * @param {number|string} id - 文章ID
   * @returns {Promise<Object>} 响应数据
   */
  getHelpArticle(id) {
    return apiClient.get(`/help/articles/${id}`)
  },

  /**
   * 获取帮助中心分类
   * @returns {Promise<Object>} 响应数据
   */
  getHelpCategories() {
    return apiClient.get('/help/categories')
  }
}

export default {
  user: userApi
}
