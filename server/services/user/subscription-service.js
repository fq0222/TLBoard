const { syncSelectedServers, syncServerNodes } = require('../../integrations/xui/xui-sync');
const { syncUserToXuiServers } = require('../shared/order-service');
const { getStrategyFromRemark, processNodeLink, parseNodeLink } = require('../shared/subscription-strategy');
const {
  fetchOriginalSubscription,
  parseSubscriptionContent,
  pickSingleNodeLink,
  getProtocolAliases
} = require('../shared/subscription-service');
const {
  computeNodeFingerprint,
  computeServerFingerprint,
  isSourceCacheUsable
} = require('../shared/subscription-cache-service');
const { isTimedPlan } = require('../shared/plan-type');
const { DISABLE_REASONS } = require('../shared/renew-policy');
const xuiSyncTaskService = require('../../integrations/xui/xui-sync-task-service');
const subscriptionRepository = require('../../repositories/subscription-repository');
const { runWithConcurrency } = require('../../utils/concurrency');
const { generatePublicSubscriptionId } = require('../../utils/subscription-id');
const { getUserAppBaseUrl } = require('../../shared/utils/site-url');

const SOURCE_CACHE_MAX_AGE_SECONDS = 24 * 60 * 60;
const SOURCE_FETCH_CONCURRENCY = 10;
const SOURCE_FETCH_TIMEOUT_MS = 15000;
const CLASH_CONFIG_NAME_KEY = 'clash_config_name';
const CLASH_PROFILE_UPDATE_INTERVAL_KEY = 'clash_profile_update_interval';
const DEFAULT_CLASH_CONFIG_NAME = '天澜大陆';
const DEFAULT_CLASH_PROFILE_UPDATE_INTERVAL_HOURS = '2';
const FALLBACK_NODE_HOST = 'invalid.subscription.local';
const FALLBACK_NODE_UUIDS = [
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002'
];

/**
 * 用户端订阅服务。
 * 负责订阅生成、订阅详情聚合、订阅内容格式输出与缓存修复，
 * 保持现有 subscription 接口的旧响应语义与共享订阅核心不变。
 */

/**
 * 创建兼容旧接口的业务异常对象。
 *
 * @param {number} code - 旧接口业务码
 * @param {string} message - 错误提示
 * @param {number} [statusCode=400] - HTTP 状态码
 * @param {*} [data=null] - 旧接口 data 字段
 * @returns {Error} 带旧接口元数据的异常对象
 */
function createLegacyBusinessError(code, message, statusCode = 400, data = null) {
  const error = new Error(message);
  error.isLegacyBusinessError = true;
  error.code = code;
  error.statusCode = statusCode;
  error.data = data;
  return error;
}

/**
 * 构建 server_id + inbound_id 组成的缓存键。
 *
 * @param {number|string} serverId - 服务器 ID
 * @param {number|string} inboundId - inbound ID
 * @returns {string} 缓存键
 */
function buildSourceCacheKey(serverId, inboundId) {
  return `${serverId}:${inboundId}`;
}

/**
 * 提取 CF IP 记录中的 IP 值。
 *
 * @param {string|Object} cfIp - CF IP 记录
 * @returns {string} IP 地址
 */
function getCfIpValue(cfIp) {
  if (!cfIp) {
    return '';
  }
  return typeof cfIp === 'string' ? cfIp : cfIp.ip;
}

/**
 * 替换节点链接中的 remark，保持其余参数不变。
 *
 * @param {string} link - 节点链接
 * @param {string} nodeName - 节点名称
 * @returns {string} 替换后的节点链接
 */
function replaceNodeRemark(link, nodeName) {
  const hashIdx = link.indexOf('#');
  if (hashIdx > 0) {
    return link.substring(0, hashIdx + 1) + encodeURIComponent(nodeName);
  }
  return `${link}#${encodeURIComponent(nodeName)}`;
}

/**
 * 从 inbound 的 settings 与 stream_settings 中解析节点连接信息。
 *
 * @param {Object} node - 节点基础信息
 * @param {string|Object} settings - inbound settings
 * @param {string|Object} streamSettings - inbound stream_settings
 * @param {string} [userEmail] - 用户邮箱，用于定位专属客户端 UUID
 * @returns {{uuid:string,network:string,wsPath:string,security:string}} 节点配置
 */
function parseNodeConfig(node, settings, streamSettings, userEmail) {
  let parsedSettings = {};
  let parsedStream = {};

  try {
    parsedSettings = typeof settings === 'string'
      ? JSON.parse(settings || '{}')
      : (settings || {});
  } catch (error) {
    parsedSettings = {};
  }

  try {
    parsedStream = typeof streamSettings === 'string'
      ? JSON.parse(streamSettings || '{}')
      : (streamSettings || {});
  } catch (error) {
    parsedStream = {};
  }

  const clients = parsedSettings.clients || [];
  let uuid = '';
  if (userEmail && clients.length > 0) {
    const userClient = clients.find((client) => client.email === userEmail);
    uuid = userClient ? userClient.id : clients[0].id;
  } else {
    uuid = clients.length > 0 ? clients[0].id : '';
  }

  const network = parsedStream.network || 'tcp';
  let wsPath = '';
  if (network === 'ws') {
    const wsSettings = parsedStream.wsSettings || parsedStream['ws-settings'] || {};
    wsPath = wsSettings.path || '/';
  }

  return {
    uuid,
    network,
    wsPath,
    security: parsedStream.security || 'none'
  };
}

/**
 * 检查本地入站快照是否能可信地证明当前用户节点配置已同步。
 *
 * @param {Object} user - 当前用户，email 用于拼接 3X-UI 客户端标识
 * @param {Object} config - user_node_configs JOIN xui_nodes 的组合记录，包含用户凭据和入站快照
 * @returns {{trusted:boolean,reason:string,client?:Object}} 检查结果；可信时携带唯一客户端，
 *   拒绝时 reason 表示快照缺失、解析失败、客户端重复或凭据不一致等核心分支
 */
function inspectUserInNodeSnapshot(user, config) {
  if (!config) {
    return { trusted: false, reason: 'missing_snapshot' };
  }
  if (!user || !user.email) {
    return { trusted: false, reason: 'incomplete_snapshot' };
  }

  const requiredFields = [
    'server_id',
    'inbound_id',
    'protocol',
    'settings',
    'stream_settings'
  ];
  const incomplete = requiredFields.some(
    (field) => config[field] === undefined
      || config[field] === null
      || config[field] === ''
  );
  if (incomplete) {
    return { trusted: false, reason: 'incomplete_snapshot' };
  }

  let settings;
  try {
    settings = typeof config.settings === 'string'
      ? JSON.parse(config.settings)
      : config.settings;
  } catch (error) {
    return { trusted: false, reason: 'invalid_settings' };
  }

  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { trusted: false, reason: 'invalid_settings' };
  }
  if (!Array.isArray(settings.clients)) {
    return { trusted: false, reason: 'invalid_clients' };
  }

  const expectedEmails = [
    user.email,
    `${user.email}-${config.remark || config.inbound_id}`
  ];
  const matchingClients = settings.clients.filter(
    (client) => client && expectedEmails.includes(client.email)
  );
  if (matchingClients.length === 0) {
    return { trusted: false, reason: 'missing_user' };
  }
  if (matchingClients.length > 1) {
    return { trusted: false, reason: 'duplicate_user' };
  }

  const client = matchingClients[0];
  if (
    !client.subId
    || !config.sub_id
    || String(client.subId || '') !== String(config.sub_id || '')
  ) {
    return { trusted: false, reason: 'sub_id_mismatch' };
  }

  // Hysteria2 使用 auth/password 作为客户端身份凭据，不使用普通节点 UUID。
  const isHy2 = String(config.protocol || '').toLowerCase() === 'hysteria2'
    || String(config.remark || '').toLowerCase().includes('hy2');
  if (isHy2) {
    const clientAuth = client.auth || client.password || '';
    if (
      !clientAuth
      || !config.auth
      || String(clientAuth) !== String(config.auth)
    ) {
      return { trusted: false, reason: 'auth_mismatch' };
    }
    return { trusted: true, reason: 'ok', client };
  }

  if (
    !client.id
    || !config.uuid
    || String(client.id || '') !== String(config.uuid || '')
  ) {
    return { trusted: false, reason: 'uuid_mismatch' };
  }

  return { trusted: true, reason: 'ok', client };
}

/**
 * 安全解析入站 streamSettings，解析失败时返回空对象。
 * @param {string|Object} streamSettings - xui_nodes.stream_settings 快照。
 * @returns {Object} streamSettings 对象。
 */
function parseStreamSettings(streamSettings) {
  if (!streamSettings) {
    return {};
  }
  if (typeof streamSettings === 'object') {
    return streamSettings;
  }
  try {
    return JSON.parse(streamSettings);
  } catch (error) {
    return {};
  }
}

/**
 * 从同一个服务器订阅返回的多条链接中选择当前 inbound 对应的原始模板。
 * @param {string[]} links - 3X-UI 原始订阅解析出的链接列表。
 * @param {Object} config - user_node_configs 与 xui_nodes 的组合记录。
 * @returns {string|null} 匹配当前 inbound 的原始链接。
 */
/**
 * 判断协议是否为 Hysteria 系列，用于跳过不适用的 streamSettings 匹配规则。
 * @param {string} protocol - 节点协议名。
 * @returns {boolean} 是否为 hysteria/hysteria2/hy2 协议。
 */
