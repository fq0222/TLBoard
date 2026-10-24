/**
 * 本地凭证轮换契约测试：运行真实服务与仓储，仅替代外部 PostgreSQL。
 * 事务替身保留行锁/服务器锁、提交隔离、SAVEPOINT 和唯一冲突语义。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

/** 深复制数据库快照，避免测试断言与事务内对象共享引用。 */
function copy(value) { return JSON.parse(JSON.stringify(value)); }

/** 提供确定的随机序列；每个字段单独计数，检测碰撞后是否整组重生。 */
function generators(candidates = []) {
  const counts = { uuid: 0, password: 0, auth: 0, subId: 0, publicToken: 0 };
  const result = { counts };
  for (const field of ['uuid', 'password', 'auth']) {
    result[field] = () => {
      const index = counts[field]++;
      return candidates[index]?.[field] || `${field}-${index + 1}`;
    };
  }
  result.subId = () => (++counts.subId).toString(16).padStart(16, '0');
  result.publicToken = () => `public-${++counts.publicToken}`;
  return result;
}

/**
 * 按真实 SQL 边界模拟专用连接；不实现服务策略，未知查询直接失败。
 * options.beforeCommit 用于检查原子提交，failOn 可精确注入数据库失败。
 */
class RotationDatabase {
  constructor(options = {}) {
    this.state = {
      users: [{ id: 7, email: 'u@example.com', enabled: 1, plan_id: 1, sub_id: 'old-public', subscription_credentials_rotated_at: null }],
      servers: [{ id: 2, name: '服务器二', status: 1, panel_version: '3.4.2' }],
      configs: [{ user_id: 7, server_id: 2, inbound_id: 10, uuid: 'old-uuid', password: 'old-password', auth: 'old-auth', sub_id: 'aaaaaaaaaaaaaaaa' }],
      nodes: [{ server_id: 2, inbound_id: 10 }, { server_id: 2, inbound_id: 11 }],
      caches: [{ user_id: 7, sub_id: 'old-public', nodes_data: '[{"server_id":2,"node_name":"旧节点","link":"vless://old"}]', updated_at: 1 }],
      tasks: [],
      sources: [],
      ...copy(options.state || {})
    };
    this.options = options;
    this.calls = [];
    this.locks = new Map();
    this.nextTaskId = 1;
    this.pool = { connect: async () => this.connect() };
  }

  /** 在键作用域内排队，直到持锁连接 COMMIT/ROLLBACK 才释放。 */
  async lock(key, releases) {
    const previous = this.locks.get(key) || Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    this.locks.set(key, current);
    await previous;
    releases.push(release);
  }

  /** 默认连接绝不能参与轮换事务；订单已有配置读取除外，由集成测试包装。 */
  prepare() { throw new Error('禁止绕过专用事务连接'); }

