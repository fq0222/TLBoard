const emailService = require('../integrations/email/email-service')
const { createLogger } = require('../utils/logger')

const logger = createLogger('EMAIL-CAMPAIGN')

async function processCampaigns(db) {
  try {
    logger.info('开始处理群发任务...')

    const campaigns = await db.prepare(
      "SELECT * FROM email_campaigns WHERE status IN ('pending', 'sending') ORDER BY id"
    ).all()

    if (campaigns.length === 0) {
      logger.info('没有待处理的任务')
      return
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayTimestamp = Math.floor(today.getTime() / 1000)

    const todayCountRow = await db.prepare(
      'SELECT COUNT(*) as count FROM email_logs WHERE created_at >= ?'
    ).get(todayTimestamp)
    const todayCount = todayCountRow.count

    // 从数据库读取每日群发配额
    const campaignDailyLimitRow = await db.prepare(
      "SELECT value FROM system_settings WHERE key = 'brevo_campaign_daily_limit'"
    ).get()
    const campaignDailyLimit = campaignDailyLimitRow ? parseInt(campaignDailyLimitRow.value) : 100

    // 从数据库读取每日总配额
    const dailyLimitRow = await db.prepare(
      "SELECT value FROM system_settings WHERE key = 'brevo_daily_limit'"
    ).get()
    const dailyLimit = dailyLimitRow ? parseInt(dailyLimitRow.value) : 200

    // 检查是否达到总配额
    if (todayCount >= dailyLimit) {
      logger.info(`今日已发送 ${todayCount} 封，达到总配额 ${dailyLimit}，跳过`)
      return
    }

    // 计算剩余配额（取总配额和群发配额的较小值）
    const remainingByDaily = dailyLimit - todayCount
    const remainingByCampaign = campaignDailyLimit
    const remainingQuota = Math.min(remainingByDaily, remainingByCampaign)
    logger.info(`今日剩余配额: ${remainingQuota}（总配额剩余: ${remainingByDaily}, 群发配额: ${remainingByCampaign}）`)

    await emailService.initClient(db)

    let remaining = remainingQuota
    for (const campaign of campaigns) {
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
    await db.prepare(
      "UPDATE email_campaigns SET status = 'sending', updated_at = ? WHERE id = ?"
    ).run(Math.floor(Date.now() / 1000), campaign.id)

    const targetUserIds = JSON.parse(campaign.target_users || '[]')
    const sentUsers = await db.prepare(
      'SELECT user_id FROM email_logs WHERE campaign_id = ? AND status = ?'
    ).all(campaign.id, 'sent')
    const sentUserIds = sentUsers.map(r => r.user_id)
    const pendingUserIds = targetUserIds.filter(id => !sentUserIds.includes(id))

    if (pendingUserIds.length === 0) {
      await db.prepare(
        "UPDATE email_campaigns SET status = 'completed', updated_at = ? WHERE id = ?"
      ).run(Math.floor(Date.now() / 1000), campaign.id)
      logger.info(`任务 ${campaign.id} 已完成`)
      return 0
    }

    const sendCount = Math.min(pendingUserIds.length, remainingQuota)
    const usersToSend = pendingUserIds.slice(0, sendCount)

    const users = await db.prepare(
      'SELECT id, email FROM users WHERE id = ANY(?)'
    ).all([usersToSend])

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

    await db.prepare(
      `UPDATE email_campaigns
       SET sent_count = ?, failed_count = ?, status = ?, updated_at = ?
       WHERE id = ?`
    ).run(newSentCount, newFailedCount, isCompleted ? 'completed' : 'pending', Math.floor(Date.now() / 1000), campaign.id)

    logger.info(`任务 ${campaign.id}: 发送 ${sentCount}, 失败 ${failedCount}`)
    return sentCount
  } catch (error) {
    logger.error(`任务 ${campaign.id} 处理失败: ${error.message}`)
    await db.prepare(
      "UPDATE email_campaigns SET status = 'pending', updated_at = ? WHERE id = ?"
    ).run(Math.floor(Date.now() / 1000), campaign.id)
    return 0
  }
}

async function logEmail(db, campaignId, userId, email, subject, status, errorMessage) {
  const now = Math.floor(Date.now() / 1000)
  await db.prepare(
    `INSERT INTO email_logs (campaign_id, user_id, email, subject, status, error_message, sent_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(campaignId, userId, email, subject, status, errorMessage, now, now)
}

async function cleanLogs(db, beforeDays = 30) {
  try {
    const beforeTime = Math.floor(Date.now() / 1000) - (beforeDays * 24 * 60 * 60)
    await db.prepare(
      'DELETE FROM email_logs WHERE created_at < ?'
    ).run(beforeTime)
    logger.info(`已清理过期日志`)
  } catch (error) {
    logger.error(`清理日志失败: ${error.message}`)
  }
}

module.exports = { processCampaigns, cleanLogs }

