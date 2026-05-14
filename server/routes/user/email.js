const express = require('express')
const crypto = require('crypto')
const router = express.Router()
const emailService = require('../../services/email-service')
const { authenticateUser } = require('../../middleware/auth-user')
const { createLogger } = require('../../utils/logger')

const logger = createLogger('USER-EMAIL')

// 预设模板白名单
const ALLOWED_TEMPLATES = {
  'send-tutorial': 1,
  'send-invoice': 2
}

// 教程类型与模板名称的映射（模糊匹配）
const TUTORIAL_TEMPLATE_MAP = {
  'android': 'v2rayNg-App',
  'windows': 'v2rayN-windows',
  'github': 'GitHub',
  'apple-id': '苹果ID'
}

// 下载链接模板关键词（模糊匹配）
const DOWNLOAD_TEMPLATE_KEYWORD = 'Android-App'

// 生成下载 token
function generateToken() {
  return crypto.randomBytes(16).toString('hex')
}

// 获取资源配置
async function getResourceConfig(db) {
  try {
    const config = await db.prepare("SELECT value FROM system_settings WHERE key = 'resource_config'").get()
    if (config) {
      return JSON.parse(config.value)
    }
    return { max_file_size: 100, download_speed_limit: 0, default_expire_minutes: 60 }
  } catch (error) {
    return { max_file_size: 100, download_speed_limit: 0, default_expire_minutes: 60 }
  }
}

