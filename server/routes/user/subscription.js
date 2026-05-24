/**
 * 用户端订阅路由
 * 处理订阅链接获取和订阅内容
 */

const express = require('express');
const { param, query, validationResult } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth-user');
const { createLogger } = require('../../utils/logger');
const { syncAllServers, syncServerNodes } = require('../../services/xui-sync');
const { syncUserToXuiServers } = require('../../services/order-service');
const { getStrategyFromRemark, processNodeLink, parseNodeLink } = require('../../services/subscription-strategy');
const { generateSubscriptionUrls } = require('../../utils/site-url');
const { fetchOriginalSubscription, parseSubscriptionContent, pickSingleNodeLink } = require('../../services/subscription-service');
const { computeNodeFingerprint, computeServerFingerprint, isSourceCacheUsable } = require('../../services/subscription-cache-service');

const router = express.Router();
const logger = createLogger('USER-SUB');
const SOURCE_CACHE_MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * 从 inbound 的 settings 和 stream_settings 中解析节点配置
 * @param {Object} node - 节点基本信息
 * @param {string|Object} settings - inbound settings
 * @param {string|Object} streamSettings - inbound stream_settings
 * @param {string} [userEmail] - 用户邮箱，用于查找特定用户的UUID
 * @returns {Object} 解析后的节点配置
 */
function parseNodeConfig(node, settings, streamSettings, userEmail) {
  let parsedSettings = {};
  let parsedStream = {};
  
  // 处理 settings（可能是 JSON 字符串或对象）
  try {
    if (typeof settings === 'string') {
      parsedSettings = JSON.parse(settings || '{}');
    } else {
      parsedSettings = settings || {};
    }
  } catch (e) {
    logger.warn(`解析 settings 失败: ${e.message}`);
  }
  
  // 处理 stream_settings（可能是 JSON 字符串或对象）
  try {
    if (typeof streamSettings === 'string') {
      parsedStream = JSON.parse(streamSettings || '{}');
    } else {
      parsedStream = streamSettings || {};
    }
  } catch (e) {
    logger.warn(`解析 stream_settings 失败: ${e.message}`);
  }
  
  // 获取 UUID（优先查找用户自己的UUID，否则返回第一个客户端的UUID）
  const clients = parsedSettings.clients || [];
  let uuid = '';
  
  if (userEmail && clients.length > 0) {
    // 根据用户邮箱查找对应的客户端
    const userClient = clients.find(c => c.email === userEmail);
    uuid = userClient ? userClient.id : clients[0].id;
  } else {
    uuid = clients.length > 0 ? clients[0].id : '';
  }
  
  // 获取传输协议
  const network = parsedStream.network || 'tcp';
  
  // 获取 WS 路径（兼容不同格式的字段名）
  let wsPath = '';
  if (network === 'ws') {
    const wsSettings = parsedStream.wsSettings || parsedStream['ws-settings'] || {};
    wsPath = wsSettings.path || '/';
  }
  
  // 获取 TLS 设置
  const security = parsedStream.security || 'none';
  
  return {
    uuid,
    network,
    wsPath,
    security
  };
}

/**
 * 生成完整的节点链接
 * @param {Object} params - 参数
 * @returns {string} 节点链接
 */
