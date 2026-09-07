const XuiService = require('../../integrations/xui/xui-service');
const { runWithConcurrency } = require('../../utils/concurrency');
let repository = require('../../repositories/user-home-routing-repository');

const HOME_ROUTING_SYNC_CONCURRENCY = 10;
const HOME_ROUTING_COOLDOWN_SECONDS = 5 * 60;
const XUI_XRAY_TIMEOUT = 30000;
const XUI_INBOUNDS_TIMEOUT = 30000;

let xuiServiceFactory = XuiService.getInstance.bind(XuiService);

/**
 * 用户家宽 IP routing 服务。
 * 职责：校验用户家宽权益、维护本地绑定记录，并将 routing rule 同步到 3X-UI。
 */

/**
 * 构造兼容旧接口的业务错误。
 *
 * @param {string} message - 错误提示
 * @param {Object} [options={}] - 错误响应配置
 * @returns {Error} 可被 controller 识别的业务异常
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
 * 获取当前秒级时间戳。
 *
 * @returns {number} 秒级 Unix 时间戳
 */
function getNowTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * 归一化用户选择的服务器 ID。
 * 核心分支：非法数字被过滤，重复 ID 去重，超过两台由业务层拒绝。
 *
 * @param {Array} serverIds - 前端提交的服务器 ID
 * @returns {number[]} 去重后的正整数 ID
 */
function normalizeServerIds(serverIds) {
  if (!Array.isArray(serverIds)) {
    return [];
  }

  return Array.from(new Set(serverIds
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0)));
}

/**
 * 解析数据库保存的服务器 ID JSON。
 *
 * @param {string|number[]|undefined|null} value - 服务器 ID JSON 或数组
 * @returns {number[]} 归一化服务器 ID
 */
function parseServerIds(value) {
  if (Array.isArray(value)) {
    return normalizeServerIds(value);
  }
  if (!value) {
    return [];
  }

  try {
    return normalizeServerIds(JSON.parse(value));
  } catch (error) {
    return [];
  }
}

function parseJsonLikeConfig(value, label) {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`解析 ${label} 失败: ${error.message}`);
  }
}

function isXraySettingObject(value) {
  return Boolean(value && typeof value === 'object' && (
    Array.isArray(value.inbounds) ||
    Array.isArray(value.outbounds) ||
    value.routing !== undefined
  ));
}

/**
 * 递归拆出 3X-UI 返回中的真实 Xray 配置。
 * 核心分支：有些面板会把 xraySetting 再包一层对象或字符串，直到出现 inbounds/outbounds/routing 才是配置本体。
 *
 * @param {*} value - 候选配置或包装对象
 * @param {number} [depth=0] - 当前递归层数，防止异常响应无限拆包
 * @returns {Object|undefined} 真实 Xray 配置，无法识别时返回 undefined
 */
function unwrapXraySetting(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) {
    return undefined;
  }

  const parsed = parseJsonLikeConfig(value, 'Xray 配置');
  if (isXraySettingObject(parsed)) {
    return parsed;
  }

  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }

  const nestedCandidates = [
    parsed.xraySetting,
    parsed.xray_setting,
    parsed.setting,
    parsed.config,
    parsed.xrayConfig,
    parsed.xray_config
  ].filter((item) => item !== undefined && item !== null);

  for (const candidate of nestedCandidates) {
    const unwrapped = unwrapXraySetting(candidate, depth + 1);
    if (unwrapped) {
      return unwrapped;
    }
  }

  return undefined;
}

/**
 * 从 3X-UI 响应中解析完整 Xray 配置。
 * 核心分支：兼容 3X-UI 返回的多层包装对象和字符串化 xraySetting。
 *
 * @param {Object|string} response - 3X-UI 原始响应
 * @returns {Object} Xray 配置对象
 */
function normalizeXraySetting(response) {
  const root = parseJsonLikeConfig(response?.obj !== undefined ? response.obj : response, 'Xray 配置响应');
  const xraySetting = unwrapXraySetting(root)
    || unwrapXraySetting(response?.data)
    || unwrapXraySetting(response);

  if (xraySetting) {
    return xraySetting;
  }

  throw new Error('3X-UI 未返回有效 Xray 配置');
}