  /** 创建连接，按用户和服务器合并提交，避免并发事务覆盖无关用户。 */
  connect() {
    const database = this;
    const releases = [];
    const heldServerLocks = new Set();
    const touchedUsers = new Set();
    const touchedConfigs = new Set();
    const touchedCaches = new Set();
    const touchedNodes = new Set();
    const touchedSources = new Set();
    let state = copy(database.state);
    let savepoint;
    let aborted = false;
    const client = {
      async query(query, params = []) {
        const sql = query.replace(/\s+/g, ' ').trim();
        database.calls.push({ sql, params: copy(params) });
        if (sql === 'BEGIN') return { rows: [] };
        if (sql.startsWith('ROLLBACK TO SAVEPOINT')) {
          state = copy(savepoint); aborted = false; return { rows: [] };
        }
        if (aborted && sql !== 'ROLLBACK') throw new Error('事务已中止，必须先回滚至 SAVEPOINT');
        if (database.options.failOn?.(sql, params)) throw new Error('模拟数据库写入失败');
        if (sql.startsWith('SAVEPOINT')) { savepoint = copy(state); return { rows: [] }; }
        if (sql.startsWith('RELEASE SAVEPOINT')) return { rows: [] };
        if (sql === 'ROLLBACK') { releases.splice(0).forEach(release => release()); return { rows: [] }; }
        if (sql === 'COMMIT') {
          await database.options.beforeCommit?.(copy(state));
          for (const userId of touchedUsers) {
            database.state.users = database.state.users.map(user => user.id === userId ? copy(state.users.find(row => row.id === userId)) : user);
          }
          for (const key of touchedConfigs) {
            const [userId, serverId] = key.split(':').map(Number);
            database.state.configs = database.state.configs.filter(row => row.user_id !== userId || row.server_id !== serverId)
              .concat(copy(state.configs.filter(row => row.user_id === userId && row.server_id === serverId)));
          }
          for (const userId of touchedCaches) {
            database.state.caches = database.state.caches.filter(row => row.user_id !== userId)
              .concat(copy(state.caches.filter(row => row.user_id === userId)));
          }
          for (const serverId of touchedNodes) {
            database.state.nodes = database.state.nodes.filter(row => row.server_id !== serverId)
              .concat(copy(state.nodes.filter(row => row.server_id === serverId)));
          }
          for (const key of touchedSources) {
            const [userId, serverId, inboundId] = key.split(':').map(Number);
            database.state.sources = database.state.sources.filter(row => !(row.user_id === userId && row.server_id === serverId && row.inbound_id === inboundId))
              .concat(copy(state.sources.filter(row => row.user_id === userId && row.server_id === serverId && row.inbound_id === inboundId)));
          }
          database.state.tasks.push(...copy(state.tasks.filter(task => !database.state.tasks.some(row => row.id === task.id))));
          releases.splice(0).forEach(release => release());
          return { rows: [] };
        }
        if (/FROM users.*FOR UPDATE/.test(sql)) {
          await database.lock(`user:${params[0]}`, releases);
          state = copy(database.state);
          return { rows: state.users.filter(row => row.id === params[0]) };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          const key = `server:${params[0]}:${params[1]}`;
          if (!heldServerLocks.has(key)) {
            await database.lock(key, releases);
            heldServerLocks.add(key);
            if (params[0] === 31002) state.configs = copy(database.state.configs);
          }
          return { rows: [] };
        }
        if (sql.includes('FROM plans')) return { rows: [{ plan_type: database.options.planType || 'lifetime' }] };
        if (sql.startsWith('INSERT INTO xui_nodes')) {
          const [serverId, inboundId, remark, port, protocol, settings, streamSettings] = params;
          touchedNodes.add(serverId);
          if (!state.nodes.some(row => row.server_id === serverId && row.inbound_id === inboundId)) {
            state.nodes.push({ server_id: serverId, inbound_id: inboundId, remark, port, protocol, settings, stream_settings: streamSettings });
          }
          return { rows: [] };
        }
        if (sql.startsWith('SELECT') && sql.includes('FROM user_subscriptions')) return { rows: state.caches.filter(row => row.user_id === params[0]).sort((a, b) => b.updated_at - a.updated_at).slice(0, 1) };
        if (sql.startsWith('INSERT INTO user_subscription_sources')) {
          const fields = ['user_id', 'server_id', 'inbound_id', 'sub_id', 'remark', 'protocol', 'original_link', 'node_fingerprint', 'server_fingerprint', 'fetched_at', 'updated_at'];
          const source = Object.fromEntries(fields.map((field, index) => [field, params[index]]));
          touchedSources.add(`${source.user_id}:${source.server_id}:${source.inbound_id}`);
          state.sources = state.sources.filter(row => !(row.user_id === source.user_id && row.server_id === source.server_id && row.inbound_id === source.inbound_id)).concat([source]);
          return { rows: [] };
        }
        if (sql.includes('FROM xui_servers')) return { rows: state.servers.filter(row => row.status === 1 && (!sql.includes('id = $1') || row.id === params[0])) };
        if (sql.includes('FROM xui_nodes')) return { rows: state.nodes.filter(row => params[0].includes(row.server_id)) };
        if (sql.includes('FROM user_node_configs')) {
          if (sql.includes('LIMIT 1')) {
            const [serverId, userId, uuid, password, auth] = params;
            return { rows: state.configs.filter(row => row.server_id === serverId && row.user_id !== userId &&
              ((uuid && row.uuid === uuid) || (password && row.password === password) || (auth && row.auth === auth))).slice(0, 1) };
          }
          const ids = Array.isArray(params[1]) ? params[1] : [params[1]];
          return { rows: state.configs.filter(row => row.user_id === params[0] && ids.includes(row.server_id)).sort((a, b) => a.inbound_id - b.inbound_id) };
        }
        if (sql.startsWith('UPDATE user_node_configs')) {
          const [userId, serverId, uuid, password, auth] = params;
          touchedConfigs.add(`${userId}:${serverId}`);
          for (const row of state.configs.filter(row => row.user_id === userId && row.server_id === serverId)) {
            Object.assign(row, { uuid, password, auth });
            if (sql.includes('sub_id = $6')) row.sub_id = params[5];
          }
          return { rows: [] };
        }
        if (sql.startsWith('INSERT INTO user_node_configs')) {
          const [userId, serverId, inboundId, uuid, password, auth, subId] = params;
          touchedConfigs.add(`${userId}:${serverId}`);
          const existing = state.configs.find(row => row.user_id === userId && row.server_id === serverId && row.inbound_id === inboundId);
          if (existing) Object.assign(existing, { uuid, password, auth });
          else state.configs.push({ user_id: userId, server_id: serverId, inbound_id: inboundId, uuid, password, auth, sub_id: subId });
          return { rows: [] };
        }
        if (sql.startsWith('UPDATE users')) {
          const [userId, subId, rotatedAt] = params;
          if (database.options.tokenCollision?.(subId) || state.users.some(row => row.id !== userId && row.sub_id === subId)) {
            aborted = true;
            throw Object.assign(new Error('唯一冲突，不允许输出凭证'), { code: '23505', constraint: 'users_sub_id_key', table: 'users' });
          }
          touchedUsers.add(userId);
          Object.assign(state.users.find(row => row.id === userId), { sub_id: subId, subscription_credentials_rotated_at: rotatedAt });
          return { rows: [] };
        }
        if (sql.startsWith('DELETE FROM user_subscriptions')) {
          touchedCaches.add(params[0]); state.caches = state.caches.filter(row => row.user_id !== params[0]); return { rows: [] };
        }
        if (sql.startsWith('INSERT INTO user_subscriptions')) {
          touchedCaches.add(params[0]);
          if (sql.includes('ON CONFLICT')) state.caches = state.caches.filter(row => row.sub_id !== params[1]);
          state.caches.push({ user_id: params[0], sub_id: params[1], nodes_data: params[2], updated_at: params[3] }); return { rows: [] };
        }
        if (sql.startsWith('INSERT INTO xui_sync_tasks')) {
          const task = { id: database.nextTaskId++, user_id: params[0], task_type: 'credential_rotation_sync', payload: JSON.parse(params[1]), status: 'pending' };
          state.tasks.push(task); return { rows: [task] };
        }
        throw new Error(`测试未定义 SQL: ${sql}`);
      },
      release() { database.calls.push({ sql: 'release', params: [] }); }
    };
    return client;
  }
}