function isHysteriaProtocol(protocol) {
  const normalized = String(protocol || '').toLowerCase();
  return normalized === 'hysteria2' || normalized === 'hysteria' || normalized === 'hy2';
}

/**
 * 从同一个服务器订阅返回的多条链接中选择当前 inbound 对应的原始模板。
 * @param {string[]} links - 3X-UI 原始订阅解析出的链接列表。
 * @param {Object} config - user_node_configs 与 xui_nodes 的组合记录。
 * @returns {string|null} 匹配当前 inbound 的原始链接。
 */
function pickInboundMatchedNodeLink(links, config) {
  const aliases = new Set(getProtocolAliases(config?.protocol));
  const streamSettings = parseStreamSettings(config?.stream_settings);
  const expectedPort = Number(config?.port);
  const expectedNetwork = String(streamSettings.network || '').toLowerCase();
  const expectedSecurity = String(streamSettings.security || '').toLowerCase();
  const expectedRemark = String(config?.remark || '').toLowerCase();
  const expectedUuid = String(config?.uuid || '').toLowerCase();

  const candidates = (links || [])
    .map((link) => ({ link, parsed: parseNodeLink(link) }))
    .filter((item) => item.parsed && aliases.has(String(item.parsed.protocol || '').toLowerCase()));

  if (candidates.length === 0) {
    return pickSingleNodeLink(links, config?.protocol);
  }

  let best = null;
  for (const candidate of candidates) {
    const { parsed } = candidate;
    const params = parsed.params || {};
    let score = 0;

    if (Number.isFinite(expectedPort) && expectedPort > 0 && Number(parsed.port) === expectedPort) {
      score += 100;
    }
    if (expectedNetwork && String(params.type || 'tcp').toLowerCase() === expectedNetwork) {
      score += 20;
    }
    if (expectedSecurity && String(params.security || 'none').toLowerCase() === expectedSecurity) {
      score += 20;
    }
    if (expectedRemark && String(parsed.remark || '').toLowerCase().includes(expectedRemark)) {
      score += 5;
    }
    if (expectedUuid && String(parsed.uuid || '').toLowerCase() === expectedUuid) {
      score += 2;
    }

    if (!best || score > best.score) {
      best = { ...candidate, score };
    }
  }

  return best && best.score > 0
    ? best.link
    : pickSingleNodeLink(links, config?.protocol);
}

/**
 * 判断缓存中的原始链接是否仍然对应当前 inbound 快照。
 * @param {string} originalLink - user_subscription_sources.original_link。
 * @param {Object} config - user_node_configs 与 xui_nodes 的组合记录。
 * @returns {boolean} 原始链接是否匹配当前 inbound。
 */
function isOriginalLinkMatchedToInbound(originalLink, config) {
  const parsed = parseNodeLink(originalLink);
  if (!parsed) {
    return false;
  }

  const aliases = new Set(getProtocolAliases(config?.protocol));
  if (!aliases.has(String(parsed.protocol || '').toLowerCase())) {
    return false;
  }

  const streamSettings = parseStreamSettings(config?.stream_settings);
  const expectedPort = Number(config?.port);
  const expectedNetwork = String(streamSettings.network || '').toLowerCase();
  const expectedSecurity = String(streamSettings.security || '').toLowerCase();
  const params = parsed.params || {};

  if (Number.isFinite(expectedPort) && expectedPort > 0 && Number(parsed.port) !== expectedPort) {
    return false;
  }
  if (isHysteriaProtocol(config?.protocol) || isHysteriaProtocol(parsed.protocol)) {
    return true;
  }
  if (expectedNetwork && String(params.type || 'tcp').toLowerCase() !== expectedNetwork) {
    return false;
  }
  if (expectedSecurity && String(params.security || 'none').toLowerCase() !== expectedSecurity) {
    return false;
  }

  return true;
}

/**
 * 判断缓存失效是否需要触发服务器级快照修复。
 * @param {string} reason - 缓存失效原因。
 * @returns {boolean} 是否需要重新同步服务器快照。
 */
function shouldRepairServerForCacheReason(reason) {
  return reason === 'node_fingerprint_mismatch' || reason === 'server_fingerprint_mismatch';
}

/**
 * 按输入顺序格式化服务器名称，优先使用服务器 ID、缺失时使用名称去重。
 *
 * @param {Array<Object>} servers - 待格式化的服务器列表
 * @returns {string} 供日志输出的服务器名称列表；空输入返回 `[]`
 */
function formatServerNames(servers) {
  const seenServerKeys = new Set();
  const names = [];

  for (const server of servers || []) {
    if (!server) {
      continue;
    }

    const serverKey = String(server?.id ?? server?.name ?? '');
    if (!serverKey || seenServerKeys.has(serverKey)) {
      continue;
    }

    seenServerKeys.add(serverKey);
    names.push(server.name || `未知服务器-${server.id}`);
  }

  return `[${names.join(', ')}]`;
}

/**
 * 规划失效来源缓存对应的入站快照处理方式。
 *
 * @param {Object} user - 当前订阅用户，用于校验快照内的用户凭据
 * @param {Array<Object>} invalidPairs - 来源缓存失效的节点组合，保持原始处理顺序
 * @param {Map<number,Object>} serversById - 在线服务器 ID 到服务器信息的映射
 * @returns {Object} 可本地复用的组合、需远程补拉的组合与服务器，以及校验原因计数
 *
 * 核心分支语义：快照内用户 UUID 与 sub_id 均可信时直接复用；其余原因均按
 * 服务器归并为远程补拉任务，同一服务器无论包含多少组合都只补拉一次。
 */
function buildInboundRefreshPlan(user, invalidPairs, serversById) {
  const reusablePairs = [];
  const remotePairs = [];
  const remoteServerIds = new Set();
  const remoteServers = [];
  const reasonCounts = {};

  for (const pair of invalidPairs || []) {
    const inspection = inspectUserInNodeSnapshot(user, pair.config);

    if (inspection.trusted) {
      reusablePairs.push(pair);
      continue;
    }

    remotePairs.push(pair);
    reasonCounts[inspection.reason] = (reasonCounts[inspection.reason] || 0) + 1;
    const serverId = pair.config && pair.config.server_id;
    if (remoteServerIds.has(serverId)) {
      continue;
    }

    const server = serversById && serversById.get(serverId);
    if (server) {
      remoteServerIds.add(serverId);
      remoteServers.push(server);
    }
  }

  return {
    reusablePairs,
    remotePairs,
    remoteServerIds,
    remoteServers,
    reasonCounts
  };
}

/**
 * 格式化字节流量为可读字符串。
 *
 * @param {*} bytes - 原始字节数
 * @returns {string} 格式化后的流量文本
 */
