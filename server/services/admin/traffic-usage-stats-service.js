/**
 * 最近一轮服务器流量统计服务。
 * 负责把流量同步中的用户增量整理为管理端可展示的服务器统计快照。
 */

const trafficUsageStatsRepository = require('../../repositories/traffic-usage-stats-repository');

const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;

/**
 * 统计单个用户在单台服务器上的当前累计流量。
 *
 * @param {Object} serverData - 单台服务器从 3X-UI 获取的客户端流量快照
 * @param {string} email - 本地用户 email
 * @returns {{found: boolean, total: number}} 是否找到用户及累计流量
 */
function getUserServerTraffic(serverData, email) {
  let total = 0;
  let found = false;

  for (const [nodeEmail, data] of Object.entries(serverData || {})) {
    if (nodeEmail === email || nodeEmail.startsWith(`${email}-`)) {
      total += Number(data.total) || 0;
      found = true;
    }
  }

  return { found, total };
}

/**
 * 构建最近一轮服务器流量统计快照。
 *
 * @param {Object} options - 构建参数
 * @param {Object} options.serverTrafficData - 服务器原始流量快照
 * @param {Array<Object>} options.users - 本地用户列表
 * @param {Map<string, number>} options.syncLogMap - 上次同步累计流量映射
 * @param {Map<string, Object>} options.serversById - 服务器信息映射
 * @param {number} options.multiplier - 流量统计倍率
 * @param {number} options.syncAt - 本轮统计时间戳
 * @returns {Array<Object>} 服务器维度统计快照
 */
function buildCurrentTrafficUsageSnapshot({
  serverTrafficData,
  users,
  syncLogMap,
  serversById,
  multiplier,
  syncAt
}) {
  const snapshots = [];

  for (const serverId of Object.keys(serverTrafficData || {})) {
    const serverUsers = [];
    let totalTraffic = 0;
    const serverData = serverTrafficData[serverId];

    for (const user of users || []) {
      const userTraffic = getUserServerTraffic(serverData, user.email);
      if (!userTraffic.found) {
        continue;
      }

      const lastSyncTraffic = syncLogMap.get(`${user.id}-${serverId}`) || 0;
      if (userTraffic.total < lastSyncTraffic) {
        continue;
      }

      const increment = Math.round((userTraffic.total - lastSyncTraffic) * multiplier);
      if (increment <= 0) {
        continue;
      }

      totalTraffic += increment;
      serverUsers.push({
        userId: Number(user.id),
        email: user.email,
        traffic: increment
      });
    }

    if (serverUsers.length === 0) {
      continue;
    }

    const server = serversById.get(String(serverId)) || serversById.get(Number(serverId)) || {};
    snapshots.push({
      serverId: Number(serverId),
      serverName: server.name || `服务器 ${serverId}`,
      syncAt,
      totalTraffic,
      userCount: serverUsers.length,
      users: serverUsers
    });
  }

  return snapshots;
}

/**
 * 选择管理端图表显示单位。
 *
 * @param {number} maxTraffic - 本轮服务器最大流量
 * @returns {{unit: string, divisor: number}} 单位和换算除数
 */
function selectDisplayUnit(maxTraffic) {
  if (maxTraffic >= GB) {
    return { unit: 'GB', divisor: GB };
  }

  return { unit: 'MB', divisor: MB };
}

/**
 * 将字节数换算为管理端展示数值。
 *
 * @param {number} bytes - 字节数
 * @param {number} divisor - 单位除数
 * @returns {number} 保留两位小数的展示值
 */
function toDisplayValue(bytes, divisor) {
  return Number(((Number(bytes) || 0) / divisor).toFixed(2));
}

/**
 * 格式化管理端统计接口响应。
 *
 * @param {Array<Object>} rows - 数据库统计快照行
 * @returns {Object} 管理端统计数据
 */
function formatStatsForAdmin(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const maxTraffic = safeRows.reduce((max, row) => {
    return Math.max(max, Number(row.total_traffic) || 0);
  }, 0);
  const { unit, divisor } = selectDisplayUnit(maxTraffic);
  const syncAt = safeRows.length > 0 ? Number(safeRows[0].sync_at) || null : null;

  return {
    syncAt,
    unit,
    servers: safeRows.map((row) => {
      let users = [];
      try {
        users = JSON.parse(row.users_data || '[]');
      } catch {
        users = [];
      }

      return {
        serverId: Number(row.server_id),
        serverName: row.server_name,
        syncAt: Number(row.sync_at) || null,
        totalTraffic: Number(row.total_traffic) || 0,
        totalTrafficValue: toDisplayValue(row.total_traffic, divisor),
        userCount: Number(row.user_count) || 0,
        users: users.map((user) => ({
          userId: Number(user.userId),
          email: user.email,
          traffic: Number(user.traffic) || 0,
          trafficValue: toDisplayValue(user.traffic, divisor)
        }))
      };
    })
  };
}

/**
 * 读取最近一轮服务器流量统计。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Promise<Object>} 管理端统计数据
 */
async function getCurrentTrafficUsageStats(db) {
  const rows = await trafficUsageStatsRepository.listCurrentTrafficUsageStats(db);
  return formatStatsForAdmin(rows);
}

module.exports = {
  buildCurrentTrafficUsageSnapshot,
  formatStatsForAdmin,
  getCurrentTrafficUsageStats
};
