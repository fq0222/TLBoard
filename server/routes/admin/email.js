const express = require('express')
const { authenticateAdmin } = require('../../middleware/auth-admin')
const { createLogger } = require('../../utils/logger')
const emailService = require('../../services/email-service')

const router = express.Router()
const logger = createLogger('ADMIN-EMAIL')

// 获取 Brevo 配置
router.get('/config', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db
    const config = await emailService.getConfig(db)
    logger.info('获取 Brevo 配置成功')
    res.json({
      code: 0,
      message: 'ok',
      data: {
        api_key: config.brevo_api_key || '',
        sender_email: config.brevo_sender_email || '',
        sender_name: config.brevo_sender_name || '',
        daily_limit: parseInt(config.brevo_daily_limit) || 200,
        campaign_daily_limit: parseInt(config.brevo_campaign_daily_limit) || 100
      }
    })
  } catch (error) {
    logger.error(`获取 Brevo 配置失败: ${error.message}`)
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 更新 Brevo 配置
router.put('/config', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db
    const { api_key, sender_email, sender_name, daily_limit, campaign_daily_limit } = req.body
    await emailService.saveConfig(db, {
      brevo_api_key: api_key,
      brevo_sender_email: sender_email,
      brevo_sender_name: sender_name,
      brevo_daily_limit: daily_limit ? daily_limit.toString() : '200',
      brevo_campaign_daily_limit: campaign_daily_limit ? campaign_daily_limit.toString() : '100'
    })
    logger.info('更新 Brevo 配置成功')
    res.json({ code: 0, message: '配置已保存', data: null })
  } catch (error) {
    logger.error(`更新 Brevo 配置失败: ${error.message}`)
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 发送测试邮件
router.post('/test', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db
    const { email } = req.body
    if (!email) {
      return res.json({ code: 1001, message: '请输入测试邮箱', data: null })
    }
    await emailService.initClient(db)
    const result = await emailService.sendTestEmail(db, { to: email })
    if (result.success) {
      logger.info(`测试邮件已发送: ${email}`)
      res.json({ code: 0, message: '测试邮件已发送', data: null })
    } else {
      logger.error(`测试邮件发送失败: ${result.error}`)
      res.json({ code: 6002, message: '发送失败: ' + result.error, data: null })
    }
  } catch (error) {
    logger.error(`测试邮件发送失败: ${error.message}`)
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 获取模板列表
router.get('/templates', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db
    const rows = await db.prepare('SELECT * FROM email_templates ORDER BY id DESC').all()
    res.json({ code: 0, message: 'ok', data: rows })
  } catch (error) {
    logger.error(`获取模板列表失败: ${error.message}`)
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 创建模板
router.post('/templates', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db
    const { name, subject, content, variables } = req.body
    if (!name || !subject || !content) {
      return res.json({ code: 1001, message: '请填写完整信息', data: null })
    }
    const now = Math.floor(Date.now() / 1000)
    const result = await db.prepare(
      `INSERT INTO email_templates (name, subject, content, variables, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(name, subject, content, JSON.stringify(variables || []), now, now)
    logger.info(`创建模板成功: ${name}`)
    res.json({ code: 0, message: '模板已创建', data: { id: result.lastInsertRowid } })
  } catch (error) {
    logger.error(`创建模板失败: ${error.message}`)
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 编辑模板
router.put('/templates/:id', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db
    const { id } = req.params
    const { name, subject, content, variables } = req.body
    if (!name || !subject || !content) {
      return res.json({ code: 1001, message: '请填写完整信息', data: null })
    }
    const now = Math.floor(Date.now() / 1000)
    await db.prepare(
      `UPDATE email_templates SET name=?, subject=?, content=?, variables=?, updated_at=?
       WHERE id=?`
    ).run(name, subject, content, JSON.stringify(variables || []), now, id)
    logger.info(`更新模板成功: ${name} (ID: ${id})`)
    res.json({ code: 0, message: '模板已更新', data: { id: parseInt(id) } })
  } catch (error) {
    logger.error(`更新模板失败: ${error.message}`)
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 删除模板
router.delete('/templates/:id', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db
    const { id } = req.params
    await db.prepare('DELETE FROM email_templates WHERE id = ?').run(id)
    logger.info(`删除模板成功 (ID: ${id})`)
    res.json({ code: 0, message: '模板已删除', data: null })
  } catch (error) {
    logger.error(`删除模板失败: ${error.message}`)
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 预览模板
router.get('/templates/:id/preview', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db
    const { id } = req.params
    const { user_id } = req.query
    const template = await db.prepare('SELECT * FROM email_templates WHERE id = ?').get(id)
    if (!template) {
      return res.json({ code: 6003, message: '模板不存在', data: null })
    }
    let variables = {}
    if (user_id) {
      variables = await emailService.getUserVariables(db, user_id) || {}
    }
    const previewContent = emailService.replaceVariables(template.content, variables)
    const previewSubject = emailService.replaceVariables(template.subject, variables)
    logger.info(`预览模板成功 (ID: ${id})`)
    res.json({
      code: 0,
      message: 'ok',
      data: { subject: previewSubject, content: previewContent }
    })
  } catch (error) {
    logger.error(`预览模板失败: ${error.message}`)
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 发送单封邮件
router.post('/send', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db
    const { to, subject, content, user_id } = req.body
    if (!to || !subject || !content) {
      return res.json({ code: 1001, message: '请填写完整信息', data: null })
    }

    let finalSubject = subject
    let finalContent = content

    // 如果提供了 user_id，获取用户变量并替换
    if (user_id) {
      const userVariables = await emailService.getUserVariables(db, user_id)
      if (userVariables) {
        finalSubject = emailService.replaceVariables(subject, userVariables)
        finalContent = emailService.replaceVariables(content, userVariables)
      }
    }

    await emailService.initClient(db)
    const result = await emailService.sendEmail(db, { to, subject: finalSubject, content: finalContent })
    if (result.success) {
      const now = Math.floor(Date.now() / 1000)
      await db.prepare(
        `INSERT INTO email_logs (email, subject, status, sent_at, created_at)
         VALUES (?, ?, 'sent', ?, ?)`
      ).run(to, finalSubject, now, now)
      logger.info(`邮件已发送: ${to}`)
      res.json({ code: 0, message: '邮件已发送', data: null })
    } else {
      logger.error(`邮件发送失败: ${result.error}`)
      res.json({ code: 500, message: '发送失败: ' + result.error, data: null })
    }
  } catch (error) {
    logger.error(`邮件发送失败: ${error.message}`)
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 创建群发任务
router.post('/campaigns', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db
    const { name, template_id, target_type, target_users } = req.body
    if (!name || !template_id || !target_type) {
      return res.json({ code: 1001, message: '请填写完整信息', data: null })
    }

    // 获取模板
    const template = await db.prepare('SELECT * FROM email_templates WHERE id = ?').get(template_id)
    if (!template) {
      return res.json({ code: 6003, message: '模板不存在', data: null })
    }

    // 获取目标用户
    let users
    if (target_type === 'all') {
      users = await db.prepare('SELECT id, email FROM users WHERE enabled = 1').all()
    } else if (target_type === 'disabled') {
      users = await db.prepare('SELECT id, email FROM users WHERE enabled = 0').all()
    } else {
      if (!target_users || target_users.length === 0) {
        return res.json({ code: 6007, message: '收件人列表为空', data: null })
      }
      users = await db.prepare(
        'SELECT id, email FROM users WHERE id = ANY(?)'
      ).all([target_users])
    }

    const now = Math.floor(Date.now() / 1000)
    const result = await db.prepare(
      `INSERT INTO email_campaigns (name, template_id, subject, content, target_type, target_users, total_count, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).run(name, template_id, template.subject, template.content, target_type, JSON.stringify(users.map(u => u.id)), users.length, now, now)

    logger.info(`群发任务已创建: ${name}`)
    res.json({ code: 0, message: '群发任务已创建', data: { id: result.lastInsertRowid } })
  } catch (error) {
    logger.error(`创建群发任务失败: ${error.message}`)
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 获取群发任务列表
router.get('/campaigns', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db
    const rows = await db.prepare('SELECT * FROM email_campaigns ORDER BY id DESC').all()
    res.json({ code: 0, message: 'ok', data: rows })
  } catch (error) {
    logger.error(`获取群发任务列表失败: ${error.message}`)
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 获取群发任务详情
router.get('/campaigns/:id', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db
    const { id } = req.params
    const campaign = await db.prepare('SELECT * FROM email_campaigns WHERE id = ?').get(id)
    if (!campaign) {
      return res.json({ code: 6004, message: '任务不存在', data: null })
    }
    res.json({ code: 0, message: 'ok', data: campaign })
  } catch (error) {
    logger.error(`获取群发任务详情失败: ${error.message}`)
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 暂停群发任务
router.post('/campaigns/:id/pause', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db
    const { id } = req.params
    await db.prepare(
      "UPDATE email_campaigns SET status = 'paused', updated_at = ? WHERE id = ? AND status IN ('pending', 'sending')"
    ).run(Math.floor(Date.now() / 1000), id)
    logger.info(`任务已暂停 (ID: ${id})`)
    res.json({ code: 0, message: '任务已暂停', data: { id: parseInt(id) } })
  } catch (error) {
    logger.error(`暂停任务失败: ${error.message}`)
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 恢复群发任务
router.post('/campaigns/:id/resume', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db
    const { id } = req.params
    await db.prepare(
      "UPDATE email_campaigns SET status = 'pending', updated_at = ? WHERE id = ? AND status = 'paused'"
    ).run(Math.floor(Date.now() / 1000), id)
    logger.info(`任务已恢复 (ID: ${id})`)
    res.json({ code: 0, message: '任务已恢复', data: { id: parseInt(id) } })
  } catch (error) {
    logger.error(`恢复任务失败: ${error.message}`)
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 删除群发任务
router.delete('/campaigns/:id', authenticateAdmin, async (req, res) => {
  const db = req.app.locals.db
  const client = await db.pool.connect()
  try {
    const { id } = req.params
    await client.query('BEGIN')
    await client.query('DELETE FROM email_logs WHERE campaign_id = $1', [id])
    await client.query('DELETE FROM email_campaigns WHERE id = $1', [id])
    await client.query('COMMIT')
    logger.info(`任务已删除 (ID: ${id})`)
    res.json({ code: 0, message: '任务已删除', data: null })
  } catch (error) {
    await client.query('ROLLBACK')
    logger.error(`删除任务失败: ${error.message}`)
    res.json({ code: 500, message: error.message, data: null })
  } finally {
    client.release()
  }
})

// 获取群发任务日志
router.get('/campaigns/:id/logs', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db
    const { id } = req.params
    const { page = 1, limit = 50 } = req.query
    const offset = (page - 1) * limit
    const rows = await db.prepare(
      'SELECT * FROM email_logs WHERE campaign_id = ? ORDER BY id DESC LIMIT ? OFFSET ?'
    ).all(id, limit, offset)
    const countRow = await db.prepare(
      'SELECT COUNT(*) as count FROM email_logs WHERE campaign_id = ?'
    ).get(id)
    res.json({
      code: 0,
      message: 'ok',
      data: {
        list: rows,
        total: countRow.count,
        page: parseInt(page),
        limit: parseInt(limit)
      }
    })
  } catch (error) {
    logger.error(`获取群发任务日志失败: ${error.message}`)
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 获取所有邮件日志
router.get('/logs', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db
    const { page = 1, limit = 10 } = req.query
    const offset = (page - 1) * limit
    const rows = await db.prepare(
      'SELECT * FROM email_logs ORDER BY id DESC LIMIT ? OFFSET ?'
    ).all(limit, offset)
    const countRow = await db.prepare(
      'SELECT COUNT(*) as count FROM email_logs'
    ).get()
    res.json({
      code: 0,
      message: 'ok',
      data: {
        list: rows,
        total: countRow.count,
        page: parseInt(page),
        limit: parseInt(limit)
      }
    })
  } catch (error) {
    logger.error(`获取邮件日志失败: ${error.message}`)
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 清空过期日志
router.delete('/logs/clear', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db
    const { before_days = 30 } = req.body
    const beforeTime = Math.floor(Date.now() / 1000) - (before_days * 24 * 60 * 60)
    await db.prepare(
      'DELETE FROM email_logs WHERE created_at < ?'
    ).run(beforeTime)
    logger.info(`已清空过期日志`)
    res.json({ code: 0, message: '日志已清空', data: null })
  } catch (error) {
    logger.error(`清空日志失败: ${error.message}`)
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 批量删除日志
router.delete('/logs/batch', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db
    const { ids } = req.body
    if (!ids || ids.length === 0) {
      return res.json({ code: 1001, message: '请选择要删除的日志', data: null })
    }
    await db.prepare('DELETE FROM email_logs WHERE id = ANY(?)').run([ids])
    logger.info(`批量删除日志成功 (数量: ${ids.length})`)
    res.json({ code: 0, message: '日志已删除', data: null })
  } catch (error) {
    logger.error(`批量删除日志失败: ${error.message}`)
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 删除单条日志
router.delete('/logs/:id', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db
    const { id } = req.params
    await db.prepare('DELETE FROM email_logs WHERE id = ?').run(id)
    logger.info(`日志已删除 (ID: ${id})`)
    res.json({ code: 0, message: '日志已删除', data: null })
  } catch (error) {
    logger.error(`删除日志失败: ${error.message}`)
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 批量删除日志
router.delete('/logs/batch', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db
    const { ids } = req.body
    if (!ids || ids.length === 0) {
      return res.json({ code: 1001, message: '请选择要删除的日志', data: null })
    }
    await db.prepare('DELETE FROM email_logs WHERE id = ANY(?)').run([ids])
    logger.info(`批量删除日志成功 (数量: ${ids.length})`)
    res.json({ code: 0, message: '日志已删除', data: null })
  } catch (error) {
    logger.error(`批量删除日志失败: ${error.message}`)
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 清空过期日志
router.delete('/logs/clear', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db
    const { before_days = 30 } = req.body
    const beforeTime = Math.floor(Date.now() / 1000) - (before_days * 24 * 60 * 60)
    const result = await db.prepare(
      'DELETE FROM email_logs WHERE created_at < ?'
    ).run(beforeTime)
    logger.info(`已清空过期日志`)
    res.json({ code: 0, message: '日志已清空', data: null })
  } catch (error) {
    logger.error(`清空日志失败: ${error.message}`)
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 搜索用户
router.get('/users/search', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db
    const { keyword } = req.query
    if (!keyword) {
      return res.json({ code: 0, message: 'ok', data: [] })
    }
    const rows = await db.prepare(
      'SELECT id, email FROM users WHERE email ILIKE ? LIMIT 20'
    ).all(`%${keyword}%`)
    res.json({ code: 0, message: 'ok', data: rows })
  } catch (error) {
    logger.error(`搜索用户失败: ${error.message}`)
    res.json({ code: 500, message: error.message, data: null })
  }
})

module.exports = router
