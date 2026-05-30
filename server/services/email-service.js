const { BrevoClient } = require('@getbrevo/brevo')
const config = require('../config')
const { createLogger } = require('../utils/logger')
const emailRepository = require('../repositories/email-repository')

const logger = createLogger('EMAIL-SERVICE')

// 获取站点基础 URL
function getSiteBaseUrl() {
  const protocol = config.site?.protocol || 'http'
  const host = config.site?.host || 'localhost:30000'
  return `${protocol}://${host}`
}

class EmailService {
  constructor() {
    this.client = null
  }

  /**
   * 读取 Brevo 相关系统配置。
   *
   * @param {Object} db - 数据库代理对象
   * @returns {Promise<Object>} 配置键值对
   */
  async getConfig(db) {
    const rows = await emailRepository.getBrevoConfigRows(db)
    const config = {}
    rows.forEach(row => {
      config[row.key] = row.value
    })
    return config
  }

  /**
   * 批量保存 Brevo 配置项。
   *
   * @param {Object} db - 数据库代理对象
   * @param {Object} config - 配置键值对
   * @returns {Promise<void>}
   */
  async saveConfig(db, config) {
    const now = Math.floor(Date.now() / 1000)
    for (const [key, value] of Object.entries(config)) {
      await emailRepository.saveBrevoConfigValue(db, key, value, now)
    }
  }

  /**
   * 初始化 Brevo 客户端并返回默认发件人信息。
   *
   * @param {Object} db - 数据库代理对象
   * @returns {Promise<{senderEmail:string,senderName:string}>} 发件人配置
   */
  async initClient(db) {
    try {
      const config = await this.getConfig(db)
      if (!config.brevo_api_key) {
        throw new Error('Brevo API Key 未配置')
      }

      this.client = new BrevoClient({
        apiKey: config.brevo_api_key
      })

      logger.info('Brevo 客户端初始化成功')
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
    if (!this.client) {
      await this.initClient(db)
    }

    const config = await this.getConfig(db)

    try {
      const result = await this.client.transactionalEmails.sendTransacEmail({
        subject: subject,
        htmlContent: content,
        sender: {
          email: senderEmail || config.brevo_sender_email,
          name: senderName || config.brevo_sender_name
        },
        to: [{ email: to }]
      })
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
    await this.initClient(db)
    const subject = '测试邮件 - 机场面板'
    const content = '<h1>测试邮件</h1><p>这是一封测试邮件，用于验证 Brevo 配置是否正确。</p>'
    return await this.sendEmail(db, { to, subject, content })
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

module.exports = new EmailService()
