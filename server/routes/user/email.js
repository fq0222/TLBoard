const express = require('express')
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
