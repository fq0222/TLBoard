/**
 * 续费提醒邮件服务。
 * 负责构建流量耗尽/套餐到期邮件，并统一执行配额检查、发送与审计日志记录。
 */

const sharedEmailService = require('../../integrations/email/email-service');
const emailRepository = require('../../repositories/email-repository');
const { createLogger } = require('../../utils/logger');
const { getUserAppBaseUrl } = require('../../utils/site-url');
const {
  checkDailyEmailQuota,
  formatTraffic,
  formatExpireAt,
  getUsernameFromEmail
} = require('./order-activation-email-service');

const logger = createLogger('RENEWAL-REQUIRED-EMAIL');
const SUPPORTED_REASONS = new Set(['traffic_limit', 'expired']);
const RENEWAL_EMAIL_SEND_TIMEOUT_MS = 15 * 1000;

/**
 * 仅为续费提醒邮件提供有限等待，避免持有 users 行锁期间无限阻塞续费事务。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - 底层邮件发送参数
 * @param {number} [timeoutMs=RENEWAL_EMAIL_SEND_TIMEOUT_MS] - 最大等待毫秒数
 * @returns {Promise<{timedOut:boolean,result?:Object}>} 超时状态或底层发送结果
 */
async function sendEmailWithTimeout(
  db,
  payload,
  timeoutMs = RENEWAL_EMAIL_SEND_TIMEOUT_MS
) {
  let timeoutHandle;
  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });

  try {
    return await Promise.race([
      sharedEmailService.sendEmail(db, payload).then((result) => ({
        timedOut: false,
        result
      })),
      timeoutPromise
    ]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * 转义邮件 HTML 中的动态文本。
 * 职责：防止邮箱、套餐名和链接中的特殊字符被解释为 HTML。
 *
 * @param {*} value - 原始动态值
 * @returns {string} 可安全嵌入 HTML 的文本
 */
function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 构建续费提醒邮件主题。
 * 职责：从邮箱 @ 前缀提取实际用户名，确保模板占位符不会进入最终邮件。
 *
 * @param {string} email - 用户邮箱
 * @returns {string} 完整邮件主题
 */
function buildRenewalRequiredEmailSubject(email) {
  const username = getUsernameFromEmail(email);
  return `【天澜大陆消息】亲爱的 ${username}，您的魔法传送能量已经耗尽！`;
}

/**
 * 构建续费提醒 HTML 正文。
 * 职责：按停用原因展示明确提醒，并呈现账户、套餐、流量和到期资料。
 * 核心分支：仅接受 traffic_limit 与 expired，避免未知原因发送误导文案。
 *
 * @param {Object} profile - 用户与套餐资料
 * @param {string} profile.email - 用户邮箱
 * @param {string} profile.plan_name - 套餐名称
 * @param {*} profile.traffic_used - 已用流量字节数
 * @param {*} profile.traffic_limit - 流量上限字节数
 * @param {*} profile.expire_at - 秒级到期时间戳
 * @param {'traffic_limit'|'expired'} reason - 提醒原因
 * @returns {string} 邮件 HTML
 */
function buildRenewalRequiredEmailContent(profile, reason) {
  if (!SUPPORTED_REASONS.has(reason)) {
    throw new Error(`不支持的续费提醒 reason: ${reason}`);
  }

  const reasonText = reason === 'traffic_limit'
    ? '您的魔法传送能量已经耗尽，请及时续费以恢复服务。'
    : '您的限时套餐已经到期，请及时续费以继续使用服务。';
  const userCenterUrl = getUserAppBaseUrl();
  const rows = [
    ['账号', profile.email],
    ['套餐', profile.plan_name || '未命名套餐'],
    ['已用流量', formatTraffic(profile.traffic_used)],
    ['流量上限', formatTraffic(profile.traffic_limit)],
    ['到期时间', formatExpireAt(profile.expire_at)]
  ].map(([label, value]) => `
    <tr>
      <td style="width:120px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;color:#64748b;">${label}</td>
      <td style="padding:10px 12px;border:1px solid #e2e8f0;">${escapeHtml(value)}</td>
    </tr>`).join('');

  return `
    <div style="margin:0;padding:32px 12px;background:#f0fdf4;font-family:Arial,'Microsoft YaHei',sans-serif;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #dcfce7;border-radius:14px;overflow:hidden;">
        <div style="padding:24px 28px;background:#16a34a;color:#ffffff;">
          <h1 style="margin:0;font-size:22px;">天澜大陆消息</h1>
        </div>
        <div style="padding:28px;">
          <p style="margin:0 0 18px;color:#334155;">亲爱的 ${escapeHtml(getUsernameFromEmail(profile.email))}：</p>
          <div style="padding:14px 16px;background:#f0fdf4;border-left:4px solid #16a34a;border-radius:8px;color:#166534;">
            ${reasonText}
          </div>
          <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;color:#334155;">
            <tbody>${rows}</tbody>
          </table>
          <div style="text-align:center;margin:24px 0 8px;">
            <a href="${escapeHtml(userCenterUrl)}" style="display:inline-block;padding:12px 24px;background:#16a34a;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">前往用户中心</a>
          </div>
        </div>
        <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px;">
          此邮件由系统自动发送，请勿直接回复。
        </div>
      </div>
    </div>`;
}

/**
 * 发送续费提醒邮件。
 * 职责：内部查询用户套餐资料，复用每日总配额，并仅为成功发送写入 email_logs。
 * 核心分支：配额满、资料缺失、Brevo 失败或异常均返回审计状态，不抛错也不重试。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - 发送参数
 * @param {number|string} payload.userId - 用户 ID
 * @param {'traffic_limit'|'expired'} payload.reason - 提醒原因
 * @param {Object} [options={}] - 续费提醒发送选项
 * @param {number} [options.sendTimeoutMs=15000] - 底层邮件调用最大等待毫秒数
 * @returns {Promise<{sent:boolean,status:string,error?:string}>} 发送审计结果
 */
async function sendRenewalRequiredEmail(db, payload = {}, options = {}) {
  let userId;
  try {
    if (!payload || typeof payload !== 'object') {
      return { sent: false, status: 'invalid_request' };
    }
    ({ userId } = payload);
    const { reason } = payload;
    if (userId === undefined || userId === null) {
      return { sent: false, status: 'invalid_request' };
    }
    if (!SUPPORTED_REASONS.has(reason)) {
      return { sent: false, status: 'invalid_reason' };
    }

    const quota = await checkDailyEmailQuota(db);
    if (!quota.allowed) {
      return { sent: false, status: 'daily_email_limit_reached' };
    }

    const profile = await emailRepository.findEmailUserProfileById(db, userId);
    if (!profile?.email) {
      return { sent: false, status: 'user_email_not_found' };
    }

    const subject = buildRenewalRequiredEmailSubject(profile.email);
    const sendAttempt = await sendEmailWithTimeout(db, {
      to: profile.email,
      subject,
      content: buildRenewalRequiredEmailContent(profile, reason)
    }, options.sendTimeoutMs);
    if (sendAttempt.timedOut) {
      return { sent: false, status: 'email_send_timeout' };
    }

    const result = sendAttempt.result;
    if (!result?.success) {
      return {
        sent: false,
        status: 'email_send_failed',
        error: result?.error || ''
      };
    }

    const now = Math.floor(Date.now() / 1000);
    try {
      await emailRepository.createEmailLog(db, {
        userId,
        email: profile.email,
        subject,
        status: 'sent',
        sentAt: now,
        createdAt: now
      });
    } catch (error) {
      logger.warn(`续费提醒邮件已发送但日志写入失败 user=${userId}: ${error.message}`);
      return {
        sent: true,
        status: 'email_sent_log_failed',
        error: error.message
      };
    }
    return { sent: true, status: 'email_sent' };
  } catch (error) {
    logger.error(`续费提醒邮件处理失败 user=${userId}: ${error.message}`);
    return {
      sent: false,
      status: 'email_error',
      error: error.message
    };
  }
}

module.exports = {
  sendRenewalRequiredEmail,
  sendEmailWithTimeout,
  buildRenewalRequiredEmailContent,
  buildRenewalRequiredEmailSubject,
  RENEWAL_EMAIL_SEND_TIMEOUT_MS
};