/** 注入外部面板和缓存边界，真实执行轮换服务、仓储、事务及共享唯一性算法。 */
function remoteFixture(options = {}) {
  const db = new RotationDatabase();
  db.state.nodes = [{ server_id: 2, inbound_id: 10, remark: 'direct', protocol: 'vless' }];
  const writes = [];
  const refreshes = [];
  const refreshOptions = [];
  const logs = [];
  const logger = { info: message => logs.push(message), warn: message => logs.push(message), error: message => logs.push(message) };
  const service = createService(generators(), {
    logger,
    getXuiService: async server => ({
      getInbounds: async () => ({ success: true, data: [{ id: 10, remark: 'direct', protocol: 'vless' }] }),
      getServerClientByEmail: async () => options.remoteLookup || {
        status: 'found', success: true,
        client: { flow: 'xtls-rprx-vision' }, inboundIds: [10]
      },
      upsertServerClient: async payload => {
        assert.ok(db.calls.some(call => call.sql === 'COMMIT'), '远端写入之前必须已提交本地配置');
        assert.strictEqual(payload.client.id, db.state.configs.find(row => row.server_id === server.id).uuid);
        writes.push(copy(payload));
        if (options.failServer === server.id) throw new Error('timeout uuid-secret https://remote/secret');
        return { success: true };
      }
    }),
    withServerClientLock: async (_db, serverId, email, handler) => {
      assert.strictEqual(email, 'u@example.com');
      return handler();
    },
    refreshAndMergeRotatedServers: async (_db, userId, serverIds, _logger, refreshOption) => {
      refreshes.push(copy(serverIds));
      refreshOptions.push(refreshOption);
      return { successfulServerIds: options.refreshFail ? [] : serverIds, failedServerIds: options.refreshFail ? serverIds : [] };
    }
  });
  return { db, service, writes, refreshes, refreshOptions, logs };
}

/** 历史任务执行两次时只能读取数据库当前字段，忽略 payload 敏感字段。 */
async function testRotationTaskReadsLatestCredentialsOnEveryRun() {
  const { db, service, writes } = remoteFixture();
  const task = { user_id: 7, payload_data: { user_id: 7, serverIds: [2], uuid: 'forbidden' } };
  await service.processRotationTask(db, task);
  Object.assign(db.state.configs[0], { uuid: 'latest-uuid', password: 'latest-password', auth: 'latest-auth', sub_id: 'latest-internal' });
  Object.assign(db.state.users[0], { enabled: 0, expire_at: '123', traffic_limit: '456' });
  const result = await service.processRotationTask(db, task);
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(writes.map(row => row.client.id), ['old-uuid', 'latest-uuid']);
  assert.deepStrictEqual(writes[1].inboundIds, [10]);
  assert.deepStrictEqual(writes[1].client, { id: 'latest-uuid', password: 'latest-password', auth: 'latest-auth',
    email: 'u@example.com', enable: false, expiryTime: 123000, totalGB: 456, subId: 'latest-internal', limitIp: 0, tgId: 0, flow: 'xtls-rprx-vision' });
}

/** 成功写入 3X-UI 后必须记录可定位的脱敏日志，不能让来源刷新看起来像唯一远端动作。 */
async function testRemoteSyncSuccessLogIncludesUserEmailAndServer() {
  const { db, service, logs } = remoteFixture();
  const result = await service.syncServerWithLatestCredentials(db, 7, 2);

  assert.strictEqual(result.success, true);
  assert.ok(logs.some(message => message.includes(
    '凭证轮换远端同步成功: user=7, email=u@example.com, server=2, phase=remote'
  )));
  assert.ok(!logs.join('\n').includes('old-uuid'));
}

