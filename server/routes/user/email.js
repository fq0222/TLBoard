const express = require('express')
const router = express.Router()
const emailService = require('../../services/email-service')
const { authenticateUser } = require('../../middleware/auth-user')

// 预设模板白名单
const ALLOWED_TEMPLATES = {
  'send-tutorial': 1,
  'send-invoice': 2
}

// 发送预设模板邮件
router.post('/:action', authenticateUser, async (req, res) => {
  try {
    const { action } = req.params
    const { variables = {} } = req.body
    const userId = req.user.id

    // 检查白名单
    const templateId = ALLOWED_TEMPLATES[action]
    if (!templateId) {
      return res.json({ code: 1004, message: '不允许的操作', data: null })
    }

    // 获取模板
    const templateResult = await req.app.locals.db.query('SELECT * FROM email_templates WHERE id = $1', [templateId])
    if (templateResult.rows.length === 0) {
      return res.json({ code: 6003, message: '模板不存在', data: null })
    }
    const template = templateResult.rows[0]

    // 获取用户信息变量
    const userVariables = await emailService.getUserVariables(req.app.locals.db, userId)
    if (!userVariables) {
      return res.json({ code: 2004, message: '用户不存在', data: null })
    }

    // 合并变量
    const allVariables = { ...userVariables, ...variables }

    // 替换变量
    const subject = emailService.replaceVariables(template.subject, allVariables)
    const content = emailService.replaceVariables(template.content, allVariables)

    // 发送邮件
    await emailService.initClient(req.app.locals.db)
    const result = await emailService.sendEmail(req.app.locals.db, {
      to: userVariables.email,
      subject,
      content
    })

    if (result.success) {
      const now = Math.floor(Date.now() / 1000)
      await req.app.locals.db.query(
        `INSERT INTO email_logs (user_id, email, subject, status, sent_at, created_at)
         VALUES ($1, $2, $3, 'sent', $4, $5)`,
        [userId, userVariables.email, subject, now, now]
      )
      res.json({ code: 0, message: '邮件已发送', data: null })
    } else {
      res.json({ code: 500, message: '发送失败: ' + result.error, data: null })
    }
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

module.exports = router
