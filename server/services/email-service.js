const { BrevoClient } = require('@getbrevo/brevo')
const { createLogger } = require('../utils/logger')

const logger = createLogger('EMAIL-SERVICE')

class EmailService {
  constructor() {
    this.client = null
  }

  async getConfig(db) {
    const rows = await db.prepare(
      "SELECT key, value FROM system_settings WHERE key LIKE 'brevo_%'"
    ).all()
    const config = {}
    rows.forEach(row => {
      config[row.key] = row.value
    })
    return config
  }

  async saveConfig(db, config) {
    const now = Math.floor(Date.now() / 1000)
    for (const [key, value] of Object.entries(config)) {
      await db.pool.query(
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
    const user = await db.prepare(
      `SELECT u.email, u.plan_id, u.traffic_used, u.traffic_limit, u.expire_at,
              p.name as plan_name
       FROM users u
       LEFT JOIN plans p ON u.plan_id = p.id
       WHERE u.id = ?`
    ).get(userId)
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
