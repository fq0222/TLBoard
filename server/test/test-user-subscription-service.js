const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const subscriptionService = require('../services/user/subscription-service');
const subscriptionStrategy = require('../services/shared/subscription-strategy');
const sharedSubscriptionService = require('../services/shared/subscription-service');
const adminUsersService = require('../services/admin/users-service');
const systemSettingsRouter = require('../routes/admin/system-settings');
const subscriptionRepository = require('../repositories/subscription-repository');
const userRepository = require('../repositories/user-repository');
const xuiSyncTaskService = require('../integrations/xui/xui-sync-task-service');
const xuiActivityTracker = require('../utils/xui-activity-tracker');
const { RotationDatabase } = require('./test-subscription-credential-rotation-service');

/** 渐进缓存使用真实仓储及事务替身，prepare 仅提供现有订阅仓储的只读查询。 */
class RotatedCacheDatabase extends RotationDatabase {
  constructor() {
    super();
    this.state.users[0].sub_id = 'current-public';
    this.state.servers = [1, 2].map(id => ({ id, name: `server-${id}`, status: 1, panel_version: '3.4.2', sub_url: `https://server-${id}/sub/` }));
    this.state.configs = [1, 2].map(id => ({ user_id: 7, server_id: id, inbound_id: id * 10, uuid: `new-${id}`, password: `pass-${id}`, auth: `auth-${id}`, sub_id: `internal-${id}` }));
    this.state.nodes = [1, 2].map(id => ({ server_id: id, inbound_id: id * 10, remark: 'direct', protocol: 'vless', port: 443 }));
    this.state.sources = [1, 2].map(id => ({ user_id: 7, server_id: id, inbound_id: id * 10, original_link: `vless://old-${id}@old.example:443` }));
    this.state.caches = [{ user_id: 7, sub_id: 'current-public', updated_at: 1, nodes_data: JSON.stringify([
      { server_id: 1, node_name: 'one-old-a', link: 'old-1a' }, { server_id: '1', node_name: 'one-old-b', link: 'old-1b' },
      { server_id: 2, node_name: 'two-old', link: 'old-2', metadata: { retain: [1, 2] } },
      { is_announcement: true, node_name: '公告' }, { is_virtual: true, node_name: '未知虚拟节点', metadata: { v: 1 } }
    ]) }];
  }

  /** 只读模拟现有订阅仓储 SQL，未知查询拒绝，避免掩盖意外写入和缓存清理。 */
  prepare(sql) {
    return {
      get: async userId => {
        if (sql.includes('FROM users')) return this.state.users.find(row => row.id === userId);
        throw new Error(`未定义 get: ${sql}`);
      },
      all: async userId => {
        if (sql.includes('FROM user_node_configs')) return this.state.configs.filter(row => row.user_id === userId)
          .filter(config => this.state.nodes.some(node => node.server_id === config.server_id && node.inbound_id === config.inbound_id)).map(config => ({
          ...config, ...this.state.nodes.find(node => node.server_id === config.server_id && node.inbound_id === config.inbound_id)
        }));
        if (sql.includes('FROM xui_servers')) return this.state.servers;
        if (sql.includes('FROM user_cf_ips')) return [{ ip: '1.1.1.1' }, { ip: '2.2.2.2' }];
        throw new Error(`未定义 all: ${sql}`);
      },
      run: async () => { throw new Error('轮换不得在专用事务外写入来源或最终缓存'); }
    };
  }
}

const rotationLogger = { info() {}, warn() {}, error() {} };

/** 真实解析和组合，只替代网络来源；不同服务器内容可识别。 */
function rotationFetchOptions(overrides = {}) {
  return { dependencies: { fetchOriginalSubscription: async url => {
    const id = url.includes('server-1') ? 1 : 2;
    return Buffer.from(`vless://new-${id}@new-${id}.example:443?type=tcp&security=none#direct`).toString('base64');
  }, ...overrides } };
}

/** 成功服务器全部旧节点替换，其他真实/虚拟节点深度保持原样。 */
async function testMergeReplacesOnlySuccessfulServerNodes() {
  const db = new RotatedCacheDatabase();
  const old = JSON.parse(db.state.caches[0].nodes_data);
  const result = await subscriptionService.refreshAndMergeRotatedServers(db, 7, [1], rotationLogger, rotationFetchOptions());
  const nodes = JSON.parse(db.state.caches[0].nodes_data);
  assert.deepStrictEqual(result, { successfulServerIds: [1], failedServerIds: [] });
  assert.deepStrictEqual(nodes.filter(node => Number(node.server_id) !== 1), old.slice(2));
  assert.strictEqual(nodes.filter(node => Number(node.server_id) === 1).length, 1);
  assert.ok(nodes.find(node => node.server_id === 1).link.includes('new-1@'));
  assert.ok(db.state.sources.find(row => row.server_id === 1).original_link.includes('new-1@'));
  assert.strictEqual(db.state.sources.find(row => row.server_id === 2).original_link, 'vless://old-2@old.example:443');
}

/** 没有成功服务器时锁内验证基线，新 token 下完整缓存仍可用且无写入。 */
async function testAllServersFailKeepsWholeBaselineUnderNewToken() {
  const db = new RotatedCacheDatabase();
  const baseline = JSON.stringify(db.state.caches);
  await subscriptionService.refreshAndMergeRotatedServers(db, 7, [], rotationLogger, rotationFetchOptions());
  assert.strictEqual(JSON.stringify(db.state.caches), baseline);
  assert.ok(db.calls.some(row => row.sql.includes('pg_advisory_xact_lock') && row.params[0] === 31003));
}

/** 拉取期间再次轮换 token，锁内必须读取最新 token，不得重新插入旧 token 缓存。 */
async function testCacheMergeAlwaysUsesLatestUserToken() {
  const db = new RotatedCacheDatabase();
  await subscriptionService.refreshAndMergeRotatedServers(db, 7, [1], rotationLogger, rotationFetchOptions({
    fetchOriginalSubscription: async () => {
      db.state.users[0].sub_id = 'newest-public';
      db.state.caches[0].sub_id = 'newest-public';
      return Buffer.from('vless://new-1@new.example:443?type=tcp#direct').toString('base64');
    }
  }));
  assert.deepStrictEqual(db.state.caches.map(row => row.sub_id), ['newest-public']);
}

/** 交错任务分别刷新服务器，第二次合并必须重读第一次已提交的节点。 */
async function testInterleavedTasksDoNotLosePreviouslyMergedServer() {
  const db = new RotatedCacheDatabase();
  let unblock;
  let entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { unblock = resolve; });
  const first = subscriptionService.refreshAndMergeRotatedServers(db, 7, [1], rotationLogger, rotationFetchOptions({
    fetchOriginalSubscription: async () => { entered(); await gate; return Buffer.from('vless://new-1@new.example:443?type=tcp#direct').toString('base64'); }
  }));
  await waiting;
  await subscriptionService.refreshAndMergeRotatedServers(db, 7, [2], rotationLogger, rotationFetchOptions());
  unblock();
  await first;
  const nodes = JSON.parse(db.state.caches[0].nodes_data);
  assert.ok(nodes.find(node => node.server_id === 1).link.includes('new-1@'));
  assert.ok(nodes.find(node => node.server_id === 2).link.includes('new-2@'));
}

/** 同服务器部分 inbound 来源失败时来源和最终节点均不得部分覆盖。 */
async function testSourceFailurePreservesWholeServerAndOtherServerCanMerge() {
  const db = new RotatedCacheDatabase();
  db.state.configs.push({ ...db.state.configs[0], inbound_id: 11, sub_id: 'fail-source' });
  db.state.nodes.push({ ...db.state.nodes[0], inbound_id: 11 });
  const old = JSON.parse(db.state.caches[0].nodes_data).filter(row => Number(row.server_id) === 1);
  const result = await subscriptionService.refreshAndMergeRotatedServers(db, 7, [1, 2], rotationLogger, rotationFetchOptions({
    fetchOriginalSubscription: async (url, subId) => {
      if (subId === 'fail-source') throw new Error('timeout');
      return Buffer.from(`vless://new-${url.includes('server-1') ? 1 : 2}@new.example:443?type=tcp#direct`).toString('base64');
    }
  }));
  assert.deepStrictEqual(result, { successfulServerIds: [2], failedServerIds: [1] });
  assert.deepStrictEqual(JSON.parse(db.state.caches[0].nodes_data).filter(row => Number(row.server_id) === 1), old);
  assert.strictEqual(db.state.sources.find(row => row.server_id === 1).original_link, 'vless://old-1@old.example:443');
}

/** 原始来源只有协议前缀但缺地址/凭证时，不能发布无效新节点或覆盖旧来源。 */
async function testInvalidComposedNodesKeepOldSourcesAndCache() {
  const db = new RotatedCacheDatabase();
  const baseline = JSON.stringify({ sources: db.state.sources, caches: db.state.caches });
  const result = await subscriptionService.refreshAndMergeRotatedServers(db, 7, [1], rotationLogger, rotationFetchOptions({
    fetchOriginalSubscription: async () => Buffer.from('vless://invalid').toString('base64')
  }));
  assert.deepStrictEqual(result, { successfulServerIds: [], failedServerIds: [1] });
  assert.strictEqual(JSON.stringify({ sources: db.state.sources, caches: db.state.caches }), baseline);
}

/** 拉取期间增加 inbound 时不能用旧配置集合替换服务器全部节点。 */
async function testChangedInboundSetIsRetriedWithoutPublishingPartialNodes() {
  const db = new RotatedCacheDatabase();
  const baseline = JSON.stringify(db.state.caches);
  const result = await subscriptionService.refreshAndMergeRotatedServers(db, 7, [1], rotationLogger, rotationFetchOptions({
    fetchOriginalSubscription: async () => {
      db.state.configs.push({ ...db.state.configs[0], inbound_id: 11 });
      db.state.nodes.push({ ...db.state.nodes[0], inbound_id: 11 });
      return Buffer.from('vless://new-1@new.example:443?type=tcp#direct').toString('base64');
    }
  }));
  assert.deepStrictEqual(result, { successfulServerIds: [], failedServerIds: [1] });
  assert.strictEqual(JSON.stringify(db.state.caches), baseline);
}

/** 缓存写入失败必须回滚同事务的新来源，不能丢失完整基线。 */
async function testCacheWriteFailureRollsBackSourcesAndPreservesBaseline() {
  const db = new RotatedCacheDatabase();
  db.options.failOn = sql => sql.startsWith('INSERT INTO user_subscriptions');
  const baseline = JSON.stringify({ sources: db.state.sources, caches: db.state.caches });
  const result = await subscriptionService.refreshAndMergeRotatedServers(db, 7, [1, 2], rotationLogger, rotationFetchOptions());
  assert.deepStrictEqual(result, { successfulServerIds: [], failedServerIds: [1, 2] });
  assert.strictEqual(JSON.stringify({ sources: db.state.sources, caches: db.state.caches }), baseline);
  assert.ok(db.calls.some(row => row.sql === 'ROLLBACK'));
}

/** 候选拉取中凭证再次轮换，旧任务必须失败保留基线，不能向当前 token 发布旧凭证。 */
async function testCredentialsChangedDuringFetchPreserveCurrentBaseline() {
  const db = new RotatedCacheDatabase();
  const baseline = JSON.stringify(db.state.caches);
  const result = await subscriptionService.refreshAndMergeRotatedServers(db, 7, [1], rotationLogger, rotationFetchOptions({
    fetchOriginalSubscription: async () => {
      db.state.configs[0].uuid = 'even-newer-uuid';
      return Buffer.from('vless://new-1@new.example:443?type=tcp#direct').toString('base64');
    }
  }));
  assert.deepStrictEqual(result, { successfulServerIds: [], failedServerIds: [1] });
  assert.strictEqual(JSON.stringify(db.state.caches), baseline);
}

/** 远端同步与来源准备之间再次轮换时，旧远端成功不能授权新配置的缓存发布。 */
async function testExpectedRemoteRevisionRejectsCredentialsChangedBeforeFetch() {
  const db = new RotatedCacheDatabase();
  const baseline = JSON.stringify({ caches: db.state.caches, sources: db.state.sources });
  const expectedRevision = crypto.createHash('sha256').update(JSON.stringify([
    [1, 10, 'new-1', 'pass-1', 'auth-1', 'internal-1']
  ])).digest('hex');
  db.state.configs[0].uuid = 'newer-local-uuid';
  const options = rotationFetchOptions();
  options.expectedCredentialRevisions = { 1: expectedRevision };
  const result = await subscriptionService.refreshAndMergeRotatedServers(db, 7, [1], rotationLogger, options);
  assert.deepStrictEqual(result, { successfulServerIds: [], failedServerIds: [1] });
  assert.strictEqual(JSON.stringify({ caches: db.state.caches, sources: db.state.sources }), baseline);
}

