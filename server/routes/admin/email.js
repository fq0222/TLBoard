const express = require('express')
const router = express.Router()
const emailService = require('../../services/email-service')

// 获取 Brevo 配置
router.get('/config', async (req, res) => {
  try {
    const config = await emailService.getConfig(req.db)
    res.json({
      code: 0,
      message: 'ok',
      data: {
        api_key: config.brevo_api_key || '',
        sender_email: config.brevo_sender_email || '',
        sender_name: config.brevo_sender_name || ''
      }
    })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 更新 Brevo 配置
router.put('/config', async (req, res) => {
  try {
    const { api_key, sender_email, sender_name } = req.body
    await emailService.saveConfig(req.db, {
      brevo_api_key: api_key,
      brevo_sender_email: sender_email,
      brevo_sender_name: sender_name
    })
    res.json({ code: 0, message: '配置已保存', data: null })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 发送测试邮件
router.post('/test', async (req, res) => {
  try {
    const { email } = req.body
    if (!email) {
      return res.json({ code: 1001, message: '请输入测试邮箱', data: null })
    }
    await emailService.initClient(req.db)
    const result = await emailService.sendTestEmail(req.db, { to: email })
    if (result.success) {
      res.json({ code: 0, message: '测试邮件已发送', data: null })
    } else {
      res.json({ code: 6002, message: '发送失败: ' + result.error, data: null })
    }
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 获取模板列表
router.get('/templates', async (req, res) => {
  try {
    const result = await req.db.query('SELECT * FROM email_templates ORDER BY id DESC')
    res.json({ code: 0, message: 'ok', data: result.rows })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 创建模板
router.post('/templates', async (req, res) => {
  try {
    const { name, subject, content, variables } = req.body
    if (!name || !subject || !content) {
      return res.json({ code: 1001, message: '请填写完整信息', data: null })
    }
    const now = Math.floor(Date.now() / 1000)
    const result = await req.db.query(
      `INSERT INTO email_templates (name, subject, content, variables, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, subject, content, JSON.stringify(variables || []), now, now]
    )
    res.json({ code: 0, message: '模板已创建', data: result.rows[0] })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 编辑模板
router.put('/templates/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { name, subject, content, variables } = req.body
    const now = Math.floor(Date.now() / 1000)
    const result = await req.db.query(
      `UPDATE email_templates SET name=$1, subject=$2, content=$3, variables=$4, updated_at=$5
       WHERE id=$6 RETURNING *`,
      [name, subject, content, JSON.stringify(variables || []), now, id]
    )
    if (result.rows.length === 0) {
      return res.json({ code: 6003, message: '模板不存在', data: null })
    }
    res.json({ code: 0, message: '模板已更新', data: result.rows[0] })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 删除模板
router.delete('/templates/:id', async (req, res) => {
  try {
    const { id } = req.params
    await req.db.query('DELETE FROM email_templates WHERE id = $1', [id])
    res.json({ code: 0, message: '模板已删除', data: null })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 预览模板
router.get('/templates/:id/preview', async (req, res) => {
  try {
    const { id } = req.params
    const { user_id } = req.query
    const result = await req.db.query('SELECT * FROM email_templates WHERE id = $1', [id])
    if (result.rows.length === 0) {
      return res.json({ code: 6003, message: '模板不存在', data: null })
    }
    const template = result.rows[0]
    let variables = {}
    if (user_id) {
      variables = await emailService.getUserVariables(req.db, user_id) || {}
    }
    const previewContent = emailService.replaceVariables(template.content, variables)
    const previewSubject = emailService.replaceVariables(template.subject, variables)
    res.json({
      code: 0,
      message: 'ok',
      data: { subject: previewSubject, content: previewContent }
    })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 发送单封邮件
router.post('/send', async (req, res) => {
  try {
    const { to, subject, content } = req.body
    if (!to || !subject || !content) {
      return res.json({ code: 1001, message: '请填写完整信息', data: null })
    }
    await emailService.initClient(req.db)
    const result = await emailService.sendEmail(req.db, { to, subject, content })
    if (result.success) {
      const now = Math.floor(Date.now() / 1000)
      await req.db.query(
        `INSERT INTO email_logs (email, subject, status, sent_at, created_at)
         VALUES ($1, $2, 'sent', $3, $4)`,
        [to, subject, now, now]
      )
      res.json({ code: 0, message: '邮件已发送', data: null })
    } else {
      res.json({ code: 500, message: '发送失败: ' + result.error, data: null })
    }
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 创建群发任务
router.post('/campaigns', async (req, res) => {
  try {
    const { name, template_id, target_type, target_users } = req.body
    if (!name || !template_id || !target_type) {
      return res.json({ code: 1001, message: '请填写完整信息', data: null })
    }

    // 获取模板
    const templateResult = await req.db.query('SELECT * FROM email_templates WHERE id = $1', [template_id])
    if (templateResult.rows.length === 0) {
      return res.json({ code: 6003, message: '模板不存在', data: null })
    }
    const template = templateResult.rows[0]

    // 获取目标用户
    let users
    if (target_type === 'all') {
      const result = await req.db.query('SELECT id, email FROM users WHERE enabled = true')
      users = result.rows
    } else if (target_type === 'disabled') {
      const result = await req.db.query('SELECT id, email FROM users WHERE enabled = false')
      users = result.rows
    } else {
      if (!target_users || target_users.length === 0) {
        return res.json({ code: 6007, message: '收件人列表为空', data: null })
      }
      const result = await req.db.query(
        'SELECT id, email FROM users WHERE id = ANY($1)',
        [target_users]
      )
      users = result.rows
    }

    const now = Math.floor(Date.now() / 1000)
    const result = await req.db.query(
      `INSERT INTO email_campaigns (name, template_id, subject, content, target_type, target_users, total_count, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9) RETURNING *`,
      [name, template_id, template.subject, template.content, target_type, JSON.stringify(users.map(u => u.id)), users.length, now, now]
    )

    res.json({ code: 0, message: '群发任务已创建', data: result.rows[0] })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 获取群发任务列表
router.get('/campaigns', async (req, res) => {
  try {
    const result = await req.db.query('SELECT * FROM email_campaigns ORDER BY id DESC')
    res.json({ code: 0, message: 'ok', data: result.rows })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 获取群发任务详情
router.get('/campaigns/:id', async (req, res) => {
  try {
    const { id } = req.params
    const result = await req.db.query('SELECT * FROM email_campaigns WHERE id = $1', [id])
    if (result.rows.length === 0) {
      return res.json({ code: 6004, message: '任务不存在', data: null })
    }
    res.json({ code: 0, message: 'ok', data: result.rows[0] })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 暂停群发任务
router.post('/campaigns/:id/pause', async (req, res) => {
  try {
    const { id } = req.params
    const result = await req.db.query(
      "UPDATE email_campaigns SET status = 'paused', updated_at = $1 WHERE id = $2 AND status IN ('pending', 'sending') RETURNING *",
      [Math.floor(Date.now() / 1000), id]
    )
    if (result.rows.length === 0) {
      return res.json({ code: 6005, message: '任务状态不允许暂停', data: null })
    }
    res.json({ code: 0, message: '任务已暂停', data: result.rows[0] })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 恢复群发任务
router.post('/campaigns/:id/resume', async (req, res) => {
  try {
    const { id } = req.params
    const result = await req.db.query(
      "UPDATE email_campaigns SET status = 'pending', updated_at = $1 WHERE id = $2 AND status = 'paused' RETURNING *",
      [Math.floor(Date.now() / 1000), id]
    )
    if (result.rows.length === 0) {
      return res.json({ code: 6005, message: '任务状态不允许恢复', data: null })
    }
    res.json({ code: 0, message: '任务已恢复', data: result.rows[0] })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 删除群发任务
router.delete('/campaigns/:id', async (req, res) => {
  try {
    const { id } = req.params
    await req.db.query('DELETE FROM email_logs WHERE campaign_id = $1', [id])
    await req.db.query('DELETE FROM email_campaigns WHERE id = $1', [id])
    res.json({ code: 0, message: '任务已删除', data: null })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 获取群发任务日志
router.get('/campaigns/:id/logs', async (req, res) => {
  try {
    const { id } = req.params
    const { page = 1, limit = 50 } = req.query
    const offset = (page - 1) * limit
    const result = await req.db.query(
      'SELECT * FROM email_logs WHERE campaign_id = $1 ORDER BY id DESC LIMIT $2 OFFSET $3',
      [id, limit, offset]
    )
    const countResult = await req.db.query(
      'SELECT COUNT(*) FROM email_logs WHERE campaign_id = $1',
      [id]
    )
    res.json({
      code: 0,
      message: 'ok',
      data: {
        list: result.rows,
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit)
      }
    })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 删除单条日志
router.delete('/logs/:id', async (req, res) => {
  try {
    const { id } = req.params
    await req.db.query('DELETE FROM email_logs WHERE id = $1', [id])
    res.json({ code: 0, message: '日志已删除', data: null })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 批量删除日志
router.delete('/logs/batch', async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || ids.length === 0) {
      return res.json({ code: 1001, message: '请选择要删除的日志', data: null })
    }
    await req.db.query('DELETE FROM email_logs WHERE id = ANY($1)', [ids])
    res.json({ code: 0, message: '日志已删除', data: null })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 清空过期日志
router.delete('/logs/clear', async (req, res) => {
  try {
    const { before_days = 30 } = req.body
    const beforeTime = Math.floor(Date.now() / 1000) - (before_days * 24 * 60 * 60)
    const result = await req.db.query(
      'DELETE FROM email_logs WHERE created_at < $1',
      [beforeTime]
    )
    res.json({ code: 0, message: `已删除 ${result.rowCount} 条日志`, data: null })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

// 搜索用户
router.get('/users/search', async (req, res) => {
  try {
    const { keyword } = req.query
    if (!keyword) {
      return res.json({ code: 0, message: 'ok', data: [] })
    }
    const result = await req.db.query(
      'SELECT id, email FROM users WHERE email ILIKE $1 LIMIT 20',
      [`%${keyword}%`]
    )
    res.json({ code: 0, message: 'ok', data: result.rows })
  } catch (error) {
    res.json({ code: 500, message: error.message, data: null })
  }
})

module.exports = router
