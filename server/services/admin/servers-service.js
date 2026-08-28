const { formatTraffic } = require('../../shared/utils/format-traffic');
const { createLogger } = require('../../utils/logger');
const XuiService = require('../../integrations/xui/xui-service');
const serversRepository = require('../../repositories/servers-repository');
const xuiNodeSnapshotService = require('../shared/xui-node-snapshot-service');
const xuiBackupTaskService = require('./xui-backup-task-service');

const logger = createLogger('ADMIN-SERVERS');
const DEFAULT_HY2_PORTS = '40000-50000';

/**
 * 管理端 3X-UI 服务器服务。
 * 负责服务器增删改查、同步和节点详情编排，并保持旧接口结构不变。
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
 * 规范化 hy2 UDP 端口范围。
 * 核心分支：空值使用默认范围；格式或端口边界非法时阻止写入服务器配置。
 *
 * @param {string|undefined|null} value - 管理端提交的端口范围，格式如 40000-40010
 * @returns {string} 可写入数据库并输出到 Clash 的端口范围
 */
function normalizeHy2Ports(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return DEFAULT_HY2_PORTS;
  }

  const text = String(value).trim();
  const match = text.match(/^(\d{1,5})-(\d{1,5})$/);
  if (!match) {
    throw createLegacyBusinessError('HY2 端口范围格式不正确，请使用 40000-40010 这样的格式');
  }

  const startPort = Number(match[1]);
  const endPort = Number(match[2]);
  if (startPort < 1 || endPort > 65535 || startPort > endPort) {
    throw createLegacyBusinessError('HY2 端口范围必须在 1-65535 内，且起始端口不能大于结束端口');
  }

  return `${startPort}-${endPort}`;
}

/**
 * 格式化过期时间显示。
 *
 * @param {number|null} timestamp - 秒级时间戳
 * @returns {string|null} 格式化后的时间文本
 */
function formatTime(timestamp) {
  if (!timestamp) {
    return null;
  }

  return new Date(timestamp * 1000).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false
  });
}

/**
 * 格式化服务器列表项。
 *
 * @param {Object} server - 原始服务器记录
 * @param {Object} stats - 节点统计
 * @returns {Object} 兼容旧接口的服务器对象
 */
function formatServerSummary(server, stats = {}) {
  return {
    id: server.id,
    name: server.name,
    api_url: server.api_url,
    has_api_token: !!server.api_token,
    panel_version: server.panel_version || '3.0.2',
    host: server.host || '',
    client_port: server.client_port || 0,
    hy2_ports: server.hy2_ports || DEFAULT_HY2_PORTS,
    sub_url: server.sub_url || '',
    status: server.status,
    status_text: server.status === 1 ? '在线' : '离线',
    node_count: Number(stats.node_count) || 0,
    user_count: Number(stats.user_count) || 0,
    online_count: Number(stats.online_count) || 0,
    last_check_at: server.last_check_at,
    created_at: server.created_at
  };
}

/**
 * 将 3X-UI inbound 结果转换为缓存写库结构。
 *
 * @param {Object} inbound - 3X-UI inbound
 * @param {number} onlineCount - 在线人数
 * @returns {Object} 节点缓存结构
 */
function toNodeCacheRow(inbound, onlineCount) {
  return {
    inbound_id: inbound.id,
    remark: inbound.remark,
    port: inbound.port,
    protocol: inbound.protocol,
    settings: typeof inbound.settings === 'string'
      ? inbound.settings
      : JSON.stringify(inbound.settings || {}),
    stream_settings: typeof inbound.streamSettings === 'string'
      ? inbound.streamSettings
      : JSON.stringify(inbound.streamSettings || {}),
    user_count: Array.isArray(inbound.clientStats) ? inbound.clientStats.length : 0,
    online_count: onlineCount
  };
}

/**
 * 将数据库缓存节点转换为详情输出结构。
 *
 * @param {Object} node - 缓存节点记录
 * @returns {Object} 详情输出节点
 */
function formatCachedNode(node) {
  return {
    inbound_id: node.inbound_id,
    remark: node.remark,
    port: node.port,
    protocol: node.protocol,
    settings: node.settings,
    stream_settings: node.stream_settings,
    user_count: node.user_count,
    online_count: node.online_count,
    users: []
  };
}

