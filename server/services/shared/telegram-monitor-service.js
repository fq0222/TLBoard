const XuiService = require('../../integrations/xui/xui-service');
const telegramRepository = require('../../repositories/telegram-repository');
const trafficRepository = require('../../repositories/traffic-repository');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('TELEGRAM-MONITOR');

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
 * 归一化 Xray 运行状态，统一输出 Telegram 展示可识别的值。
 *
 * @param {string} status - 原始运行状态
 * @returns {string} 标准化后的运行状态
 */
function normalizeXrayRuntimeStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized) {
    return 'unknown';
  }

  if (['running', 'run', 'started', 'active', 'online'].includes(normalized)) {
    return 'running';
  }

  if (['stopped', 'stop', 'inactive', 'offline'].includes(normalized)) {
    return 'stopped';
  }

  return normalized || 'unknown';
}

/**
 * 判断面板失败是否属于鉴权失败。
 *
 * @param {string} message - 失败消息
 * @returns {boolean} 是否为鉴权失败
 */
function isPanelAuthFailure(message) {
  const normalized = String(message || '').trim().toLowerCase();
  return normalized.includes('status 401')
    || normalized.includes('status 403')
    || normalized.includes('unauthorized')
    || normalized.includes('forbidden')
    || normalized.includes('invalid token')
    || normalized.includes('api token');
}

/**
 * 将面板失败统一分类为 API 故障或鉴权故障。
 *
 * @param {string} message - 失败消息
 * @returns {{panelApiStatus: string, panelAuthStatus: string, failureReason: string}}
 */
function classifyPanelFailure(message) {
  if (isPanelAuthFailure(message)) {
    return {
      panelApiStatus: 'healthy',
      panelAuthStatus: 'unhealthy',
      failureReason: 'panel_auth_failed'
    };
  }

  return {
    panelApiStatus: 'unhealthy',
    panelAuthStatus: 'unknown',
    failureReason: 'panel_api_unreachable'
  };
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
    xrayRuntimeStatus: normalizeXrayRuntimeStatus(payload.xray_runtime_status),
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
 * 巡检单台服务器健康状态，并维护 Telegram 健康表与告警。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} server - 服务器配置
 * @returns {Promise<void>}
 */
async function checkSingleServerHealth(db, server) {
  const checkedAt = getNowTimestamp();

  try {
    const xuiService = await XuiService.getInstance(server.api_url, server.api_token, {
      apiVersion: server.panel_version || '3.0.2'
    });

    const serverStatusResult = await xuiService.getServerStatus();

    if (serverStatusResult.success) {
      const xrayRuntimeStatus = normalizeXrayRuntimeStatus(serverStatusResult.data?.xrayState);

      await recordServerHealthCheck(db, {
        server_id: server.id,
        panel_api_status: 'healthy',
        panel_auth_status: 'healthy',
        xray_runtime_status: xrayRuntimeStatus,
        last_success_at: checkedAt,
        last_checked_at: checkedAt,
        consecutive_failures: 0,
        failure_reason: '',
        failure_detail: ''
      });

      await resolveAlert(db, server.id, 'panel_unreachable');
      logger.info(`服务器 ${server.name} 巡检结果: panel_api_status=healthy, panel_auth_status=healthy, xray_runtime_status=${xrayRuntimeStatus}`);
      return;
    }

    const serverStatusFailureDetail = String(serverStatusResult.message || '').trim();
    logger.warn(`服务器 ${server.name} server/status 读取失败，准备回退 inbounds 判断面板状态: ${serverStatusFailureDetail || '未知错误'}`);

    const inboundsResult = await xuiService.getInbounds();
    if (!inboundsResult.success) {
      const failure = classifyPanelFailure(inboundsResult.message || '');
      const detail = String(inboundsResult.message || '').trim();
      logger.warn(`服务器 ${server.name} 面板探测失败: ${detail || '获取 inbounds 失败'}`);

      await recordServerHealthCheck(db, {
        server_id: server.id,
        panel_api_status: failure.panelApiStatus,
        panel_auth_status: failure.panelAuthStatus,
        xray_runtime_status: 'unknown',
        last_failure_at: checkedAt,
        last_checked_at: checkedAt,
        consecutive_failures: 1,
        failure_reason: failure.failureReason,
        failure_detail: detail
      });

      await openOrUpdateAlert(db, {
        server_id: server.id,
        alert_type: 'panel_unreachable',
        title: `${server.name} 面板巡检失败`,
        message: detail || '访问 3X-UI 面板失败',
        last_triggered_at: checkedAt
      });
      logger.warn(`服务器 ${server.name} 巡检结果: panel_api_status=${failure.panelApiStatus}, panel_auth_status=${failure.panelAuthStatus}, xray_runtime_status=unknown`);
      return;
    }

    logger.info(`服务器 ${server.name} 面板连通成功`);
    await recordServerHealthCheck(db, {
      server_id: server.id,
      panel_api_status: 'healthy',
      panel_auth_status: 'healthy',
      xray_runtime_status: 'unknown',
      last_success_at: checkedAt,
      last_checked_at: checkedAt,
      consecutive_failures: 0,
      failure_reason: '',
      failure_detail: serverStatusFailureDetail
    });

    await resolveAlert(db, server.id, 'panel_unreachable');
    logger.warn(`服务器 ${server.name} server/status 读取失败，已降级记录 xray_runtime_status=unknown`);
    logger.info(`服务器 ${server.name} 巡检结果: panel_api_status=healthy, panel_auth_status=healthy, xray_runtime_status=unknown`);
  } catch (error) {
    const detail = String(error.message || '').trim();
    logger.error(`服务器 ${server.name} 巡检异常: ${detail}`);

    await recordServerHealthCheck(db, {
      server_id: server.id,
      panel_api_status: 'unhealthy',
      panel_auth_status: 'unknown',
      xray_runtime_status: 'unknown',
      last_failure_at: checkedAt,
      last_checked_at: checkedAt,
      consecutive_failures: 1,
      failure_reason: 'server_health_check_exception',
      failure_detail: detail
    });

    await openOrUpdateAlert(db, {
      server_id: server.id,
      alert_type: 'panel_unreachable',
      title: `${server.name} 面板巡检异常`,
      message: detail || '服务器健康巡检异常',
      last_triggered_at: checkedAt
    });
  }
}

/**
 * 巡检所有在线服务器健康状态。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<void>}
 */
async function checkAllServersHealth(db) {
  const servers = await trafficRepository.listOnlineServers(db);
  logger.info(`开始执行 Telegram 服务器健康巡检，在线服务器 ${servers.length} 台`);

  if (servers.length === 0) {
    logger.warn('Telegram 服务器健康巡检结束：没有在线服务器');
    return;
  }

  let successCount = 0;
  let failureCount = 0;
  for (const server of servers) {
    try {
      await checkSingleServerHealth(db, server);
      successCount += 1;
    } catch (error) {
      failureCount += 1;
      logger.error(`服务器 ${server.name} 巡检执行失败: ${error.message}`);
    }
  }

  logger.info(`Telegram 服务器健康巡检完成：共 ${servers.length} 台，成功 ${successCount} 台，失败 ${failureCount} 台`);
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
  checkAllServersHealth,
  checkSingleServerHealth,
  openOrUpdateAlert,
  normalizeXrayRuntimeStatus,
  recordServerHealthCheck,
  resolveAlert
};