/**
 * 从 Xray 配置响应中提取出站测试 URL，回写时原样保留。
 *
 * @param {Object|string} response - 3X-UI 原始响应
 * @returns {string|undefined} 出站测试 URL
 */
function extractOutboundTestUrl(response) {
  const root = parseJsonLikeConfig(response?.obj !== undefined ? response.obj : response, 'Xray 配置响应');
  const value =
    root?.outboundTestUrl ||
    root?.outbound_test_url ||
    response?.data?.outboundTestUrl ||
    response?.outboundTestUrl;

  return value === undefined || value === null ? undefined : String(value);
}

/**
 * 确保 Xray 配置具备 routing.rules 数组。
 *
 * @param {Object} xraySetting - 完整 Xray 配置
 * @returns {Array} routing.rules 数组
 */
function ensureRoutingRules(xraySetting) {
  if (!xraySetting.routing || typeof xraySetting.routing !== 'object') {
    xraySetting.routing = {};
  }
  if (!Array.isArray(xraySetting.routing.rules)) {
    xraySetting.routing.rules = [];
  }

  return xraySetting.routing.rules;
}

/**
 * 从完整 Xray 配置读取全部真实 inbound tag。
 *
 * @param {Object} xraySetting - 完整 Xray 配置
 * @returns {string[]} 去重后的 inbound tag 列表
 */
function extractInboundTags(xraySetting) {
  return Array.from(new Set((xraySetting.inbounds || [])
    .filter((inbound) => inbound?.tag !== 'api' && inbound?.protocol !== 'tunnel')
    .map((inbound) => String(inbound?.tag || '').trim())
    .filter(Boolean)));
}

/**
 * 从实时 inbounds/list 响应中提取业务 inbound tag。
 * 核心分支：getInbounds 可能返回标准化 data，也可能在测试或底层场景中保留原始 obj。
 *
 * @param {Object|Array} result - 3X-UI inbounds 响应
 * @returns {string[]} 去重后的业务 inbound tag
 */
function extractInboundTagsFromInboundsResult(result) {
  const inbounds = Array.isArray(result)
    ? result
    : (Array.isArray(result?.data) ? result.data : result?.obj);

  return extractInboundTags({ inbounds: Array.isArray(inbounds) ? inbounds : [] });
}

/**
 * 读取单台服务器真实 inbound tag。
 * 核心分支：优先使用完整 Xray 配置；若面板版本未在 xray 接口返回 inbounds，则回退到实时 inbounds/list。
 *
 * @param {Object} xuiService - 当前服务器的 XUI service
 * @param {Object} xraySetting - 已读取的 Xray 配置
 * @returns {Promise<string[]>} 去重后的业务 inbound tag
 */
async function resolveInboundTags(xuiService, xraySetting) {
  const xrayInboundTags = extractInboundTags(xraySetting);
  if (xrayInboundTags.length > 0) {
    return xrayInboundTags;
  }

  const inboundsResult = await xuiService.getInbounds({ timeout: XUI_INBOUNDS_TIMEOUT });
  if (inboundsResult && inboundsResult.success === false) {
    throw new Error(inboundsResult.message || inboundsResult.msg || '获取入站列表失败');
  }

  return extractInboundTagsFromInboundsResult(inboundsResult);
}

/**
 * 判断 rule 是否属于当前用户当前家宽 tag。
 *
 * @param {Object} rule - routing rule
 * @param {string} homeProxyTag - 家宽 outbound tag
 * @param {string} email - 当前用户邮箱
 * @returns {boolean} 是否匹配
 */
function isMatchingHomeRule(rule, homeProxyTag, email) {
  if (!rule || rule.type !== 'field' || rule.outboundTag !== homeProxyTag) {
    return false;
  }

  const users = Array.isArray(rule.user) ? rule.user : [];
  return users.includes(email);
}

function isHomeUserRule(rule, homeProxyTag) {
  return Boolean(rule
    && rule.type === 'field'
    && rule.outboundTag === homeProxyTag
    && Array.isArray(rule.user));
}

function normalizeRuleUsers(users) {
  return Array.from(new Set((users || [])
    .map((user) => String(user || '').trim())
    .filter(Boolean)));
}

