const assert = require('assert');
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
    const content = await sharedSubscriptionService.fetchOriginalSubscription(
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

/**
 * 验证更换订阅链接只替换用户级 sub_id 并复用现有节点缓存，不触发全量订阅生成。
 *
 * @returns {Promise<void>}
 */
async function testReplaceSubscriptionLinkShouldInvalidateOldCacheAndRegenerate() {
  const originals = {
    findSubscriptionUserById: subscriptionRepository.findSubscriptionUserById,
    findLatestUserSubscription: subscriptionRepository.findLatestUserSubscription,
    replaceUserSubscriptionId: subscriptionRepository.replaceUserSubscriptionId,
    deleteUserSubscriptionCaches: subscriptionRepository.deleteUserSubscriptionCaches,
    saveUserSubscriptionCache: subscriptionRepository.saveUserSubscriptionCache
  };
  const calls = [];
  const logs = [];
  const nodes = [{ node_name: 'node-a', link: 'vless://node-a' }];

  subscriptionRepository.findSubscriptionUserById = async () => ({
    id: 7,
    email: 'replace@example.com',
    sub_id: 'old-sub-id',
    enabled: 1,
    traffic_used: 0,
    traffic_limit: 1024,
    referral_traffic_limit: 0,
    expire_at: 0
  });
  subscriptionRepository.findLatestUserSubscription = async (db, userId) => {
    calls.push(['findLatestUserSubscription', db, userId]);
    return {
      nodes_data: JSON.stringify(nodes)
    };
  };
  subscriptionRepository.replaceUserSubscriptionId = async (db, userId, subId) => {
    calls.push(['replaceUserSubscriptionId', db, userId, subId]);
  };
  subscriptionRepository.deleteUserSubscriptionCaches = async (db, userId) => {
    calls.push(['deleteUserSubscriptionCaches', db, userId]);
  };
  subscriptionRepository.saveUserSubscriptionCache = async (db, userId, subId, savedNodes) => {
    calls.push(['saveUserSubscriptionCache', db, userId, subId, savedNodes]);
  };

  try {
    const db = { name: 'fake-db' };
    const logger = {
      info(message) {
        logs.push(message);
      }
    };
    const result = await subscriptionService.replaceSubscriptionLink(db, 7, logger, {
      dependencies: {
        generatePublicSubscriptionId: () => '1234567890abcdef1234567890abcdef',
        generateSubscription: async () => {
          throw new Error('更换订阅链接不应触发全量订阅生成');
        }
      }
    });

    assert.strictEqual(result, '1234567890abcdef1234567890abcdef');
    assert.deepStrictEqual(calls, [
      ['findLatestUserSubscription', db, 7],
      ['replaceUserSubscriptionId', db, 7, '1234567890abcdef1234567890abcdef'],
      ['deleteUserSubscriptionCaches', db, 7],
      ['saveUserSubscriptionCache', db, 7, '1234567890abcdef1234567890abcdef', nodes]
    ]);
    assert.deepStrictEqual(logs, [
      '用户 replace@example.com 更换订阅链接成功，复用 1 个本地节点缓存'
    ]);
  } finally {
    Object.assign(subscriptionRepository, originals);
  }
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

async function run() {
  await testDefaultSubscriptionContentShouldReturnBase64AndUserinfo();
  await testFetchOriginalSubscriptionShouldTrackForegroundWithoutBackgroundCooldown();
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
  await testReplaceSubscriptionLinkShouldInvalidateOldCacheAndRegenerate();
  await testUserCfIpQueriesShouldMatchCurrentSchema();
  await testSourceRefreshShouldPickInboundMatchedRealityLink();
  await testSourceRefreshShouldFetchSharedSubIdOnce();
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
