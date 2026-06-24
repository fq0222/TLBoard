const sharedEmailService = require('../../integrations/email/email-service');
const emailRepository = require('../../repositories/email-repository');
const systemSettingsService = require('../admin/system-settings-service');
const { createLogger } = require('../../utils/logger');
const { getUserAppBaseUrl } = require('../../utils/site-url');

const logger = createLogger('ORDER-ACTIVATION-EMAIL');

/**
 * 获取当前秒级时间戳。
 *
 * @returns {number} 秒级 Unix 时间戳
 */
function getNowTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * 获取今日零点秒级时间戳。
 * 职责：与密码重置和群发邮件共享同一每日总配额统计窗口。
 *
 * @returns {number} 今日零点秒级时间戳
 */
function getTodayStartTimestamp() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor(today.getTime() / 1000);
}

/**
 * 转义 HTML 文本内容。
 * 职责：避免邮箱、套餐名和配置链接中的特殊字符破坏邮件 HTML。
 *
 * @param {*} value - 原始值
 * @returns {string} 可安全嵌入 HTML 文本节点或属性的字符串
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
 * 格式化流量字节数。
 * 职责：兼容 PostgreSQL 可能返回字符串的 BIGINT 字段。
 *
 * @param {*} bytes - 流量字节数
 * @returns {string} 人类可读流量
 */
function formatTraffic(bytes) {
  if (bytes === null || bytes === undefined || bytes === '') return '0 B';
  const numBytes = Number(bytes);
  if (!Number.isFinite(numBytes) || numBytes <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = numBytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const formattedSize = size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 2).replace(/\.00$/, '');
  return `${formattedSize} ${units[unitIndex]}`;
}

/**
 * 格式化订单金额。
 *
 * @param {*} amount - 订单金额，单位为分
 * @returns {string} 人民币金额文本
 */
function formatAmount(amount) {
  const cents = Number(amount);
  if (!Number.isFinite(cents) || cents <= 0) return '0.00 元';
  return `${(cents / 100).toFixed(2)} 元`;
}

/**
 * 格式化套餐有效期。
 *
 * @param {*} durationDays - 套餐天数，0 表示长期有效
 * @returns {string} 有效期文本
 */
function formatDuration(durationDays) {
  const days = Number(durationDays);
  if (!Number.isFinite(days) || days <= 0) return '长期有效';
  return `${days} 天`;
}

/**
 * 格式化到期时间。
 *
 * @param {*} expireAt - 秒级到期时间戳，0 表示无限期
 * @returns {string} 到期时间文本
 */
function formatExpireAt(expireAt) {
  const timestamp = Number(expireAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '无限期';
  return new Date(timestamp * 1000).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false
  });
}

/**
 * 从邮箱生成账号展示名。
 *
 * @param {string} email - 用户邮箱
 * @returns {string} 邮箱前缀用户名
 */
function getUsernameFromEmail(email) {
  const normalizedEmail = String(email || '').trim();
  return normalizedEmail.split('@')[0] || normalizedEmail;
}

/**
 * 检查 Brevo 每日总邮件配额是否仍有余量。
 * 职责：让开通提醒邮件计入并遵守后台配置的每日总发送限制。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Promise<{allowed:boolean,todayCount:number,dailyLimit:number}>} 配额状态
 */
async function checkDailyEmailQuota(db) {
  const todayCountRow = await emailRepository.countTodayEmailLogs(db, getTodayStartTimestamp());
  const dailyLimitRow = await emailRepository.findBrevoDailyLimit(db);
  const todayCount = Number(todayCountRow?.count || 0);
  const dailyLimit = dailyLimitRow ? parseInt(dailyLimitRow.value, 10) : 200;

  return {
    allowed: todayCount < dailyLimit,
    todayCount,
    dailyLimit
  };
}

/**
 * 生成账号开通提醒邮件 HTML。
 * 职责：把订单号、套餐详情、官方网站和官方电报频道封装成固定通知模板。
 *
 * @param {Object} payload - 模板数据
 * @returns {string} 邮件 HTML 内容
 */
