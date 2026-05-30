/**
 * Email 仓储。
 * 负责 system_settings、email_templates、email_campaigns、email_logs、users、
 * resource_distributions 等与 email 模块相关的数据访问与事务操作。
 */

/**
 * 查询 Brevo 配置项。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Array<{key:string,value:string}>>} 配置项列表
 */
async function getBrevoConfigRows(db) {
  return db.prepare(
    "SELECT key, value FROM system_settings WHERE key LIKE 'brevo_%'"
  ).all();
}

/**
 * 保存单个 Brevo 配置项。
 * system_settings 的 UPSERT 使用 pool.query，避免 prepare().run() 自动拼接 RETURNING。
 *
 * @param {Object} db - 数据库实例
 * @param {string} key - 配置键
 * @param {string} value - 配置值
 * @param {number} updatedAt - 更新时间戳
 * @returns {Promise<void>}
 */
async function saveBrevoConfigValue(db, key, value, updatedAt) {
  await db.pool.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3`,
    [key, value, updatedAt]
  );
}

/**
 * 查询模板列表。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Array>} 模板列表
 */
async function listEmailTemplates(db) {
  return db.prepare('SELECT * FROM email_templates ORDER BY id DESC').all();
}

/**
 * 按 ID 查询模板。
 *
 * @param {Object} db - 数据库实例
 * @param {number|string} templateId - 模板 ID
 * @returns {Promise<Object|null>} 模板记录
 */
async function findEmailTemplateById(db, templateId) {
  return db.prepare('SELECT * FROM email_templates WHERE id = ?').get(templateId);
}

/**
 * 按名称关键字模糊查询模板。
 *
 * @param {Object} db - 数据库实例
 * @param {string} keyword - 模板关键字
 * @returns {Promise<Object|null>} 模板记录
 */
async function findEmailTemplateByNameLike(db, keyword) {
  return db.prepare(
    'SELECT * FROM email_templates WHERE name LIKE ? LIMIT 1'
  ).get(`%${keyword}%`);
}

/**
 * 创建模板。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 模板数据
 * @returns {Promise<Object>} 插入结果
 */
async function createEmailTemplate(db, payload) {
  const {
    name,
    subject,
    content,
    variables,
    createdAt,
    updatedAt
  } = payload;

  return db.prepare(
    `INSERT INTO email_templates (name, subject, content, variables, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(name, subject, content, variables, createdAt, updatedAt);
}

/**
 * 更新模板。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 模板数据
 * @returns {Promise<void>}
 */
async function updateEmailTemplate(db, payload) {
  const {
    id,
    name,
    subject,
    content,
    variables,
    updatedAt
  } = payload;

  await db.prepare(
    `UPDATE email_templates
     SET name = ?, subject = ?, content = ?, variables = ?, updated_at = ?
     WHERE id = ?`
  ).run(name, subject, content, variables, updatedAt, id);
}

/**
 * 删除模板。
 *
 * @param {Object} db - 数据库实例
 * @param {number|string} templateId - 模板 ID
 * @returns {Promise<void>}
 */
async function deleteEmailTemplate(db, templateId) {
  await db.prepare('DELETE FROM email_templates WHERE id = ?').run(templateId);
}

/**
 * 查询全部群发任务。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Array>} 群发任务列表
 */
async function listEmailCampaigns(db) {
  return db.prepare('SELECT * FROM email_campaigns ORDER BY id DESC').all();
}

/**
 * 按 ID 查询群发任务。
 *
 * @param {Object} db - 数据库实例
 * @param {number|string} campaignId - 任务 ID
 * @returns {Promise<Object|null>} 任务记录
 */
async function findEmailCampaignById(db, campaignId) {
  return db.prepare('SELECT * FROM email_campaigns WHERE id = ?').get(campaignId);
}

/**
 * 创建群发任务。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 任务数据
 * @returns {Promise<Object>} 插入结果
 */
async function createEmailCampaign(db, payload) {
  const {
    name,
    templateId,
    subject,
    content,
    targetType,
    targetUsers,
    totalCount,
    status,
    createdAt,
    updatedAt
  } = payload;

  return db.prepare(
    `INSERT INTO email_campaigns (
       name, template_id, subject, content, target_type, target_users, total_count, status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    name,
    templateId,
    subject,
    content,
    targetType,
    targetUsers,
    totalCount,
    status,
    createdAt,
    updatedAt
  );
}

/**
 * 更新群发任务状态。
 *
 * @param {Object} db - 数据库实例
 * @param {number|string} campaignId - 任务 ID
 * @param {string} nextStatus - 目标状态
 * @param {Array<string>} allowedStatuses - 允许切换的当前状态
 * @param {number} updatedAt - 更新时间戳
 * @returns {Promise<void>}
 */
async function updateEmailCampaignStatus(db, campaignId, nextStatus, allowedStatuses, updatedAt) {
  await db.prepare(
    `UPDATE email_campaigns
     SET status = ?, updated_at = ?
     WHERE id = ? AND status = ANY(?)`
  ).run(nextStatus, updatedAt, campaignId, allowedStatuses);
}

/**
 * 删除群发任务及其日志。
 * 使用独立连接保证删除日志和任务记录在同一事务中提交。
 *
 * @param {Object} db - 数据库实例
 * @param {number|string} campaignId - 任务 ID
 * @returns {Promise<void>}
 */
async function deleteEmailCampaignCascade(db, campaignId) {
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM email_logs WHERE campaign_id = $1', [campaignId]);
    await client.query('DELETE FROM email_campaigns WHERE id = $1', [campaignId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 查询指定群发任务的日志分页。
 *
 * @param {Object} db - 数据库实例
 * @param {number|string} campaignId - 任务 ID
 * @param {number} limit - 分页数量
 * @param {number} offset - 分页偏移
 * @returns {Promise<Array>} 日志列表
 */
async function listCampaignLogs(db, campaignId, limit, offset) {
  return db.prepare(
    'SELECT * FROM email_logs WHERE campaign_id = ? ORDER BY id DESC LIMIT ? OFFSET ?'
  ).all(campaignId, limit, offset);
}

/**
 * 统计指定群发任务的日志总数。
 *
 * @param {Object} db - 数据库实例
 * @param {number|string} campaignId - 任务 ID
 * @returns {Promise<{count:number}>} 数量结果
 */
async function countCampaignLogs(db, campaignId) {
  return db.prepare(
    'SELECT COUNT(*) as count FROM email_logs WHERE campaign_id = ?'
  ).get(campaignId);
}

/**
 * 查询全部邮件日志分页。
 *
 * @param {Object} db - 数据库实例
 * @param {number} limit - 分页数量
 * @param {number} offset - 分页偏移
 * @returns {Promise<Array>} 日志列表
 */
async function listEmailLogs(db, limit, offset) {
  return db.prepare(
    'SELECT * FROM email_logs ORDER BY id DESC LIMIT ? OFFSET ?'
  ).all(limit, offset);
}

/**
 * 统计全部邮件日志。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<{count:number}>} 数量结果
 */
async function countEmailLogs(db) {
  return db.prepare('SELECT COUNT(*) as count FROM email_logs').get();
}

/**
 * 写入邮件发送日志。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 日志数据
 * @returns {Promise<Object>} 插入结果
 */
async function createEmailLog(db, payload) {
  const {
    userId = null,
    campaignId = null,
    email,
    subject,
    status,
    sentAt,
    createdAt
  } = payload;

  return db.prepare(
    `INSERT INTO email_logs (user_id, campaign_id, email, subject, status, sent_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, campaignId, email, subject, status, sentAt, createdAt);
}

/**
 * 删除过期日志。
 *
 * @param {Object} db - 数据库实例
 * @param {number} beforeTime - 时间阈值
 * @returns {Promise<void>}
 */
async function deleteEmailLogsBefore(db, beforeTime) {
  await db.prepare('DELETE FROM email_logs WHERE created_at < ?').run(beforeTime);
}

/**
 * 批量删除日志。
 *
 * @param {Object} db - 数据库实例
 * @param {Array<number>} ids - 日志 ID 列表
 * @returns {Promise<void>}
 */
async function deleteEmailLogsByIds(db, ids) {
  await db.prepare('DELETE FROM email_logs WHERE id = ANY(?)').run(ids);
}

/**
 * 删除单条日志。
 *
 * @param {Object} db - 数据库实例
 * @param {number|string} logId - 日志 ID
 * @returns {Promise<void>}
 */
async function deleteEmailLogById(db, logId) {
  await db.prepare('DELETE FROM email_logs WHERE id = ?').run(logId);
}

/**
 * 查询用户搜索结果。
 *
 * @param {Object} db - 数据库实例
 * @param {string} keyword - 搜索关键字
 * @returns {Promise<Array<{id:number,email:string}>>} 用户列表
 */
async function searchUsersByEmail(db, keyword) {
  return db.prepare(
    'SELECT id, email FROM users WHERE email ILIKE ? LIMIT 20'
  ).all(`%${keyword}%`);
}

/**
 * 查询全部启用用户。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Array<{id:number,email:string}>>} 用户列表
 */
async function listEnabledUsers(db) {
  return db.prepare('SELECT id, email FROM users WHERE enabled = 1').all();
}

/**
 * 查询全部禁用用户。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Array<{id:number,email:string}>>} 用户列表
 */
async function listDisabledUsers(db) {
  return db.prepare('SELECT id, email FROM users WHERE enabled = 0').all();
}

/**
 * 按用户 ID 列表查询用户。
 *
 * @param {Object} db - 数据库实例
 * @param {Array<number>} userIds - 用户 ID 列表
 * @returns {Promise<Array<{id:number,email:string}>>} 用户列表
 */
async function findUsersByIds(db, userIds) {
  return db.prepare(
    'SELECT id, email FROM users WHERE id = ANY(?)'
  ).all(userIds);
}

/**
 * 查询生成邮件变量所需的用户资料。
 *
 * @param {Object} db - 数据库实例
 * @param {number|string} userId - 用户 ID
 * @returns {Promise<Object|null>} 用户资料
 */
async function findEmailUserProfileById(db, userId) {
  return db.prepare(
    `SELECT u.email, u.plan_id, u.traffic_used, u.traffic_limit, u.expire_at,
            p.name as plan_name
     FROM users u
     LEFT JOIN plans p ON u.plan_id = p.id
     WHERE u.id = ?`
  ).get(userId);
}

/**
 * 查询用户今天已发送的教程邮件数量。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {number} todayTimestamp - 今日零点时间戳
 * @returns {Promise<{count:number}>} 数量结果
 */
async function countTodaySentTutorialEmails(db, userId, todayTimestamp) {
  return db.prepare(
    'SELECT COUNT(*) as count FROM email_logs WHERE user_id = ? AND created_at >= ? AND status = ?'
  ).get(userId, todayTimestamp, 'sent');
}

/**
 * 查询用户最近一个有效下载令牌。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {number} now - 当前时间戳
 * @returns {Promise<{download_token:string}|null>} 下载令牌
 */
async function findLatestActiveDownloadTokenByUserId(db, userId, now) {
  return db.prepare(
    `SELECT download_token FROM resource_distributions
     WHERE user_id = ? AND enabled = 1
     AND (expire_at IS NULL OR expire_at > ?)
     ORDER BY created_at DESC LIMIT 1`
  ).get(userId, now);
}

module.exports = {
  getBrevoConfigRows,
  saveBrevoConfigValue,
  listEmailTemplates,
  findEmailTemplateById,
  findEmailTemplateByNameLike,
  createEmailTemplate,
  updateEmailTemplate,
  deleteEmailTemplate,
  listEmailCampaigns,
  findEmailCampaignById,
  createEmailCampaign,
  updateEmailCampaignStatus,
  deleteEmailCampaignCascade,
  listCampaignLogs,
  countCampaignLogs,
  listEmailLogs,
  countEmailLogs,
  createEmailLog,
  deleteEmailLogsBefore,
  deleteEmailLogsByIds,
  deleteEmailLogById,
  searchUsersByEmail,
  listEnabledUsers,
  listDisabledUsers,
  findUsersByIds,
  findEmailUserProfileById,
  countTodaySentTutorialEmails,
  findLatestActiveDownloadTokenByUserId
};