/**
 * 从当前家宽 tag 的 routing rule 中移除当前用户。
 * 核心分支：共享 rule 仍有其他用户时保留 rule；当前用户是最后一个用户时删除 rule。
 *
 * @param {Object} xraySetting - 完整 Xray 配置
 * @param {string} homeProxyTag - 家宽 outbound tag
 * @param {string} email - 当前用户邮箱
 * @returns {number} 受影响的 rule 数量
 */
function removeMatchingHomeRules(xraySetting, homeProxyTag, email) {
  const rules = ensureRoutingRules(xraySetting);
  let affectedCount = 0;

  xraySetting.routing.rules = rules
    .map((rule) => {
      if (!isMatchingHomeRule(rule, homeProxyTag, email)) {
        return rule;
      }

      affectedCount += 1;
      return {
        ...rule,
        user: normalizeRuleUsers(rule.user).filter((user) => user !== email)
      };
    })
    .filter((rule) => !isHomeUserRule(rule, homeProxyTag) || rule.user.length > 0);

  return affectedCount;
}

/**
 * 合并当前用户到共享家宽 routing rule。
 * 核心分支：inboundTag 为空说明远端配置不可用，应抛错并阻止本地保存。
 *
 * @param {Object} xraySetting - 完整 Xray 配置
 * @param {string} homeProxyTag - 家宽 outbound tag
 * @param {string} email - 当前用户邮箱
 * @returns {Object} 新增的 routing rule
 */
function upsertHomeRoutingRule(xraySetting, homeProxyTag, email, inboundTags = extractInboundTags(xraySetting)) {
  if (inboundTags.length === 0) {
    throw new Error('入站 tag 为空');
  }

  const existingRules = ensureRoutingRules(xraySetting);
  const mergedUsers = [];
  xraySetting.routing.rules = existingRules.filter((rule) => {
    if (!isHomeUserRule(rule, homeProxyTag)) {
      return true;
    }

    mergedUsers.push(...normalizeRuleUsers(rule.user));
    return false;
  });
  mergedUsers.push(email);

  const rule = {
    type: 'field',
    inboundTag: inboundTags,
    outboundTag: homeProxyTag,
    user: normalizeRuleUsers(mergedUsers)
  };

  ensureRoutingRules(xraySetting).push(rule);
  return rule;
}

/**
 * 校验并格式化当前用户家宽权益。
 *
 * @param {Object|undefined} entitlement - 仓储返回的权益记录
 * @param {number} [now=getNowTimestamp()] - 当前秒级时间戳
 * @returns {Object} 已归一化权益
 */
function assertActiveHomeEntitlement(entitlement, now = getNowTimestamp()) {
  if (!entitlement || !entitlement.home_plan_id) {
    throw createLegacyBusinessError('购买家宽 IP 套餐后可配置', { code: 4101 });
  }
  if (Number(entitlement.home_expire_at || 0) <= now) {
    throw createLegacyBusinessError('家宽 IP 套餐已到期，请先续费', { code: 4102 });
  }
  if (String(entitlement.plan_type || '') !== 'home_ip') {
    throw createLegacyBusinessError('当前家宽 IP 套餐配置异常，请联系客服', { code: 4103 });
  }
  if (!String(entitlement.home_proxy_tag || '').trim()) {
    throw createLegacyBusinessError('当前家宽 IP 未绑定 tag，请联系客服', { code: 4104 });
  }
  if (!entitlement.home_proxy_id) {
    throw createLegacyBusinessError('当前家宽 IP 配置不存在，请联系客服', { code: 4105 });
  }

  return {
    userId: Number(entitlement.user_id),
    email: entitlement.email,
    homeProxyTag: String(entitlement.home_proxy_tag).trim(),
    homePlanName: entitlement.home_plan_name || '',
    homeExpireAt: Number(entitlement.home_expire_at)
  };
}

function getCooldownRemaining(route, now = getNowTimestamp()) {
  const lastSyncedAt = Number(route?.last_synced_at || 0);
  if (!lastSyncedAt) {
    return 0;
  }

  return Math.max(0, lastSyncedAt + HOME_ROUTING_COOLDOWN_SECONDS - now);
}

function formatServer(server) {
  return {
    id: Number(server.id),
    name: server.name,
    status: Number(server.status)
  };
}

