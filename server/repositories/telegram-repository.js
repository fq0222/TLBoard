/**
 * Telegram 一期仓储。
 * 负责管理员绑定、绑定码、告警、服务健康与命令日志的数据读写。
 */

/**
 * 按聊天会话查询管理员绑定关系。
 *
 * @param {Object} db - 数据库实例
 * @param {string} chatId - Telegram chat_id
 * @returns {Promise<Object|undefined>} 绑定记录
 */
async function findAdminBindingByChatId(db, chatId) {
  return db.prepare(`
    SELECT
      b.id,
      b.admin_id,
      b.chat_id,
      b.telegram_user_id,
      b.telegram_username,
      b.telegram_first_name,
      b.telegram_last_name,
      b.created_at,
      b.updated_at,
      a.username,
      a.is_super
    FROM telegram_admin_bindings b
    INNER JOIN admins a ON a.id = b.admin_id
    WHERE b.chat_id = ?
    LIMIT 1
  `).get(String(chatId));
}

/**
 * 按管理员 ID 查询绑定关系。
 *
 * @param {Object} db - 数据库实例
 * @param {number} adminId - 管理员 ID
 * @returns {Promise<Object|undefined>} 绑定记录
 */
async function findAdminBindingByAdminId(db, adminId) {
  return db.prepare(`
    SELECT *
    FROM telegram_admin_bindings
    WHERE admin_id = ?
    LIMIT 1
  `).get(adminId);
}

/**
 * 查询绑定码。
 *
 * @param {Object} db - 数据库实例
 * @param {string} bindCode - 绑定码
 * @returns {Promise<Object|undefined>} 绑定码记录
 */
async function findBindCodeByCode(db, bindCode) {
  return db.prepare(`
    SELECT
      c.*,
      a.username
    FROM telegram_bind_codes c
    INNER JOIN admins a ON a.id = c.admin_id
    WHERE c.bind_code = ?
    LIMIT 1
  `).get(String(bindCode).trim());
}

/**
 * 标记绑定码已消费。
 *
 * @param {Object} db - 数据库实例
 * @param {number} bindCodeId - 绑定码主键
 * @param {number} usedAt - 使用时间
 * @returns {Promise<void>}
 */
async function markBindCodeUsed(db, bindCodeId, usedAt) {
  await db.prepare(`
    UPDATE telegram_bind_codes
    SET used_at = ?, updated_at = ?
    WHERE id = ?
  `).run(usedAt, usedAt, bindCodeId);
}

/**
 * 创建管理员 Telegram 绑定关系。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 绑定信息
 * @returns {Promise<void>}
 */
async function createAdminBinding(db, payload) {
  const {
    adminId,
    chatId,
    telegramUserId,
    telegramUsername,
    telegramFirstName,
    telegramLastName,
    createdAt
  } = payload;

  await db.pool.query(`
    INSERT INTO telegram_admin_bindings (
      admin_id,
      chat_id,
      telegram_user_id,
      telegram_username,
      telegram_first_name,
      telegram_last_name,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
    ON CONFLICT (admin_id)
    DO UPDATE SET
      chat_id = EXCLUDED.chat_id,
      telegram_user_id = EXCLUDED.telegram_user_id,
      telegram_username = EXCLUDED.telegram_username,
      telegram_first_name = EXCLUDED.telegram_first_name,
      telegram_last_name = EXCLUDED.telegram_last_name,
      updated_at = EXCLUDED.updated_at
  `, [
    adminId,
    String(chatId),
    telegramUserId ? String(telegramUserId) : '',
    telegramUsername ? String(telegramUsername) : '',
    telegramFirstName ? String(telegramFirstName) : '',
    telegramLastName ? String(telegramLastName) : '',
    createdAt
  ]);
}

/**
 * 创建新的管理员绑定码。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 绑定码数据
 * @returns {Promise<Object>} 插入结果
 */
async function createBindCode(db, payload) {
  const {
    adminId,
    bindCode,
    expiresAt,
    createdByAdminId,
    createdAt
  } = payload;

  return db.prepare(`
    INSERT INTO telegram_bind_codes (
      admin_id,
      bind_code,
      expires_at,
      used_at,
      created_by_admin_id,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, NULL, ?, ?, ?)
  `).run(adminId, bindCode, expiresAt, createdByAdminId, createdAt, createdAt);
}

/**
 * 查询已绑定管理员列表。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Array>} 绑定列表
 */
async function listAdminBindings(db) {
  return db.prepare(`
    SELECT
      b.id,
      b.admin_id,
      b.chat_id,
      b.telegram_user_id,
      b.telegram_username,
      b.telegram_first_name,
      b.telegram_last_name,
      b.created_at,
      b.updated_at,
      a.username,
      a.is_super
    FROM telegram_admin_bindings b
    INNER JOIN admins a ON a.id = b.admin_id
    ORDER BY b.updated_at DESC, b.id DESC
  `).all();
}