function formatTraffic(bytes) {
  if (bytes === null || bytes === undefined || bytes === '') {
    return '0 B';
  }

  const numBytes = Number(bytes);
  if (Number.isNaN(numBytes) || numBytes === 0) {
    return '0 B';
  }

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(numBytes) / Math.log(k));
  return `${parseFloat((numBytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * 格式化 Unix 时间戳。
 *
 * @param {*} timestamp - 秒级时间戳
 * @returns {string} 格式化后的时间文本
 */
function formatTime(timestamp) {
  if (!timestamp || timestamp === 0 || timestamp === '0') {
    return '无限期';
  }
  return new Date(Number(timestamp) * 1000).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false
  });
}

/**
 * 构建在线服务器 ID 到记录的映射。
 *
 * @param {Array} servers - 服务器列表
 * @returns {Map<number,Object>} 映射结果
 */
function mapServersById(servers) {
  return new Map(servers.map((server) => [server.id, server]));
}

/**
 * 按在线服务器过滤 xui_nodes 快照。
 *
 * @param {Array} snapshots - 全量快照
 * @param {Map<number,Object>} serversById - 在线服务器映射
 * @returns {Array} 在线服务器对应快照
 */
function filterOnlineSnapshots(snapshots, serversById) {
  return snapshots.filter((snapshot) => serversById.has(snapshot.server_id));
}

/**
 * 按在线服务器过滤用户节点配置。
 *
 * @param {Array} nodeConfigs - 用户节点配置列表
 * @param {Map<number,Object>} serversById - 在线服务器映射
 * @returns {Array} 在线服务器对应节点配置
 */
function filterOnlineNodeConfigs(nodeConfigs, serversById) {
  return nodeConfigs.filter((config) => serversById.has(config.server_id));
}

/**
 * 按 server_id + inbound_id 判断哪些在线服务器缺少快照或当前用户配置。
 *
 * @param {Array<Object>} servers - 在线服务器列表。
 * @param {Array<Object>} snapshots - 本地 xui_nodes 快照。
 * @param {Array<Object>} nodeConfigs - 当前用户的 user_node_configs。
 * @returns {Array<Object>} 需要远程同步的服务器；无快照或任一快照缺配置都会入选。
 */
function findServersRequiringSync(servers, snapshots, nodeConfigs) {
  const snapshotKeysByServer = new Map();
  for (const snapshot of snapshots) {
    const serverId = String(snapshot.server_id);
    if (!snapshotKeysByServer.has(serverId)) {
      snapshotKeysByServer.set(serverId, []);
    }
    snapshotKeysByServer.get(serverId).push(
      buildSourceCacheKey(snapshot.server_id, snapshot.inbound_id)
    );
  }

  const configKeys = new Set(
    nodeConfigs.map((config) => buildSourceCacheKey(config.server_id, config.inbound_id))
  );
  return servers.filter((server) => {
    const snapshotKeys = snapshotKeysByServer.get(String(server.id));
    return !snapshotKeys || snapshotKeys.some((key) => !configKeys.has(key));
  });
}

/**
 * 确保在线服务器存在节点快照，缺失时按服务器补齐。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Array} servers - 在线服务器列表
 * @param {Object} logger - 日志实例
 * @param {Object} [options={}] - 同步选项
 * @param {Map<string,Object>} [options.inboundSnapshotCache] - 批量任务级 inbound 快照缓存
 * @param {Object} [options.dependencies] - 测试或编排使用的同步依赖覆盖
 * @returns {Promise<Array<{server:Object,result:Object}>>} 本次实际远程同步结果
 */
async function ensureNodeSnapshotsAvailable(db, servers, logger, options = {}) {
  if (servers.length === 0) {
    return [];
  }

  const serversById = mapServersById(servers);
  const snapshots = filterOnlineSnapshots(
    await subscriptionRepository.listNodeSnapshots(db),
    serversById
  );
  const snapshotServerIds = new Set(snapshots.map((snapshot) => snapshot.server_id));
  const missingServers = servers.filter((server) => !snapshotServerIds.has(server.id));

  if (missingServers.length === 0) {
    return [];
  }

  logger.info(`检测到 ${missingServers.length} 台在线服务器缺少 xui_nodes 快照，开始按服务器补齐`);
  const syncServers = options.dependencies?.syncSelectedServers || syncSelectedServers;
  const syncResult = await syncServers(db, missingServers, {
    inboundSnapshotCache: options.inboundSnapshotCache
  });
  const results = missingServers.map((server, index) => ({
    server,
    result: syncResult.results?.[index] || {
      success: false,
      serverId: server.id,
      message: '未返回服务器同步结果'
    }
  }));
  for (const { server, result } of results) {
    logger.info(`补齐服务器节点快照: server=${server.name}, success=${result.success}, nodeCount=${result.nodeCount || 0}`);
  }
  return results;
}

/**
 * 确保用户在所有在线 inbound 上都有本地节点配置。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} user - 用户信息
 * @param {Array} servers - 在线服务器列表
 * @param {Object} logger - 日志实例
 * @param {Object} [options={}] - 生成选项
 * @param {Map<string,Object>} [options.inboundSnapshotCache] - 批量任务级 inbound 快照缓存
 * @param {Object} [options.dependencies] - 测试或特殊编排使用的同步依赖覆盖；省略时使用生产默认实现
 * @returns {Promise<Array>} 在线节点配置列表
 */
async function ensureUserNodeConfigsComplete(db, user, servers, logger, options = {}) {
  const serversById = mapServersById(servers);
  const onlineSnapshots = filterOnlineSnapshots(
    await subscriptionRepository.listNodeSnapshots(db),
    serversById
  );
  let nodeConfigs = filterOnlineNodeConfigs(
    await subscriptionRepository.listUserNodeConfigs(db, user.id),
    serversById
  );

  if (onlineSnapshots.length === 0) {
    return nodeConfigs;
  }

  const configKeys = new Set(
    nodeConfigs.map((config) => buildSourceCacheKey(config.server_id, config.inbound_id))
  );
  const missingPairs = onlineSnapshots.filter(
    (snapshot) => !configKeys.has(buildSourceCacheKey(snapshot.server_id, snapshot.inbound_id))
  );

  if (missingPairs.length === 0) {
    return nodeConfigs;
  }

  logger.info(`用户 ${user.email} 缺少 ${missingPairs.length} 个节点配置，尝试同步用户到 3X-UI`);
  const { totalTrafficLimit } = getUserTrafficEntitlement(user);
  const serverIds = [...new Set(missingPairs.map((snapshot) => snapshot.server_id))];
  const syncUser = options.dependencies?.syncUserToXuiServers || syncUserToXuiServers;
  const syncResult = await syncUser(db, user, {
    traffic_limit: totalTrafficLimit,
    serverIds,
    inboundSnapshotCache: options.inboundSnapshotCache
  });
  if (!syncResult.success) {
    logger.warn(`同步用户节点配置未完全成功: user=${user.email}, message=${syncResult.message || 'unknown'}`);
  }

  nodeConfigs = filterOnlineNodeConfigs(
    await subscriptionRepository.listUserNodeConfigs(db, user.id),
    serversById
  );
  return nodeConfigs;
}

/**
 * 仅针对指定修复服务器重新同步用户，并重读这些服务器的节点配置。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} user - 当前订阅用户
 * @param {Array<Object>} repairServers - 首轮模板失败且无有效缓存的服务器
 * @param {Object} logger - 日志实例
 * @param {Object} [options={}] - 生成选项与依赖覆盖
 * @returns {Promise<Array<Object>>} 修复服务器上的最新用户节点配置
 */
async function reloadRepairNodeConfigs(db, user, repairServers, logger, options = {}) {
  if (repairServers.length === 0) {
    return [];
  }

  const repairServerIds = repairServers.map((server) => server.id);
  const { totalTrafficLimit } = getUserTrafficEntitlement(user);
  const syncUser = options.dependencies?.syncUserToXuiServers || syncUserToXuiServers;
  const syncResult = await syncUser(db, user, {
    traffic_limit: totalTrafficLimit,
    serverIds: repairServerIds,
    inboundSnapshotCache: options.inboundSnapshotCache
  });
  if (!syncResult.success) {
    logger.warn(
      `定向修复用户节点配置未完全成功: user=${user.email}, `
      + `success=${syncResult.successCount || 0}, failed=${syncResult.failureCount || 0}`
    );
  }

  const repairIds = new Set(repairServerIds);
  return (await subscriptionRepository.listUserNodeConfigs(db, user.id))
    .filter((config) => repairIds.has(config.server_id));
}

/**
 * 将来源缓存列表按 server_id + inbound_id 建立映射。
 *
 * @param {Array} sources - 缓存记录列表
 * @returns {Map<string,Object>} 来源缓存映射
 */
function mapSourcesByKey(sources) {
  return new Map(sources.map((source) => [buildSourceCacheKey(source.server_id, source.inbound_id), source]));
}

/**
 * 评估当前来源缓存是否可直接复用。
 *
 * @param {Array} nodeConfigs - 用户节点配置
 * @param {Map<string,Object>} sourceMap - 来源缓存映射
 * @param {Map<number,Object>} serversById - 在线服务器映射
 * @returns {{usable:boolean,invalidPairs:Array,invalidPairKeys:Set<string>,invalidServerIds:Set<number>}} 评估结果
 */
function collectSourceCacheStatus(nodeConfigs, sourceMap, serversById) {
  const invalidServerIds = new Set();
  const invalidPairKeys = new Set();
  const invalidPairs = [];
  const now = Math.floor(Date.now() / 1000);

  for (const config of nodeConfigs) {
    const key = buildSourceCacheKey(config.server_id, config.inbound_id);
    const source = sourceMap.get(key);
    const server = serversById.get(config.server_id);
    const result = isSourceCacheUsable({
      source,
      node: config,
      server,
      subId: config.sub_id,
      now,
      maxAgeSeconds: SOURCE_CACHE_MAX_AGE_SECONDS,
      silent: true
    });

    const sourceMatched = result.usable
      ? isOriginalLinkMatchedToInbound(source.original_link, config)
      : false;
    if (result.usable && sourceMatched) {
      continue;
    }

    const reason = result.usable ? 'original_link_mismatch' : result.reason;
    invalidPairKeys.add(key);
    invalidPairs.push({ key, config, reason });
    if (shouldRepairServerForCacheReason(reason)) {
      invalidServerIds.add(config.server_id);
    }
  }

  return {
    usable: invalidPairs.length === 0,
    invalidPairs,
    invalidPairKeys,
    invalidServerIds
  };
}

/**
 * 创建服务内部拥有的来源刷新失败对象，避免修改冻结 Error 或字符串等外部拒绝值。
 *
 * @param {*} cause - 原始失败原因，仅作为 cause 保留，不写入日志
 * @param {Object} context - 已脱敏的用户、服务器、节点和单项耗时
 * @returns {Error} 可安全携带刷新上下文的内部错误
 */
function createSourceRefreshError(cause, context) {
  const error = new Error('原始订阅模板刷新失败', { cause });
  error.name = 'SourceRefreshError';
  const rawErrorType = String(cause?.code || cause?.name || 'Error');
  const errorType = rawErrorType
    .replace(/[^A-Za-z0-9_.-]/g, '_')
    .slice(0, 64) || 'Error';
  error.sourceRefreshContext = {
    ...context,
    errorType
  };
  return error;
}

/**
 * 并发刷新原始订阅模板缓存，单节点失败仅记录结果，不中断其他节点。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} user - 用户信息
 * @param {Array} nodeConfigs - 待刷新节点配置
 * @param {Map<number,Object>} serversById - 在线服务器映射
 * @param {Object} logger - 日志实例
 * @param {Object} [dependencies={}] - 可替换的外部依赖，生产环境默认使用共享拉取实现
 * @returns {Promise<{successfulConfigs:Array,failedConfigs:Array,results:Array}>} 与输入顺序关联的刷新结果
 */
async function refreshSubscriptionSources(db, user, nodeConfigs, serversById, logger, dependencies = {}) {
  const now = Math.floor(Date.now() / 1000);
  const startedAt = Date.now();
  const fetchSource = dependencies.fetchOriginalSubscription || fetchOriginalSubscription;
  const sourceFetchCache = new Map();

  /**
   * 同一服务器同一 subId 的原始订阅只拉取一次，避免 3X-UI 在多 inbound 共用 subId 时被并发重复请求打爆。
   * @param {Object} server - 当前 3X-UI 服务器。
   * @param {Object} config - 当前 inbound 配置。
   * @returns {Promise<string[]>} 解析后的原始订阅链接列表。
   */
  async function getSourceLinks(server, config) {
    const cacheKey = `${config.server_id}:${config.sub_id}`;
    if (!sourceFetchCache.has(cacheKey)) {
      sourceFetchCache.set(cacheKey, (async () => {
        const originalContent = await fetchSource(
          server.sub_url,
          config.sub_id,
          { timeout: SOURCE_FETCH_TIMEOUT_MS }
        );
        return parseSubscriptionContent(originalContent);
      })());
    }

    return sourceFetchCache.get(cacheKey);
  }

  const results = await runWithConcurrency(
    nodeConfigs,
    SOURCE_FETCH_CONCURRENCY,
    async (config) => {
      const itemStartedAt = Date.now();
      const server = serversById.get(config.server_id);

      try {
        if (!server || !server.sub_url) {
          throw new Error('服务器不存在或缺少订阅地址');
        }

        const links = await getSourceLinks(server, config);
        const originalLink = pickInboundMatchedNodeLink(links, config);

        if (!originalLink) {
          throw new Error('未找到协议匹配的原始节点链接');
        }

        await subscriptionRepository.upsertSubscriptionSource(db, {
          user_id: user.id,
          server_id: config.server_id,
          inbound_id: config.inbound_id,
          sub_id: config.sub_id,
          remark: config.remark || '',
          protocol: config.protocol || '',
          original_link: originalLink,
          node_fingerprint: computeNodeFingerprint(config),
          server_fingerprint: computeServerFingerprint(server),
          fetched_at: now,
          updated_at: now
        });

        logger.info(
          `刷新原始订阅模板成功: user=${user.email}, `
          + `servers=${formatServerNames([server])}, inbound=${config.inbound_id}, `
          + `duration=${Date.now() - itemStartedAt}ms`
        );
        return config;
      } catch (cause) {
        throw createSourceRefreshError(cause, {
          userEmail: user.email,
          serverId: server?.id || config.server_id,
          serverName: server?.name,
          inboundId: config.inbound_id,
          duration: Date.now() - itemStartedAt
        });
      }
    }
  );
  const successfulConfigs = [];
  const failedConfigs = [];

  results.forEach((result, index) => {
    const config = nodeConfigs[index];
    if (result.status === 'fulfilled') {
      successfulConfigs.push(config);
      return;
    }

    failedConfigs.push(config);
    const context = result.reason?.sourceRefreshContext || {};
    logger.warn(
      `刷新原始订阅模板失败: user=${context.userEmail || user.email}, `
      + `servers=${formatServerNames([{
        id: context.serverId || config.server_id,
        name: context.serverName
      }])}, inbound=${context.inboundId || config.inbound_id}, `
      + `duration=${context.duration ?? Date.now() - startedAt}ms, errorType=${context.errorType || 'Error'}`
    );
  });
  logger.info(
    `原始订阅模板刷新完成: success=${successfulConfigs.length}, failed=${failedConfigs.length}, `
    + `total=${nodeConfigs.length}, duration=${Date.now() - startedAt}ms`
  );

  return {
    successfulConfigs,
    failedConfigs,
    results
  };
}

/**
 * 将刷新失败的原始订阅模板写入后台补偿队列。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} user - 当前订阅用户
 * @param {Array<Object>} failedConfigs - 最终刷新失败的节点配置
 * @param {Object} logger - 日志实例
 * @returns {Promise<void>}
 */
async function enqueueFailedSourceRefreshRetry(db, user, failedConfigs, logger) {
  if (!Array.isArray(failedConfigs) || failedConfigs.length === 0) {
    return;
  }

  const configs = failedConfigs.map((config) => ({
    server_id: config.server_id,
    inbound_id: config.inbound_id
  }));

  try {
    await xuiSyncTaskService.enqueueTask(db, {
      userId: user.id,
      taskType: xuiSyncTaskService.TASK_TYPES.SUBSCRIPTION_SOURCE_REFRESH,
      payload: { configs }
    });
    logger.warn(
      `原始订阅模板刷新失败项已加入重试队列: user=${user.email}, failed=${configs.length}`
    );
  } catch (error) {
    logger.error(`原始订阅模板刷新失败项写入重试队列失败: user=${user.email}, error=${error.message}`);
  }
}

/**
 * 执行后台原始订阅模板刷新补偿任务。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} task - xui_sync_tasks 中的任务记录
 * @param {Object} logger - 日志实例
 * @param {Object} [dependencies={}] - 测试依赖注入
 * @returns {Promise<{success:boolean,message:string}>}
 */
async function retrySubscriptionSourceRefreshTask(db, task, logger, dependencies = {}) {
  const payload = task.payload_data || {};
  const requestedKeys = new Set((payload.configs || []).map((config) => (
    buildSourceCacheKey(config.server_id, config.inbound_id)
  )));
  if (requestedKeys.size === 0) {
    return { success: true, message: '任务缺少刷新目标，已跳过' };
  }

  const userId = task.user_id || payload.user_id;
  const user = assertActiveSubscriptionUser(
    await subscriptionRepository.findSubscriptionUserById(db, userId)
  );
  const servers = await subscriptionRepository.listOnlineServers(db);
  const serversById = mapServersById(servers);
  const nodeConfigs = filterOnlineNodeConfigs(
    await subscriptionRepository.listUserNodeConfigs(db, user.id),
    serversById
  ).filter((config) => requestedKeys.has(
    buildSourceCacheKey(config.server_id, config.inbound_id)
  ));

  if (nodeConfigs.length === 0) {
    return { success: true, message: '刷新目标已不存在或服务器已离线，已跳过' };
  }

  const refreshResult = await refreshSubscriptionSources(
    db,
    user,
    nodeConfigs,
    serversById,
    logger,
    dependencies
  );

  if (refreshResult.failedConfigs.length > 0) {
    return {
      success: false,
      message: `仍有 ${refreshResult.failedConfigs.length} 个原始订阅模板刷新失败`
    };
  }

  await generateSubscription(db, user.id, logger, { dependencies });

  return { success: true, message: '原始订阅模板刷新并重新生成订阅缓存成功' };
}

/**
 * 基于来源缓存和用户优选 IP 组合最终订阅节点。
 *
 * @param {Array} nodeConfigs - 用户节点配置
 * @param {Map<string,Object>} sourceMap - 来源缓存映射
 * @param {Map<number,Object>} serversById - 在线服务器映射
 * @param {Array} cfIps - 用户优选 IP
 * @param {Object} logger - 日志实例
 * @returns {Array} 最终节点列表
 */
function composeSubscriptionNodes(nodeConfigs, sourceMap, serversById, cfIps, logger) {
  const allNodes = [];

  for (const config of nodeConfigs) {
    const key = buildSourceCacheKey(config.server_id, config.inbound_id);
    const source = sourceMap.get(key);
    const server = serversById.get(config.server_id);

    if (!source || !source.original_link || !server) {
      logger.warn(`缺少可复用的原始订阅模板: server=${config.server_id}, inbound=${config.inbound_id}`);
      continue;
    }

    const strategy = getStrategyFromRemark(config.remark);
    if (strategy === 'cf') {
      for (let i = 0; i < cfIps.length; i += 1) {
        const cfIp = getCfIpValue(cfIps[i]);
        const nodeNameBase = `${server.name}-${config.remark}`;
        const nodeName = cfIps.length > 1 ? `${nodeNameBase}-${i + 1}` : nodeNameBase;
        const processedLink = replaceNodeRemark(
          processNodeLink(source.original_link, 'cf', {
            cfIp,
            clientPort: server.client_port,
            host: server.host
          }),
          nodeName
        );

        allNodes.push({
          server_name: server.name,
          node_name: nodeName,
          protocol: config.protocol,
          strategy,
          link: processedLink,
          original_link: source.original_link
        });
      }
      continue;
    }

    const nodeName = `${server.name}-${config.remark}`;
    const processedLink = replaceNodeRemark(
      processNodeLink(source.original_link, strategy),
      nodeName
    );

    allNodes.push({
      server_name: server.name,
      node_name: nodeName,
      protocol: config.protocol,
      strategy,
      link: processedLink,
      original_link: source.original_link
    });
  }

  return allNodes;
}

/**
 * 断言限时套餐仍在有效期内。
 * 职责：只对 plan_type=timed 且 expire_at 已到达的记录拦截订阅访问。
 * 关键参数：record 可以是用户记录或订阅缓存记录，需包含 plan_type/expire_at。
 * 核心分支：不限时套餐直接放行；限时套餐 expire_at 非有效未来时间时拒绝。
 *
 * @param {Object} record - 用户或订阅记录
 * @returns {void}
 */
function assertSubscriptionNotExpired(record) {
  if (!isTimedPlan(record)) {
    return;
  }

  const expireAt = Number(record.expire_at);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(expireAt) || expireAt <= now) {
    throw createLegacyBusinessError(2003, '套餐已到期，请续费后使用订阅', 400, null);
  }
}

/**
 * 判断用户启用字段是否表示启用。
 * @param {*} value - users.enabled 字段值
 * @returns {boolean} 是否启用
 */
function isEnabledValue(value) {
  return value === true || value === 1 || value === '1';
}

/**
 * 校验订阅用户是否存在且账号启用。
 *
 * @param {Object|undefined} user - 用户信息
 * @returns {Object} 已校验用户
 */
function assertActiveSubscriptionUser(user) {
  if (!user) {
    throw createLegacyBusinessError(2004, '用户不存在', 400, null);
  }

  if (!isEnabledValue(user.enabled) && user.disable_reason === DISABLE_REASONS.ADMIN) {
    throw createLegacyBusinessError(2003, `账号 ${user.email} 已被禁用，请联系管理员`, 400, null);
  }

  assertSubscriptionNotExpired(user);

  if (!isEnabledValue(user.enabled)) {
    throw createLegacyBusinessError(2003, `账号 ${user.email} 已被禁用`, 400, null);
  }

  return user;
}

/**
 * 统一计算订阅场景下的套餐流量与总流量。
 *
 * @param {Object} user - 用户或订阅记录，需包含 traffic_limit
 * @returns {{planTrafficLimit:number,referralTrafficLimit:number,totalTrafficLimit:number}} 流量口径
 */
function getUserTrafficEntitlement(user) {
  const planTrafficLimit = Number(user?.traffic_limit) || 0;

  return {
    planTrafficLimit,
    referralTrafficLimit: 0,
    totalTrafficLimit: planTrafficLimit
  };
}

/**
 * 构建订阅客户端识别的用户流量响应头。
 *
 * @param {Object} subscription - 当前订阅记录
 * @returns {Object} 包含流量用量、总量与到期时间的响应头
 */
function buildSubscriptionUserinfoHeaders(subscription) {
  const { totalTrafficLimit } = getUserTrafficEntitlement(subscription);
  return {
    'Subscription-Userinfo': `upload=0; download=${subscription.traffic_used}; total=${totalTrafficLimit}; expire=${subscription.expire_at}`
  };
}

/**
 * 读取 Clash 订阅响应头配置，配置缺失或非法时回退默认值。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Promise<{configName:string,updateIntervalHours:string}>} Clash 订阅头配置
 */
async function getClashSubscriptionHeaderConfig(db) {
  const [configNameRow, updateIntervalRow] = await Promise.all([
    subscriptionRepository.findSystemSettingByKey(db, CLASH_CONFIG_NAME_KEY),
    subscriptionRepository.findSystemSettingByKey(db, CLASH_PROFILE_UPDATE_INTERVAL_KEY)
  ]);
  const configName = String(configNameRow?.value || '').trim() || DEFAULT_CLASH_CONFIG_NAME;
  const interval = Number(updateIntervalRow?.value);

  return {
    configName,
    updateIntervalHours: Number.isFinite(interval) && interval > 0
      ? String(interval)
      : DEFAULT_CLASH_PROFILE_UPDATE_INTERVAL_HOURS
  };
}

/**
 * 构建 Clash 订阅专属响应头。
 *
 * @param {Object} subscription - 当前订阅记录，用于填充用户流量信息
 * @param {Object} config - Clash 订阅头配置
 * @returns {Object} Clash 订阅下载名、自动更新间隔与用户流量响应头
 */
function buildClashSubscriptionHeaders(subscription, config) {
  return {
    ...buildSubscriptionUserinfoHeaders(subscription),
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(config.configName)}`,
    'Profile-Update-Interval': config.updateIntervalHours
  };
}