async function formatRoute(db, route) {
  if (!route) {
    return null;
  }

  const serverIds = parseServerIds(route.server_ids);
  const servers = await repository.listServersByIds(db, serverIds);
  const serverMap = new Map(servers.map((server) => [Number(server.id), server]));

  return {
    home_proxy_tag: route.home_proxy_tag,
    server_ids: serverIds,
    servers: serverIds.map((id) => {
      const server = serverMap.get(Number(id));
      return {
        id,
        name: server ? server.name : `未知服务器 ${id}`,
        status: server ? Number(server.status) : 0
      };
    }),
    last_synced_at: route.last_synced_at
  };
}

/**
 * 获取当前用户家宽 IP routing 配置选项。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 当前用户 ID
 * @returns {Promise<Object>} 家宽权益、服务器列表和当前绑定
 */
async function getHomeRoutingOptions(db, userId) {
  const now = getNowTimestamp();
  const entitlement = await repository.findHomeRoutingEntitlement(db, userId);
  let activeEntitlement;

  try {
    activeEntitlement = assertActiveHomeEntitlement(entitlement, now);
  } catch (error) {
    if (error && error.isLegacyBusinessError) {
      return {
        available: false,
        message: error.message
      };
    }
    throw error;
  }

  const [onlineServers, route] = await Promise.all([
    repository.listOnlineServers(db),
    repository.findUserHomeRoute(db, userId)
  ]);

  return {
    available: true,
    home_proxy_tag: activeEntitlement.homeProxyTag,
    home_plan_name: activeEntitlement.homePlanName,
    home_expire_at: activeEntitlement.homeExpireAt,
    servers: onlineServers.map(formatServer),
    route: await formatRoute(db, route),
    cooldown_remaining_seconds: getCooldownRemaining(route, now)
  };
}

function assertServerSelection(serverIds) {
  if (serverIds.length === 0) {
    throw createLegacyBusinessError('请至少选择一台服务器', { code: 4106 });
  }
  if (serverIds.length > 2) {
    throw createLegacyBusinessError('最多选择两台服务器', { code: 4106 });
  }
}

function collectMissingIds(requestedIds, servers) {
  const existingIds = new Set((servers || []).map((server) => Number(server.id)));
  return requestedIds.filter((id) => !existingIds.has(Number(id)));
}

function assertSelectedServersOnline(serverIds, onlineServers) {
  const missingIds = collectMissingIds(serverIds, onlineServers);
  if (missingIds.length > 0) {
    throw createLegacyBusinessError('选择的服务器不存在或当前离线', {
      code: 4108,
      data: {
        failed_servers: missingIds.map((id) => ({
          id,
          name: `服务器 ${id}`,
          message: '服务器不存在或当前离线'
        })),
        retryable: true
      }
    });
  }
}

async function loadInvolvedServers(db, oldServerIds, nextServerIds, onlineServers) {
  const involvedIds = normalizeServerIds([...oldServerIds, ...nextServerIds]);
  const servers = await repository.listServersByIds(db, involvedIds);
  const serverMap = new Map(servers.map((server) => [Number(server.id), server]));
  const onlineIds = new Set(onlineServers.map((server) => Number(server.id)));

  const missingOrOffline = involvedIds
    .filter((id) => !serverMap.has(Number(id)) || !onlineIds.has(Number(id)))
    .map((id) => {
      const server = serverMap.get(Number(id));
      return {
        id,
        name: server ? server.name : `服务器 ${id}`,
        message: server ? '服务器当前离线，无法同步 routing' : '服务器不存在，无法同步 routing'
      };
    });

  if (missingOrOffline.length > 0) {
    throw createLegacyBusinessError('家宽 IP routing 同步失败，请重试', {
      code: 4107,
      data: {
        failed_servers: missingOrOffline,
        retryable: true
      }
    });
  }

  return involvedIds.map((id) => serverMap.get(Number(id)));
}

/**
 * 向单台 3X-UI 服务器同步当前用户家宽 routing。
 *
 * @param {Object} server - 3X-UI 服务器记录
 * @param {Object} context - 同步上下文
 * @param {string} context.homeProxyTag - 家宽 outbound tag
 * @param {string} context.email - 当前用户邮箱
 * @param {number[]} context.nextServerIds - 用户新选择的服务器 ID
 * @returns {Promise<Object>} 单台同步结果
 */