async function testXuiConnection(apiUrl, apiToken, apiVersion) {
  try {
    logger.info(`测试3X-UI连接: ${apiUrl}`);
    const xuiService = await XuiService.getInstance(apiUrl, apiToken, {
      apiVersion: apiVersion || '3.0.2'
    });
    return await xuiService.testConnection();
  } catch (error) {
    logger.error(`测试3X-UI连接错误: ${error.message}`);
    return false;
  }
}

/**
 * 查询服务器列表。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Object>} 列表结果
 */
async function listServers(db) {
  const servers = await serversRepository.listServers(db);
  const statsRows = await serversRepository.listServerNodeStats(db);
  const statsMap = new Map(statsRows.map((row) => [Number(row.server_id), row]));

  return {
    servers: servers.map((server) => formatServerSummary(server, statsMap.get(Number(server.id))))
  };
}

/**
 * 创建服务器。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 创建参数
 * @returns {Promise<Object>} 新建服务器结果
 */
async function createServer(db, payload) {
  const panelVersion = payload.panel_version || '3.0.2';
  const isConnected = await testXuiConnection(payload.api_url, payload.api_token, panelVersion);
  if (!isConnected) {
    throw createLegacyBusinessError('连接 3X-UI 面板失败，请检查地址和凭据', {
      code: 3001
    });
  }

  const result = await serversRepository.createServer(db, {
    name: payload.name,
    apiUrl: payload.api_url,
    apiToken: payload.api_token,
    panelVersion,
    host: payload.host || '',
    clientPort: parseInt(payload.client_port, 10) || 0,
    hy2Ports: normalizeHy2Ports(payload.hy2_ports),
    subUrl: payload.sub_url || '',
    lastCheckAt: getUnixTimestamp()
  });

  const createdServer = await serversRepository.findServerById(db, result.lastInsertRowid);
  return {
    ...formatServerSummary(createdServer),
    message: '服务器添加成功，连接测试通过'
  };
}

/**
 * 更新服务器。
 *
 * @param {Object} db - 数据库实例
 * @param {number} serverId - 服务器 ID
 * @param {Object} payload - 更新参数
 * @returns {Promise<Object>} 更新后的服务器
 */
async function updateServer(db, serverId, payload) {
  const existingServer = await serversRepository.findServerById(db, serverId);
  if (!existingServer) {
    throw createLegacyBusinessError('服务器不存在');
  }

  const updates = [];
  const values = [];

  if (payload.name !== undefined) {
    updates.push('name = ?');
    values.push(payload.name);
  }
  if (payload.api_url !== undefined) {
    updates.push('api_url = ?');
    values.push(payload.api_url);
  }
  if (payload.api_token !== undefined && payload.api_token !== '') {
    updates.push('api_token = ?');
    values.push(payload.api_token);
  }
  if (payload.host !== undefined) {
    updates.push('host = ?');
    values.push(payload.host);
  }
  if (payload.panel_version !== undefined) {
    updates.push('panel_version = ?');
    values.push(payload.panel_version || '3.0.2');
  }
  if (payload.client_port !== undefined) {
    updates.push('client_port = ?');
    values.push(parseInt(payload.client_port, 10) || 0);
  }
  if (payload.hy2_ports !== undefined) {
    updates.push('hy2_ports = ?');
    values.push(normalizeHy2Ports(payload.hy2_ports));
  }
  if (payload.sub_url !== undefined) {
    updates.push('sub_url = ?');
    values.push(payload.sub_url);
  }

  if (updates.length === 0) {
    throw createLegacyBusinessError('没有要更新的字段');
  }

  await serversRepository.updateServerFields(db, serverId, updates, values);

  if (payload.api_token !== undefined || payload.api_url !== undefined || payload.panel_version !== undefined) {
    XuiService.removeInstance(
      existingServer.api_url,
      existingServer.api_token,
      existingServer.panel_version || '3.0.2'
    );
  }

  const updatedServer = await serversRepository.findServerById(db, serverId);
  return {
    ...formatServerSummary(updatedServer),
    message: '服务器信息更新成功'
  };
}