// 请求教程邮件
router.post('/tutorial', authenticateUser, async (req, res) => {
  try {
    const db = req.app.locals.db
    const { type } = req.body
    const userId = req.user.id

    // 检查教程类型
    const templateKeyword = TUTORIAL_TEMPLATE_MAP[type]
    if (!templateKeyword) {
      return res.json({ code: 1001, message: '无效的教程类型', data: null })
    }

    // 检查用户今天是否已经收到过邮件
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayTimestamp = Math.floor(today.getTime() / 1000)

    const todayMailCount = await db.prepare(
      'SELECT COUNT(*) as count FROM email_logs WHERE user_id = ? AND created_at >= ? AND status = ?'
    ).get(userId, todayTimestamp, 'sent')

    if (todayMailCount.count >= 2) {
      return res.json({ code: 6006, message: '今天已经发送过2封教程邮件，请明天再试', data: null })
    }

    // 模糊匹配邮件模板
    const template = await db.prepare(
      'SELECT * FROM email_templates WHERE name LIKE ? LIMIT 1'
    ).get(`%${templateKeyword}%`)

    if (!template) {
      return res.json({ code: 6003, message: '教程模板不存在，请联系管理员', data: null })
    }

    // 获取用户信息变量
    const userVariables = await emailService.getUserVariables(db, userId)
    if (!userVariables) {
      return res.json({ code: 2004, message: '用户不存在', data: null })
    }

    // 替换变量
    const subject = emailService.replaceVariables(template.subject, userVariables)
    const content = emailService.replaceVariables(template.content, userVariables)

    // 发送邮件
    await emailService.initClient(db)
    const result = await emailService.sendEmail(db, {
      to: userVariables.email,
      subject,
      content
    })

    if (result.success) {
      const now = Math.floor(Date.now() / 1000)
      await db.prepare(
        `INSERT INTO email_logs (user_id, email, subject, status, sent_at, created_at)
         VALUES (?, ?, ?, 'sent', ?, ?)`
      ).run(userId, userVariables.email, subject, now, now)
      logger.info(`用户 ${req.user.email} 请求教程邮件成功: ${type}`)
      res.json({ code: 0, message: '教程邮件已发送，请到邮箱查看', data: null })
    } else {
      logger.error(`发送教程邮件失败: ${result.error}`)
      res.json({ code: 500, message: '发送失败: ' + result.error, data: null })
    }
  } catch (error) {
    logger.error(`请求教程邮件错误: ${error.message}`)
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 请求下载链接邮件
router.post('/download', authenticateUser, async (req, res) => {
  try {
    const db = req.app.locals.db
    const userId = req.user.id
    const now = Math.floor(Date.now() / 1000)

    // 检查用户今天是否已经收到过邮件
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayTimestamp = Math.floor(today.getTime() / 1000)

    const todayMailCount = await db.prepare(
      'SELECT COUNT(*) as count FROM email_logs WHERE user_id = ? AND created_at >= ? AND status = ?'
    ).get(userId, todayTimestamp, 'sent')

    if (todayMailCount.count >= 2) {
      return res.json({ code: 6006, message: '今天已经发送过2封邮件，请明天再试', data: null })
    }

    // 检查用户是否已有有效的分发记录
    let distribution = await db.prepare(`
      SELECT rd.*, r.name as resource_name
      FROM resource_distributions rd
      JOIN resources r ON rd.resource_id = r.id
      WHERE rd.user_id = ? AND rd.enabled = 1 
      AND (rd.expire_at IS NULL OR rd.expire_at > ?)
      ORDER BY rd.created_at DESC LIMIT 1
    `).get(userId, now)

    // 如果没有有效分发记录，自动创建
    if (!distribution) {
      // 根据关键词模糊匹配资源，多个匹配取最新的
      let resource = await db.prepare(
        'SELECT * FROM resources WHERE enabled = 1 AND name LIKE ? ORDER BY created_at DESC LIMIT 1'
      ).get(`%${DOWNLOAD_TEMPLATE_KEYWORD}%`)

      // 如果没有匹配到，返回提示
      if (!resource) {
        return res.json({ code: 7005, message: '暂无可用资源，请联系管理员', data: null })
      }

      // 获取配置的默认过期时间
      const config = await getResourceConfig(db)
      const expireMinutes = config.default_expire_minutes || 60
      const expireAt = now + (expireMinutes * 60)

      // 创建分发记录
      const token = generateToken()
      const result = await db.prepare(
        'INSERT INTO resource_distributions (resource_id, user_id, download_token, expire_at) VALUES (?, ?, ?, ?)'
      ).run(resource.id, userId, token, expireAt)

      distribution = {
        id: result.lastInsertRowid,
        resource_id: resource.id,
        user_id: userId,
        download_token: token,
        expire_at: expireAt,
        resource_name: resource.name
      }

      logger.info(`自动创建分发记录: 用户 ${userId}, 资源 ${resource.id}`)
    }

    // 模糊匹配邮件模板
    const template = await db.prepare(
      'SELECT * FROM email_templates WHERE name LIKE ? LIMIT 1'
    ).get(`%${DOWNLOAD_TEMPLATE_KEYWORD}%`)

    if (!template) {
      return res.json({ code: 6003, message: '下载模板不存在，请联系管理员', data: null })
    }

    // 获取用户信息变量（包含 download_url）
    const userVariables = await emailService.getUserVariables(db, userId)
    if (!userVariables) {
      return res.json({ code: 2004, message: '用户不存在', data: null })
    }

    // 替换变量
    const subject = emailService.replaceVariables(template.subject, userVariables)
    const content = emailService.replaceVariables(template.content, userVariables)

    // 发送邮件
    await emailService.initClient(db)
    const emailResult = await emailService.sendEmail(db, {
      to: userVariables.email,
      subject,
      content
    })

    if (emailResult.success) {
      await db.prepare(
        `INSERT INTO email_logs (user_id, email, subject, status, sent_at, created_at)
         VALUES (?, ?, ?, 'sent', ?, ?)`
      ).run(userId, userVariables.email, subject, now, now)
      logger.info(`用户 ${req.user.email} 请求下载链接邮件成功`)
      res.json({ code: 0, message: '下载链接已发送到邮箱，请查收', data: null })
    } else {
      logger.error(`发送下载链接邮件失败: ${emailResult.error}`)
      res.json({ code: 500, message: '发送失败: ' + emailResult.error, data: null })
    }
  } catch (error) {
    logger.error(`请求下载链接邮件错误: ${error.message}`)
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 发送预设模板邮件
router.post('/:action', authenticateUser, async (req, res) => {
  try {
    const db = req.app.locals.db
    const { action } = req.params
    const { variables = {} } = req.body
    const userId = req.user.id

    // 检查白名单
    const templateId = ALLOWED_TEMPLATES[action]
    if (!templateId) {
      return res.json({ code: 1004, message: '不允许的操作', data: null })
    }

    // 获取模板
    const template = await db.prepare('SELECT * FROM email_templates WHERE id = ?').get(templateId)
    if (!template) {
      return res.json({ code: 6003, message: '模板不存在', data: null })
    }

    // 获取用户信息变量
    const userVariables = await emailService.getUserVariables(db, userId)
    if (!userVariables) {
      return res.json({ code: 2004, message: '用户不存在', data: null })
    }

    // 合并变量
    const allVariables = { ...userVariables, ...variables }

    // 替换变量
    const subject = emailService.replaceVariables(template.subject, allVariables)
    const content = emailService.replaceVariables(template.content, allVariables)

    // 发送邮件
    await emailService.initClient(db)
    const result = await emailService.sendEmail(db, {
      to: userVariables.email,
      subject,
      content
    })

    if (result.success) {
      const now = Math.floor(Date.now() / 1000)
      await db.prepare(
        `INSERT INTO email_logs (user_id, email, subject, status, sent_at, created_at)
         VALUES (?, ?, ?, 'sent', ?, ?)`
      ).run(userId, userVariables.email, subject, now, now)
      logger.info(`用户 ${req.user.email} 发送邮件成功: ${action}`)
      res.json({ code: 0, message: '邮件已发送', data: null })
    } else {
      logger.error(`发送邮件失败: ${result.error}`)
      res.json({ code: 500, message: '发送失败: ' + result.error, data: null })
    }
  } catch (error) {
    logger.error(`发送邮件错误: ${error.message}`)
    res.json({ code: 500, message: error.message, data: null })
  }
})

module.exports = router