/** server-level client 只允许一个 subId；本地不一致时必须失败，不能用首行静默覆盖远端。 */
async function testRemoteSyncRejectsInconsistentLocalSubIds() {
  const { db, service, writes } = remoteFixture();
  db.state.nodes = [
    { server_id: 2, inbound_id: 10, remark: 'direct-a', protocol: 'vless' },
    { server_id: 2, inbound_id: 11, remark: 'direct-b', protocol: 'vless' }
  ];
  db.state.configs.push({ ...db.state.configs[0], inbound_id: 11, sub_id: 'bbbbbbbbbbbbbbbb' });

  const result = await service.syncServerWithLatestCredentials(db, 7, 2);

  assert.strictEqual(result.success, false);
  assert.strictEqual(writes.length, 0, '不一致 subId 不能发起会覆盖全服务器 client 的远端写入');
  assert.deepStrictEqual(db.state.configs.map(row => row.sub_id), ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb']);
}

/** subId 一致时一次关联全部 inbound，内部 ID 和服务器级三凭证在轮换同步中保持一致。 */
async function testRemoteSyncUsesUnchangedCanonicalSubIdOnce() {
  const { db, service, writes } = remoteFixture();
  db.state.nodes = [
    { server_id: 2, inbound_id: 10, remark: 'direct-a', protocol: 'vless' },
    { server_id: 2, inbound_id: 11, remark: 'direct-b', protocol: 'vless' }
  ];
  db.state.configs.push({ ...db.state.configs[0], inbound_id: 11 });

  const result = await service.syncServerWithLatestCredentials(db, 7, 2);

  assert.strictEqual(result.success, true);
  assert.strictEqual(writes.length, 1);
  assert.deepStrictEqual(writes[0].inboundIds, [10, 11]);
  assert.strictEqual(writes[0].client.subId, 'aaaaaaaaaaaaaaaa');
  assert.deepStrictEqual(db.state.configs.map(row => row.sub_id), ['aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa']);
  assert.strictEqual(new Set(db.state.configs.map(row => row.uuid)).size, 1);
  assert.strictEqual(new Set(db.state.configs.map(row => row.password)).size, 1);
  assert.strictEqual(new Set(db.state.configs.map(row => row.auth)).size, 1);
}

/** 已有 server-level client 的全局 flow 必须原样保留，轮换只能修改凭证字段。 */
async function testRemoteSyncPreservesExistingGlobalFlowForMixedStrategies() {
  const { db, service, writes } = remoteFixture({
    remoteLookup: { status: 'found', success: true, client: { flow: 'existing-global-flow' }, inboundIds: [10, 11] }
  });
  db.state.nodes = [
    { server_id: 2, inbound_id: 10, remark: 'direct-node', protocol: 'vless' },
    { server_id: 2, inbound_id: 11, remark: 'cf-node', protocol: 'vless' }
  ];
  db.state.configs.push({ ...db.state.configs[0], inbound_id: 11 });

  const result = await service.syncServerWithLatestCredentials(db, 7, 2);

  assert.strictEqual(result.success, true);
  assert.strictEqual(writes.length, 1);
  assert.strictEqual(writes[0].client.flow, 'existing-global-flow');
}

/** 远端 client 缺失时，仅一致策略能安全推导全局 flow；混合策略必须留待重试。 */
async function testMissingRemoteClientRequiresUniformFlowStrategy() {
  const cases = [
    { remarks: ['direct-a', 'direct-b'], success: true, flow: 'xtls-rprx-vision' },
    { remarks: ['cf-a', 'cf-b'], success: true, flow: undefined },
    { remarks: ['direct-a', 'cf-b'], success: false, flow: undefined }
  ];
  for (const item of cases) {
    const { db, service, writes } = remoteFixture({ remoteLookup: { status: 'not_found', success: false } });
    db.state.nodes = item.remarks.map((remark, index) => ({ server_id: 2, inbound_id: 10 + index, remark, protocol: 'vless' }));
    db.state.configs.push({ ...db.state.configs[0], inbound_id: 11 });
    const result = await service.syncServerWithLatestCredentials(db, 7, 2);
    assert.strictEqual(result.success, item.success, `策略 ${item.remarks.join(',')} 的结果不符`);
    assert.strictEqual(writes.length, item.success ? 1 : 0);
    if (item.success) assert.strictEqual(writes[0].client.flow, item.flow);
  }
}

/** server-level client 查询失败时不能猜测全局 flow 或继续写入。 */
async function testRemoteClientLookupFailureStopsServerWrite() {
  const { db, service, writes } = remoteFixture({
    remoteLookup: { status: 'error', success: false, retryable: true, message: 'timeout secret' }
  });
  const result = await service.syncServerWithLatestCredentials(db, 7, 2);
  assert.strictEqual(result.success, false);
  assert.strictEqual(writes.length, 0);
}

/** 单服务器异常不得中断其他目标，也不得把原始错误中的凭证写入日志或任务结果。 */
async function testOneServerFailureDoesNotStopOtherServers() {
  const { db, service, refreshes, logs } = remoteFixture({ failServer: 1 });
  db.state.servers.push({ ...db.state.servers[0], id: 1 });
  db.state.configs.push({ ...db.state.configs[0], server_id: 1 });
  db.state.nodes.push({ ...db.state.nodes[0], server_id: 1 });
  const result = await service.processRotationTask(db, { payload_data: { user_id: 7, serverIds: [1, 2, 2] } });
  assert.deepStrictEqual(result.successfulServerIds, [2]);
  assert.deepStrictEqual(result.failedServerIds, [1]);
  assert.strictEqual(result.success, false);
  assert.deepStrictEqual(refreshes, [[2]]);
  assert.ok(!JSON.stringify({ logs, result }).includes('uuid-secret'));
}

/** 无快照重试先远端只读，真实事务提交新配置后才允许远端写入。 */
async function testMissingLocalSnapshotBootstrapsLocallyBeforeRemoteWrite() {
  const { db, service, writes } = remoteFixture();
  db.state.nodes = [];
  db.state.configs = [];
  const result = await service.syncServerWithLatestCredentials(db, 7, 2);
  assert.strictEqual(result.success, true);
  assert.strictEqual(db.state.configs.length, 1);
  assert.strictEqual(db.state.configs[0].uuid, 'uuid-1');
  assert.strictEqual(writes[0].client.subId, '0000000000000001');
  const userLock = db.calls.findIndex(row => /FROM users.*FOR UPDATE/.test(row.sql));
  const serverLock = db.calls.findIndex(row => row.sql.includes('pg_advisory_xact_lock'));
  assert.ok(userLock >= 0 && serverLock > userLock);
  const snapshotLock = db.calls.findIndex(row => row.sql.includes('pg_advisory_xact_lock') && row.params[0] === 31001);
  const configWrite = db.calls.findIndex(row => row.sql.startsWith('UPDATE user_node_configs'));
  assert.ok(snapshotLock > serverLock && snapshotLock < configWrite, '快照锁必须先于配置写入，避免与快照清理器互相等待');
}

/** 远端全部失败仍走缓存验证，不得刷新失败服务器来源。 */
async function testRemoteFailurePreservesSourceAndFinalNodes() {
  const { db, service, refreshes } = remoteFixture({ failServer: 2 });
  const baseline = copy(db.state.caches);
  const result = await service.processRotationTask(db, { user_id: 7, payload_data: { serverIds: [2] } });
  assert.deepStrictEqual(result.failedServerIds, [2]);
  assert.deepStrictEqual(refreshes, [[]]);
  assert.deepStrictEqual(db.state.caches, baseline);
}

/** 远端成功而来源刷新失败必须降级，不得把该服务器当作任务成功。 */
async function testSourceRefreshFailureDowngradesServerToFailed() {
  const { db, service } = remoteFixture({ refreshFail: true });
  const baseline = copy(db.state.caches);
  const result = await service.processRotationTask(db, { user_id: 7, payload_data: { serverIds: [2] } });
  assert.deepStrictEqual(result.successfulServerIds, []);
  assert.deepStrictEqual(result.failedServerIds, [2]);
  assert.deepStrictEqual(db.state.caches, baseline);
}

/** 刚同步凭证指纹仅在进程 options 流转，不能把来源刷新前的新轮换当成已经远端成功。 */
async function testRemoteRevisionIsPassedToCacheWithoutCredentialValues() {
  const { db, service, refreshOptions } = remoteFixture();
  await service.processRotationTask(db, { user_id: 7, payload_data: { serverIds: [2] } });
  const revision = refreshOptions[0]?.expectedCredentialRevisions?.[2];
  assert.match(revision || '', /^[a-f0-9]{64}$/, '缓存刷新必须关联刚同步远端的稳定凭证指纹');
  db.state.configs[0].uuid = 'latest-revision';
  await service.processRotationTask(db, { user_id: 7, payload_data: { serverIds: [2] } });
  assert.notStrictEqual(refreshOptions[1].expectedCredentialRevisions[2], revision);
  assert.ok(!JSON.stringify(refreshOptions).includes('old-uuid'));
}

/** 容量为一的池真实执行共享远端锁；持锁内部不得再次申请连接，也不得提前释放持锁连接。 */
async function testSingleConnectionPoolCompletesRemoteSyncWithoutNestedCheckout() {
  const { db, service, writes } = remoteFixture();
  const xuiSyncRepository = require('../repositories/xui-sync-repository');
  service.withServerClientLock = xuiSyncRepository.withServerClientLock;
  let occupied = false;
  let nestedCheckouts = 0;
  let sessionLocks = 0;
  db.pool.connect = async () => {
    if (occupied) {
      nestedCheckouts++;
      await new Promise(resolve => setTimeout(resolve, 30));
      throw new Error('容量一连接池等待超时');
    }
    occupied = true;
    const client = db.connect();
    const originalQuery = client.query;
    const originalRelease = client.release;
    let sessionLocked = false;
    client.query = async (sql, params) => {
      if (sql.includes('pg_advisory_lock(')) { sessionLocks++; sessionLocked = true; return { rows: [] }; }
      if (sql.includes('pg_advisory_unlock(')) { sessionLocked = false; return { rows: [{ unlocked: true }] }; }
      return originalQuery(sql, params);
    };
    client.release = () => {
      assert.strictEqual(sessionLocked, false, '事务不得释放仍持有远端锁的借用连接');
      assert.strictEqual(occupied, true, '专用连接不得重复释放');
      occupied = false;
      originalRelease();
    };
    return client;
  };
  const result = await service.syncServerWithLatestCredentials(db, 7, 2);
  assert.strictEqual(result.success, true, '容量一连接池也必须能够提交本地配置并完成远端同步');
  assert.strictEqual(writes.length, 1);
  assert.strictEqual(nestedCheckouts, 0, '持锁时不得再从池中申请第二条连接');
  assert.strictEqual(sessionLocks, 1, '同一个远端锁只获取一次');
  assert.strictEqual(occupied, false);
  const userIndex = db.calls.findIndex(row => /FROM users.*FOR UPDATE/.test(row.sql));
  const credentialIndex = db.calls.findIndex(row => row.sql.includes('pg_advisory_xact_lock'));
  assert.ok(userIndex >= 0 && credentialIndex > userIndex);
}

/** 加载真实实现；缺失服务时给出明确的功能未实现断言。 */
function createService(random = generators(), options = {}) {
  const servicePath = path.join(__dirname, '../services/user/subscription-credential-rotation-service.js');
  assert.ok(fs.existsSync(servicePath), '本地凭证轮换 service 不存在');
  const { SubscriptionCredentialRotationService } = require(servicePath);
  return new SubscriptionCredentialRotationService({ generators: random, nowSeconds: () => 10000, ...options });
}

/** 捕获遗漏写入、提前提交或任务 payload 包含凭证的回归。 */
async function testPrepareRotationUpdatesTokenCredentialsBaselineAndTaskAtomically() {
  const service = createService();
  const db = new RotationDatabase();
  db.state.configs.push({ ...db.state.configs[0], inbound_id: 12, sub_id: 'bbbbbbbbbbbbbbbb' });
  const baseline = db.state.caches[0].nodes_data;
  db.options.beforeCommit = state => {
    assert.strictEqual(db.state.users[0].sub_id, 'old-public');
    assert.strictEqual(state.users[0].sub_id, 'public-1');
    assert.strictEqual(state.users[0].subscription_credentials_rotated_at, 10000);
    assert.strictEqual(state.caches.length, 1);
    assert.strictEqual(state.caches[0].sub_id, 'public-1');
    assert.strictEqual(state.caches[0].nodes_data, baseline);
    assert.deepStrictEqual(state.tasks[0].payload, { user_id: 7, serverIds: [2] });
    assert.deepStrictEqual(new Set(state.configs.map(row => row.uuid)), new Set(['uuid-1']));
    assert.deepStrictEqual(new Set(state.configs.map(row => row.password)), new Set(['password-1']));
    assert.deepStrictEqual(new Set(state.configs.map(row => row.auth)), new Set(['auth-1']));
  };
  const result = await service.prepareRotation(db, 7);
  assert.deepStrictEqual([result.taskId, result.subId, result.serverIds, result.serverNames], [1, 'public-1', [2], ['服务器二']]);
  assert.strictEqual(result.user.sub_id, 'public-1');
  assert.strictEqual(db.state.configs.find(row => row.inbound_id === 12).sub_id, 'bbbbbbbbbbbbbbbb');
  assert.strictEqual(db.state.configs.find(row => row.inbound_id === 10).sub_id, 'aaaaaaaaaaaaaaaa');
  assert.strictEqual(db.calls.at(-2).sql, 'COMMIT');
}

/** 捕获补行误换旧 sub_id 或整台服务器每 inbound 生成不同内部 ID。 */
async function testMissingInboundConfigsAreFilledFromSnapshots() {
  const service = createService();
  const db = new RotationDatabase();
  db.state.servers.push({ id: 5, name: '服务器五', status: 1, panel_version: '3.5.0' });
  db.state.nodes.push({ server_id: 5, inbound_id: 50 }, { server_id: 5, inbound_id: 51 });
  await service.prepareRotation(db, 7);
  assert.strictEqual(db.state.configs.find(row => row.inbound_id === 11).sub_id, 'aaaaaaaaaaaaaaaa');
  const rows = db.state.configs.filter(row => row.server_id === 5);
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(new Set(rows.map(row => row.sub_id)), new Set(['0000000000000001']));
  assert.deepStrictEqual(new Set(rows.map(row => row.uuid)), new Set(['uuid-2']));
}

/** 准备轮换补 active inbound 时必须优先复用 active 配置，不能被更小 ID 的历史配置污染。 */
async function testPrepareRotationUsesActiveInboundCanonicalSubId() {
  const service = createService();
  const db = new RotationDatabase();
  db.state.nodes = [{ server_id: 2, inbound_id: 10 }, { server_id: 2, inbound_id: 11 }];
  db.state.configs = [
    { user_id: 7, server_id: 2, inbound_id: 1, uuid: 'history-uuid', password: 'history-password', auth: 'history-auth', sub_id: 'aaaaaaaaaaaaaaaa' },
    { user_id: 7, server_id: 2, inbound_id: 10, uuid: 'active-uuid', password: 'active-password', auth: 'active-auth', sub_id: 'bbbbbbbbbbbbbbbb' }
  ];

  await service.prepareRotation(db, 7);

  assert.strictEqual(db.state.configs.find(row => row.inbound_id === 1).sub_id, 'aaaaaaaaaaaaaaaa');
  assert.strictEqual(db.state.configs.find(row => row.inbound_id === 10).sub_id, 'bbbbbbbbbbbbbbbb');
  assert.strictEqual(db.state.configs.find(row => row.inbound_id === 11).sub_id, 'bbbbbbbbbbbbbbbb');
}

/** 重试补 active inbound 时 canonical 凭证与 subId 都必须来自 active 配置，历史行不得阻塞同步。 */
async function testRetrySyncUsesActiveInboundCanonicalConfig() {
  const { db, service, writes } = remoteFixture();
  db.state.nodes = [
    { server_id: 2, inbound_id: 10, remark: 'direct-a', protocol: 'vless' },
    { server_id: 2, inbound_id: 11, remark: 'direct-b', protocol: 'vless' }
  ];
  db.state.configs = [
    { user_id: 7, server_id: 2, inbound_id: 1, uuid: 'history-uuid', password: 'history-password', auth: 'history-auth', sub_id: 'aaaaaaaaaaaaaaaa' },
    { user_id: 7, server_id: 2, inbound_id: 10, uuid: 'active-uuid', password: 'active-password', auth: 'active-auth', sub_id: 'bbbbbbbbbbbbbbbb' }
  ];

  const result = await service.syncServerWithLatestCredentials(db, 7, 2);

  assert.strictEqual(result.success, true);
  assert.strictEqual(writes.length, 1);
  assert.deepStrictEqual(writes[0].inboundIds, [10, 11]);
  assert.deepStrictEqual({ id: writes[0].client.id, password: writes[0].client.password,
    auth: writes[0].client.auth, subId: writes[0].client.subId }, {
    id: 'active-uuid', password: 'active-password', auth: 'active-auth', subId: 'bbbbbbbbbbbbbbbb'
  });
  assert.strictEqual(db.state.configs.find(row => row.inbound_id === 1).sub_id, 'aaaaaaaaaaaaaaaa');
  assert.strictEqual(db.state.configs.find(row => row.inbound_id === 10).sub_id, 'bbbbbbbbbbbbbbbb');
  assert.strictEqual(db.state.configs.find(row => row.inbound_id === 11).sub_id, 'bbbbbbbbbbbbbbbb');
}

/** active inbound 全无本地行时才允许回退历史配置，补齐后仍形成一致的服务器级 client。 */
async function testRetrySyncFallsBackToHistoryOnlyWhenActiveConfigsAreMissing() {
  const { db, service, writes } = remoteFixture();
  db.state.nodes = [
    { server_id: 2, inbound_id: 10, remark: 'direct-a', protocol: 'vless' },
    { server_id: 2, inbound_id: 11, remark: 'direct-b', protocol: 'vless' }
  ];
  db.state.configs = [
    { user_id: 7, server_id: 2, inbound_id: 1, uuid: 'history-uuid', password: 'history-password', auth: 'history-auth', sub_id: 'aaaaaaaaaaaaaaaa' }
  ];

  const result = await service.syncServerWithLatestCredentials(db, 7, 2);

  assert.strictEqual(result.success, true);
  assert.strictEqual(writes[0].client.subId, 'aaaaaaaaaaaaaaaa');
  assert.strictEqual(writes[0].client.id, 'history-uuid');
  assert.deepStrictEqual(db.state.configs.filter(row => [10, 11].includes(row.inbound_id)).map(row => row.sub_id),
    ['aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa']);
}

/** 捕获没有快照时凭空构造 inbound 或漏记补偿目标的回归。 */
async function testMissingSnapshotKeepsServerInTaskWithoutInventingConfigs() {
  const service = createService();
  const db = new RotationDatabase();
  db.state.servers.push({ id: 9, name: '无快照', status: 1, panel_version: '3.4.2' });
  const result = await service.prepareRotation(db, 7);
  assert.deepStrictEqual(result.serverIds, [2, 9]);
  assert.deepStrictEqual(db.state.tasks[0].payload.serverIds, [2, 9]);
  assert.ok(!db.state.configs.some(row => row.server_id === 9));
}

/** 三字段分别碰撞均须整组重生；其他服务器同值可接受。 */
async function testCredentialCollisionRegeneratesWholeTriple() {
  for (const field of ['uuid', 'password', 'auth']) {
    const random = generators([{ uuid: 'candidate', password: 'candidate', auth: 'candidate' }]);
    const service = createService(random);
    const db = new RotationDatabase();
    db.state.configs.push({ user_id: 8, server_id: 2, inbound_id: 10, [field]: 'candidate' });
    await service.prepareRotation(db, 7);
    assert.deepStrictEqual([random.counts.uuid, random.counts.password, random.counts.auth], [2, 2, 2]);
    assert.strictEqual(db.state.configs.find(row => row.user_id === 7).uuid, 'uuid-2');
  }
  const random = generators([{ uuid: 'candidate', password: 'candidate', auth: 'candidate' }]);
  const service = createService(random);
  const db = new RotationDatabase();
  db.state.configs.push({ user_id: 8, server_id: 8, inbound_id: 10, uuid: 'candidate', password: 'candidate', auth: 'candidate' });
  await service.prepareRotation(db, 7);
  assert.strictEqual(random.counts.uuid, 1);
}

/** 历史真实节点缺归属时必须拒绝；公告/虚拟节点明确放行。 */
async function testLegacyCacheWithoutServerIdRejectsBeforeCooldownIsConsumed() {
  const service = createService();
  for (const serverId of [undefined, null, '', 0, -1, 'bad']) {
    const db = new RotationDatabase();
    const before = copy(db.state);
    db.state.caches[0].nodes_data = JSON.stringify([{ server_id: serverId, server_name: '不允许猜测名称', link: 'vless://old' }]);
    await assert.rejects(() => service.prepareRotation(db, 7), error => /先重新生成订阅/.test(error.message) && error.isLegacyBusinessError);
    assert.deepStrictEqual(db.state.users, before.users);
    assert.strictEqual(db.state.tasks.length, 0);
    assert.strictEqual(db.calls.at(-2).sql, 'ROLLBACK');
  }
  const db = new RotationDatabase();
  db.state.caches[0].nodes_data = JSON.stringify([{ is_announcement: true }, { strategy: 'announcement' }, { is_virtual: true }]);
  await service.prepareRotation(db, 7);
  assert.strictEqual(db.state.tasks.length, 1);
}

/** 两请求竞争用户行锁后，第二个必须读取第一次提交的最新冷却时间。 */
async function testConcurrentRotationOnlyFirstPassesCooldown() {
  const service = createService();
  const db = new RotationDatabase();
  const results = await Promise.allSettled([service.prepareRotation(db, 7), service.prepareRotation(db, 7)]);
  assert.strictEqual(results.filter(result => result.status === 'fulfilled').length, 1);
  const error = results.find(result => result.status === 'rejected').reason;
  assert.deepStrictEqual([error.isLegacyBusinessError, error.statusCode, error.code, error.retryAfter], [true, 429, 429, 3600]);
  assert.strictEqual(db.state.tasks.length, 1);
}

/** 3599 秒剩 1 秒，未满整秒向上取整，满整小时放行。 */
async function testCooldownReturnsRemainingSeconds() {
  for (const [now, retryAfter] of [[9999, 1], [9998.1, 2], [6400, 3600]]) {
    const service = createService(generators(), { nowSeconds: () => now });
    const db = new RotationDatabase();
    db.state.users[0].subscription_credentials_rotated_at = '6400';
    await assert.rejects(() => service.prepareRotation(db, 7), error => error.retryAfter === retryAfter && error.code === 429);
    assert.strictEqual(db.state.tasks.length, 0);
  }
  const db = new RotationDatabase();
  db.state.users[0].subscription_credentials_rotated_at = 6400;
  await createService().prepareRotation(db, 7);
  assert.strictEqual(db.state.tasks.length, 1);
}

/** 每个本地写入阶段失败必须回滚 token、凭证、缓存、冷却和任务。 */
async function testTransactionFailureDoesNotConsumeCooldownOrCreateTask() {
  for (const stage of ['UPDATE user_node_configs', 'INSERT INTO user_node_configs', 'UPDATE users', 'DELETE FROM user_subscriptions', 'INSERT INTO user_subscriptions', 'INSERT INTO xui_sync_tasks']) {
    const service = createService();
    const db = new RotationDatabase({ failOn: sql => sql.startsWith(stage) });
    const before = copy(db.state);
    await assert.rejects(() => service.prepareRotation(db, 7), /模拟数据库写入失败/);
    assert.deepStrictEqual(db.state, before);
    assert.strictEqual(db.calls.at(-2).sql, 'ROLLBACK');
    assert.ok(!db.calls.some(call => call.sql === 'COMMIT'));
  }
}

/** token 唯一冲突只重试公开 ID，必须恢复 PostgreSQL 的失败事务状态。 */
async function testPublicTokenCollisionRetriesOnlyTokenGeneration() {
  const random = generators();
  const service = createService(random);
  const db = new RotationDatabase({ tokenCollision: token => token === 'public-1' });
  const result = await service.prepareRotation(db, 7);
  assert.strictEqual(result.subId, 'public-2');
  assert.deepStrictEqual([random.counts.publicToken, random.counts.uuid, random.counts.password, random.counts.auth], [2, 1, 1, 1]);
  assert.strictEqual(db.state.tasks.length, 1);
  const exhausted = new RotationDatabase({ tokenCollision: () => true });
  await assert.rejects(() => createService().prepareRotation(exhausted, 7));
  assert.strictEqual(exhausted.state.users[0].sub_id, 'old-public');
  assert.strictEqual(exhausted.state.tasks.length, 0);
}

/** 公开随机值恰好等于当前 token 时同样重试，不能把旧链接继续作为新链接返回。 */
async function testPublicTokenNeverReusesCurrentToken() {
  let attempts = 0;
  const random = generators();
  random.publicToken = () => ++attempts === 1 ? 'old-public' : 'fresh-public';
  const db = new RotationDatabase();
  const result = await createService(random).prepareRotation(db, 7);
  assert.strictEqual(result.subId, 'fresh-public');
  assert.strictEqual(attempts, 2);
  assert.strictEqual(random.counts.uuid, 1);
}

/** 无缓存、禁用、限时过期及旧面板都不应误走成功轮换路径。 */
async function testInvalidUserCacheAndUnsupportedServers() {
  for (const scenario of ['no-cache', 'disabled', 'expired']) {
    const db = new RotationDatabase({ planType: scenario === 'expired' ? 'timed' : 'lifetime' });
    if (scenario === 'no-cache') db.state.caches = [];
    if (scenario === 'disabled') db.state.users[0].enabled = 0;
    if (scenario === 'expired') db.state.users[0].expire_at = 9999;
    await assert.rejects(() => createService().prepareRotation(db, 7), error => error.isLegacyBusinessError && error.statusCode === 400);
    assert.strictEqual(db.state.tasks.length, 0);
  }
  const logs = [];
  const db = new RotationDatabase();
  db.state.servers.push({ id: 4, panel_version: '3.4.1', status: 1 });
  const result = await createService(generators(), { logger: { warn: message => logs.push(message) } }).prepareRotation(db, 7);
  assert.deepStrictEqual(result.serverIds, [2]);
  assert.ok(logs.some(message => message.includes('4')));
  assert.ok(!JSON.stringify(logs).includes('public-1'));
}

/** 独立执行全部行为，确保首次 RED 能展示每个缺失行为，而非首错即停。 */
async function main() {
  let failures = 0;
  for (const test of [testPrepareRotationUpdatesTokenCredentialsBaselineAndTaskAtomically, testMissingInboundConfigsAreFilledFromSnapshots,
    testPrepareRotationUsesActiveInboundCanonicalSubId, testRetrySyncUsesActiveInboundCanonicalConfig,
    testRetrySyncFallsBackToHistoryOnlyWhenActiveConfigsAreMissing,
    testMissingSnapshotKeepsServerInTaskWithoutInventingConfigs, testCredentialCollisionRegeneratesWholeTriple,
    testLegacyCacheWithoutServerIdRejectsBeforeCooldownIsConsumed, testConcurrentRotationOnlyFirstPassesCooldown,
    testCooldownReturnsRemainingSeconds, testTransactionFailureDoesNotConsumeCooldownOrCreateTask,
    testPublicTokenCollisionRetriesOnlyTokenGeneration, testPublicTokenNeverReusesCurrentToken, testInvalidUserCacheAndUnsupportedServers,
    testRotationTaskReadsLatestCredentialsOnEveryRun, testRemoteSyncSuccessLogIncludesUserEmailAndServer,
    testRemoteSyncRejectsInconsistentLocalSubIds,
    testRemoteSyncUsesUnchangedCanonicalSubIdOnce, testRemoteSyncPreservesExistingGlobalFlowForMixedStrategies,
    testMissingRemoteClientRequiresUniformFlowStrategy, testRemoteClientLookupFailureStopsServerWrite,
    testOneServerFailureDoesNotStopOtherServers,
    testMissingLocalSnapshotBootstrapsLocallyBeforeRemoteWrite, testRemoteFailurePreservesSourceAndFinalNodes,
    testSourceRefreshFailureDowngradesServerToFailed, testRemoteRevisionIsPassedToCacheWithoutCredentialValues,
    testSingleConnectionPoolCompletesRemoteSyncWithoutNestedCheckout]) {
    try { await test(); console.log(`PASS ${test.name}`); }
    catch (error) { failures++; console.error(`FAIL ${test.name}: ${error.stack}`); }
  }
  if (failures) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { RotationDatabase, generators, createService };
