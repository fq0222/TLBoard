/**
 * 最近一轮服务器流量统计仓储。
 * 负责覆盖保存当前统计快照，以及读取管理端统计页需要的原始行数据。
 */

const CREATE_CURRENT_TRAFFIC_USAGE_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS traffic_usage_current (
      id SERIAL PRIMARY KEY,
      sync_at BIGINT NOT NULL,
      server_id INTEGER NOT NULL REFERENCES xui_servers(id) ON DELETE CASCADE,
      server_name VARCHAR(255) NOT NULL,
      total_traffic BIGINT DEFAULT 0,
      user_count INTEGER DEFAULT 0,
      users_data TEXT NOT NULL DEFAULT '[]',
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
    )
  `;

/**
 * 确保最近一轮服务器流量统计表存在。
 *
 * @param {import('pg').PoolClient} client - PostgreSQL 事务连接
 * @returns {Promise<void>}
 */
async function ensureCurrentTrafficUsageTable(client) {
  await client.query(CREATE_CURRENT_TRAFFIC_USAGE_TABLE_SQL);
}

/**
 * 确保最近一轮服务器流量统计表可被普通数据库代理读取。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Promise<void>}
 */
async function ensureCurrentTrafficUsageTableForDb(db) {
  await db.exec(CREATE_CURRENT_TRAFFIC_USAGE_TABLE_SQL);
}

/**
 * 覆盖保存最近一轮服务器流量统计快照。
 *
 * @param {import('pg').PoolClient} client - PostgreSQL 事务连接
 * @param {Array<Object>} snapshots - 服务器维度统计快照
 * @returns {Promise<void>}
 */
async function replaceCurrentTrafficUsageSnapshot(client, snapshots) {
  await ensureCurrentTrafficUsageTable(client);

  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return;
  }

  await client.query('DELETE FROM traffic_usage_current');

  const values = [];
  const params = [];
  let paramIndex = 1;

  for (const snapshot of snapshots) {
    values.push(
      `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5})`
    );
    params.push(
      snapshot.syncAt,
      snapshot.serverId,
      snapshot.serverName,
      snapshot.totalTraffic,
      snapshot.userCount,
      JSON.stringify(snapshot.users)
    );
    paramIndex += 6;
  }

  await client.query(
    `INSERT INTO traffic_usage_current
      (sync_at, server_id, server_name, total_traffic, user_count, users_data)
     VALUES ${values.join(', ')}`,
    params
  );
}

/**
 * 读取最近一轮服务器流量统计快照。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Promise<Array>} 统计快照行
 */
async function listCurrentTrafficUsageStats(db) {
  await ensureCurrentTrafficUsageTableForDb(db);
  return db.prepare(`
    SELECT server_id, server_name, sync_at, total_traffic, user_count, users_data
    FROM traffic_usage_current
    ORDER BY total_traffic DESC, server_name ASC
  `).all();
}

module.exports = {
  ensureCurrentTrafficUsageTable,
  ensureCurrentTrafficUsageTableForDb,
  replaceCurrentTrafficUsageSnapshot,
  listCurrentTrafficUsageStats
};
