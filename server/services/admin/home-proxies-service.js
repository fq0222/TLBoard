const { createLogger } = require('../../utils/logger');
const { runWithConcurrency } = require('../../utils/concurrency');
const XuiService = require('../../integrations/xui/xui-service');
let homeProxiesRepository = require('../../repositories/home-proxies-repository');

const logger = createLogger('ADMIN-HOME-PROXIES');
const HOME_PROXY_SYNC_CONCURRENCY = 10;
const XUI_XRAY_TIMEOUT = 30000;
const SYNC_STATUS = {
  PENDING: 'pending',
  SUCCESS: 'success',
  PARTIAL_FAILED: 'partial_failed',
  FAILED: 'failed',
  DELETE_FAILED: 'delete_failed'
};

let xuiServiceFactory = XuiService.getInstance.bind(XuiService);

/**
 * 创建兼容旧管理端响应格式的业务错误。
 *
 * @param {string} message - 错误提示
 * @param {Object} [options={}] - 错误配置
 * @returns {Error} 带旧接口元信息的错误
 */
function createLegacyBusinessError(message, options = {}) {
  const error = new Error(message);
  error.isLegacyBusinessError = true;
  error.statusCode = options.statusCode || 400;
  error.code = options.code || 1001;
  error.data = options.data === undefined ? null : options.data;
  return error;
}

function getUnixTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * 解析失败服务器 ID JSON，非法数据按空数组处理。
 *
 * @param {string|number[]|undefined|null} value - 数据库中的失败服务器 ID 字段
 * @returns {number[]} 去重后的服务器 ID
 */
function parseFailedServerIds(value) {
  if (Array.isArray(value)) {
    return normalizeServerIds(value);
  }

  if (!value) {
    return [];
  }

  try {
    return normalizeServerIds(JSON.parse(value));
  } catch (error) {
    logger.warn(`解析失败服务器 ID 失败: ${error.message}`);
    return [];
  }
}

/**
 * 归一化服务器 ID 列表。
 *
 * @param {Array} ids - 原始 ID 列表
 * @returns {number[]} 去重正整数 ID 列表
 */
function normalizeServerIds(ids) {
  return Array.from(new Set((ids || [])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0)));
}

/**
 * 将管理端表单字段归一化为写库结构。
 *
 * @param {Object} payload - 管理端提交参数
 * @returns {Object} 归一化后的配置
 */
function normalizePayload(payload = {}, options = {}) {
  const requirePassword = options.requirePassword !== false;
  const normalized = {
    tag: String(payload.tag || '').trim(),
    address: String(payload.address || '').trim(),
    port: Number(payload.port),
    username: String(payload.user !== undefined ? payload.user : payload.username || '').trim(),
    password: String(payload.pass !== undefined ? payload.pass : payload.password || '').trim()
  };

  if (!normalized.tag) {
    throw createLegacyBusinessError('tag 不能为空');
  }
  if (!normalized.address) {
    throw createLegacyBusinessError('SOCKS 地址不能为空');
  }
  if (!Number.isInteger(normalized.port) || normalized.port < 1 || normalized.port > 65535) {
    throw createLegacyBusinessError('SOCKS 端口必须是 1-65535 的整数');
  }
  if (!normalized.username) {
    throw createLegacyBusinessError('SOCKS 用户名不能为空');
  }
  if (!normalized.password && !requirePassword) {
    normalized.password = options.fallbackPassword || '';
  }
  if (!normalized.password) {
    throw createLegacyBusinessError('SOCKS 密码不能为空');
  }

  return normalized;
}

/**
 * 构建 3X-UI Xray socks outbound。
 *
 * @param {Object} homeProxy - 家宽 IP 配置
 * @returns {Object} outbound 配置
 */