/**
 * 删除服务器。
 * 关联的节点、流量同步日志和用户节点配置由数据库级联外键自动清理。
 *
 * @param {Object} db - 数据库实例
 * @param {number} serverId - 服务器 ID
 * @returns {Promise<Object>} 删除结果
 */
async function deleteServer(db, serverId) {
  const existingServer = await serversRepository.findServerById(db, serverId);
  if (!existingServer) {
    throw createLegacyBusinessError('服务器不存在');
  }

  await serversRepository.deleteServer(db, serverId);

  return {
    message: '服务器已删除'
  };
}

/**
 * 获取服务器详情，优先从 3X-UI 拉取实时信息，失败时回退到数据库缓存。
 *
 * @param {Object} db - 数据库实例
 * @param {number} serverId - 服务器 ID
 * @returns {Promise<Object>} 服务器详情
 */
async function getServerDetail(db, serverId) {
  const server = await serversRepository.findServerById(db, serverId);
  if (!server) {
    throw createLegacyBusinessError('服务器不存在');
  }

  let nodes = [];

  try {
    const xuiService = await XuiService.getInstance(server.api_url, server.api_token, {
      apiVersion: server.panel_version || '3.0.2'
    });
    const inboundsResult = await xuiService.getInbounds();

    if (!inboundsResult.success) {
      throw new Error(inboundsResult.message || '获取 inbounds 失败');
    }

    const onlineResult = await xuiService.getOnlineClients();
    const onlineEmails = onlineResult.success ? onlineResult.data : [];
    const onlineCountByInboundId = new Map();

    for (const inbound of inboundsResult.data) {
      const clientStats = inbound.clientStats || [];
      const clientsConfig = xuiService.extractClientsFromSettings(inbound.settings);
      const users = clientStats.map((client) => {
        const trafficUsed = Number(client.up || 0) + Number(client.down || 0);
        const clientConfig = clientsConfig.find((config) => config.email === client.email);
        const trafficLimit = clientConfig ? Number(clientConfig.totalGB || 0) : 0;
        const expirySeconds = client.expiryTime ? Math.floor(Number(client.expiryTime) / 1000) : null;
        const isOnline = onlineEmails.includes(client.email);

        return {
          email: client.email,
          enabled: client.enable,
          expire_at: expirySeconds,
          expire_text: expirySeconds ? formatTime(expirySeconds) : '永不过期',
          traffic_used: trafficUsed,
          traffic_limit: trafficLimit,
          traffic_used_text: formatTraffic(trafficUsed),
          traffic_limit_text: trafficLimit > 0 ? formatTraffic(trafficLimit) : '无限制',
          is_online: isOnline
        };
      });

      const onlineCount = users.filter((user) => user.is_online).length;
      onlineCountByInboundId.set(inbound.id, onlineCount);
      nodes.push({
        ...toNodeCacheRow(inbound, onlineCount),
        users
      });
    }

    await xuiNodeSnapshotService.refreshServerNodeSnapshots(db, serverId, inboundsResult.data, {
      onlineCountByInboundId
    });
    logger.info(`从 3X-UI 获取节点信息成功: ${nodes.length} 个节点`);
  } catch (error) {
    logger.error(`从 3X-UI 获取信息错误: ${error.message}`);
    const cachedNodes = await serversRepository.listCachedServerNodes(db, serverId);
    nodes = cachedNodes.map(formatCachedNode);
  }

  return {
    server: {
      id: server.id,
      name: server.name,
      api_url: server.api_url,
      panel_version: server.panel_version || '3.0.2',
      host: server.host || '',
      client_port: server.client_port || 0,
      hy2_ports: server.hy2_ports || DEFAULT_HY2_PORTS,
      sub_url: server.sub_url || '',
      status: server.status,
      last_check_at: server.last_check_at
    },
    nodes
  };
}

/**
 * 手动同步服务器状态与节点缓存。
 *
 * @param {Object} db - 数据库实例
 * @param {number} serverId - 服务器 ID
 * @returns {Promise<Object>} 同步结果
 */