function generateNodeLink(params) {
  const { protocol, uuid, address, port, host, wsPath, security, remark } = params;
  
  if (protocol === 'vless') {
    // vless://uuid@address:port?encryption=none&security=none&type=ws&host=host&path=path#remark
    const queryParams = new URLSearchParams({
      encryption: 'none',
      security: security || 'none',
      type: 'ws',
      host: host || '',
      path: wsPath || '/'
    });
    return `vless://${uuid}@${address}:${port}?${queryParams.toString()}#${encodeURIComponent(remark)}`;
  } else if (protocol === 'vmess') {
    // vmess://base64(json)
    const config = {
      v: '2',
      ps: remark,
      add: address,
      port: port,
      id: uuid,
      aid: 0,
      net: 'ws',
      type: 'none',
      host: host || '',
      path: wsPath || '/',
      tls: security === 'tls' ? 'tls' : ''
    };
    return `vmess://${Buffer.from(JSON.stringify(config)).toString('base64')}`;
  } else if (protocol === 'trojan') {
    // trojan://uuid@address:port?security=tls&type=ws&host=host&path=path#remark
    const queryParams = new URLSearchParams({
      security: security || 'tls',
      type: 'ws',
      host: host || '',
      path: wsPath || '/'
    });
    return `trojan://${uuid}@${address}:${port}?${queryParams.toString()}#${encodeURIComponent(remark)}`;
  }
  
  return '';
}

/**
 * 构建用户原始订阅模板缓存键
 * @param {number|string} serverId - 服务器 ID
 * @param {number|string} inboundId - inbound ID
 * @returns {string} 缓存键
 */
function buildSourceCacheKey(serverId, inboundId) {
  return `${serverId}:${inboundId}`;
}

/**
 * 提取 CF IP 记录中的 IP 值
 * @param {string|Object} cfIp - CF IP 记录
 * @returns {string} IP 地址
 */
function getCfIpValue(cfIp) {
  if (!cfIp) return '';
  return typeof cfIp === 'string' ? cfIp : cfIp.ip;
}

/**
 * 替换节点链接中的 remark，保持其他参数不变
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
 * 获取在线服务器列表
 * @param {Object} db - 数据库实例
 * @returns {Promise<Array>} 在线服务器列表
 */
async function getOnlineServers(db) {
  return db.prepare(`
    SELECT id, name, api_url, api_token, host, client_port, sub_url
    FROM xui_servers
    WHERE status = 1
  `).all();
}

/**
 * 获取用户当前的订阅结果缓存
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @returns {Promise<Object|null>} 订阅缓存
 */