/**
 * 构造订阅失败时展示给客户端的假节点。
 * 职责：将官网入口和失败原因伪装成普通节点名称，确保订阅客户端刷新后能直接看到提示。
 * 关键参数：reason 为归一化后的用户可读原因，siteUrl 为空时仅展示“官网地址”。
 *
 * @param {string} reason - 失败原因文案
 * @param {string} [siteUrl=''] - 官网地址
 * @returns {Array<{node_name:string,link:string}>} 两个可解析的假节点
 */
function buildFallbackSubscriptionNodes(reason, siteUrl = '') {
  const siteLabel = String(siteUrl || '').trim()
    ? `官网地址 ${String(siteUrl).trim()}`
    : '官网地址';
  const names = [siteLabel, reason];

  return names.map((nodeName, index) => ({
    node_name: nodeName,
    link: `vmess://${FALLBACK_NODE_UUIDS[index]}@${FALLBACK_NODE_HOST}:443?security=none&type=tcp#${encodeURIComponent(nodeName)}`
  }));
}

/**
 * 构造订阅失败兜底响应。
 * 职责：失败时仍输出合法的 Base64 或 Clash 内容，避免订阅客户端只得到 HTTP 错误。
 * 核心分支：clash=1 返回 YAML，其余返回 Base64 文本。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} query - 请求查询参数
 * @param {string} reason - 失败原因文案
 * @param {Object} [subscription] - 可选订阅记录，用于保留流量响应头
 * @returns {Promise<{contentType:string,headers:Object,body:string,email:string}>} 兜底订阅内容
 */
