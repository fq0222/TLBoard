/**
 * 管理端 Email 服务。
 * 负责配置、模板、预览、发送、群发任务、日志清理与用户搜索等业务编排。
 */

const { parsePagination } = require('../../shared/utils/pagination');
const emailRepository = require('../../repositories/email-repository');
const sharedEmailService = require('../../integrations/email/email-service');
const systemSettingsService = require('./system-settings-service');

/**
 * 构造兼容旧接口的业务异常。
 *
 * @param {string} message - 错误消息
 * @param {Object} [options] - 扩展信息
 * @returns {Error} 业务异常
 */
function createLegacyBusinessError(message, options = {}) {
  const error = new Error(message);
  error.isLegacyBusinessError = true;
  error.statusCode = options.statusCode || 400;
  error.code = options.code || 1001;
  error.data = options.data === undefined ? null : options.data;
  return error;
}

function getNowTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * 规范化 ID 列表，过滤重复并阻止非法值。
 *
 * @param {Array<*>} ids - 原始 ID 列表
 * @param {string} emptyMessage - 空列表提示
 * @param {string} invalidMessage - 非法值提示
 * @returns {Array<number>} 规范化后的 ID 列表
 */
function normalizePositiveIntegerIds(ids, emptyMessage, invalidMessage) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw createLegacyBusinessError(emptyMessage);
  }

  const normalizedIds = [];
  const seenIds = new Set();

  for (const id of ids) {
    const parsedId = Number(id);
    if (!Number.isInteger(parsedId) || parsedId < 1) {
      throw createLegacyBusinessError(invalidMessage);
    }

    if (seenIds.has(parsedId)) {
      continue;
    }

    seenIds.add(parsedId);
    normalizedIds.push(parsedId);
  }

  return normalizedIds;
}

/**
 * 保证模板存在。
 *
 * @param {Object|null} template - 模板记录
 * @returns {Object} 模板记录
 */
function ensureTemplateExists(template) {
  if (!template) {
    throw createLegacyBusinessError('模板不存在', { code: 6003 });
  }

  return template;
}

/**
 * 保证群发任务存在。
 *
 * @param {Object|null} campaign - 群发任务记录
 * @returns {Object} 群发任务记录
 */
function ensureCampaignExists(campaign) {
  if (!campaign) {
    throw createLegacyBusinessError('任务不存在', { code: 6004 });
  }

  return campaign;
}

/**
 * 获取配置。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Object>} 配置对象
 */
async function getConfig(db) {
  return systemSettingsService.getEmailConfig(db);
}

/**
 * 保存配置。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 配置数据
 * @returns {Promise<void>}
 */
async function saveConfig(db, payload) {
  await systemSettingsService.saveEmailConfig(db, payload);
}

/**
 * 发送测试邮件。
 *
 * @param {Object} db - 数据库实例
 * @param {string} email - 收件邮箱
 * @returns {Promise<Object>} 发送结果
 */
async function sendTestEmail(db, email) {
  if (!email) {
    throw createLegacyBusinessError('请输入测试邮箱');
  }

  return sharedEmailService.sendTestEmail(db, { to: email });
}

/**
 * 查询模板列表。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Array>} 模板列表
 */
async function listTemplates(db) {
  return emailRepository.listEmailTemplates(db);
}

/**
 * 创建模板。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 模板数据
 * @returns {Promise<{id:number}>} 创建结果
 */
async function createTemplate(db, payload) {
  const { name, subject, content, variables } = payload;
  if (!name || !subject || !content) {
    throw createLegacyBusinessError('请填写完整信息');
  }

  const now = getNowTimestamp();
  const result = await emailRepository.createEmailTemplate(db, {
    name,
    subject,
    content,
    variables: JSON.stringify(variables || []),
    createdAt: now,
    updatedAt: now
  });

  return { id: Number(result.lastInsertRowid) };
}

/**
 * 更新模板。
 *
 * @param {Object} db - 数据库实例
 * @param {number} templateId - 模板 ID
 * @param {Object} payload - 模板数据
 * @returns {Promise<{id:number}>} 更新结果
 */
async function updateTemplate(db, templateId, payload) {
  const { name, subject, content, variables } = payload;
  if (!name || !subject || !content) {
    throw createLegacyBusinessError('请填写完整信息');
  }

  ensureTemplateExists(await emailRepository.findEmailTemplateById(db, templateId));
  await emailRepository.updateEmailTemplate(db, {
    id: templateId,
    name,
    subject,
    content,
    variables: JSON.stringify(variables || []),
    updatedAt: getNowTimestamp()
  });

  return { id: templateId };
}

