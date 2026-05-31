/**
 * 3X-UI 节点快照仓储。
 * 负责 xui_nodes 的事务性替换写入，并用服务器级事务锁串行化同一服务器的刷新。
 */

const SNAPSHOT_LOCK_NAMESPACE = 31001;

/**
 * 事务性替换单台服务器的节点快照。
 *
 * @param {Object} db - 数据库代理对象，必须暴露 pool.connect()
 * @param {number} serverId - 3X-UI 服务器 ID，用作快照归属和锁粒度
 * @param {Array<Object>} nodes - 已规范化的节点快照行
 * @returns {Promise<void>}
 */
async function replaceServerNodeSnapshots(db, serverId, nodes) {
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
      SNAPSHOT_LOCK_NAMESPACE,
      Number(serverId)
    ]);
    await client.query('DELETE FROM xui_nodes WHERE server_id = $1', [serverId]);

    for (const node of nodes) {
      await client.query(`
        INSERT INTO xui_nodes (
          server_id, inbound_id, remark, port, protocol, settings, stream_settings, user_count, online_count
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        serverId,
        node.inbound_id,
        node.remark,
        node.port,
        node.protocol,
        node.settings,
        node.stream_settings,
        node.user_count,
        node.online_count
      ]);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  replaceServerNodeSnapshots
};
