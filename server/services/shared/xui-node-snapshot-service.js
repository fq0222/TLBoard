/**
 * 3X-UI 节点快照服务。
 * 统一将已获取的 inbound 数据刷新到 xui_nodes，避免各入口各自拼 SQL 导致并发和语义分散。
 */

const xuiNodeSnapshotRepository = require('../../repositories/xui-node-snapshot-repository');

/**
 * 将 3X-UI inbound 规范化为 xui_nodes 行。
 *
 * @param {Object} inbound - 3X-UI inbound 原始对象
 * @param {Object} options - 规范化选项
 * @param {number} options.onlineCount - 当前节点在线人数
 * @returns {Object} xui_nodes 写入行
 */
function normalizeInboundSnapshot(inbound, options = {}) {
  const clientStats = Array.isArray(inbound.clientStats) ? inbound.clientStats : [];
  const streamSettings = inbound.streamSettings !== undefined
    ? inbound.streamSettings
    : inbound.stream_settings;

  return {
    inbound_id: inbound.inbound_id || inbound.id,
    remark: inbound.remark || '',
    port: Number(inbound.port) || 0,
    protocol: inbound.protocol || '',
    settings: typeof inbound.settings === 'string'
      ? inbound.settings
      : JSON.stringify(inbound.settings || {}),
    stream_settings: typeof streamSettings === 'string'
      ? streamSettings
      : JSON.stringify(streamSettings || {}),
    user_count: Number(inbound.user_count ?? clientStats.length) || 0,
    online_count: Number(options.onlineCount ?? inbound.online_count ?? 0) || 0
  };
}

/**
 * 用已获取的 inbound 列表刷新单台服务器的 xui_nodes 快照。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} serverId - 3X-UI 服务器 ID
 * @param {Array<Object>} inbounds - 已从 3X-UI 获取的 inbound 列表
 * @param {Object} options - 刷新选项
 * @param {boolean} options.allowEmpty - 是否允许空 inbound 清空本地快照
 * @param {Map<number, number>} options.onlineCountByInboundId - inbound_id 到在线人数的映射
 * @returns {Promise<{success:boolean, skipped:boolean, nodeCount:number}>} 刷新结果
 */
async function refreshServerNodeSnapshots(db, serverId, inbounds, options = {}) {
  if (!Array.isArray(inbounds)) {
    throw new Error('inbounds must be an array');
  }

  if (inbounds.length === 0 && !options.allowEmpty) {
    return {
      success: true,
      skipped: true,
      nodeCount: 0
    };
  }

  const onlineCountByInboundId = options.onlineCountByInboundId || new Map();
  const nodes = inbounds.map((inbound) => normalizeInboundSnapshot(inbound, {
    onlineCount: onlineCountByInboundId.get(inbound.inbound_id || inbound.id)
  }));

  await xuiNodeSnapshotRepository.replaceServerNodeSnapshots(db, serverId, nodes);

  return {
    success: true,
    skipped: false,
    nodeCount: nodes.length
  };
}

module.exports = {
  normalizeInboundSnapshot,
  refreshServerNodeSnapshots
};