function buildActivationEmailContent(payload) {
  const actionText = payload.isRenewOrder ? '续费已完成' : '账号已开通';
  const siteBaseUrl = String(payload.siteBaseUrl || '').trim();
  const telegramChannelUrl = String(payload.telegramChannelUrl || '').trim();
  const linkItems = [
    siteBaseUrl
      ? {
          buttonText: '访问官方网站',
          label: '官方网站',
          url: siteBaseUrl
        }
      : null,
    telegramChannelUrl
      ? {
          buttonText: '加入官方电报频道',
          label: '官方电报频道',
          url: telegramChannelUrl
        }
      : null
  ].filter(Boolean);
  const linkButtons = linkItems.length > 0
    ? `
          <table role="presentation" style="width:100%;border-collapse:collapse;margin:26px 0 12px;">
            <tr>
              ${linkItems.map((item, index) => `
                <td style="width:${Math.floor(100 / linkItems.length)}%;padding:${index === 0 ? '0 6px 0 0' : '0 0 0 6px'};text-align:center;">
                  <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" style="display:block;padding:12px 12px;border-radius:10px;background:#0f766e;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;">${escapeHtml(item.buttonText)}</a>
                </td>
              `).join('')}
            </tr>
          </table>
          ${linkItems.map((item) => `<p style="margin:0 0 12px;font-size:14px;color:#64748b;">${escapeHtml(item.label)}：<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" style="color:#0f766e;">${escapeHtml(item.url)}</a></p>`).join('')}
        `
    : '<p style="margin:0 0 12px;font-size:14px;color:#64748b;">官方链接暂未配置，请登录用户中心查看最新公告。</p>';

  return `
    <div style="margin:0;padding:32px 16px;background:#eef4f2;font-family:Arial,'Microsoft YaHei',sans-serif;color:#14213d;line-height:1.7;">
      <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #dce7e4;border-radius:16px;overflow:hidden;">
        <div style="padding:24px 28px;background:#0f766e;color:#ffffff;">
          <div style="font-size:14px;letter-spacing:0;font-weight:700;opacity:0.9;">天澜大陆消息</div>
          <h2 style="margin:8px 0 0;font-size:24px;line-height:1.35;font-weight:700;">${actionText}</h2>
        </div>
        <div style="padding:28px;">
          <p style="margin:0 0 18px;font-size:15px;color:#334155;">你好，${escapeHtml(payload.username)}，你的套餐订单已经处理完成。</p>
          <table style="width:100%;border-collapse:collapse;margin:18px 0;font-size:14px;color:#334155;">
            <tbody>
              <tr>
                <td style="width:120px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;color:#64748b;">订单号</td>
                <td style="padding:10px 12px;border:1px solid #e2e8f0;font-weight:700;">${escapeHtml(payload.outTradeNo)}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;color:#64748b;">套餐名称</td>
                <td style="padding:10px 12px;border:1px solid #e2e8f0;">${escapeHtml(payload.planName)}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;color:#64748b;">套餐流量</td>
                <td style="padding:10px 12px;border:1px solid #e2e8f0;">${escapeHtml(payload.trafficText)}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;color:#64748b;">有效期</td>
                <td style="padding:10px 12px;border:1px solid #e2e8f0;">${escapeHtml(payload.durationText)}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;color:#64748b;">到期时间</td>
                <td style="padding:10px 12px;border:1px solid #e2e8f0;">${escapeHtml(payload.expireText)}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;color:#64748b;">订单金额</td>
                <td style="padding:10px 12px;border:1px solid #e2e8f0;">${escapeHtml(payload.amountText)}</td>
              </tr>
            </tbody>
          </table>
          ${linkButtons}
          <div style="margin:22px 0;padding:14px 16px;border-left:4px solid #0f766e;background:#f0fdfa;border-radius:8px;color:#115e59;font-size:14px;">
            请登录用户中心生成或刷新订阅链接，并按页面提示完成客户端配置。
          </div>
          <p style="margin:18px 0 0;font-size:14px;color:#64748b;">如果你没有进行本次购买或续费，请尽快联系在线客服。</p>
        </div>
        <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px;">
          此邮件由系统自动发送，请勿直接回复。
        </div>
      </div>
    </div>
  `;
}

/**
 * 发送账号开通或续费提醒邮件。
 * 职责：复用系统邮件服务、统一每日配额和 email_logs 记账口径。
 * 核心分支：配额不足直接跳过；邮件失败只返回审计状态，不影响订单完结。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - 通知数据
 * @param {Object} payload.order - 已支付订单和用户快照
 * @param {Object} payload.plan - 套餐记录
 * @param {number} payload.expireAt - 支付完成后的到期时间
 * @param {boolean} payload.isRenewOrder - 是否续费订单
 * @returns {Promise<{sent:boolean,status:string,error?:string}>} 邮件发送审计结果
 */
async function sendOrderActivationEmail(db, payload) {
  const { order, plan, expireAt, isRenewOrder } = payload;
  const username = getUsernameFromEmail(order.email);
  const subject = `【天澜大陆消息】账号${username}开通提醒`;
  const now = getNowTimestamp();

  try {
    const quota = await checkDailyEmailQuota(db);
    if (!quota.allowed) {
      logger.warn(
        `跳过账号开通提醒邮件：每日配额已满 user=${order.user_id}, today=${quota.todayCount}, limit=${quota.dailyLimit}`
      );
      return {
        sent: false,
        status: 'daily_email_limit_reached'
      };
    }

    const subscriptionConfig = await systemSettingsService.getSubscriptionConfig(db);
    const emailResult = await sharedEmailService.sendEmail(db, {
      to: order.email,
      subject,
      content: buildActivationEmailContent({
        username,
        isRenewOrder,
        outTradeNo: order.out_trade_no,
        planName: plan.name || '未命名套餐',
        trafficText: formatTraffic(plan.traffic_limit),
        durationText: formatDuration(plan.duration_days),
        expireText: formatExpireAt(expireAt),
        amountText: formatAmount(order.amount),
        siteBaseUrl: getUserAppBaseUrl(),
        telegramChannelUrl: subscriptionConfig.telegram_channel_url
      })
    });

    if (!emailResult?.success) {
      logger.warn(`账号开通提醒邮件发送失败 user=${order.user_id}, error=${emailResult?.error || 'unknown'}`);
      return {
        sent: false,
        status: 'email_send_failed',
        error: emailResult?.error || ''
      };
    }

    await emailRepository.createEmailLog(db, {
      userId: order.user_id,
      email: order.email,
      subject,
      status: 'sent',
      sentAt: now,
      createdAt: now
    });

    logger.info(`账号开通提醒邮件发送成功 user=${order.user_id}, order=${order.out_trade_no}`);
    return {
      sent: true,
      status: 'email_sent'
    };
  } catch (error) {
    logger.error(`账号开通提醒邮件处理失败 user=${order.user_id}: ${error.message}`);
    return {
      sent: false,
      status: 'email_error',
      error: error.message
    };
  }
}

module.exports = {
  sendOrderActivationEmail,
  buildActivationEmailContent,
  checkDailyEmailQuota,
  formatTraffic,
  formatAmount,
  formatDuration,
  formatExpireAt,
  getUsernameFromEmail
};