async function syncServerRoute(server, context) {
  const xuiService = await xuiServiceFactory(server.api_url, server.api_token, {
    apiVersion: server.panel_version || '3.0.2'
  });
  const configResult = await xuiService.getXrayConfig({ timeout: XUI_XRAY_TIMEOUT });
  const xraySetting = normalizeXraySetting(configResult);
  const outboundTestUrl = extractOutboundTestUrl(configResult);

  if (context.previousHomeProxyTag && context.previousHomeProxyTag !== context.homeProxyTag) {
    removeMatchingHomeRules(xraySetting, context.previousHomeProxyTag, context.email);
  }
  removeMatchingHomeRules(xraySetting, context.homeProxyTag, context.email);

  if (context.nextServerIds.includes(Number(server.id))) {
    const inboundTags = await resolveInboundTags(xuiService, xraySetting);
    upsertHomeRoutingRule(xraySetting, context.homeProxyTag, context.email, inboundTags);
  }

  const updateResult = outboundTestUrl === undefined
    ? await xuiService.updateXrayConfig(xraySetting, { timeout: XUI_XRAY_TIMEOUT })
    : await xuiService.updateXrayConfig(xraySetting, outboundTestUrl, { timeout: XUI_XRAY_TIMEOUT });

  if (updateResult && updateResult.success === false) {
    throw new Error(updateResult.msg || updateResult.message || '回写 Xray 配置失败');
  }

  return { server_id: Number(server.id), server_name: server.name };
}

function collectFailedServers(servers, results) {
  return results
    .map((result, index) => ({ result, server: servers[index] }))
    .filter((item) => item.result.status === 'rejected')
    .map((item) => ({
      id: Number(item.server.id),
      name: item.server.name,
      message: item.result.reason?.message || String(item.result.reason || '同步失败')
    }));
}

async function saveSuccessfulRoute(db, payload) {
  if (typeof db.transaction !== 'function') {
    await repository.upsertUserHomeRoute(db, payload);
    return;
  }

  const transaction = db.transaction(async (transactionDb) => {
    await repository.upsertUserHomeRoute(transactionDb, payload);
  });
  await transaction();
}

async function deleteSuccessfulRoute(db, userId) {
  if (typeof db.transaction !== 'function') {
    await repository.deleteUserHomeRoute(db, userId);
    return;
  }

  const transaction = db.transaction(async (transactionDb) => {
    await repository.deleteUserHomeRoute(transactionDb, userId);
  });
  await transaction();
}

/**
 * 更新当前用户家宽 IP routing 绑定并同步到 3X-UI。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 当前用户 ID
 * @param {Object} payload - 前端提交数据
 * @param {Object} logger - 日志实例
 * @returns {Promise<Object>} 更新后的绑定选项
 */
async function updateHomeRouting(db, userId, payload = {}, logger = console) {
  const now = getNowTimestamp();
  const nextServerIds = normalizeServerIds(payload.server_ids);
  assertServerSelection(nextServerIds);

  const entitlement = assertActiveHomeEntitlement(
    await repository.findHomeRoutingEntitlement(db, userId),
    now
  );
  const [currentRoute, onlineServers] = await Promise.all([
    repository.findUserHomeRoute(db, userId),
    repository.listOnlineServers(db)
  ]);
  const cooldownRemaining = getCooldownRemaining(currentRoute, now);

  if (cooldownRemaining > 0) {
    throw createLegacyBusinessError(`请稍后再修改，剩余 ${Math.ceil(cooldownRemaining / 60)} 分钟`, {
      statusCode: 429,
      code: 4109,
      data: {
        cooldown_remaining_seconds: cooldownRemaining
      }
    });
  }

  assertSelectedServersOnline(nextServerIds, onlineServers);

  const oldServerIds = parseServerIds(currentRoute?.server_ids);
  const involvedServers = await loadInvolvedServers(db, oldServerIds, nextServerIds, onlineServers);
  const results = await runWithConcurrency(
    involvedServers,
    HOME_ROUTING_SYNC_CONCURRENCY,
    (server) => syncServerRoute(server, {
      homeProxyTag: entitlement.homeProxyTag,
      previousHomeProxyTag: currentRoute?.home_proxy_tag || '',
      email: entitlement.email,
      nextServerIds
    })
  );
  const failedServers = collectFailedServers(involvedServers, results);

  if (failedServers.length > 0) {
    failedServers.forEach((server) => {
      logger.warn(`家宽 IP routing 同步失败: user=${entitlement.email}, serverId=${server.id}, server=${server.name}, tag=${entitlement.homeProxyTag}, error=${server.message}`);
    });
    throw createLegacyBusinessError('家宽 IP routing 同步失败，请重试', {
      code: 4107,
      data: {
        failed_servers: failedServers,
        retryable: true
      }
    });
  }

  await saveSuccessfulRoute(db, {
    userId,
    homeProxyTag: entitlement.homeProxyTag,
    serverIds: nextServerIds,
    syncedAt: now,
    message: `同步成功，共处理 ${involvedServers.length} 台服务器`
  });

  return getHomeRoutingOptions(db, userId);
}

