/**
 * 3X-UI 节点同步工具
 * 用于同步 xui_nodes 表数据
 */

const XuiService = require('./xui-service');
const { createLogger } = require('../utils/logger');

const logger = createLogger('XUI-SYNC');

/**
 * 同步单台服务器的节点信息到 xui_nodes 表
 * @param {Object} db - 数据库实例
 * @param {Object} server - 服务器信息 { id, name, api_url, api_username, api_password }
 * @returns {Promise<Object>} 同步结果
 */
async function syncServerNodes(db, server) {
  try {
    logger.info(`开始同步服务器 ${server.name} 的节点信息`);
    
    const xuiService = new XuiService(server.api_url, server.api_username, server.api_password);
    await xuiService.init();
    
    const inboundsResult = await xuiService.getInbounds();
    
    if (!inboundsResult.success) {
      logger.warn(`获取服务器 ${server.name} 的 inbounds 失败: ${inboundsResult.message}`);
      return { success: false, message: inboundsResult.message };
    }

    // 删除旧节点
    await db.prepare('DELETE FROM xui_nodes WHERE server_id = $1').run(server.id);
    
    // 插入新节点
    for (const inbound of inboundsResult.data) {
      const settings = typeof inbound.settings === 'string' ? inbound.settings : JSON.stringify(inbound.settings || {});
      const streamSettings = typeof inbound.streamSettings === 'string' ? inbound.streamSettings : JSON.stringify(inbound.streamSettings || {});
      const clientStats = inbound.clientStats || [];
      
      await db.prepare(`
        INSERT INTO xui_nodes (server_id, inbound_id, remark, port, protocol, settings, stream_settings, user_count, online_count)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `).run(server.id, inbound.id, inbound.remark, inbound.port, inbound.protocol, settings, streamSettings, clientStats.length, 0);
    }
    
    logger.info(`同步服务器 ${server.name} 完成，${inboundsResult.data.length} 个节点`);
    
    return { 
      success: true, 
      nodeCount: inboundsResult.data.length 
    };
  } catch (error) {
    logger.error(`同步服务器 ${server.name} 错误: ${error.message}`);
    return { success: false, message: error.message };
  }
}

/**
 * 同步所有在线服务器的节点信息
 * @param {Object} db - 数据库实例
 * @returns {Promise<Object>} 同步结果
 */
async function syncAllServers(db) {
  try {
    const servers = await db.prepare(`
      SELECT id, name, api_url, api_username, api_password
      FROM xui_servers
      WHERE status = 1
    `).all();

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
