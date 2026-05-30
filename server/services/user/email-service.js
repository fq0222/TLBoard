/**
 * 用户端 Email 服务。
 * 负责教程邮件与预设模板邮件发送的业务编排，并保持旧接口约束不变。
 */

const emailRepository = require('../../repositories/email-repository');
const sharedEmailService = require('../../integrations/email/email-service');

const ALLOWED_TEMPLATES = {
  'send-tutorial': 1,
  'send-invoice': 2
};

const TUTORIAL_TEMPLATE_MAP = {
  android: 'v2rayNg-App',
  windows: 'v2rayN-windows',
  github: 'GitHub',
  'apple-id': '苹果ID'
};

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

/**
 * 获取当前 Unix 时间戳。
 *
 * @returns {number} 秒级时间戳
 */
function getNowTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * 发送教程邮件。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {string} type - 教程类型
 * @returns {Promise<Object>} 发送结果
 */
async function sendTutorialEmail(db, userId, type) {
  const templateKeyword = TUTORIAL_TEMPLATE_MAP[type];
  if (!templateKeyword) {
    throw createLegacyBusinessError('无效的教程类型');
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTimestamp = Math.floor(today.getTime() / 1000);
  const todayMailCount = await emailRepository.countTodaySentTutorialEmails(db, userId, todayTimestamp);
  if (todayMailCount.count >= 2) {
    throw createLegacyBusinessError('今天已经发送过2封教程邮件，请明天再试', { code: 6006 });
  }

  const template = await emailRepository.findEmailTemplateByNameLike(db, templateKeyword);
  if (!template) {
    throw createLegacyBusinessError('教程模板不存在，请联系管理员', { code: 6003 });
  }

  const userVariables = await sharedEmailService.getUserVariables(db, userId);
  if (!userVariables) {
    throw createLegacyBusinessError('用户不存在', { code: 2004 });
  }

  const subject = sharedEmailService.replaceVariables(template.subject, userVariables);
  const content = sharedEmailService.replaceVariables(template.content, userVariables);
  await sharedEmailService.initClient(db);
  const result = await sharedEmailService.sendEmail(db, {
    to: userVariables.email,
    subject,
    content
  });

  if (result.success) {
    const now = getNowTimestamp();
    await emailRepository.createEmailLog(db, {
      userId,
      email: userVariables.email,
      subject,
      status: 'sent',
      sentAt: now,
      createdAt: now
    });
  }

  return result;
}

/**
 * 发送预设模板邮件。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {string} action - 白名单动作名
 * @param {Object} variables - 额外模板变量
 * @returns {Promise<Object>} 发送结果
 */
async function sendPresetEmail(db, userId, action, variables = {}) {
  const templateId = ALLOWED_TEMPLATES[action];
  if (!templateId) {
    throw createLegacyBusinessError('不允许的操作', { code: 1004 });
  }

  const template = await emailRepository.findEmailTemplateById(db, templateId);
  if (!template) {
    throw createLegacyBusinessError('模板不存在', { code: 6003 });
  }

  const userVariables = await sharedEmailService.getUserVariables(db, userId);
  if (!userVariables) {
    throw createLegacyBusinessError('用户不存在', { code: 2004 });
  }

  const allVariables = { ...userVariables, ...variables };
  const subject = sharedEmailService.replaceVariables(template.subject, allVariables);
  const content = sharedEmailService.replaceVariables(template.content, allVariables);
  await sharedEmailService.initClient(db);
  const result = await sharedEmailService.sendEmail(db, {
    to: userVariables.email,
    subject,
    content
  });

  if (result.success) {
    const now = getNowTimestamp();
    await emailRepository.createEmailLog(db, {
      userId,
      email: userVariables.email,
      subject,
      status: 'sent',
      sentAt: now,
      createdAt: now
    });
  }

  return result;
}

module.exports = {
  sendTutorialEmail,
  sendPresetEmail
};