async function syncServer(db, serverId) {
  const server = await serversRepository.findServerById(db, serverId);
  if (!server) {
    throw createLegacyBusinessError('服务器不存在');
  }

  const xuiService = await XuiService.getInstance(server.api_url, server.api_token, {
    apiVersion: server.panel_version || '3.0.2'
  });
  const syncResult = await xuiService.syncServerStatus();
  const syncedAt = getUnixTimestamp();

  await serversRepository.updateServerStatus(db, serverId, syncResult.status, syncedAt);

  if (syncResult.success && Array.isArray(syncResult.nodes) && syncResult.nodes.length > 0) {
    const refreshResult = await xuiNodeSnapshotService.refreshServerNodeSnapshots(
      db,
      serverId,
      syncResult.nodes
    );
    logger.info(`更新节点信息成功: ${refreshResult.nodeCount} 个节点`);
  }

  return {
    synced_at: syncedAt,
    node_count: syncResult.node_count,
    user_count: syncResult.user_count,
    online_count: syncResult.online_count,
    message: '同步完成'
  };
}

/**
 * 查询单台 3X-UI 服务器的当前在线人数。
 *
 * @param {Object} db - 数据库实例
 * @param {number} serverId - 服务器 ID
 * @returns {Promise<Object>} 在线人数查询结果
 */
async function getServerOnlineCount(db, serverId) {
  const server = await serversRepository.findServerById(db, serverId);
  if (!server) {
    throw createLegacyBusinessError('服务器不存在');
  }

  const xuiService = await XuiService.getInstance(server.api_url, server.api_token, {
    apiVersion: server.panel_version || '3.0.2'
  });
  const onlineResult = await xuiService.getOnlineClients();

  if (!onlineResult.success) {
    throw createLegacyBusinessError(onlineResult.message || '查询在线人数失败', {
      code: 3001
    });
  }

  return {
    server_id: serverId,
    online_count: Number(onlineResult.count) || 0,
    queried_at: getUnixTimestamp()
  };
}

/**
 * 启动一次 3X-UI 数据库手动备份任务。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Object} 当前备份任务状态
 */
function runBackupTask(db) {
  return xuiBackupTaskService.startTask(db);
}

/**
 * 更新指定服务器某个节点上的用户信息。
 *
 * @param {Object} db - 数据库实例
 * @param {number} serverId - 服务器 ID
 * @param {Object} payload - 更新参数
 * @returns {Promise<Object>} 更新结果
 */
async function updateServerUser(db, serverId, payload) {
  const server = await serversRepository.findServerById(db, serverId);
  if (!server) {
    throw createLegacyBusinessError('服务器不存在');
  }

  const xuiService = await XuiService.getInstance(server.api_url, server.api_token, {
    apiVersion: server.panel_version || '3.0.2'
  });
  const result = await xuiService.updateClient(payload.inboundId, payload.email, {
    expiryTime: payload.expiryTime,
    totalGB: payload.totalGB,
    enabled: payload.enabled
  });

  if (!result.success) {
    throw createLegacyBusinessError(result.message || '更新用户失败', {
      code: 3001
    });
  }

  return {
    message: '用户更新成功'
  };
}

/**
 * 删除指定服务器某个节点上的用户。
 *
 * @param {Object} db - 数据库实例
 * @param {number} serverId - 服务器 ID
 * @param {Object} payload - 删除参数
 * @returns {Promise<Object>} 删除结果
 */
async function deleteServerUser(db, serverId, payload) {
  const server = await serversRepository.findServerById(db, serverId);
  if (!server) {
    throw createLegacyBusinessError('服务器不存在');
  }

  const xuiService = await XuiService.getInstance(server.api_url, server.api_token, {
    apiVersion: server.panel_version || '3.0.2'
  });
  const result = await xuiService.deleteClientByEmail(payload.inboundId, payload.email);

  if (!result.success) {
    throw createLegacyBusinessError(result.message || '删除用户失败', {
      code: 3001
    });
  }

  return {
    message: '用户删除成功'
  };
}

module.exports = {
  listServers,
  createServer,
  updateServer,
  deleteServer,
  getServerDetail,
  syncServer,
  getServerOnlineCount,
  runBackupTask,
  updateServerUser,
  deleteServerUser
};
