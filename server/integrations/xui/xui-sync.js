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

/**
 * 同步单台服务器的节点信息到 xui_nodes 表。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} server - 服务器信息
 * @returns {Promise<Object>} 同步结果
 */
async function syncServerNodes(db, server) {
  try {
    logger.info(`开始同步服务器 ${server.name} 的节点信息`);

    const xuiService = await XuiService.getInstance(server.api_url, server.api_token, {
      apiVersion: server.panel_version || '3.0.2'
    });
    const inboundsResult = await xuiService.getInbounds();

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
 * @returns {Promise<Object>} 同步结果
 */
async function syncAllServers(db) {
  try {
    const servers = await xuiSyncRepository.listOnlineXuiServers(db);

    if (servers.length === 0) {
      logger.warn('没有在线服务器');
      return { success: true, syncedCount: 0 };
    }

    logger.info(`开始同步 ${servers.length} 台服务器`);

    let syncedCount = 0;
    for (const server of servers) {
      const result = await syncServerNodes(db, server);
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
  syncServerNodes,
  syncAllServers
};