function buildSocksOutbound(homeProxy) {
  return {
    protocol: 'socks',
    settings: {
      servers: [
        {
          address: homeProxy.address,
          port: Number(homeProxy.port),
          users: [
            {
              user: homeProxy.username,
              pass: homeProxy.password
            }
          ]
        }
      ]
    },
    tag: homeProxy.tag
  };
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

/**
 * 从 3X-UI 响应中解析完整 Xray 配置。
 * 核心分支语义：3X-UI 会把 { xraySetting, outboundTestUrl } 包装对象作为 obj 字符串返回，
 * 这里必须继续拆出内部 xraySetting，避免把新 outbound 写到包装对象外层。
 *
 * @param {Object|string} response - 3X-UI 原始响应
 * @returns {Object} Xray 配置对象
 */
function normalizeXraySetting(response) {
  const root = parseJsonLikeConfig(response?.obj !== undefined ? response.obj : response, 'Xray 配置响应');
  const candidate =
    root?.xraySetting ||
    root?.xray_setting ||
    root?.setting ||
    response?.data?.xraySetting ||
    response?.xraySetting ||
    root;
  const xraySetting = parseJsonLikeConfig(candidate, 'Xray 配置');

  if (xraySetting && typeof xraySetting === 'object') {
    return xraySetting;
  }

  throw new Error('3X-UI 未返回有效 Xray 配置');
}

/**
 * 从 Xray 配置响应中提取出站测试 URL，回写时原样保留。
 *
 * @param {Object} response - 3X-UI 原始响应
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
 * 按 tag 插入或替换 outbound。
 *
 * @param {Object} xraySetting - 完整 Xray 配置
 * @param {Object} outbound - 目标 outbound
 * @returns {Object} 修改后的 Xray 配置
 */
function upsertOutbound(xraySetting, outbound) {
  if (!Array.isArray(xraySetting.outbounds)) {
    xraySetting.outbounds = [];
  }

  const index = xraySetting.outbounds.findIndex((item) => item && item.tag === outbound.tag);
  if (index >= 0) {
    xraySetting.outbounds.splice(index, 1, outbound);
  } else {
    xraySetting.outbounds.push(outbound);
  }

  return xraySetting;
}

/**
 * 按 tag 删除 outbound，远端原本不存在时视为已经清理完成。
 *
 * @param {Object} xraySetting - 完整 Xray 配置
 * @param {string} tag - outbound tag
 * @returns {boolean} 是否删除了实际存在的 outbound
 */
function removeOutboundByTag(xraySetting, tag) {
  if (!Array.isArray(xraySetting.outbounds)) {
    xraySetting.outbounds = [];
    return false;
  }

  const beforeLength = xraySetting.outbounds.length;
  xraySetting.outbounds = xraySetting.outbounds.filter((item) => !item || item.tag !== tag);
  return xraySetting.outbounds.length !== beforeLength;
}

/**
 * 聚合远端操作结果为本地同步状态。
 *
 * @param {Object} context - 聚合上下文
 * @returns {Object} 可写库同步状态
 */
function buildSyncState(context) {
  const {
    mode,
    attemptedCount,
    successIds,
    failedIds,
    skippedIds
  } = context;
  const remainingFailedIds = normalizeServerIds([...failedIds, ...skippedIds]);
  const successCount = successIds.length;
  const failedCount = remainingFailedIds.length;
  const now = getUnixTimestamp();

  if (remainingFailedIds.length === 0) {
    return {
      syncStatus: SYNC_STATUS.SUCCESS,
      failedServerIds: [],
      lastSyncAt: now,
      successCount,
      failedCount: 0,
      message: mode === 'delete'
        ? `远端删除成功，共处理 ${successCount} 台服务器`
        : `同步成功，共处理 ${successCount} 台服务器`
    };
  }

  const syncStatus = mode === 'delete'
    ? SYNC_STATUS.DELETE_FAILED
    : (successCount > 0 ? SYNC_STATUS.PARTIAL_FAILED : SYNC_STATUS.FAILED);
  const skippedText = skippedIds.length > 0 ? `，${skippedIds.length} 台失败服务器当前离线未重试` : '';

  return {
    syncStatus,
    failedServerIds: remainingFailedIds,
    lastSyncAt: now,
    successCount,
    failedCount,
    message: mode === 'delete'
      ? `远端删除未全部成功，成功 ${successCount} 台，失败 ${failedCount} 台${skippedText}`
      : `同步未全部成功，成功 ${successCount} 台，失败 ${failedCount} 台${skippedText}`,
    attemptedCount
  };
}

/**
 * 检查 tag 是否已被其它家宽配置占用。
 *
 * @param {Object} db - 数据库实例
 * @param {string} tag - outbound tag
 * @param {number|null} currentId - 当前记录 ID
 * @returns {Promise<void>}
 */
async function ensureUniqueTag(db, tag, currentId = null) {
  const existing = await homeProxiesRepository.findHomeProxyByTag(db, tag);
  if (existing && Number(existing.id) !== Number(currentId)) {
    throw createLegacyBusinessError('tag 已存在，请使用唯一 tag');
  }
}

/**
 * 格式化列表项，避免向管理端返回明文密码。
 *
 * @param {Object} homeProxy - 数据库记录
 * @param {Map<number,Object>} serverMap - 服务器映射
 * @returns {Object} 管理端列表项
 */
function formatHomeProxy(homeProxy, serverMap = new Map()) {
  const failedServerIds = parseFailedServerIds(homeProxy.failed_server_ids);
  const failedServers = failedServerIds.map((id) => {
    const server = serverMap.get(Number(id));
    return {
      id,
      name: server ? server.name : `未知服务器 ${id}`,
      status: server ? Number(server.status) : 0
    };
  });

  return {
    id: homeProxy.id,
    tag: homeProxy.tag,
    address: homeProxy.address,
    port: Number(homeProxy.port),
    user: homeProxy.username,
    username: homeProxy.username,
    has_password: Boolean(homeProxy.password),
    password_mask: homeProxy.password ? '******' : '',
    sync_status: homeProxy.sync_status || SYNC_STATUS.PENDING,
    failed_server_ids: failedServerIds,
    failed_servers: failedServers,
    failed_server_names: failedServers.map((server) => server.name),
    last_sync_at: homeProxy.last_sync_at,
    last_sync_success_count: Number(homeProxy.last_sync_success_count || 0),
    last_sync_failed_count: Number(homeProxy.last_sync_failed_count || 0),
    last_sync_message: homeProxy.last_sync_message || '',
    created_at: homeProxy.created_at,
    updated_at: homeProxy.updated_at
  };
}

/**
 * 载入失败服务器名称映射。
 *
 * @param {Object} db - 数据库实例
 * @param {Array<Object>} homeProxies - 家宽配置列表
 * @returns {Promise<Map<number,Object>>} 服务器映射
 */
async function loadFailedServerMap(db, homeProxies) {
  const failedIds = normalizeServerIds(homeProxies.flatMap((item) => parseFailedServerIds(item.failed_server_ids)));
  const servers = await homeProxiesRepository.listServersByIds(db, failedIds);
  return new Map(servers.map((server) => [Number(server.id), server]));
}

/**
 * 查询家宽 IP 配置列表。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Object>} 管理端列表响应
 */
async function listHomeProxies(db) {
  const homeProxies = await homeProxiesRepository.listHomeProxies(db);
  const serverMap = await loadFailedServerMap(db, homeProxies);
  return {
    home_proxies: homeProxies.map((item) => formatHomeProxy(item, serverMap))
  };
}

/**
 * 创建本地家宽 IP 配置，不触发远端同步。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 管理端提交参数
 * @returns {Promise<Object>} 创建结果
 */
async function createHomeProxy(db, payload) {
  const normalized = normalizePayload(payload, { requirePassword: true });
  await ensureUniqueTag(db, normalized.tag);

  const result = await homeProxiesRepository.createHomeProxy(db, normalized);
  const id = result?.lastInsertRowid || result?.lastID || result?.id;
  const created = id
    ? await homeProxiesRepository.findHomeProxyById(db, id)
    : await homeProxiesRepository.findHomeProxyByTag(db, normalized.tag);

  return {
    ...formatHomeProxy(created || normalized),
    message: '家宽 IP 添加成功，等待同步'
  };
}

/**
 * 更新本地家宽 IP 配置，并重置同步状态。
 *
 * @param {Object} db - 数据库实例
 * @param {number} id - 家宽 IP 配置 ID
 * @param {Object} payload - 管理端提交参数
 * @returns {Promise<Object>} 更新结果
 */
async function updateHomeProxy(db, id, payload) {
  const existing = await homeProxiesRepository.findHomeProxyById(db, id);
  if (!existing) {
    throw createLegacyBusinessError('家宽 IP 配置不存在', { statusCode: 404, code: 404 });
  }

  const normalized = normalizePayload(payload, {
    requirePassword: false,
    fallbackPassword: existing.password
  });
  await ensureUniqueTag(db, normalized.tag, id);
  await homeProxiesRepository.updateHomeProxy(db, id, normalized);
  const updated = await homeProxiesRepository.findHomeProxyById(db, id);

  return {
    ...formatHomeProxy(updated),
    message: '家宽 IP 更新成功，等待重新同步'
  };
}

/**
 * 为同步操作选择目标服务器。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} homeProxy - 家宽配置
 * @param {boolean} retryOnlyFailed - 是否仅重试失败服务器
 * @returns {Promise<Object>} 目标服务器和离线跳过服务器 ID
 */
async function selectSyncTargets(db, homeProxy, retryOnlyFailed) {
  const onlineServers = await homeProxiesRepository.listOnlineServers(db);
  const onlineServerIds = new Set(onlineServers.map((server) => Number(server.id)));
  const failedIds = parseFailedServerIds(homeProxy.failed_server_ids);

  if (retryOnlyFailed && failedIds.length > 0) {
    return {
      targets: onlineServers.filter((server) => failedIds.includes(Number(server.id))),
      skippedIds: failedIds.filter((id) => !onlineServerIds.has(id))
    };
  }

  return {
    targets: onlineServers,
    skippedIds: []
  };
}

/**
 * 向单台 3X-UI 服务器同步 outbound。
 *
 * @param {Object} server - 3X-UI 服务器
 * @param {Object} homeProxy - 家宽配置
 * @returns {Promise<Object>} 单台同步结果
 */
async function syncServerOutbound(server, homeProxy) {
  const xuiService = await xuiServiceFactory(server.api_url, server.api_token, {
    apiVersion: server.panel_version || '3.0.2'
  });
  const configResult = await xuiService.getXrayConfig({ timeout: XUI_XRAY_TIMEOUT });
  const xraySetting = normalizeXraySetting(configResult);
  const outboundTestUrl = extractOutboundTestUrl(configResult);
  upsertOutbound(xraySetting, buildSocksOutbound(homeProxy));
  const updateResult = outboundTestUrl === undefined
    ? await xuiService.updateXrayConfig(xraySetting, { timeout: XUI_XRAY_TIMEOUT })
    : await xuiService.updateXrayConfig(xraySetting, outboundTestUrl, { timeout: XUI_XRAY_TIMEOUT });

  if (updateResult && updateResult.success === false) {
    throw new Error(updateResult.msg || updateResult.message || '回写 Xray 配置失败');
  }

  return { server_id: Number(server.id), server_name: server.name };
}

/**
 * 从单项并发结果中提取成功和失败服务器 ID。
 *
 * @param {Array<Object>} targets - 目标服务器
 * @param {Array<Object>} results - runWithConcurrency 返回结果
 * @returns {Object} 成功和失败 ID
 */
function collectServerResults(targets, results) {
  const successIds = [];
  const failedIds = [];

  results.forEach((result, index) => {
    const serverId = Number(targets[index].id);
    if (result.status === 'fulfilled') {
      successIds.push(serverId);
      return;
    }

    failedIds.push(serverId);
    logger.warn(`家宽 IP 同步服务器失败: serverId=${serverId}, error=${result.reason?.message || result.reason}`);
  });

  return {
    successIds,
    failedIds
  };
}

/**
 * 手动同步家宽 IP outbound 到 3X-UI 在线服务器。
 *
 * @param {Object} db - 数据库实例
 * @param {number} id - 家宽 IP 配置 ID
 * @returns {Promise<Object>} 同步结果
 */
async function syncHomeProxy(db, id) {
  const homeProxy = await homeProxiesRepository.findHomeProxyById(db, id);
  if (!homeProxy) {
    throw createLegacyBusinessError('家宽 IP 配置不存在', { statusCode: 404, code: 404 });
  }

  const retryOnlyFailed = [SYNC_STATUS.PARTIAL_FAILED, SYNC_STATUS.FAILED].includes(homeProxy.sync_status);
  const { targets, skippedIds } = await selectSyncTargets(db, homeProxy, retryOnlyFailed);
  if (targets.length === 0 && skippedIds.length === 0) {
    throw createLegacyBusinessError('当前没有在线的 3X-UI 服务器可同步');
  }

  const results = await runWithConcurrency(targets, HOME_PROXY_SYNC_CONCURRENCY, (server) => (
    syncServerOutbound(server, homeProxy)
  ));
  const { successIds, failedIds } = collectServerResults(targets, results);
  const syncState = buildSyncState({
    mode: 'sync',
    attemptedCount: targets.length,
    successIds,
    failedIds,
    skippedIds
  });

  await homeProxiesRepository.updateSyncState(db, id, syncState);
  const updated = await homeProxiesRepository.findHomeProxyById(db, id);
  const serverMap = await loadFailedServerMap(db, [updated]);

  return {
    ...formatHomeProxy(updated, serverMap),
    message: syncState.message
  };
}

/**
 * 从单台 3X-UI 服务器删除 outbound。
 *
 * @param {Object} server - 3X-UI 服务器
 * @param {Object} homeProxy - 家宽配置
 * @returns {Promise<Object>} 单台删除结果
 */
async function deleteServerOutbound(server, homeProxy) {
  const xuiService = await xuiServiceFactory(server.api_url, server.api_token, {
    apiVersion: server.panel_version || '3.0.2'
  });
  const configResult = await xuiService.getXrayConfig({ timeout: XUI_XRAY_TIMEOUT });
  const xraySetting = normalizeXraySetting(configResult);
  const outboundTestUrl = extractOutboundTestUrl(configResult);
  removeOutboundByTag(xraySetting, homeProxy.tag);
  const updateResult = outboundTestUrl === undefined
    ? await xuiService.updateXrayConfig(xraySetting, { timeout: XUI_XRAY_TIMEOUT })
    : await xuiService.updateXrayConfig(xraySetting, outboundTestUrl, { timeout: XUI_XRAY_TIMEOUT });

  if (updateResult && updateResult.success === false) {
    throw new Error(updateResult.msg || updateResult.message || '回写 Xray 配置失败');
  }

  return { server_id: Number(server.id), server_name: server.name };
}

/**
 * 删除家宽 IP 配置，远端 outbound 全部删除成功后才删除本地记录。
 *
 * @param {Object} db - 数据库实例
 * @param {number} id - 家宽 IP 配置 ID
 * @returns {Promise<Object>} 删除结果
 */
async function deleteHomeProxy(db, id) {
  const homeProxy = await homeProxiesRepository.findHomeProxyById(db, id);
  if (!homeProxy) {
    throw createLegacyBusinessError('家宽 IP 配置不存在', { statusCode: 404, code: 404 });
  }

  const failedIds = parseFailedServerIds(homeProxy.failed_server_ids);
  const neverSynced = !homeProxy.last_sync_at
    && failedIds.length === 0
    && homeProxy.sync_status === SYNC_STATUS.PENDING;
  if (neverSynced) {
    await homeProxiesRepository.deleteHomeProxy(db, id);
    return { message: '家宽 IP 已删除' };
  }

  const retryOnlyFailed = homeProxy.sync_status === SYNC_STATUS.DELETE_FAILED;
  const { targets, skippedIds } = await selectSyncTargets(db, homeProxy, retryOnlyFailed);
  if (targets.length === 0 && skippedIds.length === 0) {
    throw createLegacyBusinessError('当前没有在线的 3X-UI 服务器可删除远端配置');
  }

  const results = await runWithConcurrency(targets, HOME_PROXY_SYNC_CONCURRENCY, (server) => (
    deleteServerOutbound(server, homeProxy)
  ));
  const { successIds, failedIds: remoteFailedIds } = collectServerResults(targets, results);
  const syncState = buildSyncState({
    mode: 'delete',
    attemptedCount: targets.length,
    successIds,
    failedIds: remoteFailedIds,
    skippedIds
  });

  if (syncState.failedServerIds.length === 0) {
    await homeProxiesRepository.deleteHomeProxy(db, id);
    return { message: '家宽 IP 已删除，远端 outbound 已清理' };
  }

  await homeProxiesRepository.updateSyncState(db, id, syncState);
  const updated = await homeProxiesRepository.findHomeProxyById(db, id);
  const serverMap = await loadFailedServerMap(db, [updated]);
  throw createLegacyBusinessError('远端 outbound 未全部删除，本地记录已保留', {
    code: 3001,
    data: formatHomeProxy(updated, serverMap)
  });
}

/**
 * 测试用：替换 XUI service factory，避免服务层测试访问真实 3X-UI。
 *
 * @param {Function} factory - 测试 factory
 */
function setXuiServiceFactoryForTest(factory) {
  xuiServiceFactory = factory;
}

/**
 * 测试用：替换仓储实现。
 *
 * @param {Object} repository - 测试仓储
 */
function setRepositoryForTest(repository) {
  homeProxiesRepository = repository;
}

/**
 * 测试用：还原依赖注入。
 */
function resetTestDependencies() {
  xuiServiceFactory = XuiService.getInstance.bind(XuiService);
  homeProxiesRepository = require('../../repositories/home-proxies-repository');
}

module.exports = {
  SYNC_STATUS,
  HOME_PROXY_SYNC_CONCURRENCY,
  buildSocksOutbound,
  upsertOutbound,
  removeOutboundByTag,
  parseFailedServerIds,
  normalizeXraySetting,
  listHomeProxies,
  createHomeProxy,
  updateHomeProxy,
  syncHomeProxy,
  deleteHomeProxy,
  setXuiServiceFactoryForTest,
  setRepositoryForTest,
  resetTestDependencies
};