async function buildFallbackSubscriptionContent(db, query, reason, subscription = {}) {
  const fallbackSubscription = {
    email: subscription.email || '',
    traffic_used: subscription.traffic_used || 0,
    traffic_limit: subscription.traffic_limit || 0,
    referral_traffic_limit: subscription.referral_traffic_limit || 0,
    expire_at: subscription.expire_at || 0
  };
  const nodes = buildFallbackSubscriptionNodes(reason, getUserAppBaseUrl());

  if (query.clash === '1') {
    const clashHeaderConfig = await getClashSubscriptionHeaderConfig(db);
    return {
      email: fallbackSubscription.email,
      contentType: 'text/yaml; charset=utf-8',
      headers: buildClashSubscriptionHeaders(fallbackSubscription, clashHeaderConfig),
      body: generateClashConfig(nodes, fallbackSubscription)
    };
  }

  return {
    email: fallbackSubscription.email,
    contentType: 'text/plain; charset=utf-8',
    headers: buildSubscriptionUserinfoHeaders(fallbackSubscription),
    body: Buffer.from(generateV2RayConfig(nodes)).toString('base64')
  };
}

/**
 * 根据用户订阅状态生成失败兜底内容。
 * 职责：统一缓存命中和缓存缺失后的状态判定，避免把需要续费误判为链接无效。
 * 核心分支：管理员禁用优先；过期或普通禁用返回续费；无状态异常时返回 null 交给调用方继续处理。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} query - 请求查询参数
 * @param {Object} subscription - 用户或订阅缓存记录
 * @returns {Promise<Object|null>} 需要兜底时返回订阅内容，否则返回 null
 */
async function buildStatusFallbackContent(db, query, subscription) {
  if (!subscription) {
    return null;
  }

  if (!isEnabledValue(subscription.enabled) && subscription.disable_reason === DISABLE_REASONS.ADMIN) {
    return buildFallbackSubscriptionContent(db, query, '被管理员禁用', subscription);
  }

  if (!isEnabledValue(subscription.enabled)
    && [DISABLE_REASONS.TRAFFIC_LIMIT, DISABLE_REASONS.EXPIRED].includes(subscription.disable_reason)) {
    return buildFallbackSubscriptionContent(db, query, '需要续费', subscription);
  }

  try {
    assertSubscriptionNotExpired(subscription);
  } catch (error) {
    if (error && error.isLegacyBusinessError) {
      return buildFallbackSubscriptionContent(db, query, '需要续费', subscription);
    }
    throw error;
  }

  return null;
}

/**
 * 将公告标题规范化为可显示的虚拟节点名称。
 *
 * @param {string} title - 公告标题
 * @returns {string} 去除多余空白和换行后的节点名称
 */
function normalizeAnnouncementNodeName(title) {
  return String(title || '').replace(/\s+/g, ' ').trim();
}

/**
 * 构建只用于客户端显示标题的虚拟公告节点。
 * 核心分支：只使用公告 title，不携带 content，避免节点列表显示过长。
 *
 * @param {Array<Object>} announcements - node_show=1 的公告列表
 * @returns {Array<Object>} 可与真实节点一起输出的虚拟节点
 */
function buildAnnouncementVirtualNodes(announcements) {
  return (announcements || [])
    .map((announcement) => normalizeAnnouncementNodeName(announcement.title))
    .filter(Boolean)
    .map((nodeName) => ({
      server_name: '系统公告',
      node_name: nodeName,
      protocol: 'vless',
      strategy: 'announcement',
      is_announcement: true,
      link: `vless://00000000-0000-0000-0000-000000000000@127.0.0.1:1?encryption=none&security=none&type=tcp#${encodeURIComponent(nodeName)}`,
      original_link: ''
    }));
}

/**
 * 在订阅输出阶段拼接公告虚拟节点。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Array<Object>} nodes - 缓存中的真实节点
 * @returns {Promise<Array<Object>>} 真实节点 + 公告虚拟节点
 */
async function appendAnnouncementVirtualNodes(db, nodes) {
  const announcements = await subscriptionRepository.listNodeShowAnnouncements(db);
  return [
    ...buildAnnouncementVirtualNodes(announcements),
    ...nodes
  ];
}

/**
 * 生成用户订阅链接并刷新缓存。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @param {Object} logger - 日志实例
 * @param {Object} [options={}] - 生成选项
 * @param {Map<string,Object>} [options.inboundSnapshotCache] - 批量任务级 inbound 快照缓存
 * @param {Object} [options.dependencies] - 同步依赖覆盖；生产调用省略后保持默认行为
 * @returns {Promise<{subscription_url:string,clash_url:string,v2ray_url:string}>} 订阅链接集合
 */
