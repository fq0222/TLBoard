const { BrevoClient } = require('@getbrevo/brevo')
const config = require('../../config')
const { createLogger } = require('../../utils/logger')
const emailRepository = require('../../repositories/email-repository')
const systemSettingsService = require('../../services/admin/system-settings-service')

const logger = createLogger('EMAIL-SERVICE')
const EMAIL_SEND_MAX_ATTEMPTS = 4
const EMAIL_RETRY_DELAYS_MS = [1000, 2000, 4000]
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504])
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET'
])

// 获取站点基础 URL
function getSiteBaseUrl() {
  const protocol = config.site?.protocol || 'http'
  const host = config.site?.host || 'localhost:30000'
  return `${protocol}://${host}`
}

class EmailService {
  constructor() {
    this.client = null
    this.clientSignature = ''
    this.initPromise = null
    this.retryDelay = wait
  }

  /**
   * 读取 Brevo 相关系统配置。
   *
   * @param {Object} db - 数据库代理对象
   * @returns {Promise<Object>} 配置键值对
   */
  async getConfig(db) {
    const emailConfig = await systemSettingsService.getEmailConfig(db)
    return {
      brevo_api_key: emailConfig.api_key,
      brevo_sender_email: emailConfig.sender_email,
      brevo_sender_name: emailConfig.sender_name,
      brevo_daily_limit: String(emailConfig.daily_limit),
      brevo_campaign_daily_limit: String(emailConfig.campaign_daily_limit)
    }
  }

  /**
   * 批量保存 Brevo 配置项。
   *
   * @param {Object} db - 数据库代理对象
   * @param {Object} config - 配置键值对
   * @returns {Promise<void>}
   */
  async saveConfig(db, config) {
    await systemSettingsService.saveEmailConfig(db, {
      api_key: config.brevo_api_key,
      sender_email: config.brevo_sender_email,
      sender_name: config.brevo_sender_name,
      daily_limit: config.brevo_daily_limit,
      campaign_daily_limit: config.brevo_campaign_daily_limit
    })
    this.invalidateClient()
  }

  /**
   * 生成 Brevo 客户端缓存签名。
   * 职责：API Key 变更时让旧客户端自然失效。
   *
   * @param {Object} config - Brevo 配置
   * @returns {string} 缓存签名
   */
  getClientSignature(config) {
    return String(config.brevo_api_key || '')
  }

  /**
   * 清空 Brevo 客户端缓存。
   * 职责：配置保存后强制下一次发送使用最新 API Key。
   *
   * @returns {void}
   */
  invalidateClient() {
    this.client = null
    this.clientSignature = ''
    this.initPromise = null
  }

  /**
   * 初始化或复用 Brevo 客户端，并返回默认发件人信息。
   * 核心分支：首次使用、强制刷新或 API Key 变更时重新初始化；并发初始化复用同一个 Promise。
   *
   * @param {Object} db - 数据库代理对象
   * @param {Object} [options={}] - 初始化选项
   * @param {boolean} [options.forceRefresh=false] - 是否强制刷新客户端
   * @returns {Promise<{senderEmail:string,senderName:string}>} 发件人配置
   */
  async initClient(db, options = {}) {
    const { forceRefresh = false } = options
    try {
      const config = await this.getConfig(db)
      if (!config.brevo_api_key) {
        throw new Error('Brevo API Key 未配置')
      }

      const signature = this.getClientSignature(config)
      const shouldInitialize = forceRefresh || !this.client || this.clientSignature !== signature
      if (shouldInitialize) {
        if (!this.initPromise) {
          this.initPromise = Promise.resolve().then(() => {
            this.client = new BrevoClient({
              apiKey: config.brevo_api_key,
              maxRetries: 0,
              timeoutInSeconds: 30
            })
            this.clientSignature = signature
            logger.info('Brevo 客户端初始化成功')
          }).finally(() => {
            this.initPromise = null
          })
        }
        await this.initPromise
      }

      return {
        senderEmail: config.brevo_sender_email,
        senderName: config.brevo_sender_name
      }
    } catch (error) {
      logger.error('Brevo 客户端初始化失败:', error.message)
      throw error
    }
  }

  /**
   * 发送单封 HTML 邮件。
   *
   * @param {Object} db - 数据库代理对象
   * @param {Object} payload - 发件参数
   * @returns {Promise<Object>} 发送结果
   */
  async sendEmail(db, { to, subject, content, senderEmail, senderName }) {
    const config = await this.initClient(db)

    try {
      const result = await this.sendTransacEmailWithRetry({
        subject: subject,
        htmlContent: content,
        sender: {
          email: senderEmail || config.senderEmail,
          name: senderName || config.senderName
        },
        to: [{ email: to }]
      }, to)
      logger.info(`邮件发送成功: ${to}`)
      return { success: true, messageId: result.messageId }
    } catch (error) {
      logger.error(`邮件发送失败: ${to}`, error.message)
      return { success: false, error: error.message }
    }
  }