/** 不再出现在快照中的历史配置不属于远端目标，不能让当前有效 inbound 永久无法合并。 */
async function testHistoricalConfigWithoutSnapshotDoesNotBlockCurrentInbound() {
  const db = new RotatedCacheDatabase();
  db.state.configs.push({ ...db.state.configs[0], inbound_id: 99 });
  const result = await subscriptionService.refreshAndMergeRotatedServers(db, 7, [1], rotationLogger, rotationFetchOptions());
  assert.deepStrictEqual(result, { successfulServerIds: [1], failedServerIds: [] });
  assert.ok(JSON.parse(db.state.caches[0].nodes_data).find(node => node.server_id === 1).link.includes('new-1@'));
}

/** 各协议真实来源身份必须匹配本地新凭证；旧身份整台拒绝，当前身份正常提交。 */
async function assertRotationSourceIdentity(protocol, expectedIdentity, remark = 'direct') {
  for (const stale of [true, false]) {
    const db = new RotatedCacheDatabase();
    Object.assign(db.state.nodes[0], { protocol, remark });
    const baseline = JSON.stringify({ caches: db.state.caches, sources: db.state.sources });
    const identity = stale ? 'stale-identity' : expectedIdentity;
    const result = await subscriptionService.refreshAndMergeRotatedServers(db, 7, [1], rotationLogger, rotationFetchOptions({
      fetchOriginalSubscription: async () => Buffer.from(`${protocol}://${identity}@new.example:443?type=tcp#${remark}`).toString('base64')
    }));
    assert.deepStrictEqual(result, stale ? { successfulServerIds: [], failedServerIds: [1] }
      : { successfulServerIds: [1], failedServerIds: [] }, `${protocol}: ${stale ? '旧' : '当前'}凭证身份结果错误`);
    if (stale) assert.strictEqual(JSON.stringify({ caches: db.state.caches, sources: db.state.sources }), baseline);
    else {
      assert.ok(db.state.sources.find(row => row.server_id === 1).original_link.includes(`${expectedIdentity}@`));
      assert.ok(JSON.parse(db.state.caches[0].nodes_data).find(node => node.server_id === 1).link.includes(`${expectedIdentity}@`));
    }
  }
}

/** VLESS 来源必须使用新 UUID。 */
async function testRotationVlessSourceRejectsStaleUuid() { await assertRotationSourceIdentity('vless', 'new-1'); }
/** VMess 采用项目现有 parseNodeLink 的 URI 返回结构，来源必须使用新 UUID。 */
async function testRotationVmessSourceRejectsStaleUuid() { await assertRotationSourceIdentity('vmess', 'new-1'); }

/** 标准 VMess Base64 JSON 必须被真实解析，当前 UUID 可提交、旧 UUID 整台回退。 */
async function testRotationStandardVmessSourceValidatesDecodedUuid() {
  for (const stale of [true, false]) {
    const db = new RotatedCacheDatabase();
    Object.assign(db.state.nodes[0], { protocol: 'vmess', remark: 'direct' });
    const baseline = JSON.stringify({ caches: db.state.caches, sources: db.state.sources });
    const payload = {
      v: '2',
      ps: 'standard-vmess',
      add: 'new.example',
      port: '443',
      id: stale ? 'stale-identity' : 'new-1',
      aid: '0',
      scy: 'auto',
      net: 'ws',
      type: 'none',
      host: 'new.example',
      path: '/ws',
      tls: 'tls',
      sni: 'new.example'
    };
    const vmessLink = `vmess://${Buffer.from(JSON.stringify(payload)).toString('base64')}`;
    const result = await subscriptionService.refreshAndMergeRotatedServers(db, 7, [1], rotationLogger, rotationFetchOptions({
      fetchOriginalSubscription: async () => Buffer.from(vmessLink).toString('base64')
    }));

    assert.deepStrictEqual(result, stale ? { successfulServerIds: [], failedServerIds: [1] }
      : { successfulServerIds: [1], failedServerIds: [] });
    if (stale) {
      assert.strictEqual(JSON.stringify({ caches: db.state.caches, sources: db.state.sources }), baseline);
    } else {
      assert.strictEqual(db.state.sources.find(row => row.server_id === 1).original_link, vmessLink);
      const cachedLink = JSON.parse(db.state.caches[0].nodes_data).find(node => node.server_id === 1).link;
      assert.ok(cachedLink.startsWith('vmess://'));
      const cachedPayload = JSON.parse(Buffer.from(cachedLink.slice('vmess://'.length), 'base64').toString('utf8'));
      assert.strictEqual(cachedPayload.id, 'new-1');
      assert.strictEqual(cachedPayload.ps, 'server-1-direct');
    }
  }
}
/** Trojan 来源身份对应新 password，不能错误使用 uuid。 */
async function testRotationTrojanSourceRejectsStalePassword() { await assertRotationSourceIdentity('trojan', 'pass-1'); }
/** Hysteria2 来源身份对应新 auth，不能错误使用 uuid/password。 */
async function testRotationHysteriaSourceRejectsStaleAuth() { await assertRotationSourceIdentity('hysteria2', 'auth-1', 'hy2'); }

/** 3X-UI inbound 的 hysteria 与订阅链接 hysteria2 是同一协议别名，凭证一致时必须允许合并。 */
async function testRotationHysteriaAliasAcceptsCurrentAuth() {
  const db = new RotatedCacheDatabase();
  Object.assign(db.state.nodes[0], { protocol: 'hysteria', remark: 'hy2' });
  const result = await subscriptionService.refreshAndMergeRotatedServers(db, 7, [1], rotationLogger, rotationFetchOptions({
    fetchOriginalSubscription: async () => Buffer.from('hysteria2://auth-1@new.example:443?insecure=0#hy2').toString('base64')
  }));

  assert.deepStrictEqual(result, { successfulServerIds: [1], failedServerIds: [] });
  assert.ok(db.state.sources.find(row => row.server_id === 1).original_link.includes('hysteria2://auth-1@'));
}

/** 来源阶段失败日志必须包含用户邮箱和脱敏原因，便于定位而不输出真实凭证。 */
async function testRotationSourceFailureLogIncludesEmailAndSafeReason() {
  const db = new RotatedCacheDatabase();
  const warnings = [];
  const logger = { info() {}, warn: message => warnings.push(message), error() {} };
  const result = await subscriptionService.refreshAndMergeRotatedServers(db, 7, [1], logger, rotationFetchOptions({
    fetchOriginalSubscription: async () => Buffer.from('vless://stale-identity@new.example:443?type=tcp#direct').toString('base64')
  }));

  assert.deepStrictEqual(result, { successfulServerIds: [], failedServerIds: [1] });
  assert.ok(warnings.some(message => message.includes(
    '凭证轮换来源或节点准备失败: user=7, email=u@example.com, server=1, phase=source, reason=credential_mismatch'
  )));
  assert.ok(!warnings.join('\n').includes('stale-identity'));
}

/**
 * 构造仅覆盖订阅查询 SQL 的轻量假数据库。
 *
 * @param {Object} subscription - 预置订阅记录
 * @returns {Object} 测试用数据库对象
 */
function createFakeDb(subscription, settings = {}) {
  return {
    prepare(sql) {
      return {
        all() {
          if (sql.includes('FROM announcements')) {
            return [];
          }
          throw new Error(`未支持的 all 查询: ${sql}`);
        },
        get(param) {
          if (sql.includes('FROM system_settings')) {
            return settings[param] === undefined ? undefined : { value: settings[param] };
          }

          const token = param;
          if (sql.includes('FROM user_subscriptions') && token === subscription?.sub_id) {
            return subscription;
          }
          return undefined;
        }
      };
    }
  };
}

/**
 * 构造包含家宽权益和成功绑定状态的订阅假数据库。
 * @param {Object} subscription - 订阅缓存记录。
 * @param {Object|undefined} entitlement - 当前家宽套餐权益。
 * @param {Object|undefined} route - 当前已持久化的家宽绑定。
 * @param {Array<Object>} servers - 数据库中的服务器记录，含离线服务器。
 * @returns {Object} 仅响应本组订阅读取的假数据库。
 */
function createHomeRoutingFakeDb(subscription, entitlement, route, servers = []) {
  const db = createFakeDb(subscription);
  const originalPrepare = db.prepare;
  db.prepare = (sql) => {
    if (sql.includes('u.home_plan_id')) {
      return { get: () => entitlement };
    }
    if (sql.includes('FROM user_home_proxy_routes')) {
      return { get: () => route };
    }
    if (sql.includes('FROM xui_servers')) {
      return { all: (...ids) => sql.includes('WHERE status = 1')
        ? servers.filter((server) => server.status === 1)
        : sql.includes('WHERE id IN')
          ? servers.filter((server) => ids.includes(server.id))
          : servers };
    }
    return originalPrepare(sql);
  };
  return db;
}

function createFakeDbWithUserSubscriptionId(user, settings = {}) {
  return {
    prepare(sql) {
      return {
        all() {
          if (sql.includes('FROM announcements')) {
            return [];
          }
          throw new Error(`未支持的 all 查询: ${sql}`);
        },
        get(param) {
          if (sql.includes('FROM system_settings')) {
            return settings[param] === undefined ? undefined : { value: settings[param] };
          }
          if (sql.includes('FROM user_subscriptions')) {
            return undefined;
          }
          if (sql.includes('FROM users') && sql.includes('sub_id') && param === user?.sub_id) {
            return user;
          }
          return undefined;
        }
      };
    }
  };
}

/**
 * 构造仅覆盖订阅配置读写的轻量系统设置数据库。
 *
 * @param {Object} initialSettings - 初始系统设置
 * @returns {{db:Object,writes:Array}} 假数据库与写入记录
 */
function createSystemSettingsFakeDb(initialSettings = {}) {
  const settings = { ...initialSettings };
  const writes = [];

  return {
    writes,
    db: {
      prepare(sql) {
        return {
          get(key) {
            if (sql.includes('FROM system_settings')) {
              return settings[key] === undefined ? undefined : { value: settings[key] };
            }
            return undefined;
          }
        };
      },
      pool: {
        async query(sql, params) {
          writes.push({ sql, params });
          settings[params[0]] = params[1];
          return { rows: [], rowCount: 1 };
        }
      }
    }
  };
}

/**
 * 验证默认订阅输出为 Base64 文本并附带用户流量头。
 *
 * @returns {Promise<void>}
 */
async function testDefaultSubscriptionContentShouldReturnBase64AndUserinfo() {
  const subscription = {
    user_id: 12,
    sub_id: 'sub-token',
    email: 'user@example.com',
    enabled: 1,
    traffic_used: 1024,
    traffic_limit: 2048,
    expire_at: 1700000000,
    nodes_data: JSON.stringify([
      {
        node_name: 'Test-Node',
        link: 'vless://11111111-1111-1111-1111-111111111111@example.com:443?encryption=none&security=tls&type=ws&host=example.com&path=%2F#Test-Node'
      }
    ])
  };

  const result = await subscriptionService.getSubscriptionContent(
    createFakeDb(subscription),
    'sub-token',
    {}
  );

  assert.strictEqual(result.contentType, 'text/plain; charset=utf-8');
  assert.strictEqual(result.userId, 12);
  assert.strictEqual(
    result.headers['Subscription-Userinfo'],
    'upload=0; download=1024; total=2048; expire=1700000000'
  );
  assert.strictEqual(
    Buffer.from(result.body, 'base64').toString('utf8'),
    'vless://11111111-1111-1111-1111-111111111111@example.com:443?encryption=none&security=tls&type=ws&host=example.com&path=%2F#Test-Node'
  );
}

/**
 * 验证原始订阅拉取按前台 3X-UI 请求计入活动追踪，但不增加后台冷却计数。
 *
 * @returns {Promise<void>}
 */
