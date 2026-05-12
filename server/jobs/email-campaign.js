const emailService = require('../services/email-service')
const { createLogger } = require('../utils/logger')

const logger = createLogger('EMAIL-CAMPAIGN')

async function processCampaigns(db) {
  try {
    logger.info('开始处理群发任务...')

    const campaignResult = await db.query(
      "SELECT * FROM email_campaigns WHERE status IN ('pending', 'sending') ORDER BY id"
    )

    if (campaignResult.rows.length === 0) {
      logger.info('没有待处理的任务')
      return
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayTimestamp = Math.floor(today.getTime() / 1000)

    const todayCountResult = await db.query(
      'SELECT COUNT(*) FROM email_logs WHERE created_at >= $1',
      [todayTimestamp]
    )
    const todayCount = parseInt(todayCountResult.rows[0].count)

    if (todayCount >= 200) {
      logger.info('今日已发送 200 封，跳过')
      return
    }

    const remainingQuota = 200 - todayCount
    logger.info(`今日剩余配额: ${remainingQuota}`)

    await emailService.initClient(db)

    let remaining = remainingQuota
    for (const campaign of campaignResult.rows) {
      const used = await processCampaign(db, campaign, remaining)
      remaining -= used
      if (remaining <= 0) break
    }

    logger.info('处理完成')
  } catch (error) {
    logger.error(`处理失败: ${error.message}`)
  }
}

async function processCampaign(db, campaign, remainingQuota) {
  try {
    await db.query(
      "UPDATE email_campaigns SET status = 'sending', updated_at = $1 WHERE id = $2",
      [Math.floor(Date.now() / 1000), campaign.id]
    )

    const targetUserIds = JSON.parse(campaign.target_users || '[]')
    const sentUsersResult = await db.query(
      'SELECT user_id FROM email_logs WHERE campaign_id = $1 AND status = $2',
      [campaign.id, 'sent']
    )
    const sentUserIds = sentUsersResult.rows.map(r => r.user_id)
    const pendingUserIds = targetUserIds.filter(id => !sentUserIds.includes(id))

    if (pendingUserIds.length === 0) {
      await db.query(
        "UPDATE email_campaigns SET status = 'completed', updated_at = $1 WHERE id = $2",
        [Math.floor(Date.now() / 1000), campaign.id]
      )
      logger.info(`任务 ${campaign.id} 已完成`)
      return 0
    }

    const sendCount = Math.min(pendingUserIds.length, remainingQuota)
    const usersToSend = pendingUserIds.slice(0, sendCount)

    const usersResult = await db.query(
      'SELECT id, email FROM users WHERE id = ANY($1)',
      [usersToSend]
    )
    const users = usersResult.rows

    let sentCount = 0
    let failedCount = 0

    for (const user of users) {
      try {
        const userVariables = await emailService.getUserVariables(db, user.id)
        if (!userVariables) {
          failedCount++
          await logEmail(db, campaign.id, user.id, user.email, campaign.subject, 'failed', '用户不存在')
          continue
        }

        const subject = emailService.replaceVariables(campaign.subject, userVariables)
        const content = emailService.replaceVariables(campaign.content, userVariables)

        const result = await emailService.sendEmail(db, {
          to: user.email,
          subject,
          content
        })

        if (result.success) {
          sentCount++
          await logEmail(db, campaign.id, user.id, user.email, subject, 'sent', null)
        } else {
          failedCount++
          await logEmail(db, campaign.id, user.id, user.email, subject, 'failed', result.error)
        }
      } catch (error) {
        failedCount++
        await logEmail(db, campaign.id, user.id, user.email, campaign.subject, 'failed', error.message)
      }
    }

    const newSentCount = (campaign.sent_count || 0) + sentCount
    const newFailedCount = (campaign.failed_count || 0) + failedCount
    const isCompleted = (newSentCount + newFailedCount) >= campaign.total_count

    await db.query(
      `UPDATE email_campaigns 
       SET sent_count = $1, failed_count = $2, status = $3, updated_at = $4
       WHERE id = $5`,
      [newSentCount, newFailedCount, isCompleted ? 'completed' : 'pending', Math.floor(Date.now() / 1000), campaign.id]
    )

    logger.info(`任务 ${campaign.id}: 发送 ${sentCount}, 失败 ${failedCount}`)
    return sentCount
  } catch (error) {
    logger.error(`任务 ${campaign.id} 处理失败: ${error.message}`)
    await db.query(
      "UPDATE email_campaigns SET status = 'pending', updated_at = $1 WHERE id = $2",
      [Math.floor(Date.now() / 1000), campaign.id]
    )
    return 0
  }
}

async function logEmail(db, campaignId, userId, email, subject, status, errorMessage) {
  const now = Math.floor(Date.now() / 1000)
  await db.query(
    `INSERT INTO email_logs (campaign_id, user_id, email, subject, status, error_message, sent_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [campaignId, userId, email, subject, status, errorMessage, now, now]
  )
}

async function cleanLogs(db, beforeDays = 30) {
  try {
    const beforeTime = Math.floor(Date.now() / 1000) - (beforeDays * 24 * 60 * 60)
    const result = await db.query(
      'DELETE FROM email_logs WHERE created_at < $1',
      [beforeTime]
    )
    logger.info(`已清理 ${result.rowCount} 条过期日志`)
  } catch (error) {
    logger.error(`清理日志失败: ${error.message}`)
  }
}

module.exports = { processCampaigns, cleanLogs }