  /**
   * 发送配置测试邮件。
   *
   * @param {Object} db - 数据库代理对象
   * @param {{to:string}} payload - 收件参数
   * @returns {Promise<Object>} 发送结果
   */
  async sendTestEmail(db, { to }) {
    logger.info(`发送测试邮件: ${to}`)
    const subject = '测试邮件 - 机场面板'
    const content = '<h1>测试邮件</h1><p>这是一封测试邮件，用于验证 Brevo 配置是否正确。</p>'
    return await this.sendEmail(db, { to, subject, content })
  }

  /**
   * 使用可控重试发送 Brevo 事务邮件。
   * 核心分支：仅对网络失败、超时、限流和 5xx 等可恢复错误重试，业务/配置错误立即返回。
   *
   * @param {Object} payload - Brevo 事务邮件参数
   * @param {string} to - 收件邮箱，用于日志定位
   * @returns {Promise<Object>} Brevo 发送结果
   */
  async sendTransacEmailWithRetry(payload, to) {
    let lastError
    for (let attempt = 1; attempt <= EMAIL_SEND_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.client.transactionalEmails.sendTransacEmail(payload)
      } catch (error) {
        lastError = error
        const canRetry = attempt < EMAIL_SEND_MAX_ATTEMPTS && this.isRetryableSendError(error)
        if (!canRetry) {
          throw error
        }

        const delayMs = EMAIL_RETRY_DELAYS_MS[attempt - 1]
        logger.warn(`邮件发送可重试失败: ${to}, attempt=${attempt}/${EMAIL_SEND_MAX_ATTEMPTS}, delay=${delayMs}ms, error=${error.message}`)
        await this.retryDelay(delayMs)
      }
    }

    throw lastError
  }

  /**
   * 判断 Brevo 发送异常是否适合重试。
   * 核心分支：HTTP 响应类错误按状态码判断；未拿到响应的 fetch/网络错误按名称、code 和 message 判断。
   *
   * @param {Error} error - Brevo 或 fetch 抛出的异常
   * @returns {boolean} 是否可重试
   */
  isRetryableSendError(error) {
    const statusCode = Number(error?.statusCode || error?.status || error?.rawResponse?.status)
    if (RETRYABLE_STATUS_CODES.has(statusCode)) {
      return true
    }

    const errorCode = error?.code || error?.cause?.code
    if (RETRYABLE_ERROR_CODES.has(errorCode)) {
      return true
    }

    const errorName = String(error?.name || '')
    if (errorName === 'AbortError' || errorName === 'TimeoutError') {
      return true
    }

    const message = String(error?.message || '').toLowerCase()
    return message.includes('fetch failed') || message.includes('network') || message.includes('timeout')
  }

  /**
   * 测试专用：替换重试等待函数，避免单元测试真实等待 7 秒。
   *
   * @param {Function} delayFn - 接收毫秒数并返回 Promise 的等待函数
   * @returns {void}
   */
  setRetryDelayForTest(delayFn) {
    this.retryDelay = delayFn
  }

  /**
   * 使用变量字典替换模板中的 `{{key}}` 占位符。
   *
   * @param {string} content - 原始模板内容
   * @param {Object} variables - 变量字典
   * @returns {string} 替换后的内容
   */
  replaceVariables(content, variables) {
    let result = content
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
    }
    return result
  }

  /**
   * 查询用户邮件模板所需变量。
   *
   * @param {Object} db - 数据库代理对象
   * @param {number} userId - 用户 ID
   * @returns {Promise<Object|null>} 模板变量
   */
  async getUserVariables(db, userId) {
    const user = await emailRepository.findEmailUserProfileById(db, userId)
    if (!user) return null

    const username = user.email.split('@')[0]
    const formatTraffic = (bytes) => {
      if (!bytes || bytes === 0) return '0 B'
      const gb = bytes / (1024 * 1024 * 1024)
      return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    }

    // 获取用户有效的下载链接
    const now = Math.floor(Date.now() / 1000)
    const downloadUrl = await emailRepository.findLatestActiveDownloadTokenByUserId(db, userId, now)

    const siteBaseUrl = getSiteBaseUrl()

    return {
      username,
      email: user.email,
      user_id: userId.toString(),
      plan_name: user.plan_name || '无套餐',
      expire_date: user.expire_at ? new Date(user.expire_at * 1000).toLocaleDateString('zh-CN') : '无限期',
      traffic_used: formatTraffic(user.traffic_used),
      traffic_limit: formatTraffic(user.traffic_limit),
      download_url: downloadUrl ? `${siteBaseUrl}/api/user/download/${downloadUrl.download_token}` : ''
    }
  }
}

/**
 * 等待指定毫秒数。
 *
 * @param {number} delayMs - 等待毫秒数
 * @returns {Promise<void>}
 */
function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

module.exports = new EmailService()
