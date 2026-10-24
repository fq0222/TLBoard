/**
 * 订阅凭证轮换仓储：只在调用方持有的 PostgreSQL 专用连接上读写轮换数据。
 * 本模块不访问远端、不生成凭证，也不通过数据库代理绕过事务。
 */
const CREDENTIAL_LOCK_NAMESPACE = 31002;
const crypto = require('crypto');

/** configs 的固定字段/顺序生成进程内同步指纹；仅供当前执行比较，不落库、不写 payload 或日志。 */
function computeCredentialRevision(configs) {
  const normalized = [...configs].sort((left, right) => Number(left.server_id) - Number(right.server_id)
    || Number(left.inbound_id) - Number(right.inbound_id)).map(config => [Number(config.server_id), Number(config.inbound_id),
    String(config.uuid || ''), String(config.password || ''), String(config.auth || ''), String(config.sub_id || '')]);
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

/**
 * 为用户轮换提供事务边界与行锁。
 * @param {Object} db - 暴露 pool.connect() 的数据库代理。
 * @param {number} userId - 被轮换用户 ID。
 * @param {Function} handler - 接收 (client, lockedUser)，在行锁后检查冷却并完成全部本地写入。
 * @param {import('pg').PoolClient} [borrowedClient] - 可选的已持有会话锁连接；仅开启事务，不负责释放。
 * @returns {Promise<*>} handler 的返回值；用户不存在或任何步骤失败时回滚，自有连接才释放。
 */
async function withRotationTransaction(db, userId, handler, borrowedClient) {
  const client = borrowedClient || await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const user = result.rows[0];
    if (!user) {
      const error = new Error('用户不存在');
      error.code = 'ROTATION_USER_NOT_FOUND';
      throw error;
    }
    const value = await handler(client, user);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if (!borrowedClient) client.release();
  }
}

/**
 * 判断面板版本是否达到 3.4.2；version 为数字三段版本，可带 v 前缀。
 * 未知或非标准版本保守排除，由调用方根据 unsupportedServers 记录告警。
 */
function supportsCredentialRotation(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(version || '').trim());
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  return parts[0] > 3 || (parts[0] === 3 && (parts[1] > 4 || (parts[1] === 4 && parts[2] >= 2)));
}

/**
 * 查询轮换目标，并按服务器 ID 升序获取事务锁以串行化候选检查和写入。
 * @param {import('pg').PoolClient} client - 当前轮换事务连接。
 * @param {number} userId - 用户 ID。
 * @returns {Promise<Object>} servers、unsupportedServers、configs、nodes；无快照服务器仍保留在 servers。
 */
async function listRotationTargets(client, userId) {
  const result = await client.query('SELECT * FROM xui_servers WHERE status = 1 ORDER BY id ASC');
  const servers = result.rows.filter(server => supportsCredentialRotation(server.panel_version))
    .sort((left, right) => Number(left.id) - Number(right.id));
  const unsupportedServers = result.rows.filter(server => !supportsCredentialRotation(server.panel_version));
  for (const server of servers) {
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [CREDENTIAL_LOCK_NAMESPACE, Number(server.id)]);
  }
  const serverIds = servers.map(server => Number(server.id));
  if (serverIds.length === 0) return { servers, unsupportedServers, configs: [], nodes: [] };
  const configs = await client.query(`
    SELECT * FROM user_node_configs
    WHERE user_id = $1 AND server_id = ANY($2::int[])
    ORDER BY server_id ASC, inbound_id ASC
  `, [userId, serverIds]);
  const nodes = await client.query(`
    SELECT * FROM xui_nodes
    WHERE server_id = ANY($1::int[])
    ORDER BY server_id ASC, inbound_id ASC
  `, [serverIds]);
  return { servers, unsupportedServers, configs: configs.rows, nodes: nodes.rows };
}

/** 按 userId 读取最新旧节点基线；只使用专用 client，无缓存时返回 undefined。 */
async function findLatestSubscription(client, userId) {
  const result = await client.query(`
    SELECT * FROM user_subscriptions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1
  `, [userId]);
  return result.rows[0];
}

/** 用专用 client 按 planId 查询锁定用户的套餐类型；套餐不存在时返回 undefined。 */
async function findUserPlanType(client, planId) {
  const result = await client.query('SELECT plan_type FROM plans WHERE id = $1', [planId]);
  return result.rows[0]?.plan_type;
}

/** client 按 serverId 获取凭证事务锁；生成、收编和写入共享此锁，同连接重复获取安全。 */
async function lockServerCredentials(client, serverId) {
  await client.query('SELECT pg_advisory_xact_lock($1, $2)', [CREDENTIAL_LOCK_NAMESPACE, Number(serverId)]);
}