/**
 * 删除当前用户家宽 IP routing 绑定并同步清理 3X-UI。
 * 核心分支：删除同样遵守 5 分钟冷却；远端全部清理成功后才删除本地记录。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 当前用户 ID
 * @param {Object} logger - 日志实例
 * @returns {Promise<Object>} 删除后的绑定选项
 */
async function deleteHomeRouting(db, userId, logger = console) {
  const now = getNowTimestamp();
  const [currentRoute, userContext, onlineServers] = await Promise.all([
    repository.findUserHomeRoute(db, userId),
    repository.findUserHomeRoutingContext(db, userId),
    repository.listOnlineServers(db)
  ]);

  if (!currentRoute) {
    throw createLegacyBusinessError('家宽 IP routing 配置不存在', { statusCode: 404, code: 404 });
  }
  if (!userContext || !userContext.email) {
    throw createLegacyBusinessError('用户不存在或邮箱异常', { statusCode: 404, code: 404 });
  }

  const cooldownRemaining = getCooldownRemaining(currentRoute, now);
  if (cooldownRemaining > 0) {
    throw createLegacyBusinessError(`请稍后再修改，剩余 ${Math.ceil(cooldownRemaining / 60)} 分钟`, {
      statusCode: 429,
      code: 4109,
      data: {
        cooldown_remaining_seconds: cooldownRemaining
      }
    });
  }

  const oldServerIds = parseServerIds(currentRoute.server_ids);
  const involvedServers = await loadInvolvedServers(db, oldServerIds, [], onlineServers);
  const results = await runWithConcurrency(
    involvedServers,
    HOME_ROUTING_SYNC_CONCURRENCY,
    (server) => syncServerRoute(server, {
      homeProxyTag: String(currentRoute.home_proxy_tag || '').trim(),
      previousHomeProxyTag: '',
      email: userContext.email,
      nextServerIds: []
    })
  );
  const failedServers = collectFailedServers(involvedServers, results);

  if (failedServers.length > 0) {
    failedServers.forEach((server) => {
      logger.warn(`家宽 IP routing 删除失败: user=${userContext.email}, serverId=${server.id}, server=${server.name}, tag=${currentRoute.home_proxy_tag}, error=${server.message}`);
    });
    throw createLegacyBusinessError('家宽 IP routing 删除失败，请重试', {
      code: 4110,
      data: {
        failed_servers: failedServers,
        retryable: true
      }
    });
  }

  await deleteSuccessfulRoute(db, userId);
  return getHomeRoutingOptions(db, userId);
}

function setRepositoryForTest(testRepository) {
  repository = testRepository;
}

function setXuiServiceFactoryForTest(factory) {
  xuiServiceFactory = factory;
}

function resetTestDependencies() {
  repository = require('../../repositories/user-home-routing-repository');
  xuiServiceFactory = XuiService.getInstance.bind(XuiService);
}

module.exports = {
  HOME_ROUTING_COOLDOWN_SECONDS,
  getHomeRoutingOptions,
  updateHomeRouting,
  deleteHomeRouting,
  __testables: {
    normalizeServerIds,
    parseServerIds,
    normalizeXraySetting,
    unwrapXraySetting,
    extractInboundTags,
    extractInboundTagsFromInboundsResult,
    resolveInboundTags,
    normalizeRuleUsers,
    removeMatchingHomeRules,
    upsertHomeRoutingRule,
    assertActiveHomeEntitlement
  },
  setRepositoryForTest,
  setXuiServiceFactoryForTest,
  resetTestDependencies
};