async function generateSubscription(db, userId, logger, options = {}) {
  const inboundSnapshotCache = options.inboundSnapshotCache || new Map();
  options = { ...options, inboundSnapshotCache };
  const generationStartedAt = Date.now();
  const remoteServerIds = new Set();
  const remoteServers = [];
  const inboundOutcomes = new Map();
  /**
   * 记录本次实际访问的远程服务器及其最新结果；服务器按首次出现顺序去重。
   *
   * @param {Object} server - 被访问的在线服务器记录
   * @param {Object} result - 当前一轮同步结果
   * @returns {void}
   */
  const recordInboundResult = (server, result) => {
    if (!server || server.id === null || server.id === undefined) {
      return;
    }
    const existingIndex = remoteServers.findIndex((item) => item.id === server.id);
    if (existingIndex === -1) {
      remoteServers.push(server);
    } else {
      remoteServers[existingIndex] = server;
    }
    remoteServerIds.add(server.id);
    inboundOutcomes.set(server.id, !!result?.success);
  };
  const summary = {
    snapshotReused: 0,
    snapshotRejected: 0,
    inboundSuccess: 0,
    inboundFailed: 0,
    sourceSuccess: 0,
    sourceFailed: 0,
    repairServers: 0,
    nodes: 0
  };
  const existingSubscription = await subscriptionRepository.findLatestUserSubscription(db, userId);
  const user = assertActiveSubscriptionUser(
    await subscriptionRepository.findSubscriptionUserById(db, userId)
  );
  const cfIps = await subscriptionRepository.listEnabledUserCfIps(db, userId);

  if (cfIps.length === 0) {
    throw createLegacyBusinessError(3001, '请先完成极速通道优选', 400, null);
  }

  const servers = await subscriptionRepository.listOnlineServers(db);
  if (servers.length === 0) {
    throw createLegacyBusinessError(500, '当前没有可用的在线服务器', 500, null);
  }

  const serversById = mapServersById(servers);
  const isFirstGeneration = !existingSubscription;

  if (isFirstGeneration) {
    const snapshots = await subscriptionRepository.listNodeSnapshots(db);
    const nodeConfigs = await subscriptionRepository.listUserNodeConfigs(db, user.id);
    const missingServers = findServersRequiringSync(servers, snapshots, nodeConfigs);
    if (missingServers.length > 0) {
      logger.info(`用户 ${user.email} 首次生成订阅，定向同步 ${missingServers.length} 台缺口服务器`);
      const syncServers = options.dependencies?.syncSelectedServers || syncSelectedServers;
      const syncResult = await syncServers(db, missingServers, {
        inboundSnapshotCache: options.inboundSnapshotCache
      });
      missingServers.forEach((server, index) => {
        recordInboundResult(server, syncResult.results?.[index]);
      });
      logger.info(`首次生成前节点同步完成: ${syncResult.syncedCount || 0}/${syncResult.totalCount || missingServers.length} 台服务器`);
    } else {
      logger.info(`用户 ${user.email} 首次生成订阅，本地快照和节点配置完整，跳过远程节点同步`);
    }
  } else {
    const snapshotSyncResults = await ensureNodeSnapshotsAvailable(db, servers, logger, options);
    snapshotSyncResults.forEach(({ server, result }) => recordInboundResult(server, result));
  }

  let nodeConfigs = await ensureUserNodeConfigsComplete(db, user, servers, logger, options);
  if (nodeConfigs.length === 0) {
    throw createLegacyBusinessError(500, '当前没有可用节点，请稍后重试', 500, null);
  }

  if (isFirstGeneration) {
    logger.info(`用户 ${user.email} 首次生成订阅，开始拉取全部原始订阅模板`);
    const firstRefreshResult = await refreshSubscriptionSources(
      db,
      user,
      nodeConfigs,
      serversById,
      logger,
      options.dependencies
    );
    logger.info(`用户 ${user.email} 首次模板刷新结果: success=${firstRefreshResult.successfulConfigs.length}, failed=${firstRefreshResult.failedConfigs.length}`);

    if (firstRefreshResult.failedConfigs.length > 0) {
      const sourceMap = mapSourcesByKey(
        await subscriptionRepository.listUserSubscriptionSources(db, userId)
      );
      const failedCacheStatus = collectSourceCacheStatus(
        firstRefreshResult.failedConfigs,
        sourceMap,
        serversById
      );
      const repairServerIds = new Set(
        failedCacheStatus.invalidPairs.map((pair) => pair.config.server_id)
      );
      const repairServers = servers.filter((server) => repairServerIds.has(server.id));
      summary.repairServers = repairServers.length;

      if (repairServers.length > 0) {
        const syncServers = options.dependencies?.syncSelectedServers || syncSelectedServers;
        const repairSyncResult = await syncServers(db, repairServers, {
          inboundSnapshotCache: options.inboundSnapshotCache
        });
        repairServers.forEach((server, index) => {
          recordInboundResult(server, repairSyncResult.results?.[index]);
        });
        const successfulRepairServers = repairServers.filter(
          (server, index) => repairSyncResult.results?.[index]?.success
        );

        const latestRepairConfigs = await reloadRepairNodeConfigs(
          db,
          user,
          successfulRepairServers,
          logger,
          options
        );
        const latestRepairConfigMap = new Map(
          latestRepairConfigs.map((config) => [
            buildSourceCacheKey(config.server_id, config.inbound_id),
            config
          ])
        );
        const retryConfigs = firstRefreshResult.failedConfigs
          .filter((config) => failedCacheStatus.invalidPairKeys.has(
            buildSourceCacheKey(config.server_id, config.inbound_id)
          ))
          .map((config) => {
            const key = buildSourceCacheKey(config.server_id, config.inbound_id);
            return latestRepairConfigMap.get(key) || config;
          });
        const repairIds = new Set(repairServers.map((server) => server.id));
        const originalRepairKeys = new Set(
          nodeConfigs
            .filter((config) => repairIds.has(config.server_id))
            .map((config) => buildSourceCacheKey(config.server_id, config.inbound_id))
        );
        nodeConfigs = [
          ...nodeConfigs.filter((config) => !repairIds.has(config.server_id)),
          ...latestRepairConfigs.filter(
            (config) => originalRepairKeys.has(
              buildSourceCacheKey(config.server_id, config.inbound_id)
            )
          )
        ];

        if (retryConfigs.length > 0) {
          const retryResult = await refreshSubscriptionSources(
            db,
            user,
            retryConfigs,
            serversById,
            logger,
            options.dependencies
          );
          await enqueueFailedSourceRefreshRetry(db, user, retryResult.failedConfigs, logger);
        }
      } else {
        await enqueueFailedSourceRefreshRetry(db, user, firstRefreshResult.failedConfigs, logger);
      }
    }
  } else {
    const sourceMap = mapSourcesByKey(
      await subscriptionRepository.listUserSubscriptionSources(db, userId)
    );
    const cacheStatus = collectSourceCacheStatus(nodeConfigs, sourceMap, serversById);

    if (cacheStatus.usable) {
      logger.info(`用户 ${user.email} 的原始订阅模板缓存可用，直接复用本地拼装`);
    } else {
      logger.info(`用户 ${user.email} 的原始订阅模板缓存不可用，开始增量修复: invalidPairs=${cacheStatus.invalidPairs.length}`);
      const refreshPlan = buildInboundRefreshPlan(user, cacheStatus.invalidPairs, serversById);
      summary.snapshotReused = refreshPlan.reusablePairs.length;
      summary.snapshotRejected = refreshPlan.remotePairs.length;
      const affectedServers = cacheStatus.invalidPairs
        .map((pair) => serversById.get(pair.config.server_id))
        .filter(Boolean);
      logger.info(
        `本地 inbound 快照评估: user=${user.email}, `
        + `servers=${formatServerNames(affectedServers)}, `
        + `invalidPairs=${cacheStatus.invalidPairs.length}, `
        + `reusedPairs=${refreshPlan.reusablePairs.length}, `
        + `remotePairs=${refreshPlan.remotePairs.length}, `
        + `reasons=${JSON.stringify(refreshPlan.reasonCounts)}`
      );

      if (refreshPlan.remoteServers.length > 0) {
        const inboundStartedAt = Date.now();
        const syncServers = options.dependencies?.syncSelectedServers || syncSelectedServers;
        const syncResult = await syncServers(db, refreshPlan.remoteServers, {
          inboundSnapshotCache: options.inboundSnapshotCache
        });
        refreshPlan.remoteServers.forEach((server, index) => {
          recordInboundResult(server, syncResult.results?.[index]);
        });
        logger.info(
          `inbound 并发补拉完成: user=${user.email}, `
          + `servers=${formatServerNames(refreshPlan.remoteServers)}, `
          + `success=${syncResult.syncedCount ?? syncResult.results?.filter((item) => item?.success).length ?? 0}, `
          + `failed=${syncResult.failedCount ?? syncResult.results?.filter((item) => !item?.success).length ?? 0}, `
          + `duration=${Date.now() - inboundStartedAt}ms`
        );

        // 补拉完成后统一重读，避免继续使用本轮请求开始前的旧 JOIN 快照。
        nodeConfigs = filterOnlineNodeConfigs(
          await subscriptionRepository.listUserNodeConfigs(db, user.id),
          serversById
        );
        const latestConfigMap = new Map(nodeConfigs.map((config) => [
          buildSourceCacheKey(config.server_id, config.inbound_id),
          config
        ]));
        const stillUntrustedServerIds = new Set();
        for (const pair of refreshPlan.remotePairs) {
          const latestConfig = latestConfigMap.get(pair.key);
          if (!inspectUserInNodeSnapshot(user, latestConfig).trusted) {
            stillUntrustedServerIds.add(pair.config.server_id);
          }
        }

        // 补拉后仍不可信时，只执行一轮既有用户同步补偿，防止异常服务器形成循环。
        const compensationServers = refreshPlan.remoteServers.filter(
          (server) => stillUntrustedServerIds.has(server.id)
        );
        if (compensationServers.length > 0) {
          summary.repairServers = compensationServers.length;
          await reloadRepairNodeConfigs(
            db,
            user,
            compensationServers,
            logger,
            options
          );

          // 用户补偿会修改远端客户端；再补拉一次才能让 xui_nodes 反映补偿后的真实状态。
          for (const server of compensationServers) {
            options.inboundSnapshotCache.delete(String(server.id));
          }
          const verificationSyncResult = await syncServers(db, compensationServers, {
            inboundSnapshotCache: options.inboundSnapshotCache
          });
          compensationServers.forEach((server, index) => {
            recordInboundResult(server, verificationSyncResult.results?.[index]);
          });
          logger.info(
            `补偿后 inbound 验证同步完成: user=${user.email}, `
            + `servers=${formatServerNames(compensationServers)}, `
            + `success=${verificationSyncResult.syncedCount
              ?? verificationSyncResult.results?.filter((item) => item?.success).length
              ?? 0}, `
            + `failed=${verificationSyncResult.failedCount
              ?? verificationSyncResult.results?.filter((item) => !item?.success).length
              ?? 0}`
          );
          nodeConfigs = filterOnlineNodeConfigs(
            await subscriptionRepository.listUserNodeConfigs(db, user.id),
            serversById
          );
        }
      } else {
        logger.info(
          `复用本地 inbound 快照: user=${user.email}, `
          + `servers=${formatServerNames(affectedServers)}, `
          + `pairs=${refreshPlan.reusablePairs.length}`
        );
      }

      const finalConfigMap = new Map(nodeConfigs.map((config) => [
        buildSourceCacheKey(config.server_id, config.inbound_id),
        config
      ]));
      const finalInvalidPairs = cacheStatus.invalidPairs.map((pair) => ({
        ...pair,
        config: finalConfigMap.get(pair.key)
      }));
      const verifiedRefreshPlan = buildInboundRefreshPlan(
        user,
        finalInvalidPairs,
        serversById
      );
      const trustedInvalidPairKeys = new Set(
        verifiedRefreshPlan.reusablePairs.map((pair) => pair.key)
      );

      // 仅刷新最初失效且最终快照可信的 pair；补偿失败项不得发布为新有效来源。
      const repairConfigs = nodeConfigs.filter((config) => (
        trustedInvalidPairKeys.has(
          buildSourceCacheKey(config.server_id, config.inbound_id)
        )
      ));
      const refreshResult = await refreshSubscriptionSources(
        db,
        user,
        repairConfigs,
        serversById,
        logger,
        options.dependencies
      );
      logger.info(`用户 ${user.email} 增量模板刷新结果: success=${refreshResult.successfulConfigs.length}, failed=${refreshResult.failedConfigs.length}`);
      await enqueueFailedSourceRefreshRetry(db, user, refreshResult.failedConfigs, logger);
    }
  }

  const latestSourceMap = mapSourcesByKey(
    await subscriptionRepository.listUserSubscriptionSources(db, userId)
  );
  const latestCacheStatus = collectSourceCacheStatus(nodeConfigs, latestSourceMap, serversById);
  for (const invalidPair of latestCacheStatus.invalidPairs) {
    latestSourceMap.delete(invalidPair.key);
  }
  const finalSourceKeys = new Set(
    nodeConfigs.map((config) => buildSourceCacheKey(config.server_id, config.inbound_id))
  );
  summary.sourceSuccess = Array.from(finalSourceKeys)
    .filter((key) => latestSourceMap.has(key))
    .length;
  summary.sourceFailed = finalSourceKeys.size - summary.sourceSuccess;
  const localServers = servers.filter((server) => !remoteServerIds.has(server.id));
  summary.inboundSuccess = Array.from(inboundOutcomes.values()).filter(Boolean).length;
  summary.inboundFailed = inboundOutcomes.size - summary.inboundSuccess;
  const allNodes = composeSubscriptionNodes(nodeConfigs, latestSourceMap, serversById, cfIps, logger);
  summary.nodes = allNodes.length;
  logger.info(
    `订阅生成汇总: user=${user.email}, localServers=${formatServerNames(localServers)}, `
    + `remoteServers=${formatServerNames(remoteServers)}, `
    + `snapshotReused=${summary.snapshotReused}, snapshotRejected=${summary.snapshotRejected}, `
    + `inboundSuccess=${summary.inboundSuccess}, `
    + `inboundFailed=${summary.inboundFailed}, sourceSuccess=${summary.sourceSuccess}, `
    + `sourceFailed=${summary.sourceFailed}, repairServers=${summary.repairServers}, `
    + `nodes=${summary.nodes}, duration=${Date.now() - generationStartedAt}ms`
  );
  if (allNodes.length === 0) {
    throw createLegacyBusinessError(500, '未生成任何可用节点，请稍后重试', 500, null);
  }

  await subscriptionRepository.saveUserSubscriptionCache(db, userId, user.sub_id, allNodes);
  logger.info(`用户 ${user.email} 生成订阅链接成功，共 ${allNodes.length} 个节点`);
  return user.sub_id;
}

