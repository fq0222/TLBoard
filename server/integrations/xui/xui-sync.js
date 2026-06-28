/**
 * 3X-UI 节点同步工具。
 * 负责从 3X-UI 拉取 inbound 快照并写入本地 xui_nodes，
 * 自身只保留同步编排逻辑，具体 SQL 访问下沉到 xui-sync-repository。
 */

const XuiService = require('./xui-service');
const { createLogger } = require('../../utils/logger');
const xuiSyncRepository = require('../../repositories/xui-sync-repository');
const xuiNodeSnapshotService = require('../../services/shared/xui-node-snapshot-service');

const logger = createLogger('XUI-SYNC');
const INBOUND_SNAPSHOT_TTL_MS = 15 * 60 * 1000;
const INBOUND_REQUEST_TIMEOUT_MS = 10000;

/**
 * 归一化单次远程请求超时，仅允许有限正数，非法值回退到默认值。
 *
 * @param {*} timeout - 调用方传入的超时值。
 * @param {number} [fallback=INBOUND_REQUEST_TIMEOUT_MS] - 非法输入使用的默认超时。
 * @returns {number} 可安全传给 HTTP 客户端的毫秒数。
 */
function normalizePositiveTimeout(timeout, fallback = INBOUND_REQUEST_TIMEOUT_MS) {
  return Number.isFinite(timeout) && timeout > 0 ? timeout : fallback;
}

/**
 * 获取单台服务器的 inbound 快照，允许批量任务复用同一轮已获取的数据。
 *
 * @param {Object} server - 服务器信息，必须包含 id/api_url/api_token。
 * @param {Object} [options={}] - 获取选项。
 * @param {Map<string,Object>} [options.inboundSnapshotCache] - 批量任务级缓存，key 为 server.id。
 * @param {number} [options.timeout=10000] - 单次 inbound 请求超时；未提供时使用 10 秒。
 * @returns {Promise<Object>} 3X-UI getInbounds 的标准结果；仅成功结果会写入缓存。
 */
async function getServerInboundsSnapshot(server, options = {}) {
  const cache = options.inboundSnapshotCache;
  const cacheKey = String(server.id);
  const now = Date.now();

  if (cache && cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    if (cached && now - cached.fetchedAt < INBOUND_SNAPSHOT_TTL_MS) {
      logger.info(`复用批量 inbound 快照: server=${server.name || server.id}, age=${Math.floor((now - cached.fetchedAt) / 1000)}s`);
      return cached.result;
    }
    logger.info(`批量 inbound 快照已过期，重新获取: server=${server.name || server.id}`);
    cache.delete(cacheKey);
  }

  const xuiService = await XuiService.getInstance(server.api_url, server.api_token, {
    apiVersion: server.panel_version || '3.0.2'
  });
  const inboundsResult = await xuiService.getInbounds({
    timeout: normalizePositiveTimeout(options.timeout)
  });

  if (cache && inboundsResult.success) {
    cache.set(cacheKey, {
      fetchedAt: now,
      result: inboundsResult
    });
    logger.info(`写入批量 inbound 快照: server=${server.name || server.id}, nodeCount=${Array.isArray(inboundsResult.data) ? inboundsResult.data.length : 0}`);
  } else if (cache && !inboundsResult.success) {
    logger.warn(`获取 inbound 失败，未写入批量快照: server=${server.name || server.id}, message=${inboundsResult.message || 'unknown'}`);
  }

  return inboundsResult;
}

/**
 * 同步单台服务器的节点信息到 xui_nodes 表。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} server - 服务器信息
 * @param {Object} [options={}] - 同步选项。
 * @param {Map<string,Object>} [options.inboundSnapshotCache] - 批量任务级 inbound 快照缓存。
 * @returns {Promise<Object>} 同步结果
 */
async function syncServerNodes(db, server, options = {}) {
  try {
    logger.info(`开始同步服务器 ${server.name} 的节点信息`);

    const inboundsResult = await getServerInboundsSnapshot(server, options);

    if (!inboundsResult.success) {
      logger.warn(`获取服务器 ${server.name} 的 inbounds 失败: ${inboundsResult.message}`);
      return { success: false, message: inboundsResult.message };
    }

    const refreshResult = await xuiNodeSnapshotService.refreshServerNodeSnapshots(
      db,
      server.id,
      inboundsResult.data
    );

    for (const inbound of inboundsResult.data) {
      logger.info(`节点 ${inbound.remark}: inbound_id ${inbound.id}`);
    }

    logger.info(`同步服务器 ${server.name} 完成，共 ${refreshResult.nodeCount} 个节点`);

    return {
      success: true,
      serverId: server.id,
      nodeCount: refreshResult.nodeCount
    };
  } catch (error) {
    logger.error(`同步服务器 ${server.name} 错误: ${error.message}`);
    return { success: false, message: error.message };
  }
}

/**
 * 同步所有在线服务器的节点信息。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} [options={}] - 同步选项。
 * @param {Map<string,Object>} [options.inboundSnapshotCache] - 批量任务级 inbound 快照缓存。
 * @returns {Promise<Object>} 同步结果
 */
async function syncAllServers(db, options = {}) {
  try {
    const servers = await xuiSyncRepository.listOnlineXuiServers(db);

    if (servers.length === 0) {
      logger.warn('没有在线服务器');
      return { success: true, syncedCount: 0 };
    }

    logger.info(`开始同步 ${servers.length} 台服务器`);

    let syncedCount = 0;
    for (const server of servers) {
      const result = await syncServerNodes(db, server, options);
      if (result.success) {
        syncedCount++;
      }
    }

    logger.info(`同步完成，成功 ${syncedCount}/${servers.length} 台`);

    return {
      success: true,
      syncedCount,
      totalCount: servers.length
    };
  } catch (error) {
    logger.error(`同步所有服务器错误: ${error.message}`);
    return { success: false, message: error.message };
  }
}

module.exports = {
  INBOUND_REQUEST_TIMEOUT_MS,
  INBOUND_SNAPSHOT_TTL_MS,
  normalizePositiveTimeout,
  getServerInboundsSnapshot,
  syncServerNodes,
  syncAllServers
};