/**
 * 删除模板。
 *
 * @param {Object} db - 数据库实例
 * @param {number} templateId - 模板 ID
 * @returns {Promise<void>}
 */
async function deleteTemplate(db, templateId) {
  await emailRepository.deleteEmailTemplate(db, templateId);
}

/**
 * 预览模板。
 *
 * @param {Object} db - 数据库实例
 * @param {number} templateId - 模板 ID
 * @param {number|string|undefined} userId - 预览用户 ID
 * @returns {Promise<{subject:string,content:string}>} 预览结果
 */
async function previewTemplate(db, templateId, userId) {
  const template = ensureTemplateExists(await emailRepository.findEmailTemplateById(db, templateId));
  let variables = {};

  if (userId) {
    variables = await sharedEmailService.getUserVariables(db, userId) || {};
  }

  return {
    subject: sharedEmailService.replaceVariables(template.subject, variables),
    content: sharedEmailService.replaceVariables(template.content, variables)
  };
}

/**
 * 发送单封邮件。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 发送参数
 * @returns {Promise<Object>} 发送结果
 */
async function sendSingleEmail(db, payload) {
  const { to, subject, content, user_id: userId } = payload;
  if (!to || !subject || !content) {
    throw createLegacyBusinessError('请填写完整信息');
  }

  let finalSubject = subject;
  let finalContent = content;

  if (userId) {
    const userVariables = await sharedEmailService.getUserVariables(db, userId);
    if (userVariables) {
      finalSubject = sharedEmailService.replaceVariables(subject, userVariables);
      finalContent = sharedEmailService.replaceVariables(content, userVariables);
    }
  }

  await sharedEmailService.initClient(db);
  const result = await sharedEmailService.sendEmail(db, {
    to,
    subject: finalSubject,
    content: finalContent
  });

  if (result.success) {
    const now = getNowTimestamp();
    await emailRepository.createEmailLog(db, {
      email: to,
      subject: finalSubject,
      status: 'sent',
      sentAt: now,
      createdAt: now,
      userId: userId ? Number(userId) : null
    });
  }

  return result;
}

/**
 * 解析群发目标用户。
 *
 * @param {Object} db - 数据库实例
 * @param {string} targetType - 目标类型
 * @param {Array<*>} targetUsers - 目标用户列表
 * @returns {Promise<Array<{id:number,email:string}>>} 用户列表
 */
async function resolveCampaignUsers(db, targetType, targetUsers) {
  if (targetType === 'all') {
    return emailRepository.listEnabledUsers(db);
  }

  if (targetType === 'disabled') {
    return emailRepository.listDisabledUsers(db);
  }

  const normalizedIds = normalizePositiveIntegerIds(
    targetUsers,
    '收件人列表为空',
    '收件人列表包含非法值'
  );
  return emailRepository.findUsersByIds(db, normalizedIds);
}

/**
 * 创建群发任务。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 任务参数
 * @returns {Promise<{id:number}>} 创建结果
 */
async function createCampaign(db, payload) {
  const { name, template_id: templateId, target_type: targetType, target_users: targetUsers } = payload;
  if (!name || !templateId || !targetType) {
    throw createLegacyBusinessError('请填写完整信息');
  }

  const template = ensureTemplateExists(await emailRepository.findEmailTemplateById(db, templateId));
  const users = await resolveCampaignUsers(db, targetType, targetUsers);
  const now = getNowTimestamp();
  const result = await emailRepository.createEmailCampaign(db, {
    name,
    templateId,
    subject: template.subject,
    content: template.content,
    targetType,
    targetUsers: JSON.stringify(users.map((user) => user.id)),
    totalCount: users.length,
    status: 'pending',
    createdAt: now,
    updatedAt: now
  });

  return { id: Number(result.lastInsertRowid) };
}

/**
 * 查询群发任务列表。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Array>} 群发任务列表
 */
async function listCampaigns(db) {
  return emailRepository.listEmailCampaigns(db);
}

/**
 * 查询群发任务详情。
 *
 * @param {Object} db - 数据库实例
 * @param {number} campaignId - 任务 ID
 * @returns {Promise<Object>} 任务详情
 */
async function getCampaignDetail(db, campaignId) {
  return ensureCampaignExists(await emailRepository.findEmailCampaignById(db, campaignId));
}

/**
 * 暂停群发任务。
 *
 * @param {Object} db - 数据库实例
 * @param {number} campaignId - 任务 ID
 * @returns {Promise<{id:number}>} 操作结果
 */
