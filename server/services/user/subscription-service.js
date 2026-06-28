const { syncSelectedServers, syncServerNodes } = require('../../integrations/xui/xui-sync');
const { syncUserToXuiServers } = require('../shared/order-service');
const { getStrategyFromRemark, processNodeLink, parseNodeLink } = require('../shared/subscription-strategy');
const { fetchOriginalSubscription, parseSubscriptionContent, pickSingleNodeLink } = require('../shared/subscription-service');
const {
  computeNodeFingerprint,
  computeServerFingerprint,
  isSourceCacheUsable
} = require('../shared/subscription-cache-service');
const { isTimedPlan } = require('../shared/plan-type');
const { DISABLE_REASONS } = require('../shared/renew-policy');
const subscriptionRepository = require('../../repositories/subscription-repository');
const { runWithConcurrency } = require('../../utils/concurrency');

const SOURCE_CACHE_MAX_AGE_SECONDS = 24 * 60 * 60;
const SOURCE_FETCH_CONCURRENCY = 10;
const SOURCE_FETCH_TIMEOUT_MS = 5000;
const CLASH_CONFIG_NAME_KEY = 'clash_config_name';
const CLASH_PROFILE_UPDATE_INTERVAL_KEY = 'clash_profile_update_interval';
const DEFAULT_CLASH_CONFIG_NAME = '天澜大陆';
const DEFAULT_CLASH_PROFILE_UPDATE_INTERVAL_HOURS = '2';

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
 * @returns {Promise<void>}
 */