/** client 持服务器锁后按 userId/serverId 重读配置；无记录返回 []，防止覆盖并发建档。 */
async function listServerConfigs(client, userId, serverId) {
  const result = await client.query(`
    SELECT * FROM user_node_configs WHERE user_id = $1 AND server_id = $2 ORDER BY inbound_id ASC
  `, [userId, serverId]);
  return result.rows;
}

/** client 上读取启用的 serverId 及其 inbound 快照；未知/旧版本由服务拒绝。 */
async function findServerState(client, serverId) {
  const server = (await client.query('SELECT * FROM xui_servers WHERE id = $1 AND status = 1', [serverId])).rows[0];
  const nodes = (await client.query('SELECT * FROM xui_nodes WHERE server_id = ANY($1::int[]) ORDER BY inbound_id ASC', [[serverId]])).rows;
  return { server, nodes };
}

/** 仅补存远端只读获得的 inbound，不删除旧来源/配置/缓存；client 已持用户与凭证锁。 */
async function insertMissingSnapshots(client, serverId, nodes) {
  await client.query('SELECT pg_advisory_xact_lock($1, $2)', [31001, Number(serverId)]);
  for (const node of nodes) {
    await client.query(`
      INSERT INTO xui_nodes (server_id, inbound_id, remark, port, protocol, settings, stream_settings)
      SELECT $1, $2, $3, $4, $5, $6, $7
      WHERE NOT EXISTS (SELECT 1 FROM xui_nodes WHERE server_id = $1 AND inbound_id = $2)
    `, [serverId, node.inbound_id, node.remark, node.port, node.protocol, node.settings, node.stream_settings]);
  }
}

/** client 已持用户行锁；用户级 advisory lock 内只读当前公开 token 对应缓存，不回退历史 token。 */
async function lockCurrentCache(client, user) {
  await client.query('SELECT pg_advisory_xact_lock($1, $2)', [31003, Number(user.id)]);
  return (await client.query('SELECT * FROM user_subscriptions WHERE user_id = $1 AND sub_id = $2', [user.id, user.sub_id])).rows[0];
}

/** 同一 client 事务原子写入已完整准备的来源与最终节点；任何 SQL 失败由外层整体回滚。 */
async function saveRotatedSourcesAndCache(client, user, sources, nodes) {
  for (const source of sources) {
    await client.query(`
      INSERT INTO user_subscription_sources (user_id, server_id, inbound_id, sub_id, remark, protocol,
        original_link, node_fingerprint, server_fingerprint, fetched_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (user_id, server_id, inbound_id) DO UPDATE SET
        sub_id = EXCLUDED.sub_id, remark = EXCLUDED.remark, protocol = EXCLUDED.protocol,
        original_link = EXCLUDED.original_link, node_fingerprint = EXCLUDED.node_fingerprint,
        server_fingerprint = EXCLUDED.server_fingerprint, fetched_at = EXCLUDED.fetched_at, updated_at = EXCLUDED.updated_at
    `, [source.user_id, source.server_id, source.inbound_id, source.sub_id, source.remark, source.protocol,
      source.original_link, source.node_fingerprint, source.server_fingerprint, source.fetched_at, source.updated_at]);
  }
  await client.query(`
    INSERT INTO user_subscriptions (user_id, sub_id, nodes_data, updated_at) VALUES ($1,$2,$3,$4)
    ON CONFLICT (sub_id) DO UPDATE SET nodes_data = EXCLUDED.nodes_data, updated_at = EXCLUDED.updated_at
  `, [user.id, user.sub_id, JSON.stringify(nodes), Math.floor(Date.now() / 1000)]);
}

/**
 * 查询同服务器其他用户对应非空字段的凭证碰撞；应在服务器事务锁内调用。
 * @param {import('pg').PoolClient} client - 当前轮换事务连接。
 * @param {number} serverId - 凭证的服务器作用域。
 * @param {number} userId - 排除本用户已有多条 inbound 配置。
 * @param {Object} credentials - 候选 uuid/password/auth，空值不参与匹配。
 * @returns {Promise<Object|undefined>} 首个冲突配置；无冲突时返回 undefined。
 */