/**
 * 更换用户公开订阅链接，并复用现有节点缓存。
 * 核心分支：先读取旧缓存，再替换 users.sub_id、清理旧缓存并用新 sub_id 写回同一批节点。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @param {Object} logger - 日志对象
 * @param {Object} [options={}] - 测试依赖注入与生成选项
 * @returns {Promise<string>} 新的公开订阅 ID
 */
async function replaceSubscriptionLink(db, userId, logger, options = {}) {
  const user = assertActiveSubscriptionUser(
    await subscriptionRepository.findSubscriptionUserById(db, userId)
  );

  const dependencies = options.dependencies || {};
  const createSubId = dependencies.generatePublicSubscriptionId || generatePublicSubscriptionId;
  const existingSubscription = await subscriptionRepository.findLatestUserSubscription(db, userId);
  if (!existingSubscription || !existingSubscription.nodes_data) {
    throw createLegacyBusinessError(3002, '请先生成订阅链接', 400, null);
  }

  const newSubId = createSubId();
  const nodes = JSON.parse(existingSubscription.nodes_data || '[]');

  await subscriptionRepository.replaceUserSubscriptionId(db, userId, newSubId);
  await subscriptionRepository.deleteUserSubscriptionCaches(db, userId);
  await subscriptionRepository.saveUserSubscriptionCache(db, userId, newSubId, nodes);

  logger?.info?.(`用户 ${user.email} 更换订阅链接成功，复用 ${nodes.length} 个本地节点缓存`);
  return newSubId;
}

/**
 * 获取用户当前订阅详情与节点展示信息。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<Object>} 订阅详情
 */
async function getSubscriptionInfo(db, userId) {
  const user = assertActiveSubscriptionUser(
    await subscriptionRepository.findSubscriptionUserById(db, userId)
  );
  const existingSubscription = await subscriptionRepository.findLatestUserSubscription(db, userId);
  const cfIps = await subscriptionRepository.listEnabledUserCfIps(db, userId);
  const subscriptionReady = cfIps.length > 0 && !!existingSubscription;
  const servers = subscriptionReady
    ? await subscriptionRepository.listOnlineServersForDisplay(db)
    : [];
  const nodes = [];

  for (const server of servers) {
    const serverNodes = await subscriptionRepository.listServerNodes(db, server.id);
    for (const node of serverNodes) {
      const strategy = node.remark && node.remark.toLowerCase().includes('cf') ? 'cf' : 'direct';
      const config = parseNodeConfig(node, node.settings, node.stream_settings, user.email);
      const protocolDetail = `${node.protocol}+${config.network}+${config.security}`;
      const nodeHost = server.host || '';

      if (strategy === 'cf' && cfIps.length > 0) {
        const nodePort = server.client_port || node.port;
        cfIps.forEach((cfIp, index) => {
          const ipRemark = cfIps.length > 1 ? `${node.remark}-${index + 1}` : node.remark;
          nodes.push({
            server_name: server.name,
            node_name: `${server.name}-${ipRemark}`,
            protocol: protocolDetail,
            strategy,
            uuid: config.uuid,
            address: getCfIpValue(cfIp),
            port: nodePort,
            host: nodeHost,
            remark: ipRemark
          });
        });
        continue;
      }

      const defaultIp = String(server.api_url || '').match(/\/\/([^:]+)/);
      nodes.push({
        server_name: server.name,
        node_name: `${server.name}-${node.remark}`,
        protocol: protocolDetail,
        strategy,
        uuid: config.uuid,
        address: defaultIp ? defaultIp[1] : '0.0.0.0',
        port: node.port,
        host: nodeHost,
        remark: node.remark
      });
    }
  }

  const trafficUsed = Number(user.traffic_used);
  const {
    planTrafficLimit,
    referralTrafficLimit,
    totalTrafficLimit
  } = getUserTrafficEntitlement(user);
  const safeTrafficLimit = Number.isFinite(totalTrafficLimit) ? totalTrafficLimit : 0;
  const safeTrafficUsed = Number.isFinite(trafficUsed) ? trafficUsed : 0;
  const trafficPercent = safeTrafficLimit > 0
    ? Math.round((safeTrafficUsed / safeTrafficLimit) * 100 * 100) / 100
    : 0;

  return {
    subId: user.sub_id,
    cfOptimized: cfIps.length > 0,
    subscriptionReady,
    expire_at: user.expire_at,
    expire_text: formatTime(user.expire_at),
    traffic_used: user.traffic_used,
    plan_traffic_limit: planTrafficLimit,
    plan_traffic_limit_text: formatTraffic(planTrafficLimit),
    referral_traffic_limit: referralTrafficLimit,
    referral_traffic_limit_text: formatTraffic(referralTrafficLimit),
    total_traffic_limit: totalTrafficLimit,
    total_traffic_limit_text: formatTraffic(totalTrafficLimit),
    // 兼容旧字段：订阅详情中的 traffic_limit 对外语义已切换为总流量上限。
    traffic_limit: totalTrafficLimit,
    traffic_used_text: formatTraffic(user.traffic_used),
    traffic_limit_text: formatTraffic(totalTrafficLimit),
    traffic_percent: trafficPercent,
    nodes
  };
}