async function getExistingUserSubscription(db, userId) {
  return db.prepare(`
    SELECT *
    FROM user_subscriptions
    WHERE user_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(userId);
}

/**
 * 获取在线服务器的 inbound 快照
 * @param {Object} db - 数据库实例
 * @param {Map<number, Object>} serversById - 在线服务器映射
 * @returns {Promise<Array>} inbound 快照
 */
async function getOnlineNodeSnapshots(db, serversById) {
  const rows = await db.prepare(`
    SELECT server_id, inbound_id
    FROM xui_nodes
  `).all();
  return rows.filter(row => serversById.has(row.server_id));
}

/**
 * 获取用户在在线服务器中的节点配置
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {Map<number, Object>} serversById - 在线服务器映射
 * @returns {Promise<Array>} 节点配置列表
 */
async function getUserNodeConfigsForOnlineServers(db, userId, serversById) {
  const rows = await db.prepare(`
    SELECT
      unc.user_id, unc.server_id, unc.inbound_id, unc.uuid, unc.sub_id,
      xn.remark, xn.protocol, xn.port, xn.settings, xn.stream_settings
    FROM user_node_configs unc
    JOIN xui_nodes xn ON unc.server_id = xn.server_id AND unc.inbound_id = xn.inbound_id
    WHERE unc.user_id = ?
  `).all(userId);

  return rows.filter(row => serversById.has(row.server_id));
}

/**
 * 获取用户的原始订阅模板缓存
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @returns {Promise<Array>} 缓存记录
 */
async function getUserSubscriptionSources(db, userId) {
  return db.prepare(`
    SELECT *
    FROM user_subscription_sources
    WHERE user_id = ?
  `).all(userId);
}

/**
 * 确保在线服务器已有 xui_nodes 快照；首次为空时回退到全量同步
 * @param {Object} db - 数据库实例
 * @param {Array} servers - 在线服务器列表
 */
async function ensureNodeSnapshotsAvailable(db, servers) {
  if (servers.length === 0) {
    return;
  }

  const serversById = new Map(servers.map(server => [server.id, server]));
  const snapshots = await getOnlineNodeSnapshots(db, serversById);
  const snapshotServerIds = new Set(snapshots.map(snapshot => snapshot.server_id));
  const missingServers = servers.filter(server => !snapshotServerIds.has(server.id));

  if (missingServers.length === 0) {
    return;
  }

  logger.info(`检测到 ${missingServers.length} 台在线服务器缺少 xui_nodes 快照，开始按服务器补齐`);
  for (const server of missingServers) {
    const syncResult = await syncServerNodes(db, server);
    logger.info(`补齐服务器节点快照: server=${server.name}, success=${syncResult.success}, nodeCount=${syncResult.nodeCount || 0}`);
  }
}

/**
 * 确保用户在所有在线 inbound 上都有本地节点配置
 * @param {Object} db - 数据库实例
 * @param {Object} user - 用户信息
 * @param {Array} servers - 在线服务器列表
 * @returns {Promise<Array>} 最新节点配置
 */
async function ensureUserNodeConfigsComplete(db, user, servers) {
  const serversById = new Map(servers.map(server => [server.id, server]));
  const onlineSnapshots = await getOnlineNodeSnapshots(db, serversById);
  let nodeConfigs = await getUserNodeConfigsForOnlineServers(db, user.id, serversById);

  if (onlineSnapshots.length === 0) {
    return nodeConfigs;
  }

  const configKeys = new Set(nodeConfigs.map(config => buildSourceCacheKey(config.server_id, config.inbound_id)));
  const missingPairs = onlineSnapshots.filter(snapshot => !configKeys.has(buildSourceCacheKey(snapshot.server_id, snapshot.inbound_id)));
  if (missingPairs.length === 0) {
    return nodeConfigs;
  }

  logger.info(`用户 ${user.email} 缺少 ${missingPairs.length} 个节点配置，尝试同步用户到 3X-UI`);
  const syncResult = await syncUserToXuiServers(db, user, { traffic_limit: user.traffic_limit });
  if (!syncResult.success) {
    logger.warn(`同步用户节点配置未完全成功: user=${user.email}, message=${syncResult.message || 'unknown'}`);
  }

  nodeConfigs = await getUserNodeConfigsForOnlineServers(db, user.id, serversById);
  return nodeConfigs;
}

/**
 * 将缓存记录按 server_id + inbound_id 建立映射
 * @param {Array} sources - 缓存记录列表
 * @returns {Map<string, Object>} 缓存映射
 */
function mapSourcesByKey(sources) {
  return new Map(sources.map(source => [buildSourceCacheKey(source.server_id, source.inbound_id), source]));
}

/**
 * 评估原始订阅模板缓存是否可用
 * @param {Array} nodeConfigs - 用户节点配置
 * @param {Map<string, Object>} sourceMap - 原始模板缓存映射
 * @param {Map<number, Object>} serversById - 在线服务器映射
 * @returns {Object} 评估结果
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
 * 写入或更新单个原始订阅模板缓存
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 缓存记录
 */
async function upsertSubscriptionSource(db, payload) {
  await db.prepare(`
    INSERT INTO user_subscription_sources (
      user_id, server_id, inbound_id, sub_id, remark, protocol,
      original_link, node_fingerprint, server_fingerprint, fetched_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, server_id, inbound_id) DO UPDATE SET
      sub_id = EXCLUDED.sub_id,
      remark = EXCLUDED.remark,
      protocol = EXCLUDED.protocol,
      original_link = EXCLUDED.original_link,
      node_fingerprint = EXCLUDED.node_fingerprint,
      server_fingerprint = EXCLUDED.server_fingerprint,
      fetched_at = EXCLUDED.fetched_at,
      updated_at = EXCLUDED.updated_at
  `).run(
    payload.user_id,
    payload.server_id,
    payload.inbound_id,
    payload.sub_id,
    payload.remark,
    payload.protocol,
    payload.original_link,
    payload.node_fingerprint,
    payload.server_fingerprint,
    payload.fetched_at,
    payload.updated_at
  );
}

/**
 * 逐节点刷新原始订阅模板缓存
 * @param {Object} db - 数据库实例
 * @param {Object} user - 用户信息
 * @param {Array} nodeConfigs - 要刷新的节点配置
 * @param {Map<number, Object>} serversById - 在线服务器映射
 * @returns {Promise<void>}
 */
async function refreshSubscriptionSources(db, user, nodeConfigs, serversById) {
  const now = Math.floor(Date.now() / 1000);

  for (const config of nodeConfigs) {
    const server = serversById.get(config.server_id);
    if (!server || !server.sub_url) {
      logger.warn(`跳过原始订阅拉取：server=${config.server_id}, inbound=${config.inbound_id} 缺少订阅地址`);
      continue;
    }

    try {
      const originalContent = await fetchOriginalSubscription(server.sub_url, config.sub_id);
      const links = parseSubscriptionContent(originalContent);
      const originalLink = pickSingleNodeLink(links, config.protocol);

      if (!originalLink) {
        logger.warn(`未找到匹配的原始节点链接: user=${user.email}, server=${server.name}, inbound=${config.inbound_id}`);
        continue;
      }

      await upsertSubscriptionSource(db, {
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

      logger.info(`刷新原始订阅模板成功: user=${user.email}, server=${server.name}, inbound=${config.inbound_id}`);
    } catch (error) {
      logger.warn(`刷新原始订阅模板失败: user=${user.email}, server=${server.name}, inbound=${config.inbound_id}, error=${error.message}`);
    }
  }
}

/**
 * 基于原始模板缓存和用户优选 IP 组合最终订阅节点
 * @param {Array} nodeConfigs - 用户节点配置
 * @param {Map<string, Object>} sourceMap - 原始模板缓存映射
 * @param {Map<number, Object>} serversById - 在线服务器映射
 * @param {Array} cfIps - 用户优选 IP
 * @returns {Array} 最终节点列表
 */
function composeSubscriptionNodes(nodeConfigs, sourceMap, serversById, cfIps) {
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
      for (let i = 0; i < cfIps.length; i++) {
        const cfIp = getCfIpValue(cfIps[i]);
        const nodeNameBase = `${server.name}-${config.remark}`;
        const nodeName = cfIps.length > 1 ? `${nodeNameBase}-${i + 1}` : nodeNameBase;
        const processedLink = replaceNodeRemark(processNodeLink(source.original_link, 'cf', {
          cfIp,
          clientPort: server.client_port,
          host: server.host
        }), nodeName);

        allNodes.push({
          server_name: server.name,
          node_name: nodeName,
          protocol: config.protocol,
          strategy,
          link: processedLink,
          original_link: source.original_link
        });
      }
    } else {
      const nodeName = `${server.name}-${config.remark}`;
      const processedLink = replaceNodeRemark(processNodeLink(source.original_link, 'direct'), nodeName);

      allNodes.push({
        server_name: server.name,
        node_name: nodeName,
        protocol: config.protocol,
        strategy,
        link: processedLink,
        original_link: source.original_link
      });
    }
  }

  return allNodes;
}

/**
 * 写回最终订阅缓存
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {string} subId - 用户订阅 ID
 * @param {Array} allNodes - 最终节点列表
 */
async function saveUserSubscriptionCache(db, userId, subId, allNodes) {
  const now = Math.floor(Date.now() / 1000);

  await db.prepare(`
    INSERT INTO user_subscriptions (user_id, sub_id, nodes_data, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (sub_id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      nodes_data = EXCLUDED.nodes_data,
      updated_at = EXCLUDED.updated_at
  `).run(userId, subId, JSON.stringify(allNodes), now);
}

/**
 * POST /api/user/subscription/generate
 * 生成订阅链接（同步节点信息、处理策略、聚合节点后返回）
 */
router.post('/generate', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const db = req.app.locals.db;
    const existingSubscription = await getExistingUserSubscription(db, userId);

    // 新流程：优先复用本地原始订阅模板缓存，仅在首次生成或缓存失效时增量修复
    const user = await db.prepare(`
      SELECT 
        u.id, u.email, u.subscription_token, u.sub_id,
        u.traffic_used, u.traffic_limit, u.expire_at, u.enabled,
        p.name as plan_name
      FROM users u
      LEFT JOIN plans p ON u.plan_id = p.id
      WHERE u.id = ?
    `).get(userId);
    
    if (!user) {
      logger.error(`用户不存在: ${userId}`);
      return res.status(400).json({
        code: 2004,
        message: '用户不存在',
        data: null
      });
    }

    // 检查账号是否启用
    if (!user.enabled) {
      logger.warn(`用户账号已禁用: ${user.email}`);
      return res.status(400).json({
        code: 2003,
        message: '账号已被禁用',
        data: null
      });
    }

    // 检查是否已完成 CF 优选
    const cfIps = await db.prepare(`
      SELECT cp.ip
      FROM user_cf_ips uci
      JOIN cf_ip_pool cp ON uci.ip_pool_id = cp.id
      WHERE uci.user_id = ? AND cp.enabled = 1
    `).all(userId);
    
    if (cfIps.length === 0) {
      return res.status(400).json({
        code: 3001,
        message: '请先完成 IP 优选',
        data: null
      });
    }

    const servers = await getOnlineServers(db);
    const serversById = new Map(servers.map(server => [server.id, server]));
    const isFirstGeneration = !existingSubscription;

    if (servers.length === 0) {
      logger.warn(`用户 ${user.email} 生成订阅失败：当前没有在线服务器`);
      return res.status(500).json({
        code: 500,
        message: '当前没有可用的在线服务器',
        data: null
      });
    }

    if (isFirstGeneration) {
      logger.info(`用户 ${user.email} 首次生成订阅，先执行全量节点同步`);
      const syncResult = await syncAllServers(db);
      logger.info(`首次生成前节点同步完成: ${syncResult.syncedCount || 0}/${syncResult.totalCount || servers.length} 台服务器`);
    } else {
      await ensureNodeSnapshotsAvailable(db, servers);
    }

    let nodeConfigs = await ensureUserNodeConfigsComplete(db, user, servers);
    if (nodeConfigs.length === 0) {
      logger.warn(`用户 ${user.email} 没有可用的节点配置，无法生成订阅`);
      return res.status(500).json({
        code: 500,
        message: '当前没有可用节点，请稍后重试',
        data: null
      });
    }

    if (isFirstGeneration) {
      logger.info(`用户 ${user.email} 首次生成订阅，开始拉取全部原始订阅模板`);
      await refreshSubscriptionSources(db, user, nodeConfigs, serversById);
    } else {
      const sourceMap = mapSourcesByKey(await getUserSubscriptionSources(db, userId));
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

            const syncResult = await syncServerNodes(db, server);
            logger.info(`增量同步服务器完成: server=${server.name}, success=${syncResult.success}, nodeCount=${syncResult.nodeCount || 0}`);
          }

          nodeConfigs = await ensureUserNodeConfigsComplete(db, user, servers);
        }

        const repairConfigs = nodeConfigs.filter(config => {
          const key = buildSourceCacheKey(config.server_id, config.inbound_id);
          return cacheStatus.invalidServerIds.has(config.server_id) || cacheStatus.invalidPairKeys.has(key);
        });

        await refreshSubscriptionSources(db, user, repairConfigs, serversById);
      }
    }

    const latestSourceMap = mapSourcesByKey(await getUserSubscriptionSources(db, userId));
    const allNodes = composeSubscriptionNodes(nodeConfigs, latestSourceMap, serversById, cfIps);
    if (allNodes.length === 0) {
      logger.error(`用户 ${user.email} 生成订阅失败：未生成任何可用节点`);
      return res.status(500).json({
        code: 500,
        message: '未生成任何可用节点，请稍后重试',
        data: null
      });
    }

    await saveUserSubscriptionCache(db, userId, user.sub_id, allNodes);
    logger.info(`用户 ${user.email} 生成订阅链接成功，共 ${allNodes.length} 个节点`);

    const urls = generateSubscriptionUrls(req, user.sub_id);
    return res.json({
      code: 0,
      message: 'ok',
      data: urls
    });
  } catch (error) {
    logger.error(`生成订阅链接错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * GET /api/user/subscription
 * 获取订阅链接及节点信息
 */
router.get('/', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const db = req.app.locals.db;

    // 查询用户信息
    const user = await db.prepare(`
      SELECT 
        u.id, u.email, u.subscription_token, u.sub_id,
        u.traffic_used, u.traffic_limit, u.expire_at, u.enabled,
        p.name as plan_name
      FROM users u
      LEFT JOIN plans p ON u.plan_id = p.id
      WHERE u.id = ?
    `).get(userId);
    
    if (!user) {
      logger.error(`用户不存在: ${userId}`);
      return res.status(400).json({
        code: 2004,
        message: '用户不存在',
        data: null
      });
    }

    // 检查账号是否启用
    if (!user.enabled) {
      logger.warn(`用户账号已禁用: ${user.email}`);
      return res.status(400).json({
        code: 2003,
        message: '账号已被禁用',
        data: null
      });
    }

    // 查询用户选择的CF优选IP
    const cfIps = await db.prepare(`
      SELECT cp.ip
      FROM user_cf_ips uci
      JOIN cf_ip_pool cp ON uci.ip_pool_id = cp.id
      WHERE uci.user_id = ? AND cp.enabled = 1
    `).all(userId);

    // 查询所有在线服务器（包含 host 和 client_port）
    const servers = await db.prepare(`
      SELECT id, name, api_url, host, client_port, status
      FROM xui_servers
      WHERE status = 1
    `).all();

    // 构建节点列表
    const nodes = [];
    
    for (const server of servers) {
      // 查询服务器节点（包含 settings 和 stream_settings）
      const serverNodes = await db.prepare(`
        SELECT inbound_id, remark, port, protocol, settings, stream_settings
        FROM xui_nodes
        WHERE server_id = ?
      `).all(server.id);

      for (const node of serverNodes) {
        // 判断策略类型
        const strategy = node.remark && node.remark.toLowerCase().includes('cf') ? 'cf' : 'direct';
        
        // 解析节点配置
        const config = parseNodeConfig(node, node.settings, node.stream_settings, user.email);
        
        // 协议详情：vless+tcp+reality
        const protocolDetail = `${node.protocol}+${config.network}+${config.security}`;
        
        // 使用服务器的 host
        const nodeHost = server.host || '';
        
        if (strategy === 'cf' && cfIps.length > 0) {
          // CF 节点：端口用 client_port
          const nodePort = server.client_port || node.port;
          cfIps.forEach((cfIp, index) => {
            const ipRemark = cfIps.length > 1 ? `${node.remark}-${index + 1}` : node.remark;
            nodes.push({
              server_name: server.name,
              node_name: `${server.name}-${ipRemark}`,
              protocol: protocolDetail,
              strategy: strategy,
              uuid: config.uuid,
              address: cfIp.ip,
              port: nodePort,
              host: nodeHost,
              remark: ipRemark
            });
          });
        } else {
          // direct 节点：端口用原始端口
          const defaultIp = server.api_url.match(/\/\/([^:]+)/);
          nodes.push({
            server_name: server.name,
            node_name: `${server.name}-${node.remark}`,
            protocol: protocolDetail,
            strategy: strategy,
            uuid: config.uuid,
            address: defaultIp ? defaultIp[1] : '0.0.0.0',
            port: node.port,
            host: nodeHost,
            remark: node.remark
          });
        }
      }
    }

    // 计算流量百分比
    const trafficPercent = user.traffic_limit > 0 
      ? Math.round((user.traffic_used / user.traffic_limit) * 100 * 100) / 100 
      : 0;

    // 格式化流量显示
    const formatTraffic = (bytes) => {
      // 处理 null、undefined 或非数字情况
      if (bytes === null || bytes === undefined || bytes === '') return '0 B';
      
      // 转换为数字
      const numBytes = Number(bytes);
      
      // 检查是否为有效数字
      if (isNaN(numBytes)) return '0 B';
      
      // 处理0的情况
      if (numBytes === 0) return '0 B';
      
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(numBytes) / Math.log(k));
      return parseFloat((numBytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    // 格式化时间显示
    const formatTime = (timestamp) => {
      if (!timestamp || timestamp === 0 || timestamp === '0') return '无限期';
      return new Date(timestamp * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    };

    const urls = generateSubscriptionUrls(req, user.sub_id);

    // 检查用户是否已完成 CF 优选
    const cfOptimized = cfIps.length > 0;

    logger.info(`获取订阅信息成功: ${user.email}`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        subscription_url: cfOptimized ? urls.subscription_url : '',
        clash_url: cfOptimized ? urls.clash_url : '',
        v2ray_url: cfOptimized ? urls.v2ray_url : '',
        cf_optimized: cfOptimized,
        expire_at: user.expire_at,
        expire_text: formatTime(user.expire_at),
        traffic_used: user.traffic_used,
        traffic_limit: user.traffic_limit,
        traffic_used_text: formatTraffic(user.traffic_used),
        traffic_limit_text: formatTraffic(user.traffic_limit),
        traffic_percent: trafficPercent,
        nodes
      }
    });
  } catch (error) {
    logger.error(`获取订阅信息错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * GET /api/user/sub/:token
 * 通过token直接获取订阅内容（从缓存中获取）
 */
router.get('/sub/:token', [
  param('token')
    .notEmpty()
    .withMessage('订阅token不能为空'),
  query('clash')
    .optional()
    .isIn(['0', '1'])
    .withMessage('clash参数必须是0或1'),
  query('v2ray')
    .optional()
    .isIn(['0', '1'])
    .withMessage('v2ray参数必须是0或1')
], async (req, res) => {
  try {
    // 验证请求参数
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('获取订阅内容参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const { token } = req.params;
    const { clash, v2ray } = req.query;
    const db = req.app.locals.db;

    // 从 user_subscriptions 表获取缓存的节点信息
    const subscription = await db.prepare(`
      SELECT us.*, u.email, u.traffic_used, u.traffic_limit, u.expire_at, u.enabled
      FROM user_subscriptions us
      JOIN users u ON us.user_id = u.id
      WHERE us.sub_id = ?
    `).get(token);
    
    if (!subscription) {
      logger.warn(`订阅链接无效: ${token}`);
      return res.status(400).json({
        code: 2004,
        message: '订阅链接无效或尚未生成',
        data: null
      });
    }

    // 检查账号是否启用
    if (!subscription.enabled) {
      logger.warn(`用户账号已禁用: ${subscription.email}`);
      return res.status(400).json({
        code: 2003,
        message: '账号已被禁用',
        data: null
      });
    }

    // 解析缓存的节点数据
    const nodes = JSON.parse(subscription.nodes_data);

    // 根据请求格式返回订阅内容
    if (clash === '1') {
      // 返回Clash格式
      const clashConfig = generateClashConfig(nodes, subscription);
      res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
      res.send(clashConfig);
    } else if (v2ray === '1') {
      // 返回V2Ray base64格式
      const v2rayConfig = generateV2RayConfig(nodes, subscription);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(Buffer.from(v2rayConfig).toString('base64'));
    } else {
      // 返回默认格式（V2Ray base64）
      const v2rayConfig = generateV2RayConfig(nodes, subscription);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Subscription-Userinfo', `upload=0; download=${subscription.traffic_used}; total=${subscription.traffic_limit}; expire=${subscription.expire_at}`);
      res.send(Buffer.from(v2rayConfig).toString('base64'));
    }

    logger.info(`获取订阅内容成功: ${subscription.email}`);
  } catch (error) {
    logger.error(`获取订阅内容错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * 生成Clash配置
 * @param {Array} nodes - 节点列表（包含 link 字段）
 * @param {Object} user - 用户信息
 * @returns {string} Clash配置YAML
 */
function generateClashConfig(nodes, user) {
  const proxies = nodes.map(node => {
    const { link, node_name } = node;
    
    // 解析节点链接
    const parsed = parseNodeLink(link);
    if (!parsed) return '';
    
    const { protocol, uuid, address, port, params } = parsed;
    
    // 处理IPv6地址，去除方括号
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
      const spx = params.spx || '';
      const host = params.host || '';
      const wsPath = params.path || '';
      
      let config = `  - name: ${node_name}
    type: vless
    server: ${serverAddress}
    port: ${port}
    uuid: ${uuid}
    udp: true`;
      
      // flow 参数
      if (flow) {
        config += `\n    flow: ${flow}`;
      }
      
      // TLS 和 Reality 配置
      if (security === 'reality') {
        config += `\n    tls: true`;
        if (sni) config += `\n    servername: ${sni}`;
        if (fp) config += `\n    client-fingerprint: ${fp}`;
        if (pbk || sid) {
          config += `\n    reality-opts:`;
          if (pbk) config += `\n      public-key: ${pbk}`;
          if (sid) config += `\n      short-id: "${sid}"`;
        }
      } else if (security === 'tls') {
        config += `\n    tls: true`;
        if (sni) config += `\n    servername: ${sni}`;
        if (fp) config += `\n    client-fingerprint: ${fp}`;
      } else {
        config += `\n    tls: false`;
      }
      
      // 网络层配置
      config += `\n    network: ${network}`;
      
      if (network === 'ws') {
        config += `\n    ws-opts:`;
        config += `\n      path: ${wsPath || '/'}`;
        if (host) {
          config += `\n      headers:`;
          config += `\n        Host: ${host}`;
        }
      } else if (network === 'tcp') {
        const headerType = params.headerType || 'none';
        if (headerType !== 'none') {
          config += `\n    tcp-opts:`;
          config += `\n      header:`;
          config += `\n        type: ${headerType}`;
        }
      }
      
      return config;
    } else if (protocol === 'vmess') {
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
        config += `\n    ws-opts:`;
        config += `\n      path: ${wsPath || '/'}`;
        if (host) {
          config += `\n      headers:`;
          config += `\n        Host: ${host}`;
        }
      }
      
      return config;
    } else if (protocol === 'trojan') {
      const security = params.security || 'none';
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
      
      config += `\n    tls: true`;
      if (sni) config += `\n    sni: ${sni}`;
      config += `\n    network: ${network}`;
      
      if (network === 'ws') {
        config += `\n    ws-opts:`;
        config += `\n      path: ${wsPath || '/'}`;
        if (host) {
          config += `\n      headers:`;
          config += `\n        Host: ${host}`;
        }
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
${nodes.map(node => `      - ${node.node_name}`).join('\n')}

rules:
  - MATCH,Proxy`;
}

/**
 * 生成V2Ray订阅内容
 * @param {Array} nodes - 节点列表（包含 link 字段）
 * @param {Object} user - 用户信息
 * @returns {string} V2Ray订阅内容（每行一个节点链接）
 */
function generateV2RayConfig(nodes, user) {
  return nodes.map(node => node.link).filter(Boolean).join('\n');
}

module.exports = router;