/**
 * 记录 Telegram 命令日志。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 命令日志
 * @returns {Promise<void>}
 */
async function createCommandLog(db, payload) {
  const {
    bindingId = null,
    adminId = null,
    chatId = '',
    command = '',
    commandArgs = '',
    resultStatus = 'success',
    resultMessage = '',
    createdAt
  } = payload;

  await db.prepare(`
    INSERT INTO telegram_command_logs (
      binding_id,
      admin_id,
      chat_id,
      command,
      command_args,
      result_status,
      result_message,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    bindingId,
    adminId,
    String(chatId || ''),
    String(command || ''),
    String(commandArgs || ''),
    String(resultStatus || 'success'),
    String(resultMessage || '').slice(0, 1000),
    createdAt
  );
}

/**
 * 写入或更新单台服务器的健康状态。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 健康数据
 * @returns {Promise<void>}
 */
async function upsertServerHealthCheck(db, payload) {
  const {
    serverId,
    panelApiStatus,
    panelAuthStatus,
    xrayRuntimeStatus,
    lastSuccessAt = null,
    lastFailureAt = null,
    lastCheckedAt,
    consecutiveFailures = 0,
    failureReason = '',
    failureDetail = ''
  } = payload;

  await db.pool.query(`
    INSERT INTO telegram_server_health_checks (
      server_id,
      panel_api_status,
      panel_auth_status,
      xray_runtime_status,
      last_success_at,
      last_failure_at,
      last_checked_at,
      consecutive_failures,
      failure_reason,
      failure_detail,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $7)
    ON CONFLICT (server_id)
    DO UPDATE SET
      panel_api_status = EXCLUDED.panel_api_status,
      panel_auth_status = EXCLUDED.panel_auth_status,
      xray_runtime_status = EXCLUDED.xray_runtime_status,
      last_success_at = EXCLUDED.last_success_at,
      last_failure_at = EXCLUDED.last_failure_at,
      last_checked_at = EXCLUDED.last_checked_at,
      consecutive_failures = EXCLUDED.consecutive_failures,
      failure_reason = EXCLUDED.failure_reason,
      failure_detail = EXCLUDED.failure_detail,
      updated_at = EXCLUDED.updated_at
  `, [
    serverId,
    panelApiStatus,
    panelAuthStatus,
    xrayRuntimeStatus,
    lastSuccessAt,
    lastFailureAt,
    lastCheckedAt,
    consecutiveFailures,
    failureReason,
    failureDetail
  ]);
}

/**
 * 查询服务器健康总览。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Array>} 健康记录列表
 */
async function listServerHealthSummary(db) {
  return db.prepare(`
    SELECT
      h.server_id,
      s.name AS server_name,
      s.host AS server_host,
      h.panel_api_status,
      h.panel_auth_status,
      h.xray_runtime_status,
      h.last_success_at,
      h.last_failure_at,
      h.last_checked_at,
      h.consecutive_failures,
      h.failure_reason,
      h.failure_detail
    FROM telegram_server_health_checks h
    INNER JOIN xui_servers s ON s.id = h.server_id
    ORDER BY s.id ASC
  `).all();
}

/**
 * 查询单台服务器健康详情。
 *
 * @param {Object} db - 数据库实例
 * @param {number} serverId - 服务器 ID
 * @returns {Promise<Object|undefined>} 健康详情
 */
async function findServerHealthDetail(db, serverId) {
  return db.prepare(`
    SELECT
      h.server_id,
      s.name AS server_name,
      s.host AS server_host,
      h.panel_api_status,
      h.panel_auth_status,
      h.xray_runtime_status,
      h.last_success_at,
      h.last_failure_at,
      h.last_checked_at,
      h.consecutive_failures,
      h.failure_reason,
      h.failure_detail
    FROM telegram_server_health_checks h
    INNER JOIN xui_servers s ON s.id = h.server_id
    WHERE h.server_id = ?
    LIMIT 1
  `).get(serverId);
}

/**
 * 新建告警。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 告警数据
 * @returns {Promise<void>}
 */
async function createAlert(db, payload) {
  const {
    serverId,
    alertType,
    status,
    title,
    message,
    firstTriggeredAt,
    lastTriggeredAt,
    resolvedAt = null
  } = payload;

  await db.prepare(`
    INSERT INTO telegram_alert_records (
      server_id,
      alert_type,
      status,
      title,
      message,
      first_triggered_at,
      last_triggered_at,
      resolved_at,
      send_count,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    serverId,
    alertType,
    status,
    title,
    message,
    firstTriggeredAt,
    lastTriggeredAt,
    resolvedAt,
    firstTriggeredAt,
    lastTriggeredAt
  );
}

/**
 * 按服务器与告警类型查询开启中的告警。
 *
 * @param {Object} db - 数据库实例
 * @param {number} serverId - 服务器 ID
 * @param {string} alertType - 告警类型
 * @returns {Promise<Object|undefined>} 告警记录
 */
async function findOpenAlertByServerAndType(db, serverId, alertType) {
  return db.prepare(`
    SELECT *
    FROM telegram_alert_records
    WHERE server_id = ? AND alert_type = ? AND status = 'open'
    LIMIT 1
  `).get(serverId, alertType);
}

/**
 * 更新开启中的告警。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 告警更新数据
 * @returns {Promise<void>}
 */
async function updateOpenAlert(db, payload) {
  const {
    alertId,
    title,
    message,
    lastTriggeredAt
  } = payload;

  await db.prepare(`
    UPDATE telegram_alert_records
    SET title = ?, message = ?, last_triggered_at = ?, updated_at = ?
    WHERE id = ?
  `).run(title, message, lastTriggeredAt, lastTriggeredAt, alertId);
}

/**
 * 关闭告警。
 *
 * @param {Object} db - 数据库实例
 * @param {number} alertId - 告警 ID
 * @param {number} resolvedAt - 恢复时间
 * @returns {Promise<void>}
 */
async function resolveAlert(db, alertId, resolvedAt) {
  await db.prepare(`
    UPDATE telegram_alert_records
    SET status = 'resolved', resolved_at = ?, updated_at = ?
    WHERE id = ?
  `).run(resolvedAt, resolvedAt, alertId);
}

/**
 * 查询告警列表。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} filters - 查询条件
 * @returns {Promise<Array>} 告警列表
 */
async function listRecentAlerts(db, filters = {}) {
  const clauses = [];
  const params = [];

  if (filters.status) {
    clauses.push('r.status = ?');
    params.push(filters.status);
  }

  let sql = `
    SELECT
      r.id AS alert_id,
      r.server_id,
      s.name AS server_name,
      r.alert_type,
      r.status,
      r.title,
      r.message,
      r.first_triggered_at,
      r.last_triggered_at,
      r.resolved_at,
      r.last_sent_at,
      r.send_count,
      r.last_send_status,
      r.last_send_error
    FROM telegram_alert_records r
    INNER JOIN xui_servers s ON s.id = r.server_id
  `;

  if (clauses.length > 0) {
    sql += ` WHERE ${clauses.join(' AND ')}`;
  }

  sql += ' ORDER BY r.last_triggered_at DESC, r.id DESC LIMIT ?';
  params.push(filters.limit || 20);

  return db.prepare(sql).all(...params);
}

/**
 * 查询待发送告警。
 *
 * @param {Object} db - 数据库实例
 * @param {number} limit - 返回上限
 * @returns {Promise<Array>} 告警列表
 */
async function listPendingAlerts(db, limit) {
  return db.prepare(`
    SELECT
      r.id AS alert_id,
      r.server_id,
      s.name AS server_name,
      r.alert_type,
      r.status,
      r.title,
      r.message,
      r.first_triggered_at,
      r.last_triggered_at,
      r.resolved_at,
      r.last_sent_at,
      r.send_count,
      r.last_send_status,
      r.last_send_error
    FROM telegram_alert_records r
    INNER JOIN xui_servers s ON s.id = r.server_id
    WHERE r.status = 'open'
      AND (r.last_sent_at IS NULL OR r.last_sent_at < r.last_triggered_at)
    ORDER BY r.last_triggered_at DESC, r.id DESC
    LIMIT ?
  `).all(limit);
}

/**
 * 标记告警发送结果。
 *
 * @param {Object} db - 数据库实例
 * @param {number} alertId - 告警 ID
 * @param {Object} payload - 回执结果
 * @returns {Promise<void>}
 */
async function markAlertSent(db, alertId, payload) {
  const {
    resultStatus,
    deliveredCount = 0,
    telegramMessageId = '',
    resultMessage = '',
    sentAt
  } = payload;

  await db.prepare(`
    UPDATE telegram_alert_records
    SET
      last_sent_at = ?,
      send_count = COALESCE(send_count, 0) + ?,
      last_send_status = ?,
      last_send_message_id = ?,
      last_send_error = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    sentAt,
    resultStatus === 'sent' ? Math.max(Number(deliveredCount) || 0, 1) : 0,
    String(resultStatus || 'sent'),
    String(telegramMessageId || ''),
    String(resultMessage || '').slice(0, 1000),
    sentAt,
    alertId
  );
}

module.exports = {
  createAdminBinding,
  createAlert,
  createBindCode,
  createCommandLog,
  findAdminBindingByAdminId,
  findAdminBindingByChatId,
  findBindCodeByCode,
  findOpenAlertByServerAndType,
  findServerHealthDetail,
  listAdminBindings,
  listPendingAlerts,
  listRecentAlerts,
  listServerHealthSummary,
  markAlertSent,
  markBindCodeUsed,
  resolveAlert,
  updateOpenAlert,
  upsertServerHealthCheck
};

