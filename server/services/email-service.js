const brevo = require('@getbrevo/brevo')
const { createLogger } = require('../utils/logger')

const logger = createLogger('EMAIL-SERVICE')

class EmailService {
  constructor() {
    this.apiInstance = null
  }

  async getConfig(db) {
    const result = await db.query(
      "SELECT key, value FROM system_settings WHERE key LIKE 'brevo_%'"
    )
    const config = {}
    result.rows.forEach(row => {
      config[row.key] = row.value
    })
    return config
  }

  async saveConfig(db, config) {
    const now = Math.floor(Date.now() / 1000)
    for (const [key, value] of Object.entries(config)) {
      await db.query(
        `INSERT INTO system_settings (key, value, updated_at) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3`,
        [key, value, now]
      )
    }
  }

  async initClient(db) {
    try {
      const config = await this.getConfig(db)
      if (!config.brevo_api_key) {
        throw new Error('Brevo API Key 未配置')
      }

      const defaultClient = brevo.ApiClient.instance
      const apiKey = defaultClient.authentications['api-key']
      apiKey.apiKey = config.brevo_api_key
      this.apiInstance = new brevo.TransactionalEmailsApi()

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

  async sendEmail(db, { to, subject, content, senderEmail, senderName }) {
    if (!this.apiInstance) {
      await this.initClient(db)
    }

    const config = await this.getConfig(db)
    const sendSmtpEmail = new brevo.SendSmtpEmail()

    sendSmtpEmail.subject = subject
    sendSmtpEmail.htmlContent = content
    sendSmtpEmail.sender = {
      email: senderEmail || config.brevo_sender_email,
      name: senderName || config.brevo_sender_name
    }
    sendSmtpEmail.to = [{ email: to }]

    try {
      const result = await this.apiInstance.sendTransacEmail(sendSmtpEmail)
      logger.info(`邮件发送成功: ${to}`)
      return { success: true, messageId: result.messageId }
    } catch (error) {
      logger.error(`邮件发送失败: ${to}`, error.message)
      return { success: false, error: error.message }
    }
  }

  async sendTestEmail(db, { to }) {
    logger.info(`发送测试邮件: ${to}`)
    await this.initClient(db)
    const subject = '测试邮件 - 机场面板'
    const content = '<h1>测试邮件</h1><p>这是一封测试邮件，用于验证 Brevo 配置是否正确。</p>'
    return await this.sendEmail(db, { to, subject, content })
  }

  replaceVariables(content, variables) {
    let result = content
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
    }
    return result
  }

  async getUserVariables(db, userId) {
    const result = await db.query(
      `SELECT u.email, u.plan_id, u.traffic_used, u.traffic_limit, u.expire_at,
              p.name as plan_name
       FROM users u
       LEFT JOIN plans p ON u.plan_id = p.id
       WHERE u.id = $1`,
      [userId]
    )
    const user = result.rows[0]
    if (!user) return null

    const username = user.email.split('@')[0]
    const formatTraffic = (bytes) => {
      if (!bytes || bytes === 0) return '0 B'
      const gb = bytes / (1024 * 1024 * 1024)
      return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    }

    return {
      username,
      email: user.email,
      user_id: userId.toString(),
      plan_name: user.plan_name || '无套餐',
      expire_date: user.expire_at ? new Date(user.expire_at * 1000).toLocaleDateString('zh-CN') : '无限期',
      traffic_used: formatTraffic(user.traffic_used),
      traffic_limit: formatTraffic(user.traffic_limit)
    }
  }
}

module.exports = new EmailService()