async function findCredentialCollision(client, serverId, userId, credentials) {
  const result = await client.query(`
    SELECT user_id, server_id, inbound_id FROM user_node_configs
    WHERE server_id = $1 AND user_id <> $2
      AND (
        (NULLIF($3, '') IS NOT NULL AND uuid = $3)
        OR (NULLIF($4, '') IS NOT NULL AND password = $4)
        OR (NULLIF($5, '') IS NOT NULL AND auth = $5)
      )
    LIMIT 1
  `, [serverId, userId, credentials.uuid || '', credentials.password || '', credentials.auth || '']);
  return result.rows[0];
}

/**
 * 更新服务器全部已有配置并按快照补行，默认保留已有 sub_id。
 * @param {import('pg').PoolClient} client - 已获取对应服务器事务锁的连接。
 * @param {Object} payload - userId/serverId/inboundIds/credentials/subId；subId 是补行使用的 canonical 内部 ID。
 * 无快照时 inboundIds 为空，只更新已有配置，不凭空构造 inbound。
 * replaceSubId 默认为 false；仅普通同步显式恢复远端 subId 冲突时才替换已有内部 ID。
 */
async function upsertServerConfigs(client, payload) {
  const { userId, serverId, inboundIds, credentials, subId } = payload;
  if (payload.replaceSubId === true) {
    await client.query(`
      UPDATE user_node_configs SET uuid = $3, password = $4, auth = $5, sub_id = $6
      WHERE user_id = $1 AND server_id = $2
    `, [userId, serverId, credentials.uuid, credentials.password, credentials.auth, subId]);
  } else {
    await client.query(`
      UPDATE user_node_configs SET uuid = $3, password = $4, auth = $5
      WHERE user_id = $1 AND server_id = $2
    `, [userId, serverId, credentials.uuid, credentials.password, credentials.auth]);
  }
  for (const inboundId of [...new Set(inboundIds)]) {
    await client.query(`
      INSERT INTO user_node_configs (user_id, server_id, inbound_id, uuid, password, auth, sub_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_id, server_id, inbound_id) DO UPDATE SET
        uuid = EXCLUDED.uuid, password = EXCLUDED.password, auth = EXCLUDED.auth
    `, [userId, serverId, inboundId, credentials.uuid, credentials.password, credentials.auth, subId]);
  }
}

/**
 * 同一事务内替换公开 token、冷却时间及完整旧节点基线。
 * @param {import('pg').PoolClient} client - 当前轮换事务连接。
 * @param {Object} payload - userId/subId/rotatedAt（Unix 秒）/nodesData（原始缓存 JSON 字符串）。
 * 清理全部历史用户缓存以废止旧链接，直接保留 nodesData 原值，不重新生成节点。
 */
async function replacePublicTokenAndBaseline(client, payload) {
  const { userId, subId, rotatedAt, nodesData } = payload;
  await client.query(`
    UPDATE users SET sub_id = $2, subscription_credentials_rotated_at = $3
    WHERE id = $1
  `, [userId, subId, rotatedAt]);
  await client.query('DELETE FROM user_subscriptions WHERE user_id = $1', [userId]);
  await client.query(`
    INSERT INTO user_subscriptions (user_id, sub_id, nodes_data, updated_at)
    VALUES ($1, $2, $3, $4)
  `, [userId, subId, nodesData, rotatedAt]);
}

/**
 * 在轮换事务提交前创建独立任务，白名单 payload 禁止携带任何凭证。
 * @param {import('pg').PoolClient} client - 当前轮换事务连接。
 * @param {Object} payload - userId/serverIds/now（Unix 秒）；服务器 ID 去重并升序保存。
 * @returns {Promise<Object>} 新任务行，供事务提交后立即处理。
 */
async function insertRotationTask(client, payload) {
  const serverIds = [...new Set(payload.serverIds.map(Number))].sort((left, right) => left - right);
  const taskPayload = JSON.stringify({ user_id: payload.userId, serverIds });
  const result = await client.query(`
    INSERT INTO xui_sync_tasks (
      user_id, task_type, status, payload, attempts, next_retry_at, created_at, updated_at
    )
    VALUES ($1, 'credential_rotation_sync', 'pending', $2, 0, $3, $3, $3)
    RETURNING *
  `, [payload.userId, taskPayload, payload.now]);
  return result.rows[0];
}

module.exports = {
  CREDENTIAL_LOCK_NAMESPACE,
  supportsCredentialRotation,
  computeCredentialRevision,
  withRotationTransaction,
  listRotationTargets,
  findLatestSubscription,
  findUserPlanType,
  lockServerCredentials,
  listServerConfigs,
  findServerState,
  insertMissingSnapshots,
  lockCurrentCache,
  saveRotatedSourcesAndCache,
  findCredentialCollision,
  upsertServerConfigs,
  replacePublicTokenAndBaseline,
  insertRotationTask
};
