const telegramRepository = require('../../repositories/telegram-repository');

/**
 * 归一化健康状态值，避免表中混入非预期文案。
 *
 * @param {string} status - 原始状态
 * @returns {string} 归一化结果
 */
function normalizeStatus(status) {
  const allowed = new Set(['healthy', 'unhealthy', 'unknown']);
  return allowed.has(status) ? status : 'unknown';
}

/**
 * 获取当前秒级时间戳。
 *
 * @returns {number} 秒级 Unix 时间戳
 */
function getNowTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * 记录单台服务器本次巡检的健康状态。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 健康状态
 * @returns {Promise<void>}
 */
async function recordServerHealthCheck(db, payload) {
  const now = payload.last_checked_at || getNowTimestamp();
  const normalizedPayload = {
    serverId: Number(payload.server_id),
    panelApiStatus: normalizeStatus(payload.panel_api_status),
    panelAuthStatus: normalizeStatus(payload.panel_auth_status),
    xrayRuntimeStatus: normalizeStatus(payload.xray_runtime_status),
    lastSuccessAt: payload.last_success_at || null,
    lastFailureAt: payload.last_failure_at || null,
    lastCheckedAt: now,
    consecutiveFailures: Number(payload.consecutive_failures) || 0,
    failureReason: payload.failure_reason || '',
    failureDetail: payload.failure_detail || ''
  };

  await telegramRepository.upsertServerHealthCheck(db, normalizedPayload);
}

/**
 * 打开或更新服务异常告警。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 告警信息
 * @returns {Promise<void>}
 */
async function openOrUpdateAlert(db, payload) {
  const now = payload.last_triggered_at || getNowTimestamp();
  const existing = await telegramRepository.findOpenAlertByServerAndType(
    db,
    Number(payload.server_id),
    payload.alert_type
  );

  if (existing) {
    await telegramRepository.updateOpenAlert(db, {
      alertId: existing.id,
      title: payload.title,
      message: payload.message,
      lastTriggeredAt: now
    });
    return;
  }

  await telegramRepository.createAlert(db, {
    serverId: Number(payload.server_id),
    alertType: payload.alert_type,
    status: 'open',
    title: payload.title,
    message: payload.message,
    firstTriggeredAt: now,
    lastTriggeredAt: now
  });
}

/**
 * 关闭指定类型的服务告警。
 *
 * @param {Object} db - 数据库实例
 * @param {number} serverId - 服务器 ID
 * @param {string} alertType - 告警类型
 * @returns {Promise<void>}
 */
async function resolveAlert(db, serverId, alertType) {
  const existing = await telegramRepository.findOpenAlertByServerAndType(db, Number(serverId), alertType);
  if (!existing) {
    return;
  }

  const now = getNowTimestamp();
  await telegramRepository.resolveAlert(db, existing.id, now);
}

/**
 * 获取服务器健康总览。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Object>} 总览数据
 */
async function getServersHealthSummary(db) {
  const list = await telegramRepository.listServerHealthSummary(db);
  return {
    total_servers: list.length,
    healthy_servers: list.filter((item) => item.panel_api_status === 'healthy' && item.panel_auth_status === 'healthy').length,
    unhealthy_servers: list.filter((item) => item.panel_api_status !== 'healthy' || item.panel_auth_status !== 'healthy').length,
    last_check_at: list.reduce((max, item) => Math.max(max, Number(item.last_checked_at) || 0), 0),
    servers: list
  };
}

/**
 * 获取单台服务器健康详情。
 *
 * @param {Object} db - 数据库实例
 * @param {number} serverId - 服务器 ID
 * @returns {Promise<Object>} 健康详情
 */
async function getServerHealthDetail(db, serverId) {
  const detail = await telegramRepository.findServerHealthDetail(db, Number(serverId));
  if (!detail) {
    const error = new Error('服务器健康记录不存在');
    error.isLegacyBusinessError = true;
    error.statusCode = 404;
    error.code = 404;
    error.data = null;
    throw error;
  }

  return detail;
}

/**
 * 查询告警列表。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} filters - 查询条件
 * @returns {Promise<Object>} 告警列表
 */
async function listAlerts(db, filters = {}) {
  return {
    list: await telegramRepository.listRecentAlerts(db, {
      status: filters.status || '',
      limit: Number(filters.limit) || 20
    })
  };
}

/**
 * 查询待发送告警，并拼出管理员接收人列表。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} filters - 查询条件
 * @returns {Promise<Object>} 待发送告警
 */
async function listPendingAlerts(db, filters = {}) {
  const [alerts, bindings] = await Promise.all([
    telegramRepository.listPendingAlerts(db, Number(filters.limit) || 20),
    telegramRepository.listAdminBindings(db)
  ]);

  return {
    list: alerts.map((item) => ({
      ...item,
      recipients: bindings.map((binding) => ({
        binding_id: binding.id,
        chat_id: binding.chat_id
      }))
    }))
  };
}

/**
 * 标记告警已发送。
 *
 * @param {Object} db - 数据库实例
 * @param {number} alertId - 告警 ID
 * @param {Object} payload - 回执数据
 * @returns {Promise<Object>} 更新结果
 */
async function markAlertSent(db, alertId, payload) {
  const sentAt = getNowTimestamp();
  await telegramRepository.markAlertSent(db, Number(alertId), {
    resultStatus: payload.result_status,
    deliveredCount: payload.delivered_count,
    telegramMessageId: payload.telegram_message_id,
    resultMessage: payload.result_message,
    sentAt
  });

  return {
    alert_id: Number(alertId),
    result_status: payload.result_status,
    delivered_count: Number(payload.delivered_count) || 0,
    sent_at: sentAt
  };
}

module.exports = {
  getServerHealthDetail,
  getServersHealthSummary,
  listAlerts,
  listPendingAlerts,
  markAlertSent,
  openOrUpdateAlert,
  recordServerHealthCheck,
  resolveAlert
};