async function pauseCampaign(db, campaignId) {
  ensureCampaignExists(await emailRepository.findEmailCampaignById(db, campaignId));
  await emailRepository.updateEmailCampaignStatus(
    db,
    campaignId,
    'paused',
    ['pending', 'sending'],
    getNowTimestamp()
  );
  return { id: campaignId };
}

/**
 * 恢复群发任务。
 *
 * @param {Object} db - 数据库实例
 * @param {number} campaignId - 任务 ID
 * @returns {Promise<{id:number}>} 操作结果
 */
async function resumeCampaign(db, campaignId) {
  ensureCampaignExists(await emailRepository.findEmailCampaignById(db, campaignId));
  await emailRepository.updateEmailCampaignStatus(
    db,
    campaignId,
    'pending',
    ['paused'],
    getNowTimestamp()
  );
  return { id: campaignId };
}

/**
 * 删除群发任务。
 *
 * @param {Object} db - 数据库实例
 * @param {number} campaignId - 任务 ID
 * @returns {Promise<void>}
 */
async function deleteCampaign(db, campaignId) {
  ensureCampaignExists(await emailRepository.findEmailCampaignById(db, campaignId));
  await emailRepository.deleteEmailCampaignCascade(db, campaignId);
}

/**
 * 查询群发日志分页。
 *
 * @param {Object} db - 数据库实例
 * @param {number} campaignId - 任务 ID
 * @param {Object} query - 分页参数
 * @returns {Promise<Object>} 分页结果
 */
async function listCampaignLogs(db, campaignId, query) {
  ensureCampaignExists(await emailRepository.findEmailCampaignById(db, campaignId));
  const { page, limit, offset } = parsePagination(query, {
    defaultPage: 1,
    defaultLimit: 50,
    maxLimit: 200
  });
  const list = await emailRepository.listCampaignLogs(db, campaignId, limit, offset);
  const total = await emailRepository.countCampaignLogs(db, campaignId);

  return {
    list,
    total: total.count,
    page,
    limit
  };
}

/**
 * 查询全部邮件日志分页。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} query - 分页参数
 * @returns {Promise<Object>} 分页结果
 */
async function listLogs(db, query) {
  const { page, limit, offset } = parsePagination(query, {
    defaultPage: 1,
    defaultLimit: 10,
    maxLimit: 200
  });
  const list = await emailRepository.listEmailLogs(db, limit, offset);
  const total = await emailRepository.countEmailLogs(db);

  return {
    list,
    total: total.count,
    page,
    limit
  };
}

/**
 * 清理过期日志。
 *
 * @param {Object} db - 数据库实例
 * @param {number|string|undefined} beforeDays - 保留天数
 * @returns {Promise<void>}
 */
async function clearExpiredLogs(db, beforeDays) {
  const normalizedDays = Number(beforeDays || 30);
  const beforeTime = getNowTimestamp() - (normalizedDays * 24 * 60 * 60);
  await emailRepository.deleteEmailLogsBefore(db, beforeTime);
}

/**
 * 批量删除日志。
 *
 * @param {Object} db - 数据库实例
 * @param {Array<*>} ids - 日志 ID 列表
 * @returns {Promise<void>}
 */
async function batchDeleteLogs(db, ids) {
  const normalizedIds = normalizePositiveIntegerIds(
    ids,
    '请选择要删除的日志',
    '日志 ID 列表包含非法值'
  );
  await emailRepository.deleteEmailLogsByIds(db, normalizedIds);
}

/**
 * 删除单条日志。
 *
 * @param {Object} db - 数据库实例
 * @param {number} logId - 日志 ID
 * @returns {Promise<void>}
 */
async function deleteLog(db, logId) {
  await emailRepository.deleteEmailLogById(db, logId);
}

/**
 * 按关键字搜索用户。
 *
 * @param {Object} db - 数据库实例
 * @param {string} keyword - 搜索关键字
 * @returns {Promise<Array>} 用户列表
 */
async function searchUsers(db, keyword) {
  if (!keyword) {
    return [];
  }

  return emailRepository.searchUsersByEmail(db, keyword);
}

module.exports = {
  getConfig,
  saveConfig,
  sendTestEmail,
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  previewTemplate,
  sendSingleEmail,
  createCampaign,
  listCampaigns,
  getCampaignDetail,
  pauseCampaign,
  resumeCampaign,
  deleteCampaign,
  listCampaignLogs,
  listLogs,
  clearExpiredLogs,
  batchDeleteLogs,
  deleteLog,
  searchUsers
};