async function ensureNodeSnapshotsAvailable(db, servers, logger, options = {}) {
  if (servers.length === 0) {
    return;
  }

  const serversById = mapServersById(servers);
  const snapshots = filterOnlineSnapshots(
    await subscriptionRepository.listNodeSnapshots(db),
    serversById
  );
  const snapshotServerIds = new Set(snapshots.map((snapshot) => snapshot.server_id));
  const missingServers = servers.filter((server) => !snapshotServerIds.has(server.id));

  if (missingServers.length === 0) {
    return;
  }

  logger.info(`检测到 ${missingServers.length} 台在线服务器缺少 xui_nodes 快照，开始按服务器补齐`);
  for (const server of missingServers) {
    const syncResult = await syncServerNodes(db, server, {
      inboundSnapshotCache: options.inboundSnapshotCache
    });
    logger.info(`补齐服务器节点快照: server=${server.name}, success=${syncResult.success}, nodeCount=${syncResult.nodeCount || 0}`);
  }
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
      `定向修复用户节点配置未完全成功: user=${user.id}, `
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
      maxAgeSeconds: SOURCE_CACHE_MAX_AGE_SECONDS
    });

    if (result.usable) {
      continue;
    }

    invalidPairKeys.add(key);
    invalidPairs.push({ key, config, reason: result.reason });
    if (result.reason === 'node_fingerprint_mismatch' || result.reason === 'server_fingerprint_mismatch') {
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
  error.sourceRefreshContext = context;
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

        const originalContent = await fetchSource(
          server.sub_url,
          config.sub_id,
          { timeout: SOURCE_FETCH_TIMEOUT_MS }
        );
        const links = parseSubscriptionContent(originalContent);
        const originalLink = pickSingleNodeLink(links, config.protocol);

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

        logger.info(`刷新原始订阅模板成功: user=${user.id}, server=${server.id}, inbound=${config.inbound_id}, duration=${Date.now() - itemStartedAt}ms`);
        return config;
      } catch (cause) {
        throw createSourceRefreshError(cause, {
          userId: user.id,
          serverId: server?.id || config.server_id,
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
      `刷新原始订阅模板失败: user=${context.userId || user.id}, `
      + `server=${context.serverId || config.server_id}, inbound=${context.inboundId || config.inbound_id}, `
      + `duration=${context.duration ?? Date.now() - startedAt}ms, error=${result.reason?.name || 'Error'}`
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
    throw createLegacyBusinessError(2003, '账号已被禁用，请联系管理员', 400, null);
  }

  assertSubscriptionNotExpired(user);

  if (!isEnabledValue(user.enabled)) {
    throw createLegacyBusinessError(2003, '账号已被禁用', 400, null);
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
  const generationStartedAt = Date.now();
  const summary = {
    localServers: 0,
    remoteServers: 0,
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
    throw createLegacyBusinessError(3001, '请先完成 IP 优选', 400, null);
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
    summary.localServers = servers.length - missingServers.length;
    summary.remoteServers = missingServers.length;
    if (missingServers.length > 0) {
      logger.info(`用户 ${user.email} 首次生成订阅，定向同步 ${missingServers.length} 台缺口服务器`);
      const syncServers = options.dependencies?.syncSelectedServers || syncSelectedServers;
      const syncResult = await syncServers(db, missingServers, {
        inboundSnapshotCache: options.inboundSnapshotCache
      });
      summary.inboundSuccess += syncResult.syncedCount || 0;
      summary.inboundFailed += syncResult.failedCount || 0;
      logger.info(`首次生成前节点同步完成: ${syncResult.syncedCount || 0}/${syncResult.totalCount || missingServers.length} 台服务器`);
    } else {
      logger.info(`用户 ${user.email} 首次生成订阅，本地快照和节点配置完整，跳过远程节点同步`);
    }
  } else {
    await ensureNodeSnapshotsAvailable(db, servers, logger, options);
  }

  let nodeConfigs = await ensureUserNodeConfigsComplete(db, user, servers, logger, options);
  if (nodeConfigs.length === 0) {
    throw createLegacyBusinessError(500, '当前没有可用节点，请稍后重试', 500, null);
  }

  if (isFirstGeneration) {
    logger.info(`用户 ${user.id} 首次生成订阅，开始拉取全部原始订阅模板`);
    const firstRefreshResult = await refreshSubscriptionSources(
      db,
      user,
      nodeConfigs,
      serversById,
      logger,
      options.dependencies
    );
    summary.sourceSuccess += firstRefreshResult.successfulConfigs.length;
    summary.sourceFailed += firstRefreshResult.failedConfigs.length;
    logger.info(`用户 ${user.id} 首次模板刷新结果: success=${firstRefreshResult.successfulConfigs.length}, failed=${firstRefreshResult.failedConfigs.length}`);

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
        summary.inboundSuccess += repairSyncResult.syncedCount || 0;
        summary.inboundFailed += repairSyncResult.failedCount || 0;

        const latestRepairConfigs = await reloadRepairNodeConfigs(
          db,
          user,
          repairServers,
          logger,
          options
        );
        const successfulKeys = new Set(
          firstRefreshResult.successfulConfigs.map(
            (config) => buildSourceCacheKey(config.server_id, config.inbound_id)
          )
        );
        const retryConfigs = latestRepairConfigs.filter(
          (config) => !successfulKeys.has(buildSourceCacheKey(config.server_id, config.inbound_id))
        );
        const repairIds = new Set(repairServers.map((server) => server.id));
        nodeConfigs = [
          ...nodeConfigs.filter((config) => !repairIds.has(config.server_id)),
          ...latestRepairConfigs
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
          summary.sourceSuccess += retryResult.successfulConfigs.length;
          summary.sourceFailed += retryResult.failedConfigs.length;
        }
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

      if (cacheStatus.invalidServerIds.size > 0) {
        for (const serverId of cacheStatus.invalidServerIds) {
          const server = serversById.get(serverId);
          if (!server) {
            continue;
          }

          const syncResult = await syncServerNodes(db, server, {
            inboundSnapshotCache: options.inboundSnapshotCache
          });
          logger.info(`增量同步服务器完成: server=${server.name}, success=${syncResult.success}, nodeCount=${syncResult.nodeCount || 0}`);
        }

        nodeConfigs = await ensureUserNodeConfigsComplete(db, user, servers, logger, options);
      }

      const repairConfigs = nodeConfigs.filter((config) => {
        const key = buildSourceCacheKey(config.server_id, config.inbound_id);
        return cacheStatus.invalidServerIds.has(config.server_id) || cacheStatus.invalidPairKeys.has(key);
      });
      const refreshResult = await refreshSubscriptionSources(
        db,
        user,
        repairConfigs,
        serversById,
        logger,
        options.dependencies
      );
      logger.info(`用户 ${user.email} 增量模板刷新结果: success=${refreshResult.successfulConfigs.length}, failed=${refreshResult.failedConfigs.length}`);
    }
  }

  const latestSourceMap = mapSourcesByKey(
    await subscriptionRepository.listUserSubscriptionSources(db, userId)
  );
  const latestCacheStatus = collectSourceCacheStatus(nodeConfigs, latestSourceMap, serversById);
  for (const invalidPair of latestCacheStatus.invalidPairs) {
    latestSourceMap.delete(invalidPair.key);
  }
  const allNodes = composeSubscriptionNodes(nodeConfigs, latestSourceMap, serversById, cfIps, logger);
  summary.nodes = allNodes.length;
  logger.info(
    `订阅生成汇总: user=${user.id}, localServers=${summary.localServers}, `
    + `remoteServers=${summary.remoteServers}, inboundSuccess=${summary.inboundSuccess}, `
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
  const cfIps = await subscriptionRepository.listEnabledUserCfIps(db, userId);
  const servers = await subscriptionRepository.listOnlineServersForDisplay(db);
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
    throw createLegacyBusinessError(2004, '订阅链接无效或尚未生成', 400, null);
  }

  if (!isEnabledValue(subscription.enabled) && subscription.disable_reason === DISABLE_REASONS.ADMIN) {
    throw createLegacyBusinessError(2003, '账号已被禁用，请联系管理员', 400, null);
  }

  assertSubscriptionNotExpired(subscription);

  if (!isEnabledValue(subscription.enabled)) {
    throw createLegacyBusinessError(2003, '账号已被禁用', 400, null);
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
  generateSubscription,
  getSubscriptionInfo,
  getSubscriptionContent,
  generateClashConfig,
  generateV2RayConfig,
  buildAnnouncementVirtualNodes,
  appendAnnouncementVirtualNodes,
  createLegacyBusinessError,
  __testables: {
    findServersRequiringSync
  }
};