async function testFetchOriginalSubscriptionShouldTrackForegroundWithoutBackgroundCooldown() {
  const service = new sharedSubscriptionService.SubscriptionService({ proxy: { enabled: false } });
  const observedActiveCounts = [];
  const backgroundCountBefore = xuiActivityTracker.getBackgroundRequestCount();
  const server = http.createServer((req, res) => {
    observedActiveCounts.push(xuiActivityTracker.getActiveCount());
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(Buffer.from('vless://node').toString('base64'));
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    const content = await service.fetchOriginalSubscription(
      `http://127.0.0.1:${port}/sub/`,
      'token',
      { timeout: 1000 }
    );

    assert.strictEqual(content, Buffer.from('vless://node').toString('base64'));
    assert.deepStrictEqual(observedActiveCounts, [1]);
    assert.strictEqual(
      xuiActivityTracker.getBackgroundRequestCount(),
      backgroundCountBefore
    );
    assert.strictEqual(xuiActivityTracker.getActiveCount(), 0);
  } finally {
    xuiActivityTracker.reset();
    await new Promise(resolve => server.close(resolve));
  }
}

/**
 * 验证原始订阅请求超时会返回可供刷新日志稳定分类的内部错误码。
 *
 * @returns {Promise<void>}
 */
async function testFetchOriginalSubscriptionShouldExposeStableTimeoutCode() {
  const service = new sharedSubscriptionService.SubscriptionService({ proxy: { enabled: false } });
  const server = http.createServer((req, res) => {
    setTimeout(() => res.end('late response'), 100);
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await assert.rejects(
      service.fetchOriginalSubscription(
        `http://127.0.0.1:${port}/sub/`,
        'token',
        { timeout: 10 }
      ),
      error => error.code === 'SUBSCRIPTION_FETCH_TIMEOUT'
        && error.message === '获取原始订阅超时: 10ms'
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

/**
 * 验证 Clash 订阅输出会正确展开 YAML 与 IPv6 地址。
 *
 * @returns {Promise<void>}
 */
async function testClashSubscriptionShouldRenderYaml() {
  const subscription = {
    sub_id: 'sub-token-2',
    email: 'user@example.com',
    enabled: 1,
    traffic_used: 0,
    traffic_limit: 0,
    expire_at: 0,
    nodes_data: JSON.stringify([
      {
        node_name: 'CF-Node',
        link: 'vless://11111111-1111-1111-1111-111111111111@[2606:4700:4700::1111]:443?encryption=none&security=tls&type=ws&host=cdn.example.com&path=%2Fws#CF-Node'
      }
    ])
  };

  const result = await subscriptionService.getSubscriptionContent(
    createFakeDb(subscription),
    'sub-token-2',
    { clash: '1' }
  );

  assert.strictEqual(result.contentType, 'text/yaml; charset=utf-8');
  assert.strictEqual(
    result.headers['Subscription-Userinfo'],
    'upload=0; download=0; total=0; expire=0'
  );
  assert.strictEqual(
    result.headers['Content-Disposition'],
    `attachment; filename*=UTF-8''${encodeURIComponent('天澜大陆')}`
  );
  assert.strictEqual(result.headers['Profile-Update-Interval'], '2');
  assert.ok(result.body.includes('type: vless'));
  assert.ok(result.body.includes('server: 2606:4700:4700::1111'));
  assert.ok(result.body.includes('Host: cdn.example.com'));
}

/**
 * 验证已绑定的有效家宽服务器在每次订阅请求中动态展示前缀。
 * 关键参数：缓存保持普通名称，家宽记录由假数据库返回；核心分支覆盖通用与 Clash 输出。
 *
 * @returns {Promise<void>}
 */
async function testActiveHomeRouteShouldDecorateSubscriptionFormats() {
  const link = 'vless://11111111-1111-1111-1111-111111111111@example.com:443?encryption=none&security=tls&type=ws#日本[4K]-hy2';
  const subscription = {
    user_id: 12,
    sub_id: 'home-token',
    email: 'user@example.com',
    enabled: 1,
    traffic_used: 0,
    traffic_limit: 1024,
    expire_at: 0,
    nodes_data: JSON.stringify([{ server_id: 8, server_name: '日本', node_name: '日本[4K]-hy2', link }])
  };
  const db = createHomeRoutingFakeDb(subscription,
    { home_plan_id: 3, home_expire_at: Math.floor(Date.now() / 1000) + 3600, home_status: 'normal', plan_type: 'home_ip', home_proxy_tag: 'home', home_proxy_id: 6 },
    { server_ids: '[8]', home_proxy_tag: 'home', last_sync_status: 'success' });

  const generic = await subscriptionService.getSubscriptionContent(db, 'home-token', {});
  assert.ok(Buffer.from(generic.body, 'base64').toString('utf8').includes('#' + encodeURIComponent('家宽落地-日本[4K]-hy2')));

  const clash = await subscriptionService.getSubscriptionContent(db, 'home-token', { clash: '1' });
  assert.ok(clash.body.includes('name: 家宽落地-日本[4K]-hy2'));
  assert.ok(clash.body.includes('      - 家宽落地-日本[4K]-hy2'));
  assert.ok(!subscription.nodes_data.includes('家宽落地-'));
}

/**
 * 验证关闭前缀开关后通用和 Clash 订阅均输出原始名称，绑定数据不变。
 * @returns {Promise<void>} 两种订阅格式都不添加家宽前缀。
 */
async function testDisabledHomeNodePrefixShouldKeepSubscriptionNames() {
  const nodeName = '日本[4K]-hy2';
  const subscription = {
    user_id: 12, sub_id: 'prefix-off-token', email: 'user@example.com', enabled: 1,
    traffic_used: 0, traffic_limit: 1024, expire_at: 0,
    nodes_data: JSON.stringify([{
      server_id: 8, server_name: '日本', node_name: nodeName,
      link: `vless://11111111-1111-1111-1111-111111111111@example.com:443?encryption=none#${encodeURIComponent(nodeName)}`
    }])
  };
  const entitlement = {
    home_plan_id: 3, home_expire_at: Math.floor(Date.now() / 1000) + 3600,
    home_status: 'normal', plan_type: 'home_ip', home_proxy_tag: 'home', home_proxy_id: 6
  };
  for (const prefixValue of [0, '0']) {
    const route = {
      server_ids: '[8]', home_proxy_tag: 'home', last_sync_status: 'success',
      show_home_node_prefix: prefixValue
    };
    const db = createHomeRoutingFakeDb(subscription, entitlement, route);
    const generic = await subscriptionService.getSubscriptionContent(db, 'prefix-off-token', {});
    assert.ok(Buffer.from(generic.body, 'base64').toString('utf8').endsWith(`#${encodeURIComponent(nodeName)}`));
    const clash = await subscriptionService.getSubscriptionContent(db, 'prefix-off-token', { clash: '1' });
    assert.ok(clash.body.includes(`name: ${nodeName}`));
    assert.ok(!clash.body.includes('家宽落地-'));
    assert.strictEqual(route.server_ids, '[8]');
  }
}

/**
 * 验证绑定范围、权益失效及解绑都会在现有缓存上即时反映。
 * 关键参数：两台服务器共用一份缓存；核心分支只命中绑定 ID，过期、未购买和解绑都恢复普通名称。
 * @returns {Promise<void>}
 */
async function testHomeRouteStateShouldDecorateOnlyBoundServers() {
  const baseNode = (serverId, name) => ({
    server_id: serverId,
    server_name: name,
    node_name: `${name}-direct`,
    link: `vless://11111111-1111-1111-1111-111111111111@example.com:443?encryption=none#${name}-direct`
  });
  const subscription = {
    user_id: 12, sub_id: 'state-token', email: 'user@example.com', enabled: 1,
    traffic_used: 0, traffic_limit: 1024, expire_at: 0,
    nodes_data: JSON.stringify([baseNode(8, '日本'), baseNode(9, '美国')])
  };
  const active = { home_plan_id: 3, home_expire_at: Math.floor(Date.now() / 1000) + 3600, home_status: 'normal', plan_type: 'home_ip', home_proxy_tag: 'home', home_proxy_id: 6 };
  const route = { server_ids: '[8]', home_proxy_tag: 'home', last_sync_status: 'success' };
  const scenarios = [
    { entitlement: active, route, expected: ['家宽落地-日本-direct', '美国-direct'] },
    { entitlement: { ...active, home_status: 'expired' }, route, expected: ['日本-direct', '美国-direct'] },
    { entitlement: { ...active, home_expire_at: Math.floor(Date.now() / 1000) - 1 }, route, expected: ['日本-direct', '美国-direct'] },
    { entitlement: undefined, route, expected: ['日本-direct', '美国-direct'] },
    { entitlement: { ...active, home_proxy_id: null }, route, expected: ['日本-direct', '美国-direct'] },
    { entitlement: active, route: undefined, expected: ['日本-direct', '美国-direct'] },
    { entitlement: active, route: { ...route, last_sync_status: 'failed' }, expected: ['日本-direct', '美国-direct'] }
  ];

  for (const scenario of scenarios) {
    const result = await subscriptionService.getSubscriptionContent(
      createHomeRoutingFakeDb(subscription, scenario.entitlement, scenario.route),
      'state-token', { clash: '1' }
    );
    const names = Array.from(result.body.split('proxy-groups:')[0].matchAll(/^  - name: (.+)$/gm), (match) => match[1]);
    assert.deepStrictEqual(names, scenario.expected);
  }
}

/**
 * 验证旧缓存按绑定服务器名称兼容匹配，且重复输出不会叠加前缀。
 * 核心分支：旧缓存没有 server_id，服务器虽离线仍应按已绑定记录识别。
 * @returns {Promise<void>}
 */
async function testLegacyHomeCacheShouldMatchBoundServerName() {
  const subscription = {
    user_id: 12, sub_id: 'legacy-home-token', email: 'user@example.com', enabled: 1,
    traffic_used: 0, traffic_limit: 1024, expire_at: 0,
    nodes_data: JSON.stringify([{
      server_name: '日本', node_name: '日本[4K]-hy2',
      link: 'vless://11111111-1111-1111-1111-111111111111@example.com:443?encryption=none#%E6%97%A5%E6%9C%AC%5B4K%5D-hy2'
    }])
  };
  const active = { home_plan_id: 3, home_expire_at: Math.floor(Date.now() / 1000) + 3600, home_status: 'normal', plan_type: 'home_ip', home_proxy_tag: 'home', home_proxy_id: 6 };
  const route = { server_ids: '[8]', home_proxy_tag: 'home', last_sync_status: 'success' };
  const db = createHomeRoutingFakeDb(subscription, active, route, [{ id: 8, name: '日本', status: 0 }]);
  const result = await subscriptionService.getSubscriptionContent(db, 'legacy-home-token', { clash: '1' });
  assert.ok(result.body.includes('name: 家宽落地-日本[4K]-hy2'));
  assert.ok(!result.body.includes('家宽落地-家宽落地-'));

  const duplicateNames = createHomeRoutingFakeDb(subscription, active, route, [
    { id: 8, name: '日本', status: 1 },
    { id: 9, name: '日本', status: 1 }
  ]);
  const ambiguous = await subscriptionService.getSubscriptionContent(duplicateNames, 'legacy-home-token', { clash: '1' });
  assert.ok(ambiguous.body.includes('name: 日本[4K]-hy2'));
  assert.ok(!ambiguous.body.includes('name: 家宽落地-日本[4K]-hy2'));

  const expired = createHomeRoutingFakeDb(subscription, { ...active, home_status: 'expired' }, route);
  const plain = await subscriptionService.getSubscriptionContent(expired, 'legacy-home-token', {});
  assert.ok(Buffer.from(plain.body, 'base64').toString('utf8').endsWith('#' + encodeURIComponent('日本[4K]-hy2')));
}

/**
 * 验证管理员原始节点名自带家宽字样时，解绑和过期均保留原始名称。
 * 核心分支：已绑定不重复加前缀；未绑定或权益过期时不改写缓存名称与通用链接备注。
 * @returns {Promise<void>}
 */
async function testAdminPrefixedNodeNameShouldRemainIntact() {
  const originalName = '家宽落地-日本[4K]-hy2';
  const subscription = {
    user_id: 12, sub_id: 'admin-name-token', email: 'user@example.com', enabled: 1,
    traffic_used: 0, traffic_limit: 1024, expire_at: 0,
    nodes_data: JSON.stringify([{
      server_id: 8, server_name: '家宽落地-日本', node_name: originalName,
      link: `vless://11111111-1111-1111-1111-111111111111@example.com:443?encryption=none#${encodeURIComponent(originalName)}`
    }])
  };
  const active = { home_plan_id: 3, home_expire_at: Math.floor(Date.now() / 1000) + 3600, home_status: 'normal', plan_type: 'home_ip', home_proxy_tag: 'home', home_proxy_id: 6 };
  const route = { server_ids: '[8]', home_proxy_tag: 'home', last_sync_status: 'success' };
  const scenarios = [
    { entitlement: active, route },
    { entitlement: active, route: undefined },
    { entitlement: { ...active, home_status: 'expired' }, route }
  ];
  for (const scenario of scenarios) {
    const db = createHomeRoutingFakeDb(subscription, scenario.entitlement, scenario.route);
    const generic = await subscriptionService.getSubscriptionContent(db, 'admin-name-token', {});
    assert.ok(Buffer.from(generic.body, 'base64').toString('utf8').endsWith(`#${encodeURIComponent(originalName)}`));
    const clash = await subscriptionService.getSubscriptionContent(db, 'admin-name-token', { clash: '1' });
    assert.ok(clash.body.includes(`name: ${originalName}`));
    assert.ok(!clash.body.includes('家宽落地-家宽落地-'));
  }
}

/**
 * 验证用户端订阅详情与内容输出使用相同的家宽服务器范围和到期判断。
 * 核心分支：一台已绑定、一台未绑定；权益到期后两台均恢复普通名称。
 * @returns {Promise<void>}
 */
async function testSubscriptionInfoShouldDecorateOnlyActiveHomeServers() {
  const originals = {
    findSubscriptionUserById: subscriptionRepository.findSubscriptionUserById,
    findLatestUserSubscription: subscriptionRepository.findLatestUserSubscription,
    listEnabledUserCfIps: subscriptionRepository.listEnabledUserCfIps,
    listOnlineServersForDisplay: subscriptionRepository.listOnlineServersForDisplay,
    listServerNodes: subscriptionRepository.listServerNodes
  };
  const user = {
    id: 12, email: 'user@example.com', sub_id: 'home-detail-token', enabled: 1,
    traffic_used: 0, traffic_limit: 1024, referral_traffic_limit: 0, expire_at: 0
  };
  const servers = [
    { id: 8, name: '日本', status: 1, api_url: 'https://jp.example.com', host: 'jp.example.com' },
    { id: 9, name: '美国', status: 1, api_url: 'https://us.example.com', host: 'us.example.com' }
  ];
  subscriptionRepository.findSubscriptionUserById = async () => user;
  subscriptionRepository.findLatestUserSubscription = async () => ({ id: 1 });
  subscriptionRepository.listEnabledUserCfIps = async () => [{ ip: '1.1.1.1' }];
  subscriptionRepository.listOnlineServersForDisplay = async () => servers;
  subscriptionRepository.listServerNodes = async () => [{
    inbound_id: 10, remark: 'hy2', port: 443, protocol: 'hysteria2',
    settings: JSON.stringify({ clients: [{ email: user.email, id: 'test-uuid' }] }),
    stream_settings: JSON.stringify({ network: 'udp', security: 'tls' })
  }];

  const active = { home_plan_id: 3, home_expire_at: Math.floor(Date.now() / 1000) + 3600, home_status: 'normal', plan_type: 'home_ip', home_proxy_tag: 'home', home_proxy_id: 6 };
  const route = { server_ids: '[8]', home_proxy_tag: 'home', last_sync_status: 'success' };
  try {
    const activeInfo = await subscriptionService.getSubscriptionInfo(
      createHomeRoutingFakeDb(undefined, active, route, servers), user.id
    );
    assert.deepStrictEqual(activeInfo.nodes.map((node) => node.node_name), [
      '家宽落地-日本[4K]-hy2', '美国[4K]-hy2'
    ]);

    const disabledInfo = await subscriptionService.getSubscriptionInfo(
      createHomeRoutingFakeDb(undefined, active, { ...route, show_home_node_prefix: false }, servers), user.id
    );
    assert.deepStrictEqual(disabledInfo.nodes.map((node) => node.node_name), [
      '日本[4K]-hy2', '美国[4K]-hy2'
    ]);
    const stringDisabledInfo = await subscriptionService.getSubscriptionInfo(
      createHomeRoutingFakeDb(undefined, active, { ...route, show_home_node_prefix: '0' }, servers), user.id
    );
    assert.deepStrictEqual(stringDisabledInfo.nodes.map((node) => node.node_name), [
      '日本[4K]-hy2', '美国[4K]-hy2'
    ]);

    servers[0].name = '家宽落地-日本';
    const prefixedServerInfo = await subscriptionService.getSubscriptionInfo(
      createHomeRoutingFakeDb(undefined, active, route, servers), user.id
    );
    assert.strictEqual(prefixedServerInfo.nodes[0].node_name, '家宽落地-日本[4K]-hy2');
    const prefixedExpiredInfo = await subscriptionService.getSubscriptionInfo(
      createHomeRoutingFakeDb(undefined, { ...active, home_status: 'expired' }, route, servers), user.id
    );
    assert.strictEqual(prefixedExpiredInfo.nodes[0].node_name, '家宽落地-日本[4K]-hy2');
    servers[0].name = '日本';

    const expiredInfo = await subscriptionService.getSubscriptionInfo(
      createHomeRoutingFakeDb(undefined, { ...active, home_status: 'expired' }, route, servers), user.id
    );
    assert.deepStrictEqual(expiredInfo.nodes.map((node) => node.node_name), [
      '日本[4K]-hy2', '美国[4K]-hy2'
    ]);

    const missingProxyInfo = await subscriptionService.getSubscriptionInfo(
      createHomeRoutingFakeDb(undefined, { ...active, home_proxy_id: null }, route, servers), user.id
    );
    assert.strictEqual(missingProxyInfo.nodes[0].node_name, '日本[4K]-hy2');

    servers[0].name = '家宽落地-日本';
    subscriptionRepository.listServerNodes = async () => [{
      inbound_id: 11, remark: 'cf', port: 443, protocol: 'vless',
      settings: JSON.stringify({ clients: [{ email: user.email, id: 'test-uuid' }] }),
      stream_settings: JSON.stringify({ network: 'ws', security: 'tls' })
    }];
    const cfInfo = await subscriptionService.getSubscriptionInfo(
      createHomeRoutingFakeDb(undefined, active, route, servers), user.id
    );
    assert.strictEqual(cfInfo.nodes[0].node_name, '家宽落地-日本[AI]-cf');
  } finally {
    Object.assign(subscriptionRepository, originals);
  }
}

/**
 * 验证 Clash hy2 节点会使用缓存中的端口范围，适配 LXC 等端口数量受限机器。
 *
 * @returns {void}
 */
function testClashHy2SubscriptionShouldUseCachedPortsRange() {
  const clash = subscriptionService.generateClashConfig([{
    node_name: '测试[4K]-hy2',
    link: 'hysteria2://secret@example.com:28905?security=tls&fp=chrome&alpn=h3&sni=example.com#hy2',
    hy2_ports: '40000-40010'
  }]);

  assert.ok(clash.includes('type: hysteria2'));
  assert.ok(clash.includes('ports: 40000-40010'));
  assert.ok(!clash.includes('ports: 40000-50000'));
}

/**
 * 验证 HY2 端口范围配置为 0-0 时，Clash 节点不输出 ports 字段。
 *
 * @returns {void}
 */
function testClashHy2SubscriptionShouldOmitPortsWhenDisabled() {
  const clash = subscriptionService.generateClashConfig([{
    node_name: '测试[4K]-hy2',
    link: 'hysteria2://secret@example.com:28905?security=tls&fp=chrome&alpn=h3&sni=example.com#hy2',
    hy2_ports: '0-0'
  }]);

  assert.ok(clash.includes('type: hysteria2'));
  assert.ok(clash.includes('port: 28905'));
  assert.ok(!clash.includes('\n    ports:'));
}

/**
 * 验证 HY2 端口范围配置为 0-0 时，通用订阅链接不输出 mport 参数。
 *
 * @returns {void}
 */
function testHy2StrategyShouldOmitMportWhenPortsDisabled() {
  const link = subscriptionStrategy.processNodeLink(
    'hysteria2://secret@example.com:28905?security=tls&mport=40000-50000&fp=chrome#hy2',
    'hy2',
    { hy2Ports: '0-0' }
  );

  assert.ok(link.startsWith('hysteria2://secret@example.com:28905?'));
  assert.ok(link.includes('security=tls'));
  assert.ok(!link.includes('mport='));
}

/**
 * 验证 CF 策略会为客户端侧补齐 Cloudflare 边缘 TLS 参数。
 *
 * @returns {void}
 */
function testCfStrategyShouldEnableTlsAndUseHostAsSni() {
  const link = subscriptionStrategy.processNodeLink(
    'vless://e4fa2b14-a7b7-4d8d-8006-2a12c5e625f7@us06.example.com:26315?encryption=none&security=none&type=ws&path=%2F7o8mknfqt6wcd82q#cf',
    'cf',
    {
      cfIp: '172.67.160.0',
      clientPort: 443,
      host: 'chus06.bidding.dpdns.org'
    }
  );

  const parsed = subscriptionStrategy.parseNodeLink(link);
  assert.strictEqual(parsed.params.security, 'tls');
  assert.strictEqual(parsed.params.sni, 'chus06.bidding.dpdns.org');
}

/**
 * 验证 Clash 订阅响应头会优先使用系统设置中的订阅配置。
 *
 * @returns {Promise<void>}
 */
async function testClashSubscriptionShouldUseSystemSettingsHeaders() {
  const subscription = {
    sub_id: 'sub-token-settings',
    email: 'user@example.com',
    enabled: 1,
    traffic_used: 1024,
    traffic_limit: 2048,
    expire_at: 1700000000,
    nodes_data: '[]'
  };

  const result = await subscriptionService.getSubscriptionContent(
    createFakeDb(subscription, {
      clash_config_name: '自定义订阅',
      clash_profile_update_interval: '6'
    }),
    'sub-token-settings',
    { clash: '1' }
  );

  assert.strictEqual(
    result.headers['Content-Disposition'],
    `attachment; filename*=UTF-8''${encodeURIComponent('自定义订阅')}`
  );
  assert.strictEqual(result.headers['Profile-Update-Interval'], '6');
  assert.strictEqual(
    result.headers['Subscription-Userinfo'],
    'upload=0; download=1024; total=2048; expire=1700000000'
  );
}

/**
 * 验证订阅响应头只使用当前套餐流量，不再叠加历史推广流量字段。
 *
 * @returns {Promise<void>}
 */
async function testSubscriptionHeaderShouldIgnoreReferralTrafficLimit() {
  const subscription = {
    sub_id: 'sub-token-referral-traffic',
    email: 'user@example.com',
    enabled: 1,
    traffic_used: 1024,
    traffic_limit: 2048,
    referral_traffic_limit: 4096,
    expire_at: 1700000000,
    nodes_data: '[]'
  };

  const result = await subscriptionService.getSubscriptionContent(
    createFakeDb(subscription),
    'sub-token-referral-traffic',
    {}
  );

  assert.strictEqual(
    result.headers['Subscription-Userinfo'],
    'upload=0; download=1024; total=2048; expire=1700000000'
  );
}

/**
 * 验证订阅配置缺失时管理端设置接口返回默认值。
 *
 * @returns {Promise<void>}
 */
async function testSystemSettingsSubscriptionDefaults() {
  const { db } = createSystemSettingsFakeDb();
  const config = await systemSettingsRouter.getSubscriptionConfig(db);

  assert.deepStrictEqual(config, {
    clash_config_name: '天涯大陆',
    clash_profile_update_interval: 2,
    telegram_channel_url: '',
    online_customer_service_url: ''
  });
}

/**
 * 验证保存订阅配置会写入两个系统设置键。
 *
 * @returns {Promise<void>}
 */
async function testSystemSettingsSubscriptionSave() {
  const { db, writes } = createSystemSettingsFakeDb();
  await systemSettingsRouter.saveSubscriptionConfig(db, {
    clash_config_name: '自定义订阅',
    clash_profile_update_interval: 6,
    telegram_channel_url: 'https://t.me/customChannel',
    online_customer_service_url: 'https://service.example.com/chat'
  });

  assert.strictEqual(writes.length, 4);
  assert.strictEqual(writes[0].params[0], 'clash_config_name');
  assert.strictEqual(writes[0].params[1], '自定义订阅');
  assert.strictEqual(writes[1].params[0], 'clash_profile_update_interval');
  assert.strictEqual(writes[1].params[1], '6');
  assert.strictEqual(writes[2].params[0], 'telegram_channel_url');
  assert.strictEqual(writes[2].params[1], 'https://t.me/customChannel');
  assert.strictEqual(writes[3].params[0], 'online_customer_service_url');
  assert.strictEqual(writes[3].params[1], 'https://service.example.com/chat');
}

/**
 * 验证禁用账号会返回旧接口业务异常。
 *
 * @returns {Promise<void>}
 */
function decodeSubscriptionBody(result) {
  return decodeURIComponent(Buffer.from(result.body, 'base64').toString('utf8'));
}

async function testDisabledSubscriptionShouldReturnFallbackNodes() {
  const subscription = {
    sub_id: 'sub-token-3',
    email: 'user@example.com',
    enabled: 0,
    disable_reason: 'admin',
    traffic_used: 0,
    traffic_limit: 0,
    expire_at: 0,
    nodes_data: '[]'
  };

  const result = await subscriptionService.getSubscriptionContent(
    createFakeDb(subscription),
    'sub-token-3',
    {}
  );

  const content = decodeSubscriptionBody(result);
  assert.strictEqual(result.contentType, 'text/plain; charset=utf-8');
  assert.ok(content.includes('官网地址'));
  assert.ok(content.includes('被管理员禁用'));
  assert.strictEqual(content.split('\n').length, 2);
}

async function testInvalidSubscriptionShouldReturnRegenerateFallbackNodes() {
  await assert.rejects(
    () => subscriptionService.getSubscriptionContent(
      createFakeDb(undefined),
      'missing-token',
      {}
    ),
    (error) => (
      error.isLegacyBusinessError
      && error.code === 2004
      && error.statusCode === 400
    )
  );
}

async function testMissingCacheActiveUserShouldReturnRegenerateFallbackNodes() {
  const result = await subscriptionService.getSubscriptionContent(
    createFakeDbWithUserSubscriptionId({
      sub_id: 'sub-token-active-missing-cache',
      email: 'active@example.com',
      enabled: 1,
      traffic_used: 0,
      traffic_limit: 10737418240,
      expire_at: 0,
      plan_type: 'lifetime'
    }),
    'sub-token-active-missing-cache',
    {}
  );

  const content = decodeSubscriptionBody(result);
  assert.ok(content.includes('官网地址'));
  assert.ok(content.includes('订阅链接已失效，请到官网重新生成'));
}

async function testMissingCacheExpiredUserShouldReturnRenewFallbackNodes() {
  const result = await subscriptionService.getSubscriptionContent(
    createFakeDbWithUserSubscriptionId({
      sub_id: 'sub-token-missing-cache',
      email: 'expired@example.com',
      enabled: 1,
      traffic_used: 0,
      traffic_limit: 10737418240,
      expire_at: 1,
      plan_type: 'timed'
    }),
    'sub-token-missing-cache',
    {}
  );

  const content = decodeSubscriptionBody(result);
  assert.ok(content.includes('官网地址'));
  assert.ok(content.includes('需要续费'));
  assert.ok(!content.includes('订阅链接已失效，请到官网重新生成'));
}

async function testExpiredSubscriptionShouldReturnRenewFallbackNodes() {
  const subscription = {
    sub_id: 'sub-token-expired',
    email: 'user@example.com',
    enabled: 1,
    traffic_used: 0,
    traffic_limit: 0,
    expire_at: 1,
    plan_type: 'timed',
    nodes_data: '[]'
  };

  const result = await subscriptionService.getSubscriptionContent(
    createFakeDb(subscription),
    'sub-token-expired',
    {}
  );

  const content = decodeSubscriptionBody(result);
  assert.ok(content.includes('官网地址'));
  assert.ok(content.includes('需要续费'));
}

async function testFallbackSubscriptionShouldRenderClashYaml() {
  const result = await subscriptionService.getSubscriptionContent(
    createFakeDbWithUserSubscriptionId({
      sub_id: 'clash-missing-cache',
      email: 'active@example.com',
      enabled: 1,
      traffic_used: 0,
      traffic_limit: 10737418240,
      expire_at: 0,
      plan_type: 'lifetime'
    }),
    'clash-missing-cache',
    { clash: '1' }
  );

  assert.strictEqual(result.contentType, 'text/yaml; charset=utf-8');
  assert.ok(result.body.includes('name: 官网地址'));
  assert.ok(result.body.includes('name: 订阅链接已失效，请到官网重新生成'));
  assert.ok(result.body.includes('type: vmess'));
}

/**
 * 验证管理端生成订阅时复用用户端增量流程，避免重新走旧全量拉取逻辑。
 *
 * @returns {Promise<void>}
 */
async function testAdminSubscriptionShouldReuseUserIncrementalGenerator() {
  const originalGenerateSubscription = subscriptionService.generateSubscription;
  const originalFindLatestUserSubscription = subscriptionRepository.findLatestUserSubscription;
  const fakeDb = {};
  const fakeLogger = {};
  let delegatedUserId = null;

  subscriptionService.generateSubscription = async (db, userId, logger) => {
    assert.strictEqual(db, fakeDb);
    assert.strictEqual(logger, fakeLogger);
    delegatedUserId = userId;
    return 'sub-token';
  };

  subscriptionRepository.findLatestUserSubscription = async (db, userId) => {
    assert.strictEqual(db, fakeDb);
    assert.strictEqual(userId, 9);
    return {
      nodes_data: JSON.stringify([
        { node_name: 'node-a' },
        { node_name: 'node-b' }
      ])
    };
  };

  try {
    const result = await adminUsersService.generateSubscription(fakeDb, 9, fakeLogger);

    assert.strictEqual(delegatedUserId, 9);
    assert.deepStrictEqual(result, {
      sub_id: 'sub-token',
      node_count: 2
    });
  } finally {
    subscriptionService.generateSubscription = originalGenerateSubscription;
    subscriptionRepository.findLatestUserSubscription = originalFindLatestUserSubscription;
  }
}

/**
 * 验证仅完成 CF 优选但尚未生成订阅时，不会提前暴露节点结果。
 *
 * @returns {Promise<void>}
 */
async function testSubscriptionInfoShouldHideNodesBeforeFirstGeneration() {
  const originals = {
    findSubscriptionUserById: subscriptionRepository.findSubscriptionUserById,
    findLatestUserSubscription: subscriptionRepository.findLatestUserSubscription,
    listEnabledUserCfIps: subscriptionRepository.listEnabledUserCfIps,
    listOnlineServersForDisplay: subscriptionRepository.listOnlineServersForDisplay
  };

  subscriptionRepository.findSubscriptionUserById = async () => ({
    id: 1,
    email: 'new-user@example.com',
    sub_id: 'new-user-sub-id',
    enabled: 1,
    traffic_used: 0,
    traffic_limit: 1024,
    referral_traffic_limit: 0,
    expire_at: 0
  });
  subscriptionRepository.findLatestUserSubscription = async () => undefined;
  subscriptionRepository.listEnabledUserCfIps = async () => [{ ip: '1.1.1.1' }];
  subscriptionRepository.listOnlineServersForDisplay = async () => {
    throw new Error('未生成订阅时不应查询节点');
  };

  try {
    const result = await subscriptionService.getSubscriptionInfo({}, 1);

    assert.strictEqual(result.cfOptimized, true);
    assert.strictEqual(result.subscriptionReady, false);
    assert.deepStrictEqual(result.nodes, []);
  } finally {
    Object.assign(subscriptionRepository, originals);
  }
}

/**
 * 验证公开订阅链接使用 32 位十六进制 ID，避免新用户继续拿到旧的 16 位链接。
 *
 * @returns {Promise<void>}
 */
async function testPublicSubscriptionIdShouldUse32HexChars() {
  const subId = subscriptionService.generatePublicSubscriptionId();

  assert.match(subId, /^[0-9a-f]{32}$/);
}

/** 入口必须先原子准备轮换，再由持久化任务服务执行第一次同步并返回完整成功结果。 */
async function testReplaceSubscriptionLinkShouldRunPersistedRotationTask() {
  const db = { name: 'fake-db' };
  const calls = [];
  const logger = { info() {}, warn() {} };
  const result = await subscriptionService.replaceSubscriptionLink(db, 7, logger, {
    dependencies: {
      rotationService: {
        async prepareRotation(actualDb, userId) {
          calls.push(['prepare', actualDb, userId]);
          return { taskId: 41, subId: 'new-public-token', serverIds: [1, 2], serverNames: ['东京', '香港'] };
        },
        async processRotationTask(actualDb, task, actualLogger) {
          calls.push(['handler', actualDb, task, actualLogger]);
          return { success: true, successfulServerIds: [1, 2], failedServerIds: [] };
        }
      },
      taskService: {
        async processTask(actualDb, task, handler) {
          calls.push(['processTask', actualDb, task]);
          return { success: true, handlerResult: await handler(task) };
        }
      }
    }
  });

  assert.deepStrictEqual(result, {
    subId: 'new-public-token',
    pendingServerIds: [],
    pendingServerNames: [],
    retryScheduled: false
  });
  assert.deepStrictEqual(calls[0], ['prepare', db, 7]);
  assert.deepStrictEqual(calls[1], ['processTask', db, {
    id: 41,
    user_id: 7,
    task_type: 'credential_rotation_sync',
    attempts: 0,
    payload_data: { user_id: 7, serverIds: [1, 2] }
  }]);
  assert.strictEqual(calls[2][0], 'handler');
  assert.strictEqual(calls[2][1], db);
  assert.deepStrictEqual(calls[2][2], calls[1][2]);
  assert.strictEqual(calls[2][3], logger);
}

/** 部分远端失败仍返回新 token，并把待重试服务器 ID 和名称交给前端。 */
async function testReplaceSubscriptionLinkShouldResolvePartialFailure() {
  const result = await subscriptionService.replaceSubscriptionLink({}, 7, { warn() {} }, {
    dependencies: {
      rotationService: {
        async prepareRotation() {
          return { taskId: 42, subId: 'new-public-token', serverIds: [1, 2, 3], serverNames: ['东京', '香港', '美国'] };
        },
        async processRotationTask() {
          return { success: false, successfulServerIds: [1], failedServerIds: [3, 2, 3] };
        }
      },
      taskService: {
        async processTask(db, task, handler) {
          return { success: false, final: false, handlerResult: await handler(task) };
        }
      }
    }
  });

  assert.deepStrictEqual(result, {
    subId: 'new-public-token',
    pendingServerIds: [3, 2],
    pendingServerNames: ['美国', '香港'],
    retryScheduled: true
  });
}

/** 首次任务领取/处理异常不能丢掉已提交任务，入口应把全部服务器报告为后台待重试。 */
async function testReplaceSubscriptionLinkShouldKeepAllServersPendingWhenTaskProcessingThrows() {
  const result = await subscriptionService.replaceSubscriptionLink({}, 7, { warn() {}, info() {} }, {
    dependencies: {
      rotationService: {
        async prepareRotation() {
          return { taskId: 43, subId: 'committed-token', serverIds: [3, 1, 3], serverNames: ['美国', '东京', '美国'] };
        },
        async processRotationTask() { throw new Error('不应在任务服务抛错后直接调用'); }
      },
      taskService: {
        async processTask() { throw new Error('领取任务失败'); }
      }
    }
  });

  assert.deepStrictEqual(result, {
    subId: 'committed-token',
    pendingServerIds: [3, 1],
    pendingServerNames: ['美国', '东京'],
    retryScheduled: true
  });
}

/** 本地原子准备失败必须原样拒绝，且不能尝试处理不存在的持久化任务。 */
async function testReplaceSubscriptionLinkShouldRejectPreparationFailure() {
  let processCalled = false;
  const failure = new Error('任务持久化失败');
  await assert.rejects(
    subscriptionService.replaceSubscriptionLink({}, 7, {}, {
      dependencies: {
        rotationService: {
          async prepareRotation() { throw failure; },
          async processRotationTask() { throw new Error('不应调用'); }
        },
        taskService: {
          async processTask() { processCalled = true; }
        }
      }
    }),
    error => error === failure
  );
  assert.strictEqual(processCalled, false);
}

/**
 * 验证用户 CF IP 查询只读取当前 cf_ip_pool 表真实存在的字段。
 *
 * @returns {Promise<void>}
 */
async function testUserCfIpQueriesShouldMatchCurrentSchema() {
  const fakeDb = {
    prepare(sql) {
      assert.ok(!sql.includes('cp.port'), 'SQL 不应读取不存在的 cp.port 字段');
      assert.ok(!sql.includes('cp.location'), 'SQL 不应读取不存在的 cp.location 字段');
      assert.ok(!sql.includes('port, location'), 'SQL 不应读取不存在的 port/location 字段');
      return {
        all() {
          return [];
        }
      };
    }
  };

  await userRepository.listUserCfIps(fakeDb, 1);
  await userRepository.findActiveCfIpsForUser(fakeDb, 1);
  await userRepository.findEnabledCfIpsByIds(fakeDb, [1, 2]);
}

/**
 * 验证同一个 3X-UI 服务器订阅返回多条同协议链接时，会按 inbound 特征选择 direct Reality 模板。
 *
 * @returns {Promise<void>}
 */
async function testSourceRefreshShouldPickInboundMatchedRealityLink() {
  const refreshSubscriptionSources = subscriptionService.__testables.refreshSubscriptionSources;
  const savedSources = [];
  const user = { id: 1, email: 'user@example.com' };
  const server = { id: 1, name: '测试', sub_url: 'https://xui.example/sub/' };
  const config = {
    user_id: 1,
    server_id: 1,
    inbound_id: 11,
    sub_id: 'shared-sub-id',
    uuid: 'a8c40026-06cd-4e53-98a2-af99f4c76971',
    remark: 'direct',
    protocol: 'vless',
    port: 443,
    settings: JSON.stringify({
      clients: [{
        email: 'user@example.com',
        id: 'a8c40026-06cd-4e53-98a2-af99f4c76971',
        subId: 'shared-sub-id'
      }]
    }),
    stream_settings: JSON.stringify({
      network: 'tcp',
      security: 'reality'
    })
  };
  const wsLink = 'vless://a8c40026-06cd-4e53-98a2-af99f4c76971@us00.bidding.dpdns.org:26015?encryption=none&security=none&type=ws&path=%2Fbypeaeifpd4akh9o#ws-node';
  const realityLink = 'vless://a8c40026-06cd-4e53-98a2-af99f4c76971@jp01.bidding.dpdns.org:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.amd.com&fp=chrome&pbk=c6AJu3vTFA3nacnnaGuS-3CxFNUcpAymqQTL7GFXSxg&sid=c5a3decc&type=tcp&headerType=none#direct';

  const originalUpsert = subscriptionRepository.upsertSubscriptionSource;
  subscriptionRepository.upsertSubscriptionSource = async (db, source) => savedSources.push(source);
  try {
    await refreshSubscriptionSources(
      {},
      user,
      [config],
      new Map([[1, server]]),
      { info() {}, warn() {}, error() {} },
      {
        fetchOriginalSubscription: async () => Buffer.from(`${wsLink}\n${realityLink}`).toString('base64')
      }
    );
  } finally {
    subscriptionRepository.upsertSubscriptionSource = originalUpsert;
  }

  assert.strictEqual(savedSources.length, 1);
  assert.strictEqual(savedSources[0].original_link, realityLink);

  const clash = subscriptionService.generateClashConfig([{
    node_name: '测试-direct',
    link: savedSources[0].original_link
  }]);
  assert.ok(clash.includes('flow: xtls-rprx-vision'));
  assert.ok(clash.includes('tls: true'));
  assert.ok(clash.includes('servername: www.amd.com'));
  assert.ok(clash.includes('client-fingerprint: chrome'));
  assert.ok(clash.includes('reality-opts:'));
  assert.ok(clash.includes('public-key: c6AJu3vTFA3nacnnaGuS-3CxFNUcpAymqQTL7GFXSxg'));
  assert.ok(clash.includes('short-id: "c5a3decc"'));
  assert.ok(clash.includes('network: tcp'));
  assert.ok(!clash.includes('ws-opts:'));
}

/**
 * 验证同一服务器同一 subId 的多个 inbound 只拉取一次原始订阅，避免并发重复请求 3X-UI。
 *
 * @returns {Promise<void>}
 */
async function testSourceRefreshShouldFetchSharedSubIdOnce() {
  const refreshSubscriptionSources = subscriptionService.__testables.refreshSubscriptionSources;
  const savedSources = [];
  const user = { id: 1, email: 'user@example.com' };
  const server = { id: 1, name: '测试', sub_url: 'https://xui.example/sub/' };
  const baseConfig = {
    user_id: 1,
    server_id: 1,
    sub_id: 'shared-sub-id',
    uuid: 'a8c40026-06cd-4e53-98a2-af99f4c76971',
    protocol: 'vless',
    settings: JSON.stringify({
      clients: [{
        email: 'user@example.com',
        id: 'a8c40026-06cd-4e53-98a2-af99f4c76971',
        subId: 'shared-sub-id'
      }]
    })
  };
  const configs = [
    {
      ...baseConfig,
      inbound_id: 1,
      remark: 'direct',
      port: 443,
      stream_settings: JSON.stringify({ network: 'tcp', security: 'reality' })
    },
    {
      ...baseConfig,
      inbound_id: 2,
      remark: 'ws',
      port: 26015,
      stream_settings: JSON.stringify({ network: 'ws', security: 'none' })
    },
    {
      ...baseConfig,
      inbound_id: 3,
      remark: 'direct-backup',
      port: 8443,
      stream_settings: JSON.stringify({ network: 'tcp', security: 'reality' })
    }
  ];
  const links = [
    'vless://a8c40026-06cd-4e53-98a2-af99f4c76971@jp01.bidding.dpdns.org:443?encryption=none&flow=xtls-rprx-vision&security=reality&type=tcp#direct',
    'vless://a8c40026-06cd-4e53-98a2-af99f4c76971@us00.bidding.dpdns.org:26015?encryption=none&security=none&type=ws&path=%2Fws#ws',
    'vless://a8c40026-06cd-4e53-98a2-af99f4c76971@jp02.bidding.dpdns.org:8443?encryption=none&flow=xtls-rprx-vision&security=reality&type=tcp#direct-backup'
  ];
  let fetchCount = 0;

  const originalUpsert = subscriptionRepository.upsertSubscriptionSource;
  subscriptionRepository.upsertSubscriptionSource = async (db, source) => savedSources.push(source);
  try {
    await refreshSubscriptionSources(
      {},
      user,
      configs,
      new Map([[1, server]]),
      { info() {}, warn() {}, error() {} },
      {
        fetchOriginalSubscription: async (subUrl, subId, options) => {
          fetchCount += 1;
          assert.strictEqual(options.timeout, 15000);
          return Buffer.from(links.join('\n')).toString('base64');
        }
      }
    );
  } finally {
    subscriptionRepository.upsertSubscriptionSource = originalUpsert;
  }

  assert.strictEqual(fetchCount, 1);
  assert.strictEqual(savedSources.length, 3);
  assert.deepStrictEqual(savedSources.map((source) => source.original_link), links);
}

/**
 * 验证原始订阅模板刷新失败时，日志会输出可定位的网络错误信息，且不会泄露订阅地址或 token。
 *
 * @returns {Promise<void>}
 */
async function testSourceRefreshShouldLogSanitizedNetworkErrorDetails() {
  const refreshSubscriptionSources = subscriptionService.__testables.refreshSubscriptionSources;
  const user = { id: 1, email: 'user@example.com' };
  const server = { id: 1, name: '测试节点', sub_url: 'https://panel.example.com/sub/' };
  const config = {
    user_id: 1,
    server_id: 1,
    inbound_id: 2,
    sub_id: 'sensitive-subscription-token',
    uuid: 'a8c40026-06cd-4e53-98a2-af99f4c76971',
    remark: 'direct',
    protocol: 'vless',
    settings: JSON.stringify({ clients: [] }),
    stream_settings: JSON.stringify({ network: 'tcp', security: 'reality' })
  };
  const warnings = [];
  const networkError = new Error(
    'connect ECONNREFUSED https://panel.example.com/sub/sensitive-subscription-token?secret=hidden'
  );
  networkError.code = 'ECONNREFUSED';

  const result = await refreshSubscriptionSources(
    {},
    user,
    [config],
    new Map([[1, server]]),
    { info() {}, warn: (message) => warnings.push(message), error() {} },
    {
      fetchOriginalSubscription: async () => {
        throw networkError;
      }
    }
  );

  assert.strictEqual(result.failedConfigs.length, 1);
  assert.ok(warnings.some((message) => message.includes('errorType=NetworkError')));
  assert.ok(warnings.some((message) => message.includes('errorCode=ECONNREFUSED')));
  assert.ok(warnings.some((message) => message.includes('errorMessage="连接被远端拒绝"')));
  assert.ok(warnings.every((message) => !message.includes('panel.example.com')));
  assert.ok(warnings.every((message) => !message.includes('sensitive-subscription-token')));
}

/**
 * 验证原始订阅请求超时会以稳定的内部错误码写入刷新失败日志。
 *
 * @returns {Promise<void>}
 */
async function testSourceRefreshShouldLogSubscriptionFetchTimeoutDetails() {
  const refreshSubscriptionSources = subscriptionService.__testables.refreshSubscriptionSources;
  const user = { id: 1, email: 'user@example.com' };
  const server = { id: 1, name: '测试节点', sub_url: 'https://panel.example.com/sub/' };
  const config = {
    user_id: 1,
    server_id: 1,
    inbound_id: 2,
    sub_id: 'sensitive-subscription-token',
    uuid: 'a8c40026-06cd-4e53-98a2-af99f4c76971',
    remark: 'direct',
    protocol: 'vless',
    settings: JSON.stringify({ clients: [] }),
    stream_settings: JSON.stringify({ network: 'tcp', security: 'reality' })
  };
  const warnings = [];
  const timeoutError = new Error('获取原始订阅超时: 15000ms');
  timeoutError.code = 'SUBSCRIPTION_FETCH_TIMEOUT';

  const result = await refreshSubscriptionSources(
    {},
    user,
    [config],
    new Map([[1, server]]),
    { info() {}, warn: (message) => warnings.push(message), error() {} },
    {
      fetchOriginalSubscription: async () => {
        throw timeoutError;
      }
    }
  );

  assert.strictEqual(result.failedConfigs.length, 1);
  assert.ok(warnings.some((message) => message.includes('errorType=SubscriptionFetchTimeout')));
  assert.ok(warnings.some((message) => message.includes('errorCode=SUBSCRIPTION_FETCH_TIMEOUT')));
  assert.ok(warnings.some((message) => message.includes('errorMessage="获取原始订阅超时: 15000ms"')));
}

/**
 * 验证历史误选的原始模板缓存会因 inbound 特征不匹配而自动刷新。
 *
 * @returns {Promise<void>}
 */
async function testGenerateSubscriptionShouldRefreshMismatchedSourceCache() {
  const originals = {
    findLatestUserSubscription: subscriptionRepository.findLatestUserSubscription,
    findSubscriptionUserById: subscriptionRepository.findSubscriptionUserById,
    listEnabledUserCfIps: subscriptionRepository.listEnabledUserCfIps,
    listOnlineServers: subscriptionRepository.listOnlineServers,
    listNodeSnapshots: subscriptionRepository.listNodeSnapshots,
    listUserNodeConfigs: subscriptionRepository.listUserNodeConfigs,
    listUserSubscriptionSources: subscriptionRepository.listUserSubscriptionSources,
    upsertSubscriptionSource: subscriptionRepository.upsertSubscriptionSource,
    saveUserSubscriptionCache: subscriptionRepository.saveUserSubscriptionCache
  };
  const wsLink = 'vless://a8c40026-06cd-4e53-98a2-af99f4c76971@us00.bidding.dpdns.org:26015?encryption=none&security=none&type=ws&path=%2Fbypeaeifpd4akh9o#ws-node';
  const realityLink = 'vless://a8c40026-06cd-4e53-98a2-af99f4c76971@jp01.bidding.dpdns.org:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.amd.com&fp=chrome&pbk=c6AJu3vTFA3nacnnaGuS-3CxFNUcpAymqQTL7GFXSxg&sid=c5a3decc&type=tcp&headerType=none#direct';
  const server = { id: 1, name: '测试', sub_url: 'https://xui.example/sub/', host: 'jp01.bidding.dpdns.org', client_port: 443 };
  const config = {
    user_id: 1,
    server_id: 1,
    inbound_id: 11,
    sub_id: 'shared-sub-id',
    uuid: 'a8c40026-06cd-4e53-98a2-af99f4c76971',
    remark: 'direct',
    protocol: 'vless',
    port: 443,
    settings: JSON.stringify({
      clients: [{
        email: 'user@example.com',
        id: 'a8c40026-06cd-4e53-98a2-af99f4c76971',
        subId: 'shared-sub-id'
      }]
    }),
    stream_settings: JSON.stringify({ network: 'tcp', security: 'reality' })
  };
  let fetchCount = 0;
  let savedNodes = [];
  let currentSources;

  subscriptionRepository.findLatestUserSubscription = async () => ({ id: 1 });
  subscriptionRepository.findSubscriptionUserById = async () => ({
    id: 1,
    email: 'user@example.com',
    sub_id: 'public-sub-id',
    enabled: 1,
    traffic_limit: 1024
  });
  subscriptionRepository.listEnabledUserCfIps = async () => [{ ip: '1.1.1.1' }];
  subscriptionRepository.listOnlineServers = async () => [server];
  subscriptionRepository.listNodeSnapshots = async () => [config];
  subscriptionRepository.listUserNodeConfigs = async () => [config];
  currentSources = [{
    user_id: 1,
    server_id: 1,
    inbound_id: 11,
    sub_id: 'shared-sub-id',
    original_link: wsLink,
    node_fingerprint: require('../services/shared/subscription-cache-service').computeNodeFingerprint(config),
    server_fingerprint: require('../services/shared/subscription-cache-service').computeServerFingerprint(server),
    fetched_at: Math.floor(Date.now() / 1000)
  }];
  subscriptionRepository.listUserSubscriptionSources = async () => currentSources;
  subscriptionRepository.upsertSubscriptionSource = async (db, source) => {
    currentSources = [source];
  };
  subscriptionRepository.saveUserSubscriptionCache = async (db, userId, subId, nodes) => {
    savedNodes = nodes;
  };

  try {
    await subscriptionService.generateSubscription({}, 1, { info() {}, warn() {}, error() {} }, {
      dependencies: {
        fetchOriginalSubscription: async () => {
          fetchCount += 1;
          return Buffer.from(`${wsLink}\n${realityLink}`).toString('base64');
        }
      }
    });
  } finally {
    Object.assign(subscriptionRepository, originals);
  }

  assert.strictEqual(fetchCount, 1);
  assert.strictEqual(savedNodes.length, 1);
  assert.strictEqual(savedNodes[0].server_id, 1);
  assert.strictEqual(savedNodes[0].node_name, '测试-direct');
  assert.ok(savedNodes[0].link.includes('flow=xtls-rprx-vision'));
  assert.ok(savedNodes[0].link.includes('security=reality'));
  assert.ok(!savedNodes[0].link.includes('type=ws'));
}

/**
 * 验证生成订阅时仍刷新失败的原始模板会进入后台重试队列。
 *
 * @returns {Promise<void>}
 */
async function testGenerateSubscriptionShouldQueueFailedSourceRefreshRetry() {
  const originals = {
    findLatestUserSubscription: subscriptionRepository.findLatestUserSubscription,
    findSubscriptionUserById: subscriptionRepository.findSubscriptionUserById,
    listEnabledUserCfIps: subscriptionRepository.listEnabledUserCfIps,
    listOnlineServers: subscriptionRepository.listOnlineServers,
    listNodeSnapshots: subscriptionRepository.listNodeSnapshots,
    listUserNodeConfigs: subscriptionRepository.listUserNodeConfigs,
    listUserSubscriptionSources: subscriptionRepository.listUserSubscriptionSources,
    upsertSubscriptionSource: subscriptionRepository.upsertSubscriptionSource,
    saveUserSubscriptionCache: subscriptionRepository.saveUserSubscriptionCache,
    enqueueTask: xuiSyncTaskService.enqueueTask
  };
  const goodLink = 'vless://a8c40026-06cd-4e53-98a2-af99f4c76971@good.example.com:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.amd.com&fp=chrome&pbk=c6AJu3vTFA3nacnnaGuS-3CxFNUcpAymqQTL7GFXSxg&sid=c5a3decc&type=tcp&headerType=none#good';
  const server = { id: 1, name: '测试', sub_url: 'https://xui.example/sub/', host: 'good.example.com', client_port: 443 };
  const configs = [
    {
      user_id: 7,
      server_id: 1,
      inbound_id: 11,
      sub_id: 'good-sub-id',
      uuid: 'a8c40026-06cd-4e53-98a2-af99f4c76971',
      remark: 'direct-good',
      protocol: 'vless',
      port: 443,
      settings: JSON.stringify({ clients: [{ email: 'user@example.com', id: 'a8c40026-06cd-4e53-98a2-af99f4c76971', subId: 'good-sub-id' }] }),
      stream_settings: JSON.stringify({ network: 'tcp', security: 'reality' })
    },
    {
      user_id: 7,
      server_id: 1,
      inbound_id: 12,
      sub_id: 'bad-sub-id',
      uuid: 'b8c40026-06cd-4e53-98a2-af99f4c76972',
      remark: 'direct-bad',
      protocol: 'vless',
      port: 443,
      settings: JSON.stringify({ clients: [{ email: 'user@example.com', id: 'b8c40026-06cd-4e53-98a2-af99f4c76972', subId: 'bad-sub-id' }] }),
      stream_settings: JSON.stringify({ network: 'tcp', security: 'reality' })
    }
  ];
  const enqueuedTasks = [];
  let currentSources = [];
  let savedNodes = [];

  subscriptionRepository.findLatestUserSubscription = async () => ({ id: 1 });
  subscriptionRepository.findSubscriptionUserById = async () => ({
    id: 7,
    email: 'user@example.com',
    sub_id: 'public-sub-id',
    enabled: 1,
    traffic_limit: 1024
  });
  subscriptionRepository.listEnabledUserCfIps = async () => [{ ip: '1.1.1.1' }];
  subscriptionRepository.listOnlineServers = async () => [server];
  subscriptionRepository.listNodeSnapshots = async () => configs;
  subscriptionRepository.listUserNodeConfigs = async () => configs;
  subscriptionRepository.listUserSubscriptionSources = async () => currentSources;
  subscriptionRepository.upsertSubscriptionSource = async (db, source) => {
    currentSources = currentSources
      .filter((item) => item.server_id !== source.server_id || item.inbound_id !== source.inbound_id)
      .concat(source);
  };
  subscriptionRepository.saveUserSubscriptionCache = async (db, userId, subId, nodes) => {
    savedNodes = nodes;
  };
  xuiSyncTaskService.enqueueTask = async (db, task) => {
    enqueuedTasks.push(task);
    return 99;
  };

  try {
    await subscriptionService.generateSubscription({}, 7, { info() {}, warn() {}, error() {} }, {
      dependencies: {
        fetchOriginalSubscription: async (subUrl, subId) => {
          if (subId === 'bad-sub-id') {
            throw new Error('source timeout');
          }
          return Buffer.from(goodLink).toString('base64');
        }
      }
    });
  } finally {
    Object.assign(subscriptionRepository, originals);
    xuiSyncTaskService.enqueueTask = originals.enqueueTask;
  }

  assert.strictEqual(savedNodes.length, 1);
  assert.strictEqual(enqueuedTasks.length, 1);
  assert.strictEqual(enqueuedTasks[0].userId, 7);
  assert.strictEqual(enqueuedTasks[0].taskType, 'subscription_source_refresh');
  assert.deepStrictEqual(enqueuedTasks[0].payload.configs, [{ server_id: 1, inbound_id: 12 }]);
}

/**
 * 验证后台模板重试成功后会重新执行完整订阅生成并保存用户订阅缓存。
 *
 * @returns {Promise<void>}
 */
async function testSourceRefreshRetryShouldRegenerateSubscriptionCache() {
  const originals = {
    findLatestUserSubscription: subscriptionRepository.findLatestUserSubscription,
    findSubscriptionUserById: subscriptionRepository.findSubscriptionUserById,
    listEnabledUserCfIps: subscriptionRepository.listEnabledUserCfIps,
    listOnlineServers: subscriptionRepository.listOnlineServers,
    listNodeSnapshots: subscriptionRepository.listNodeSnapshots,
    listUserNodeConfigs: subscriptionRepository.listUserNodeConfigs,
    listUserSubscriptionSources: subscriptionRepository.listUserSubscriptionSources,
    upsertSubscriptionSource: subscriptionRepository.upsertSubscriptionSource,
    saveUserSubscriptionCache: subscriptionRepository.saveUserSubscriptionCache
  };
  const { computeNodeFingerprint, computeServerFingerprint } = require('../services/shared/subscription-cache-service');
  const link = 'vless://b8c40026-06cd-4e53-98a2-af99f4c76972@good.example.com:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.amd.com&fp=chrome&pbk=c6AJu3vTFA3nacnnaGuS-3CxFNUcpAymqQTL7GFXSxg&sid=c5a3decc&type=tcp&headerType=none#retry';
  const server = {
    id: 1,
    name: '测试',
    sub_url: 'https://xui.example/sub/',
    host: 'good.example.com',
    client_port: 443
  };
  const config = {
    user_id: 7,
    server_id: 1,
    inbound_id: 12,
    sub_id: 'bad-sub-id',
    uuid: 'b8c40026-06cd-4e53-98a2-af99f4c76972',
    remark: 'direct-bad',
    protocol: 'vless',
    port: 443,
    settings: JSON.stringify({
      clients: [{
        email: 'user@example.com-direct-bad',
        id: 'b8c40026-06cd-4e53-98a2-af99f4c76972',
        subId: 'bad-sub-id'
      }]
    }),
    stream_settings: JSON.stringify({ network: 'tcp', security: 'reality' })
  };
  let currentSources = [];
  let savedNodes = [];

  subscriptionRepository.findLatestUserSubscription = async () => ({ id: 1 });
  subscriptionRepository.findSubscriptionUserById = async () => ({
    id: 7,
    email: 'user@example.com',
    sub_id: 'public-sub-id',
    enabled: 1,
    traffic_limit: 1024
  });
  subscriptionRepository.listEnabledUserCfIps = async () => [{ ip: '1.1.1.1' }];
  subscriptionRepository.listOnlineServers = async () => [server];
  subscriptionRepository.listNodeSnapshots = async () => [config];
  subscriptionRepository.listUserNodeConfigs = async () => [config];
  subscriptionRepository.listUserSubscriptionSources = async () => currentSources;
  subscriptionRepository.upsertSubscriptionSource = async (db, source) => {
    currentSources = [{
      ...source,
      node_fingerprint: computeNodeFingerprint(config),
      server_fingerprint: computeServerFingerprint(server),
      fetched_at: Math.floor(Date.now() / 1000)
    }];
  };
  subscriptionRepository.saveUserSubscriptionCache = async (db, userId, subId, nodes) => {
    savedNodes = nodes;
  };

  try {
    const result = await subscriptionService.retrySubscriptionSourceRefreshTask(
      {},
      {
        user_id: 7,
        payload_data: {
          configs: [{ server_id: 1, inbound_id: 12 }]
        }
      },
      { info() {}, warn() {}, error() {} },
      {
        fetchOriginalSubscription: async () => Buffer.from(link).toString('base64')
      }
    );

    assert.equal(result.success, true);
    assert.equal(savedNodes.length, 1);
    assert.equal(savedNodes[0].original_link, link);
    assert.ok(savedNodes[0].link.includes('flow=xtls-rprx-vision'));
  } finally {
    Object.assign(subscriptionRepository, originals);
  }
}

/**
 * 验证 hy2 原始模板刷新成功后不会被 vless 的 streamSettings 匹配规则误判为不可复用。
 *
 * @returns {Promise<void>}
 */
async function testGenerateSubscriptionShouldKeepRefreshedHy2SourceCache() {
  const originals = {
    findLatestUserSubscription: subscriptionRepository.findLatestUserSubscription,
    findSubscriptionUserById: subscriptionRepository.findSubscriptionUserById,
    listEnabledUserCfIps: subscriptionRepository.listEnabledUserCfIps,
    listOnlineServers: subscriptionRepository.listOnlineServers,
    listNodeSnapshots: subscriptionRepository.listNodeSnapshots,
    listUserNodeConfigs: subscriptionRepository.listUserNodeConfigs,
    listUserSubscriptionSources: subscriptionRepository.listUserSubscriptionSources,
    upsertSubscriptionSource: subscriptionRepository.upsertSubscriptionSource,
    saveUserSubscriptionCache: subscriptionRepository.saveUserSubscriptionCache
  };
  const { computeNodeFingerprint, computeServerFingerprint } = require('../services/shared/subscription-cache-service');
  const hy2Link = 'hysteria2://ps6ne77kxinlotaz@us00.bidding.dpdns.org:32458?security=tls&fp=chrome&alpn=h3&sni=us00.bidding.dpdns.org#hy2';
  const server = { id: 2, name: '测试', sub_url: 'https://xui.example/sub/', host: 'us00.bidding.dpdns.org', client_port: 443, hy2_ports: '40000-40010' };
  const config = {
    user_id: 1,
    server_id: 2,
    inbound_id: 3,
    sub_id: 'shared-sub-id',
    uuid: '',
    auth: 'ps6ne77kxinlotaz',
    remark: 'hy2',
    protocol: 'hysteria2',
    port: 32458,
    settings: JSON.stringify({
      clients: [{
        email: 'user@example.com',
        password: 'ps6ne77kxinlotaz',
        subId: 'shared-sub-id'
      }]
    }),
    stream_settings: JSON.stringify({ network: 'tcp', security: 'reality' })
  };
  let fetchCount = 0;
  let savedNodes = [];
  let currentSources = [];

  subscriptionRepository.findLatestUserSubscription = async () => ({ id: 1 });
  subscriptionRepository.findSubscriptionUserById = async () => ({
    id: 1,
    email: 'user@example.com',
    sub_id: 'public-sub-id',
    enabled: 1,
    traffic_limit: 1024
  });
  subscriptionRepository.listEnabledUserCfIps = async () => [{ ip: '1.1.1.1' }];
  subscriptionRepository.listOnlineServers = async () => [server];
  subscriptionRepository.listNodeSnapshots = async () => [config];
  subscriptionRepository.listUserNodeConfigs = async () => [config];
  subscriptionRepository.listUserSubscriptionSources = async () => currentSources;
  subscriptionRepository.upsertSubscriptionSource = async (db, source) => {
    currentSources = [{
      ...source,
      node_fingerprint: computeNodeFingerprint(config),
      server_fingerprint: computeServerFingerprint(server),
      fetched_at: Math.floor(Date.now() / 1000)
    }];
  };
  subscriptionRepository.saveUserSubscriptionCache = async (db, userId, subId, nodes) => {
    savedNodes = nodes;
  };

  try {
    await subscriptionService.generateSubscription({}, 1, { info() {}, warn() {}, error() {} }, {
      dependencies: {
        fetchOriginalSubscription: async () => {
          fetchCount += 1;
          return Buffer.from(hy2Link).toString('base64');
        }
      }
    });
  } finally {
    Object.assign(subscriptionRepository, originals);
  }

  assert.strictEqual(fetchCount, 1);
  assert.strictEqual(savedNodes.length, 1);
  assert.strictEqual(savedNodes[0].server_id, 2);
  assert.strictEqual(savedNodes[0].node_name, '测试[4K]-hy2');
  assert.strictEqual(savedNodes[0].hy2_ports, '40000-40010');
  assert.ok(savedNodes[0].link.startsWith('hysteria2://ps6ne77kxinlotaz@us00.bidding.dpdns.org:32458?'));
  assert.ok(savedNodes[0].link.includes('mport=40000-40010'));
  assert.ok(!savedNodes[0].link.includes('mport=40000-50000'));
  assert.ok(savedNodes[0].link.includes('security=tls'));
  assert.ok(savedNodes[0].link.includes('alpn=h3'));
}

/**
 * 验证节点名称会按 remark 策略在服务器名后追加显示标识。
 *
 * @returns {void}
 */
function testSubscriptionNodeNameShouldIncludeStrategyBadge() {
  const { buildSubscriptionNodeName } = subscriptionService.__testables;

  assert.strictEqual(
    buildSubscriptionNodeName({ name: '测试' }, 'cf', 1),
    '测试[AI]-cf-1'
  );
  assert.strictEqual(
    buildSubscriptionNodeName({ name: '测试' }, 'hy2'),
    '测试[4K]-hy2'
  );
  assert.strictEqual(
    buildSubscriptionNodeName({ name: '测试' }, 'direct'),
    '测试-direct'
  );
}

/**
 * 验证未完成极速通道优选时，订阅生成返回面向用户的新提示文案。
 *
 * @returns {Promise<void>}
 */
async function testGenerateSubscriptionShouldAskForSpeedChannelOptimization() {
  const originals = {
    findLatestUserSubscription: subscriptionRepository.findLatestUserSubscription,
    findSubscriptionUserById: subscriptionRepository.findSubscriptionUserById,
    listEnabledUserCfIps: subscriptionRepository.listEnabledUserCfIps
  };

  subscriptionRepository.findLatestUserSubscription = async () => undefined;
  subscriptionRepository.findSubscriptionUserById = async () => ({
    id: 1,
    email: 'user@example.com',
    enabled: 1,
    expired_at: Math.floor(Date.now() / 1000) + 3600,
    traffic_used: 0,
    traffic_limit: 1024
  });
  subscriptionRepository.listEnabledUserCfIps = async () => [];

  try {
    await assert.rejects(
      subscriptionService.generateSubscription({}, 1, { info() {}, warn() {}, error() {} }),
      error => error.code === 3001 && error.message === '请先完成极速通道优选'
    );
  } finally {
    Object.assign(subscriptionRepository, originals);
  }
}

/**
 * 验证后台订阅拉取先等待前台空闲，HTTP 失败后也释放活动计数。
 * @returns {Promise<void>} 请求结束且追踪器恢复原状态后完成。
 */
async function testBackgroundSubscriptionWaitsAndReleasesActivityAfterFailure() {
  const service = new sharedSubscriptionService.SubscriptionService({ proxy: { enabled: false } });
  const originalWait = xuiActivityTracker.waitForForegroundIdle;
  const observedCounts = [];
  let waited = false;
  let releaseIdle;
  const gate = new Promise(resolve => { releaseIdle = resolve; });
  const server = http.createServer((request, response) => {
    observedCounts.push(xuiActivityTracker.getActiveCount());
    response.writeHead(503);
    response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  xuiActivityTracker.reset();
  xuiActivityTracker.waitForForegroundIdle = async () => { waited = true; await gate; };
  let pending;
  try {
    pending = xuiActivityTracker.runAsBackground(() => service.fetchOriginalSubscription(
      `http://127.0.0.1:${server.address().port}/sub/`, 'token', { timeout: 1000 }
    ));
    assert.strictEqual(waited, true);
    assert.deepStrictEqual(observedCounts, []);
    assert.strictEqual(xuiActivityTracker.getActiveCount(), 0);
    releaseIdle();
    await assert.rejects(pending, { message: '获取原始订阅失败，HTTP 状态码: 503' });
    assert.deepStrictEqual(observedCounts, [1]);
    assert.strictEqual(xuiActivityTracker.getBackgroundRequestCount(), 1);
    assert.strictEqual(xuiActivityTracker.getActiveCount(), 0);
  } finally {
    releaseIdle();
    if (pending) await pending.catch(() => {});
    xuiActivityTracker.waitForForegroundIdle = originalWait;
    xuiActivityTracker.reset();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

async function run() {
  let rotationFailures = 0;
  for (const test of [testMergeReplacesOnlySuccessfulServerNodes, testAllServersFailKeepsWholeBaselineUnderNewToken,
    testCacheMergeAlwaysUsesLatestUserToken, testInterleavedTasksDoNotLosePreviouslyMergedServer,
    testSourceFailurePreservesWholeServerAndOtherServerCanMerge, testInvalidComposedNodesKeepOldSourcesAndCache,
    testChangedInboundSetIsRetriedWithoutPublishingPartialNodes, testCacheWriteFailureRollsBackSourcesAndPreservesBaseline,
    testCredentialsChangedDuringFetchPreserveCurrentBaseline, testExpectedRemoteRevisionRejectsCredentialsChangedBeforeFetch,
    testHistoricalConfigWithoutSnapshotDoesNotBlockCurrentInbound, testRotationVlessSourceRejectsStaleUuid,
    testRotationVmessSourceRejectsStaleUuid, testRotationStandardVmessSourceValidatesDecodedUuid,
    testRotationTrojanSourceRejectsStalePassword, testRotationHysteriaSourceRejectsStaleAuth,
    testRotationHysteriaAliasAcceptsCurrentAuth, testRotationSourceFailureLogIncludesEmailAndSafeReason]) {
    try { await test(); console.log(`PASS ${test.name}`); }
    catch (error) { rotationFailures++; console.error(`FAIL ${test.name}: ${error.message}`); }
  }
  assert.strictEqual(rotationFailures, 0, '轮换缓存行为存在失败');
  await testDefaultSubscriptionContentShouldReturnBase64AndUserinfo();
  await testFetchOriginalSubscriptionShouldTrackForegroundWithoutBackgroundCooldown();
  await testFetchOriginalSubscriptionShouldExposeStableTimeoutCode();
  await testBackgroundSubscriptionWaitsAndReleasesActivityAfterFailure();
  await testClashSubscriptionShouldRenderYaml();
  await testActiveHomeRouteShouldDecorateSubscriptionFormats();
  await testDisabledHomeNodePrefixShouldKeepSubscriptionNames();
  await testHomeRouteStateShouldDecorateOnlyBoundServers();
  await testLegacyHomeCacheShouldMatchBoundServerName();
  await testAdminPrefixedNodeNameShouldRemainIntact();
  await testSubscriptionInfoShouldDecorateOnlyActiveHomeServers();
  testClashHy2SubscriptionShouldUseCachedPortsRange();
  testClashHy2SubscriptionShouldOmitPortsWhenDisabled();
  testHy2StrategyShouldOmitMportWhenPortsDisabled();
  testCfStrategyShouldEnableTlsAndUseHostAsSni();
  await testClashSubscriptionShouldUseSystemSettingsHeaders();
  await testSubscriptionHeaderShouldIgnoreReferralTrafficLimit();
  await testSystemSettingsSubscriptionDefaults();
  await testSystemSettingsSubscriptionSave();
  await testDisabledSubscriptionShouldReturnFallbackNodes();
  await testInvalidSubscriptionShouldReturnRegenerateFallbackNodes();
  await testMissingCacheActiveUserShouldReturnRegenerateFallbackNodes();
  await testMissingCacheExpiredUserShouldReturnRenewFallbackNodes();
  await testExpiredSubscriptionShouldReturnRenewFallbackNodes();
  await testFallbackSubscriptionShouldRenderClashYaml();
  await testAdminSubscriptionShouldReuseUserIncrementalGenerator();
  await testSubscriptionInfoShouldHideNodesBeforeFirstGeneration();
  await testPublicSubscriptionIdShouldUse32HexChars();
  await testReplaceSubscriptionLinkShouldRunPersistedRotationTask();
  await testReplaceSubscriptionLinkShouldResolvePartialFailure();
  await testReplaceSubscriptionLinkShouldKeepAllServersPendingWhenTaskProcessingThrows();
  await testReplaceSubscriptionLinkShouldRejectPreparationFailure();
  await testUserCfIpQueriesShouldMatchCurrentSchema();
  await testSourceRefreshShouldPickInboundMatchedRealityLink();
  await testSourceRefreshShouldFetchSharedSubIdOnce();
  await testSourceRefreshShouldLogSubscriptionFetchTimeoutDetails();
  await testSourceRefreshShouldLogSanitizedNetworkErrorDetails();
  await testGenerateSubscriptionShouldRefreshMismatchedSourceCache();
  await testGenerateSubscriptionShouldQueueFailedSourceRefreshRetry();
  await testSourceRefreshRetryShouldRegenerateSubscriptionCache();
  await testGenerateSubscriptionShouldKeepRefreshedHy2SourceCache();
  testSubscriptionNodeNameShouldIncludeStrategyBadge();
  await testGenerateSubscriptionShouldAskForSpeedChannelOptimization();
  console.log('user subscription service tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