/**
 * 获取订阅内容，并根据请求格式生成输出。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} token - 订阅 token
 * @param {Object} query - 请求查询参数
 * @returns {Promise<{contentType:string,headers:Object,body:string,email:string}>} 输出结果
 */
async function getSubscriptionContent(db, token, query) {
  const subscription = await subscriptionRepository.findSubscriptionContentByToken(db, token);

  if (!subscription) {
    const user = await subscriptionRepository.findSubscriptionUserBySubId(db, token);
    const fallback = await buildStatusFallbackContent(db, query, user);
    if (fallback) {
      return fallback;
    }
    if (user) {
      return buildFallbackSubscriptionContent(db, query, '订阅链接无效需要重新生成', user);
    }
    throw createLegacyBusinessError(2004, '订阅链接无效或尚未生成', 400, null);
  }

  const fallback = await buildStatusFallbackContent(db, query, subscription);
  if (fallback) {
    return fallback;
  }

  const nodes = await appendAnnouncementVirtualNodes(
    db,
    JSON.parse(subscription.nodes_data || '[]')
  );
  if (query.clash === '1') {
    const clashHeaderConfig = await getClashSubscriptionHeaderConfig(db);
    return {
      email: subscription.email,
      contentType: 'text/yaml; charset=utf-8',
      headers: buildClashSubscriptionHeaders(subscription, clashHeaderConfig),
      body: generateClashConfig(nodes, subscription)
    };
  }

  const v2rayConfig = generateV2RayConfig(nodes, subscription);
  if (query.v2ray === '1') {
    return {
      email: subscription.email,
      contentType: 'text/plain; charset=utf-8',
      headers: {},
      body: Buffer.from(v2rayConfig).toString('base64')
    };
  }

  return {
    email: subscription.email,
    contentType: 'text/plain; charset=utf-8',
    headers: buildSubscriptionUserinfoHeaders(subscription),
    body: Buffer.from(v2rayConfig).toString('base64')
  };
}

/**
 * 生成 Clash 订阅配置。
 *
 * @param {Array} nodes - 节点列表
 * @returns {string} Clash YAML
 */
function generateClashConfig(nodes) {
  const proxies = nodes.map((node) => {
    const { link, node_name } = node;
    const parsed = parseNodeLink(link);
    if (!parsed) {
      return '';
    }

    const { protocol, uuid, address, port, params } = parsed;
    const serverAddress = address.startsWith('[') && address.endsWith(']')
      ? address.slice(1, -1)
      : address;

    if (protocol === 'vless') {
      const security = params.security || 'none';
      const network = params.type || 'tcp';
      const flow = params.flow || '';
      const sni = params.sni || '';
      const fp = params.fp || '';
      const pbk = params.pbk || '';
      const sid = params.sid || '';
      const host = params.host || '';
      const wsPath = params.path || '';

      let config = `  - name: ${node_name}
    type: vless
    server: ${serverAddress}
    port: ${port}
    uuid: ${uuid}
    udp: true`;

      if (flow) {
        config += `\n    flow: ${flow}`;
      }

      if (security === 'reality') {
        config += '\n    tls: true';
        if (sni) {
          config += `\n    servername: ${sni}`;
        }
        if (fp) {
          config += `\n    client-fingerprint: ${fp}`;
        }
        if (pbk || sid) {
          config += '\n    reality-opts:';
          if (pbk) {
            config += `\n      public-key: ${pbk}`;
          }
          if (sid) {
            config += `\n      short-id: "${sid}"`;
          }
        }
      } else if (security === 'tls') {
        config += '\n    tls: true';
        if (sni) {
          config += `\n    servername: ${sni}`;
        }
        if (fp) {
          config += `\n    client-fingerprint: ${fp}`;
        }
      } else {
        config += '\n    tls: false';
      }

      config += `\n    network: ${network}`;
      if (network === 'ws') {
        config += '\n    ws-opts:';
        config += `\n      path: ${wsPath || '/'}`;
        if (host) {
          config += '\n      headers:';
          config += `\n        Host: ${host}`;
        }
      } else if (network === 'tcp') {
        const headerType = params.headerType || 'none';
        if (headerType !== 'none') {
          config += '\n    tcp-opts:';
          config += '\n      header:';
          config += `\n        type: ${headerType}`;
        }
      }

      return config;
    }

    if (protocol === 'vmess') {
      const security = params.security || 'none';
      const network = params.type || 'tcp';
      const host = params.host || '';
      const wsPath = params.path || '';

      let config = `  - name: ${node_name}
    type: vmess
    server: ${serverAddress}
    port: ${port}
    uuid: ${uuid}
    alterId: 0
    cipher: auto
    udp: true`;

      config += `\n    tls: ${security === 'tls'}`;
      config += `\n    network: ${network}`;
      if (network === 'ws') {
        config += '\n    ws-opts:';
        config += `\n      path: ${wsPath || '/'}`;
        if (host) {
          config += '\n      headers:';
          config += `\n        Host: ${host}`;
        }
      }

      return config;
    }

    if (protocol === 'trojan') {
      const network = params.type || 'tcp';
      const host = params.host || '';
      const wsPath = params.path || '';
      const sni = params.sni || host || serverAddress;

      let config = `  - name: ${node_name}
    type: trojan
    server: ${serverAddress}
    port: ${port}
    password: ${uuid}
    udp: true`;

      config += '\n    tls: true';
      if (sni) {
        config += `\n    sni: ${sni}`;
      }
      config += `\n    network: ${network}`;
      if (network === 'ws') {
        config += '\n    ws-opts:';
        config += `\n      path: ${wsPath || '/'}`;
        if (host) {
          config += '\n      headers:';
          config += `\n        Host: ${host}`;
        }
      }

      return config;
    }

    if (protocol === 'hysteria2') {
      const sni = params.sni || serverAddress;
      const alpnValues = String(params.alpn || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

      let config = `  - name: ${node_name}
    type: hysteria2
    server: ${serverAddress}
    port: ${port}
    password: ${uuid}
    ports: 40000-50000
    tls: true
    skip-cert-verify: false
    sni: ${sni}
    udp: true`;

      if (alpnValues.length > 0) {
        config += '\n    alpn:';
        for (const alpn of alpnValues) {
          config += `\n      - ${alpn}`;
        }
      }
      if (params.fp) {
        config += `\n    client-fingerprint: ${params.fp}`;
      }

      return config;
    }

    return '';
  }).filter(Boolean).join('\n');

  return `proxies:
${proxies}

proxy-groups:
  - name: Proxy
    type: select
    proxies:
${nodes.map((node) => `      - ${node.node_name}`).join('\n')}

rules:
  - GEOIP,lan,DIRECT,no-resolve
  - GEOSITE,cn,DIRECT
  - DOMAIN-SUFFIX,cn,DIRECT
  - GEOIP,CN,DIRECT
  - MATCH,Proxy`;
}

/**
 * 生成 V2Ray 订阅内容。
 *
 * @param {Array} nodes - 节点列表
 * @returns {string} 每行一个节点链接的文本
 */
function generateV2RayConfig(nodes) {
  return nodes.map((node) => node.link).filter(Boolean).join('\n');
}

module.exports = {
  generatePublicSubscriptionId,
  generateSubscription,
  retrySubscriptionSourceRefreshTask,
  replaceSubscriptionLink,
  getSubscriptionInfo,
  getSubscriptionContent,
  generateClashConfig,
  generateV2RayConfig,
  buildAnnouncementVirtualNodes,
  appendAnnouncementVirtualNodes,
  createLegacyBusinessError,
  __testables: {
    // 仅开放真实业务函数的依赖注入测试路径，不作为生产调用接口。
    findServersRequiringSync,
    inspectUserInNodeSnapshot,
    formatServerNames,
    buildInboundRefreshPlan,
    refreshSubscriptionSources,
    enqueueFailedSourceRefreshRetry,
    retrySubscriptionSourceRefreshTask
  }
};
