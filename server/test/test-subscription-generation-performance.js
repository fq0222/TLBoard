const assert = require('assert');
const http = require('http');
const sharedSubscriptionService = require('../services/shared/subscription-service');
const XuiApiClientV302 = require('../integrations/xui/xui-api-client-v302');
const XuiService = require('../integrations/xui/xui-service');
const xuiSync = require('../integrations/xui/xui-sync');
const userSubscriptionService = require('../services/user/subscription-service');
const orderService = require('../services/shared/order-service');
const xuiNodeSnapshotService = require('../services/shared/xui-node-snapshot-service');
const xuiSyncRepository = require('../repositories/xui-sync-repository');
const orderRepository = require('../repositories/order-repository');
const subscriptionRepository = require('../repositories/subscription-repository');
const {
  computeNodeFingerprint,
  computeServerFingerprint
} = require('../services/shared/subscription-cache-service');
const { INBOUND_REQUEST_TIMEOUT_MS } = xuiSync;

/**
 * 启动一个接受请求但永不响应的本地 HTTP 服务，用于验证请求超时会主动取消连接。
 *
 * @returns {Promise<{server:http.Server,url:string}>} 测试服务及其订阅基础地址。
 */
async function createHangingHttpServer() {
  const server = http.createServer(() => {});
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}/subscription/`
  };
}

/**
 * 启动一个先返回 200 和部分正文、随后立即断开连接的本地 HTTP 服务。
 *
 * @returns {Promise<{server:http.Server,url:string}>} 测试服务及其订阅基础地址。
 */
async function createInterruptedHttpServer() {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.write('partial-content');
    setImmediate(() => response.socket.destroy());
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}/subscription/`
  };
}

/**
 * 关闭测试 HTTP 服务；若仍有残留连接则主动销毁，避免测试进程挂起。
 *
 * @param {http.Server} server - 待关闭的本地测试服务。
 * @returns {Promise<void>}
 */
async function closeHttpServer(server) {
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
  }
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

/**
 * 验证原始订阅请求使用单次超时，并在超时后拒绝且释放悬挂连接。
 *
 * @returns {Promise<void>}
 */
async function testOriginalSubscriptionShouldUsePerRequestTimeout() {
  const { server, url } = await createHangingHttpServer();
  const startedAt = Date.now();

  try {
    await assert.rejects(
      sharedSubscriptionService.fetchOriginalSubscription(url, 'token', { timeout: 50 }),
      (error) => error instanceof Error && error.message.includes('50ms')
    );
    assert(
      Date.now() - startedAt < 1000,
      '单次 50ms 超时不应等待默认的 15000ms'
    );
  } finally {
    await closeHttpServer(server);
  }
}

/**
 * 验证 200 响应正文尚未接收完整便断开时会拒绝，而不会永久等待。
 *
 * @returns {Promise<void>}
 */
async function testInterruptedOriginalSubscriptionShouldReject() {
  const { server, url } = await createInterruptedHttpServer();
  let guardTimer;

  try {
    await assert.rejects(
      Promise.race([
        sharedSubscriptionService.fetchOriginalSubscription(url, 'token', { timeout: 1000 }),
        new Promise((resolve, reject) => {
          guardTimer = setTimeout(
            () => reject(new Error('响应中断后订阅请求仍处于 pending 状态')),
            300
          );
        })
      ]),
      (error) => !error.message.includes('pending 状态')
    );
  } finally {
    clearTimeout(guardTimer);
    await closeHttpServer(server);
  }
}

/**
 * 验证 3X-UI API 客户端把单次 timeout 写入 Axios 请求配置。
 *
 * @returns {Promise<void>}
 */
async function testApiClientShouldWriteTimeoutToAxiosConfig() {
  const client = new XuiApiClientV302('http://127.0.0.1', 'token');
  let requestConfig;
  client.api.request = async (config) => {
    requestConfig = config;
    return { data: { success: true, obj: [] } };
  };

  await client.getInbounds({ timeout: 10000 });
  assert.strictEqual(requestConfig.timeout, 10000);
}

/**
 * 验证 XuiService 获取 inbound 时透传单次请求选项，并保留标准化响应。
 *
 * @returns {Promise<void>}
 */
async function testXuiServiceShouldForwardInboundOptions() {
  const service = new XuiService('http://127.0.0.1', 'token');
  let receivedOptions;
  service.client = {
    async getInbounds(options) {
      receivedOptions = options;
      return { success: true, obj: [{ id: 1 }] };
    }
  };

  const result = await service.getInbounds({ timeout: 10000 });
  assert.deepStrictEqual(receivedOptions, { timeout: 10000 });
  assert.deepStrictEqual(result, { success: true, data: [{ id: 1 }] });
}

/**
 * 验证 inbound 快照请求的默认单次超时常量保持为 10 秒。
 *
 * @returns {void}
 */
function testInboundRequestTimeoutConstant() {
  assert.strictEqual(INBOUND_REQUEST_TIMEOUT_MS, 10000);
}

/**
 * 验证 inbound 快照公共接口仅透传有限正数，非法超时均回退到默认值。
 *
 * @returns {Promise<void>}
 */
async function testInboundRequestTimeoutNormalization() {
  const originalGetInstance = XuiService.getInstance;
  const receivedTimeouts = [];
  XuiService.getInstance = async () => ({
    async getInbounds(options) {
      receivedTimeouts.push(options.timeout);
      return { success: true, data: [] };
    }
  });

  try {
    const server = {
      id: 1,
      api_url: 'http://127.0.0.1',
      api_token: 'token',
      panel_version: '3.0.2'
    };
    await xuiSync.getServerInboundsSnapshot(server, { timeout: 2500 });
    await xuiSync.getServerInboundsSnapshot(server, { timeout: -1 });
    await xuiSync.getServerInboundsSnapshot(server, { timeout: '2500' });
    await xuiSync.getServerInboundsSnapshot(server, { timeout: Infinity });

    assert.deepStrictEqual(receivedTimeouts, [2500, 10000, 10000, 10000]);
    assert.strictEqual(
      xuiSync.normalizePositiveTimeout,
      undefined,
      '超时归一化函数应保持模块私有'
    );
  } finally {
    XuiService.getInstance = originalGetInstance;
  }
}

/**
 * 验证本地快照和用户配置完整时无需同步任何远程服务器。
 *
 * @returns {void}
 */
function testCompleteLocalSnapshotShouldSkipRemoteSync() {
  const servers = [{ id: 1 }, { id: 2 }];
  const snapshots = [
    { server_id: 1, inbound_id: 11 },
    { server_id: 2, inbound_id: 21 }
  ];
  const nodeConfigs = [
    { server_id: 1, inbound_id: 11 },
    { server_id: 2, inbound_id: 21 }
  ];

  const missingServers = userSubscriptionService.__testables.findServersRequiringSync(
    servers,
    snapshots,
    nodeConfigs
  );

  assert.deepStrictEqual(missingServers, []);
}

/**
 * 验证三台服务器中仅无快照或缺用户配置的两台进入定向同步。
 *
 * @returns {void}
 */
function testOnlyGapServersShouldBeSelected() {
  const servers = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const snapshots = [
    { server_id: 1, inbound_id: 11 },
    { server_id: 2, inbound_id: 21 }
  ];
  const nodeConfigs = [{ server_id: 1, inbound_id: 11 }];

  const missingServers = userSubscriptionService.__testables.findServersRequiringSync(
    servers,
    snapshots,
    nodeConfigs
  );

  assert.deepStrictEqual(missingServers.map((server) => server.id), [2, 3]);
}

/**
 * 验证定向节点同步最多并发十台，且单台失败不会中断其他服务器。
 *
 * @returns {Promise<void>}
 */
async function testSelectedServerSyncShouldLimitConcurrencyAndIsolateFailures() {
  const originalGetInstance = XuiService.getInstance;
  const originalRefresh = xuiNodeSnapshotService.refreshServerNodeSnapshots;
  let activeCount = 0;
  let maxActiveCount = 0;

  XuiService.getInstance = async (apiUrl) => ({
    async getInbounds() {
      activeCount += 1;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeCount -= 1;
      if (apiUrl.endsWith('/7')) {
        throw new Error('模拟单台失败');
      }
      return { success: true, data: [{ id: 1, remark: 'node' }] };
    }
  });
  xuiNodeSnapshotService.refreshServerNodeSnapshots = async () => ({
    success: true,
    skipped: false,
    nodeCount: 1
  });

  try {
    const servers = Array.from({ length: 25 }, (_, index) => ({
      id: index + 1,
      name: `server-${index + 1}`,
      api_url: `http://xui/${index + 1}`,
      api_token: 'token'
    }));
    const result = await xuiSync.syncSelectedServers({}, servers);

    assert.strictEqual(maxActiveCount, 10);
    assert.strictEqual(result.totalCount, 25);
    assert.strictEqual(result.syncedCount, 24);
    assert.strictEqual(result.failedCount, 1);
    assert.strictEqual(result.results.length, 25);
    result.results.forEach((item, index) => {
      assert.strictEqual(item.serverId, index + 1);
      assert.strictEqual(item.success, index !== 6);
    });
  } finally {
    XuiService.getInstance = originalGetInstance;
    xuiNodeSnapshotService.refreshServerNodeSnapshots = originalRefresh;
  }
}

/**
 * 验证用户同步仅遍历指定服务器，并复用本轮已有 inbound 快照。
 *
 * @returns {Promise<void>}
 */
async function testTargetedUserSyncShouldReuseInboundSnapshotCache() {
  const originalListServers = xuiSyncRepository.listOnlineXuiServers;
  const originalFindConfig = xuiSyncRepository.findUserNodeConfig;
  const originalUpdateStatus = orderRepository.updateUserSyncStatus;
  const originalGetInstance = XuiService.getInstance;
  const visitedServerIds = [];
  let remoteInboundCalls = 0;

  xuiSyncRepository.listOnlineXuiServers = async () => [
    { id: 1, name: 'one', api_url: 'http://one', api_token: 'token' },
    { id: 2, name: 'two', api_url: 'http://two', api_token: 'token' },
    { id: 3, name: 'three', api_url: 'http://three', api_token: 'token' }
  ];
  xuiSyncRepository.findUserNodeConfig = async (db, userId, serverId) => ({
    uuid: `uuid-${serverId}`,
    auth: '',
    sub_id: `sub-${serverId}`
  });
  orderRepository.updateUserSyncStatus = async () => {};
  XuiService.getInstance = async (apiUrl) => {
    const serverId = { 'http://one': 1, 'http://two': 2, 'http://three': 3 }[apiUrl];
    visitedServerIds.push(serverId);
    return {
      async getInbounds() {
        remoteInboundCalls += 1;
        return { success: true, data: [] };
      },
      extractClientsFromSettings() {
        return [];
      },
      async upsertUniqueClient() {
        return { success: true, action: 'updated' };
      }
    };
  };

  try {
    const inboundSnapshotCache = new Map([
      ['2', {
        fetchedAt: Date.now(),
        result: {
          success: true,
          data: [{ id: 21, remark: 'direct', protocol: 'vless', settings: '{}' }]
        }
      }]
    ]);
    const result = await orderService.syncUserToXuiServers(
      {},
      { id: 9, email: 'user@example.com', enabled: 1, expire_at: 0 },
      { serverIds: [2], inboundSnapshotCache }
    );

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(visitedServerIds, [2]);
    assert.strictEqual(remoteInboundCalls, 0);
  } finally {
    xuiSyncRepository.listOnlineXuiServers = originalListServers;
    xuiSyncRepository.findUserNodeConfig = originalFindConfig;
    orderRepository.updateUserSyncStatus = originalUpdateStatus;
    XuiService.getInstance = originalGetInstance;
  }
}

/**
 * 通过公共生成链验证完整本地数据跳过远程，缺口场景仅同步目标服务器并透传缓存。
 *
 * @returns {Promise<void>}
 */
async function testGenerateSubscriptionShouldWireTargetedSyncDependencies() {
  const repositoryMethods = [
    'findLatestUserSubscription',
    'findSubscriptionUserById',
    'listEnabledUserCfIps',
    'listOnlineServers',
    'listNodeSnapshots',
    'listUserNodeConfigs',
    'listUserSubscriptionSources',
    'upsertSubscriptionSource',
    'saveUserSubscriptionCache'
  ];
  const originals = Object.fromEntries(
    repositoryMethods.map((method) => [method, subscriptionRepository[method]])
  );
  const originalGetInstance = XuiService.getInstance;
  const servers = [
    { id: 1, name: 'one', api_url: 'http://one', api_token: 'token', sub_url: 'http://sub-one/', host: 'one.example.com', client_port: 443 },
    { id: 2, name: 'two', api_url: 'http://two', api_token: 'token', sub_url: 'http://sub-two/', host: 'two.example.com', client_port: 443 },
    { id: 3, name: 'three', api_url: 'http://three', api_token: 'token', sub_url: 'http://sub-three/', host: 'three.example.com', client_port: 443 }
  ];
  const user = {
    id: 9,
    email: 'user@example.com',
    sub_id: 'sub-token',
    enabled: 1,
    traffic_limit: 1024
  };
  const logger = { info() {}, warn() {}, error() {} };
  const sources = new Map();
  let remoteCalls = 0;

  subscriptionRepository.findLatestUserSubscription = async () => undefined;
  subscriptionRepository.findSubscriptionUserById = async () => user;
  subscriptionRepository.listEnabledUserCfIps = async () => [{ ip: '1.1.1.1' }];
  subscriptionRepository.listOnlineServers = async () => servers;
  subscriptionRepository.listUserSubscriptionSources = async () => Array.from(sources.values());
  subscriptionRepository.upsertSubscriptionSource = async (db, source) => {
    sources.set(`${source.server_id}:${source.inbound_id}`, source);
  };
  subscriptionRepository.saveUserSubscriptionCache = async () => {};
  XuiService.getInstance = async () => {
    remoteCalls += 1;
    throw new Error('完整本地数据不应访问远程');
  };

  try {
    subscriptionRepository.listNodeSnapshots = async () => [
      { server_id: 1, inbound_id: 11 },
      { server_id: 2, inbound_id: 21 },
      { server_id: 3, inbound_id: 31 }
    ];
    subscriptionRepository.listUserNodeConfigs = async () => [
      { server_id: 1, inbound_id: 11, sub_id: 'sub-1', remark: 'direct-1', protocol: 'vless', port: 443, settings: '{}', stream_settings: '{}' },
      { server_id: 2, inbound_id: 21, sub_id: 'sub-2', remark: 'direct-2', protocol: 'vless', port: 443, settings: '{}', stream_settings: '{}' },
      { server_id: 3, inbound_id: 31, sub_id: 'sub-3', remark: 'direct-3', protocol: 'vless', port: 443, settings: '{}', stream_settings: '{}' }
    ];
    let selectedSyncCalls = 0;
    await userSubscriptionService.generateSubscription({}, user.id, logger, {
        dependencies: {
          async syncSelectedServers() {
            selectedSyncCalls += 1;
            return { success: true, syncedCount: 0, failedCount: 0, totalCount: 0, results: [] };
          },
          async fetchOriginalSubscription() {
            return Buffer.from('vless://00000000-0000-0000-0000-000000000001@127.0.0.1:443?encryption=none#node').toString('base64');
          }
        }
      });
    assert.strictEqual(selectedSyncCalls, 0);
    assert.strictEqual(remoteCalls, 0);

    const inboundSnapshotCache = new Map();
    const selectedServerIds = [];
    let receivedUserSyncPlan;
    subscriptionRepository.listNodeSnapshots = async () => [
      { server_id: 1, inbound_id: 11 },
      { server_id: 2, inbound_id: 21 }
    ];
    subscriptionRepository.listUserNodeConfigs = async () => [
      { server_id: 1, inbound_id: 11, sub_id: 'sub-1', remark: 'direct-1', protocol: 'vless', port: 443, settings: '{}', stream_settings: '{}' }
    ];
    await userSubscriptionService.generateSubscription({}, user.id, logger, {
        inboundSnapshotCache,
        dependencies: {
          async syncSelectedServers(db, selectedServers) {
            selectedServerIds.push(...selectedServers.map((server) => server.id));
            return { success: true, syncedCount: 2, failedCount: 0, totalCount: 2, results: [] };
          },
          async syncUserToXuiServers(db, syncedUser, plan) {
            receivedUserSyncPlan = plan;
            return { success: true, successCount: 1, failureCount: 0 };
          },
          async fetchOriginalSubscription() {
            return Buffer.from('vless://00000000-0000-0000-0000-000000000001@127.0.0.1:443?encryption=none#node').toString('base64');
          }
        }
      });

    assert.deepStrictEqual(selectedServerIds, [2, 3]);
    assert.deepStrictEqual(receivedUserSyncPlan.serverIds, [2]);
    assert.strictEqual(receivedUserSyncPlan.inboundSnapshotCache, inboundSnapshotCache);
    assert.strictEqual(remoteCalls, 0);
  } finally {
    for (const method of repositoryMethods) {
      subscriptionRepository[method] = originals[method];
    }
    XuiService.getInstance = originalGetInstance;
  }
}

/**
 * 验证公共生成入口未显式传入缓存时，会为整次请求创建并复用同一个 inbound 快照缓存。
 *
 * @returns {Promise<void>}
 */
async function testGenerateSubscriptionShouldCreateRequestScopedInboundCache() {
  const methods = [
    'findLatestUserSubscription', 'findSubscriptionUserById', 'listEnabledUserCfIps',
    'listOnlineServers', 'listNodeSnapshots', 'listUserNodeConfigs',
    'listUserSubscriptionSources', 'upsertSubscriptionSource', 'saveUserSubscriptionCache'
  ];
  const originals = Object.fromEntries(methods.map((method) => [method, subscriptionRepository[method]]));
  const server = {
    id: 1, name: 'cache-server', sub_url: 'https://cache.example/',
    host: 'cache.example.com', client_port: 443
  };
  const config = {
    user_id: 801, server_id: 1, inbound_id: 11, sub_id: 'cache-node-sub',
    uuid: '00000000-0000-0000-0000-000000000801', remark: 'direct',
    protocol: 'vless', port: 443, settings: '{}', stream_settings: '{}'
  };
  const caches = [];
  let configReads = 0;
  const sources = new Map();

  subscriptionRepository.findLatestUserSubscription = async () => undefined;
  subscriptionRepository.findSubscriptionUserById = async () => ({
    id: 801, email: 'cache@example.com', sub_id: 'cache-user-sub',
    enabled: 1, traffic_limit: 1024
  });
  subscriptionRepository.listEnabledUserCfIps = async () => [{ ip: '1.1.1.1' }];
  subscriptionRepository.listOnlineServers = async () => [server];
  subscriptionRepository.listNodeSnapshots = async () => [{ server_id: 1, inbound_id: 11 }];
  subscriptionRepository.listUserNodeConfigs = async () => {
    configReads += 1;
    return configReads <= 2 ? [] : [config];
  };
  subscriptionRepository.listUserSubscriptionSources = async () => Array.from(sources.values());
  subscriptionRepository.upsertSubscriptionSource = async (db, source) => {
    sources.set(`${source.server_id}:${source.inbound_id}`, source);
  };
  subscriptionRepository.saveUserSubscriptionCache = async () => {};

  try {
    await userSubscriptionService.generateSubscription({}, 801, {
      info() {}, warn() {}, error() {}
    }, {
      dependencies: {
        async syncSelectedServers(db, servers, options) {
          caches.push(options.inboundSnapshotCache);
          return {
            success: true, syncedCount: 1, failedCount: 0, totalCount: 1,
            results: [{ success: true, serverId: 1 }]
          };
        },
        async syncUserToXuiServers(db, user, plan) {
          caches.push(plan.inboundSnapshotCache);
          return { success: true, successCount: 1, failureCount: 0 };
        },
        async fetchOriginalSubscription() {
          return Buffer.from(
            'vless://00000000-0000-0000-0000-000000000801@127.0.0.1:443?encryption=none#node'
          ).toString('base64');
        }
      }
    });

    assert(caches[0] instanceof Map);
    assert.strictEqual(caches[1], caches[0]);
  } finally {
    for (const method of methods) subscriptionRepository[method] = originals[method];
  }
}

/**
 * 验证非首次生成补齐 25 台缺失快照时最多并发 10 台，且部分失败不会阻断其余服务器。
 *
 * @returns {Promise<void>}
 */
async function testExistingGenerationMissingSnapshotsShouldUseConcurrentBatchSync() {
  const methods = [
    'findLatestUserSubscription', 'findSubscriptionUserById', 'listEnabledUserCfIps',
    'listOnlineServers', 'listNodeSnapshots', 'listUserNodeConfigs',
    'listUserSubscriptionSources', 'upsertSubscriptionSource', 'saveUserSubscriptionCache'
  ];
  const originals = Object.fromEntries(methods.map((method) => [method, subscriptionRepository[method]]));
  const servers = Array.from({ length: 25 }, (_, index) => ({
    id: index + 1, name: `missing-${index + 1}`, sub_url: `https://missing/${index + 1}/`,
    host: `missing-${index + 1}.example.com`, client_port: 443
  }));
  const configs = servers.map((server) => ({
    user_id: 802, server_id: server.id, inbound_id: server.id * 10,
    sub_id: `missing-sub-${server.id}`, uuid: `missing-uuid-${server.id}`,
    remark: `direct-${server.id}`, protocol: 'vless', port: 443,
    settings: '{}', stream_settings: '{}'
  }));
  const now = Math.floor(Date.now() / 1000);
  const sources = configs.map((config) => ({
    user_id: 802, server_id: config.server_id, inbound_id: config.inbound_id,
    sub_id: config.sub_id, original_link: `vless://cached-${config.server_id}`,
    node_fingerprint: computeNodeFingerprint(config),
    server_fingerprint: computeServerFingerprint(servers[config.server_id - 1]),
    fetched_at: now
  }));
  let active = 0;
  let maxActive = 0;
  const completed = [];

  subscriptionRepository.findLatestUserSubscription = async () => ({ id: 1 });
  subscriptionRepository.findSubscriptionUserById = async () => ({
    id: 802, email: 'missing@example.com', sub_id: 'missing-user-sub',
    enabled: 1, traffic_limit: 1024
  });
  subscriptionRepository.listEnabledUserCfIps = async () => [{ ip: '1.1.1.1' }];
  subscriptionRepository.listOnlineServers = async () => servers;
  subscriptionRepository.listNodeSnapshots = async () => [];
  subscriptionRepository.listUserNodeConfigs = async () => configs;
  subscriptionRepository.listUserSubscriptionSources = async () => sources;
  subscriptionRepository.saveUserSubscriptionCache = async () => {};

  try {
    await userSubscriptionService.generateSubscription({}, 802, {
      info() {}, warn() {}, error() {}
    }, {
      dependencies: {
        async syncSelectedServers(db, selectedServers) {
          const results = await require('../utils/concurrency').runWithConcurrency(
            selectedServers,
            10,
            async (server) => {
              active += 1;
              maxActive = Math.max(maxActive, active);
              await new Promise((resolve) => setTimeout(resolve, 2));
              active -= 1;
              completed.push(server.id);
              return {
                success: ![7, 19].includes(server.id),
                serverId: server.id,
                nodeCount: 1
              };
            }
          );
          const normalized = results.map((result) => result.value);
          return {
            success: true,
            syncedCount: normalized.filter((result) => result.success).length,
            failedCount: normalized.filter((result) => !result.success).length,
            totalCount: normalized.length,
            results: normalized
          };
        }
      }
    });

    assert.strictEqual(maxActive, 10);
    assert.strictEqual(completed.length, 25);
    assert(completed.includes(7));
    assert(completed.includes(19));
  } finally {
    for (const method of methods) subscriptionRepository[method] = originals[method];
  }
}

/**
 * 通过公共生成链构造原始模板刷新场景，并确保仓储替身在测试结束后完整恢复。
 *
 * @param {Object} options - 场景选项。
 * @param {Set<number>} [options.failedIndexes] - 模拟网络失败的节点序号集合。
 * @param {Array<Object>} [options.seedSources] - 刷新前已存在的来源缓存。
 * @param {Function} [options.createFailure] - 按节点序号创建失败原因，支持非 Error 拒绝值。
 * @param {Function} [options.getDelayMs] - 按节点序号返回模拟网络耗时。
 * @param {Object} [options.serverOverrides] - 按节点序号覆盖服务器字段。
 * @returns {Promise<Object>} 生成结果、并发统计和最终写入节点。
 */
async function runSourceRefreshScenario({
  failedIndexes = new Set(),
  seedSources = [],
  createFailure = () => new Error('模拟网络失败：敏感内容 token-uuid'),
  getDelayMs = () => 5,
  serverOverrides = {}
} = {}) {
  const repositoryMethods = [
    'findLatestUserSubscription',
    'findSubscriptionUserById',
    'listEnabledUserCfIps',
    'listOnlineServers',
    'listNodeSnapshots',
    'listUserNodeConfigs',
    'listUserSubscriptionSources',
    'upsertSubscriptionSource',
    'saveUserSubscriptionCache'
  ];
  const originals = Object.fromEntries(
    repositoryMethods.map((method) => [method, subscriptionRepository[method]])
  );
  const user = {
    id: 91,
    email: 'concurrency@example.com',
    sub_id: 'user-sub-token',
    enabled: 1,
    traffic_limit: 1024
  };
  const servers = Array.from({ length: 25 }, (_, index) => {
    const serverIndex = index + 1;
    return {
      id: serverIndex,
      name: `source-${serverIndex}`,
      sub_url: `https://subscription.example/${serverIndex}/`,
      host: `node-${serverIndex}.example.com`,
      client_port: 443,
      ...(serverOverrides[serverIndex] || {})
    };
  });
  const nodeConfigs = servers.map((server, index) => ({
    server_id: server.id,
    inbound_id: index + 101,
    sub_id: `node-sub-${index + 1}`,
    remark: `direct-${index + 1}`,
    protocol: 'vless',
    port: 443,
    settings: '{}',
    stream_settings: '{}'
  }));
  const sources = new Map(seedSources.map((source) => [
    `${source.server_id}:${source.inbound_id}`,
    { ...source }
  ]));
  const timeoutValues = [];
  const fetchCounts = new Map();
  const repairServerSelections = [];
  let activeCount = 0;
  let maxActiveCount = 0;
  let savedNodes;
  const logMessages = [];

  subscriptionRepository.findLatestUserSubscription = async () => undefined;
  subscriptionRepository.findSubscriptionUserById = async () => user;
  subscriptionRepository.listEnabledUserCfIps = async () => [{ ip: '1.1.1.1' }];
  subscriptionRepository.listOnlineServers = async () => servers;
  subscriptionRepository.listNodeSnapshots = async () => nodeConfigs;
  subscriptionRepository.listUserNodeConfigs = async () => nodeConfigs;
  subscriptionRepository.listUserSubscriptionSources = async () => Array.from(sources.values());
  subscriptionRepository.upsertSubscriptionSource = async (db, source) => {
    sources.set(`${source.server_id}:${source.inbound_id}`, { ...source });
  };
  subscriptionRepository.saveUserSubscriptionCache = async (db, userId, subId, nodes) => {
    savedNodes = nodes;
  };

  try {
    const result = await userSubscriptionService.generateSubscription({}, user.id, {
      info(message) { logMessages.push(message); },
      warn(message) { logMessages.push(message); },
      error(message) { logMessages.push(message); }
    }, {
      dependencies: {
        async syncSelectedServers(db, selectedServers) {
          repairServerSelections.push(selectedServers.map((server) => server.id));
          return {
            success: true,
            syncedCount: selectedServers.length,
            failedCount: 0,
            totalCount: selectedServers.length,
            results: selectedServers.map((server) => ({ success: true, serverId: server.id }))
          };
        },
        async syncUserToXuiServers() {
          return { success: true, successCount: 1, failureCount: 0 };
        },
        async fetchOriginalSubscription(subUrl, subId, options) {
          const index = Number(subId.replace('node-sub-', ''));
          fetchCounts.set(index, (fetchCounts.get(index) || 0) + 1);
          timeoutValues.push(options.timeout);
          activeCount += 1;
          maxActiveCount = Math.max(maxActiveCount, activeCount);
          try {
            await new Promise((resolve) => setTimeout(resolve, getDelayMs(index)));
            if (failedIndexes.has(index)) {
              throw createFailure(index);
            }
            const link = `vless://00000000-0000-0000-0000-${String(index).padStart(12, '0')}@127.0.0.1:443?encryption=none#node`;
            return Buffer.from(link).toString('base64');
          } finally {
            activeCount -= 1;
          }
        }
      }
    });

    return {
      result,
      maxActiveCount,
      timeoutValues,
      sources,
      savedNodes,
      servers,
      nodeConfigs,
      logMessages,
      fetchCounts,
      repairServerSelections
    };
  } finally {
    for (const method of repositoryMethods) {
      subscriptionRepository[method] = originals[method];
    }
  }
}

/**
 * 验证 25 个模板最多并发 10 个、统一使用 5 秒超时，且两个网络失败不阻断其余节点生成。
 *
 * @returns {Promise<void>}
 */
async function testSourceRefreshShouldLimitConcurrencyAndKeepPartialSuccess() {
  const scenario = await runSourceRefreshScenario({ failedIndexes: new Set([7, 19]) });

  assert.strictEqual(scenario.result, 'user-sub-token');
  assert.strictEqual(scenario.maxActiveCount, 10);
  assert.deepStrictEqual(new Set(scenario.timeoutValues), new Set([5000]));
  assert.strictEqual(scenario.sources.size, 23);
  assert.strictEqual(scenario.savedNodes.length, 23);
  const logs = scenario.logMessages.join('\n');
  assert(logs.includes('success=23, failed=2'));
  assert(logs.includes('user=concurrency@example.com, servers=[source-7], inbound=107, duration='));
  assert(!logs.includes('user=concurrency@example.com, server=7'));
  assert(!logs.includes('token-uuid'));
}

/**
 * 验证所有远程刷新失败且没有旧缓存时，公共生成链返回业务失败。
 *
 * @returns {Promise<void>}
 */
async function testSourceRefreshShouldFailWhenNoNodeCanBeComposed() {
  await assert.rejects(
    runSourceRefreshScenario({
      failedIndexes: new Set(Array.from({ length: 25 }, (_, index) => index + 1))
    }),
    (error) => error.code === 500 && error.message.includes('未生成任何可用节点')
  );
}

/**
 * 创建与当前节点和服务器匹配的有效来源缓存。
 *
 * @param {Object} nodeConfig - 当前用户节点配置。
 * @param {Object} server - 当前在线服务器。
 * @param {Object} [overrides={}] - 用于构造失效分支的字段覆盖。
 * @returns {Object} 来源缓存记录。
 */
function createSourceCache(nodeConfig, server, overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    user_id: 91,
    server_id: nodeConfig.server_id,
    inbound_id: nodeConfig.inbound_id,
    sub_id: nodeConfig.sub_id,
    remark: nodeConfig.remark,
    protocol: nodeConfig.protocol,
    original_link: 'vless://00000000-0000-0000-0000-000000000099@127.0.0.1:443?encryption=none#cached',
    node_fingerprint: computeNodeFingerprint(nodeConfig),
    server_fingerprint: computeServerFingerprint(server),
    fetched_at: now,
    updated_at: now,
    ...overrides
  };
}

/**
 * 验证刷新失败时仍可复用匹配当前 sub_id 和指纹的旧模板。
 *
 * @returns {Promise<void>}
 */
async function testSourceRefreshShouldReuseValidOldCache() {
  const server = {
    id: 1,
    name: 'source-1',
    sub_url: 'https://subscription.example/1/',
    host: 'node-1.example.com',
    client_port: 443
  };
  const nodeConfig = {
    server_id: 1,
    inbound_id: 101,
    sub_id: 'node-sub-1',
    remark: 'direct-1',
    protocol: 'vless',
    port: 443,
    settings: '{}',
    stream_settings: '{}'
  };
  const scenario = await runSourceRefreshScenario({
    failedIndexes: new Set([1]),
    seedSources: [createSourceCache(nodeConfig, server)]
  });

  assert.strictEqual(scenario.savedNodes.length, 25);
  assert(scenario.savedNodes.some((node) => node.original_link.includes('000000000099')));
  assert.deepStrictEqual(scenario.repairServerSelections, []);
}

/**
 * 验证同一服务器存在混合缓存状态时，修复仅重试最终无效的失败节点。
 *
 * @returns {Promise<void>}
 */
async function testRepairShouldRetryOnlyFailedNodesWithoutValidCache() {
  const methods = [
    'findLatestUserSubscription', 'findSubscriptionUserById', 'listEnabledUserCfIps',
    'listOnlineServers', 'listNodeSnapshots', 'listUserNodeConfigs',
    'listUserSubscriptionSources', 'upsertSubscriptionSource', 'saveUserSubscriptionCache'
  ];
  const originals = Object.fromEntries(methods.map((method) => [method, subscriptionRepository[method]]));
  const server = {
    id: 1, name: 'mixed-cache', sub_url: 'https://mixed.example/',
    host: 'mixed.example.com', client_port: 443
  };
  const configs = [101, 102].map((inboundId, index) => ({
    user_id: 803, server_id: 1, inbound_id: inboundId,
    sub_id: `mixed-sub-${index + 1}`,
    uuid: `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
    remark: `direct-${index + 1}`, protocol: 'vless', port: 443,
    settings: '{}', stream_settings: '{}'
  }));
  const sources = new Map([[
    '1:101',
    createSourceCache(configs[0], server, {
      user_id: 803,
      original_link: 'vless://00000000-0000-0000-0000-000000000099@127.0.0.1:443?encryption=none#cached-a'
    })
  ]]);
  const fetchCounts = new Map();
  const repairCalls = [];
  let savedNodes;

  subscriptionRepository.findLatestUserSubscription = async () => undefined;
  subscriptionRepository.findSubscriptionUserById = async () => ({
    id: 803, email: 'mixed@example.com', sub_id: 'mixed-user-sub',
    enabled: 1, traffic_limit: 1024
  });
  subscriptionRepository.listEnabledUserCfIps = async () => [{ ip: '1.1.1.1' }];
  subscriptionRepository.listOnlineServers = async () => [server];
  subscriptionRepository.listNodeSnapshots = async () => configs;
  subscriptionRepository.listUserNodeConfigs = async () => configs;
  subscriptionRepository.listUserSubscriptionSources = async () => Array.from(sources.values());
  subscriptionRepository.upsertSubscriptionSource = async (db, source) => {
    sources.set(`${source.server_id}:${source.inbound_id}`, source);
  };
  subscriptionRepository.saveUserSubscriptionCache = async (db, userId, subId, nodes) => {
    savedNodes = nodes;
  };

  try {
    await userSubscriptionService.generateSubscription({}, 803, {
      info() {}, warn() {}, error() {}
    }, {
      dependencies: {
        async syncSelectedServers(db, selectedServers) {
          repairCalls.push(selectedServers.map((item) => item.id));
          return {
            success: true, syncedCount: 1, failedCount: 0, totalCount: 1,
            results: [{ success: true, serverId: 1 }]
          };
        },
        async syncUserToXuiServers() {
          return { success: true, successCount: 1, failureCount: 0 };
        },
        async fetchOriginalSubscription(subUrl, subId) {
          const index = Number(subId.split('-').pop());
          const count = (fetchCounts.get(index) || 0) + 1;
          fetchCounts.set(index, count);
          if (index === 1 || count === 1) {
            throw new Error('模拟首轮失败');
          }
          return Buffer.from(
            'vless://00000000-0000-0000-0000-000000000002@127.0.0.1:443?encryption=none#node-b'
          ).toString('base64');
        }
      }
    });

    assert.deepStrictEqual(Object.fromEntries(fetchCounts), { 1: 1, 2: 2 });
    assert.deepStrictEqual(repairCalls, [[1]]);
    assert.strictEqual(savedNodes.length, 2);
  } finally {
    for (const method of methods) subscriptionRepository[method] = originals[method];
  }
}

/**
 * 验证 sub_id 或节点指纹失效的旧模板不会在刷新失败后混入最终订阅。
 *
 * @returns {Promise<void>}
 */
async function testSourceRefreshShouldRejectInvalidOldCache() {
  const server = {
    id: 1,
    name: 'source-1',
    sub_url: 'https://subscription.example/1/',
    host: 'node-1.example.com',
    client_port: 443
  };
  const nodeConfig = {
    server_id: 1,
    inbound_id: 101,
    sub_id: 'node-sub-1',
    remark: 'direct-1',
    protocol: 'vless',
    port: 443,
    settings: '{}',
    stream_settings: '{}'
  };

  for (const invalidSource of [
    createSourceCache(nodeConfig, server, { sub_id: 'stale-sub-id' }),
    createSourceCache(nodeConfig, server, { node_fingerprint: 'stale-fingerprint' })
  ]) {
    const scenario = await runSourceRefreshScenario({
      failedIndexes: new Set([1]),
      seedSources: [invalidSource]
    });
    assert.strictEqual(scenario.savedNodes.length, 24);
    assert(!scenario.savedNodes.some((node) => node.original_link.includes('000000000099')));
  }
}

/**
 * 创建首个节点的标准服务器和节点配置，供无效缓存公共链测试独立构造输入。
 *
 * @returns {{server:Object,nodeConfig:Object}} 标准服务器与节点配置。
 */
function createFirstSourceFixture() {
  const server = {
    id: 1,
    name: 'source-1',
    sub_url: 'https://subscription.example/1/',
    host: 'node-1.example.com',
    client_port: 443
  };
  const nodeConfig = {
    server_id: 1,
    inbound_id: 101,
    sub_id: 'node-sub-1',
    remark: 'direct-1',
    protocol: 'vless',
    port: 443,
    settings: '{}',
    stream_settings: '{}'
  };

  return { server, nodeConfig };
}

/**
 * 验证服务器指纹不匹配的旧模板，在全部刷新失败时不能兜底生成订阅。
 * 核心分支：通过公共 generateSubscription 链路校验，最终必须返回零节点业务失败。
 *
 * @returns {Promise<void>}
 */
async function testSourceRefreshShouldFailWithInvalidServerFingerprintCache() {
  const { server, nodeConfig } = createFirstSourceFixture();
  const allFailedIndexes = new Set(Array.from({ length: 25 }, (_, index) => index + 1));
  const invalidSource = createSourceCache(
    nodeConfig,
    server,
    { server_fingerprint: 'stale-server-fingerprint' }
  );

  await assert.rejects(
    runSourceRefreshScenario({
      failedIndexes: allFailedIndexes,
      seedSources: [invalidSource]
    }),
    (error) => error.code === 500 && error.message.includes('未生成任何可用节点')
  );
}

/**
 * 验证超过 24 小时的旧模板，在全部刷新失败时不能兜底生成订阅。
 * 核心分支：通过公共 generateSubscription 链路校验，最终必须返回零节点业务失败。
 *
 * @returns {Promise<void>}
 */
async function testSourceRefreshShouldFailWithExpiredCache() {
  const { server, nodeConfig } = createFirstSourceFixture();
  const allFailedIndexes = new Set(Array.from({ length: 25 }, (_, index) => index + 1));
  const invalidSource = createSourceCache(nodeConfig, server, {
    fetched_at: Math.floor(Date.now() / 1000) - (24 * 60 * 60) - 1
  });

  await assert.rejects(
    runSourceRefreshScenario({
      failedIndexes: allFailedIndexes,
      seedSources: [invalidSource]
    }),
    (error) => error.code === 500 && error.message.includes('未生成任何可用节点')
  );
}

/**
 * 验证冻结 Error 与字符串拒绝值均被单项隔离，且排队后的失败耗时不包含等待批次时间。
 * 核心分支：前十项占满并发槽位，第 11、12 项随后快速失败，日志仍应携带单项短耗时。
 *
 * @returns {Promise<void>}
 */
async function testSourceRefreshShouldWrapExternalFailuresWithoutMutation() {
  const scenario = await runSourceRefreshScenario({
    failedIndexes: new Set([11, 12]),
    createFailure(index) {
      return index === 11
        ? Object.freeze(new Error('冻结错误正文 token-frozen'))
        : '字符串错误正文 token-string';
    },
    getDelayMs(index) {
      return index <= 10 ? 60 : 0;
    }
  });
  const logs = scenario.logMessages.join('\n');
  const frozenLog = scenario.logMessages.find(
    (message) => message.includes('servers=[source-11], inbound=111')
  );
  const stringLog = scenario.logMessages.find(
    (message) => message.includes('servers=[source-12], inbound=112')
  );

  assert.strictEqual(scenario.savedNodes.length, 23);
  assert(frozenLog);
  assert(stringLog);
  assert(Number(frozenLog.match(/duration=(\d+)ms/)[1]) < 30);
  assert(Number(stringLog.match(/duration=(\d+)ms/)[1]) < 30);
  assert(!logs.includes('token-frozen'));
  assert(!logs.includes('token-string'));
}

/**
 * 验证排队后才执行的缺失订阅地址校验使用单项耗时，而不是批次启动时间。
 *
 * @returns {Promise<void>}
 */
async function testMissingSourceUrlShouldLogItemDuration() {
  const scenario = await runSourceRefreshScenario({
    getDelayMs(index) {
      return index <= 10 ? 60 : 0;
    },
    serverOverrides: {
      11: { sub_url: '' }
    }
  });
  const missingUrlLog = scenario.logMessages.find(
    (message) => message.includes('servers=[source-11], inbound=111')
  );

  assert.strictEqual(scenario.savedNodes.length, 24);
  assert(missingUrlLog);
  assert(Number(missingUrlLog.match(/duration=(\d+)ms/)[1]) < 30);
}

/**
 * 验证首次模板失败仅按服务器做一轮定向修复，并复用同一 inbound 快照缓存。
 * 核心分支：服务器 2 的失败节点重试成功；修复后新增 inbound 不在本轮失败键集合中，因此不得拉取。
 *
 * @returns {Promise<void>}
 */
async function testFirstGenerationShouldRepairFailedServerOnlyOnce() {
  const repositoryMethods = [
    'findLatestUserSubscription',
    'findSubscriptionUserById',
    'listEnabledUserCfIps',
    'listOnlineServers',
    'listNodeSnapshots',
    'listUserNodeConfigs',
    'listUserSubscriptionSources',
    'upsertSubscriptionSource',
    'saveUserSubscriptionCache'
  ];
  const originals = Object.fromEntries(
    repositoryMethods.map((method) => [method, subscriptionRepository[method]])
  );
  const servers = [1, 2, 3].map((id) => ({
    id,
    name: `server-${id}`,
    sub_url: `https://subscription.example/${id}/`,
    host: `server-${id}.example.com`,
    client_port: 443,
    api_token: `api-token-${id}`
  }));
  const nodeConfigs = servers.map((server) => ({
    user_id: 501,
    server_id: server.id,
    inbound_id: server.id * 10,
    sub_id: `private-sub-${server.id}`,
    uuid: `private-uuid-${server.id}`,
    remark: `direct-${server.id}`,
    protocol: 'vless',
    port: 443,
    settings: '{}',
    stream_settings: '{}'
  }));
  const addedNodeConfig = {
    ...nodeConfigs[1],
    inbound_id: 21,
    sub_id: 'private-sub-new-inbound',
    uuid: 'private-uuid-new-inbound',
    remark: 'direct-new-inbound'
  };
  const sources = new Map();
  const fetchCounts = new Map();
  const repairCalls = [];
  const userSyncPlans = [];
  const logs = [];
  const inboundSnapshotCache = new Map();
  let repairUserSynced = false;
  let savedNodes;

  subscriptionRepository.findLatestUserSubscription = async () => undefined;
  subscriptionRepository.findSubscriptionUserById = async () => ({
    id: 501,
    email: 'secret-user@example.com',
    sub_id: 'private-user-token',
    enabled: 1,
    traffic_limit: 1024
  });
  subscriptionRepository.listEnabledUserCfIps = async () => [{ ip: '1.1.1.1' }];
  subscriptionRepository.listOnlineServers = async () => servers;
  subscriptionRepository.listNodeSnapshots = async () => nodeConfigs;
  subscriptionRepository.listUserNodeConfigs = async () => (
    repairUserSynced ? [...nodeConfigs, addedNodeConfig] : nodeConfigs
  );
  subscriptionRepository.listUserSubscriptionSources = async () => Array.from(sources.values());
  subscriptionRepository.upsertSubscriptionSource = async (db, source) => {
    sources.set(`${source.server_id}:${source.inbound_id}`, { ...source });
  };
  subscriptionRepository.saveUserSubscriptionCache = async (db, userId, subId, nodes) => {
    savedNodes = nodes;
  };

  try {
    const result = await userSubscriptionService.generateSubscription({}, 501, {
      info(message) { logs.push(message); },
      warn(message) { logs.push(message); },
      error(message) { logs.push(message); }
    }, {
      inboundSnapshotCache,
      dependencies: {
        async fetchOriginalSubscription(subUrl, subId) {
          fetchCounts.set(subId, (fetchCounts.get(subId) || 0) + 1);
          if (subId === 'private-sub-2' && fetchCounts.get(subId) === 1) {
            throw new Error('sensitive-error private-user-token private-uuid-2 api-token-2');
          }
          const serverId = subId === 'private-sub-new-inbound'
            ? 2
            : Number(subId.split('-').pop());
          return Buffer.from(
            `vless://00000000-0000-0000-0000-${String(serverId).padStart(12, '0')}@127.0.0.1:443?encryption=none#node`
          ).toString('base64');
        },
        async syncSelectedServers(db, selectedServers, options) {
          repairCalls.push({
            ids: selectedServers.map((server) => server.id),
            cache: options.inboundSnapshotCache
          });
          return {
            success: true,
            syncedCount: selectedServers.length,
            failedCount: 0,
            totalCount: selectedServers.length,
            results: selectedServers.map((server) => ({ success: true, serverId: server.id }))
          };
        },
        async syncUserToXuiServers(db, user, plan) {
          userSyncPlans.push(plan);
          repairUserSynced = true;
          return { success: true, successCount: 1, failureCount: 0 };
        }
      }
    });

    assert.strictEqual(result, 'private-user-token');
    assert.deepStrictEqual(repairCalls.map((call) => call.ids), [[2]]);
    assert.strictEqual(repairCalls[0].cache, inboundSnapshotCache);
    assert.deepStrictEqual(userSyncPlans.map((plan) => plan.serverIds), [[2]]);
    assert.strictEqual(userSyncPlans[0].inboundSnapshotCache, inboundSnapshotCache);
    assert.deepStrictEqual(Object.fromEntries(fetchCounts), {
      'private-sub-1': 1,
      'private-sub-2': 2,
      'private-sub-3': 1
    });
    assert.strictEqual(fetchCounts.get('private-sub-new-inbound') || 0, 0);
    assert.strictEqual(savedNodes.length, 3);

    const summary = logs.find((message) => message.includes('订阅生成汇总:'));
    assert(summary);
    for (const field of [
      'user=secret-user@example.com',
      'localServers=[server-1, server-3]',
      'remoteServers=[server-2]',
      'inboundSuccess=1',
      'inboundFailed=0',
      'sourceSuccess=3',
      'sourceFailed=0',
      'repairServers=1',
      'nodes=3',
      'duration='
    ]) {
      assert(summary.includes(field), `汇总日志缺少字段 ${field}`);
    }
    const allLogs = logs.join('\n');
    assert(!allLogs.includes('private-user-token'));
    assert(!allLogs.includes('private-uuid'));
    assert(!allLogs.includes('api-token'));
    assert(!allLogs.includes('sensitive-error'));
  } finally {
    for (const method of repositoryMethods) {
      subscriptionRepository[method] = originals[method];
    }
  }
}

/**
 * 执行原始订阅持续失败场景，并收集公共生成流程的重试与保存结果。
 *
 * @param {number[]} failedServerIds - 首轮与重试均失败的服务器 ID
 * @returns {Promise<Object>} 拉取次数、修复批次、保存节点和业务错误
 */
async function runPersistentSourceFailureScenario(failedServerIds) {
  const repositoryMethods = [
    'findLatestUserSubscription',
    'findSubscriptionUserById',
    'listEnabledUserCfIps',
    'listOnlineServers',
    'listNodeSnapshots',
    'listUserNodeConfigs',
    'listUserSubscriptionSources',
    'upsertSubscriptionSource',
    'saveUserSubscriptionCache'
  ];
  const originals = Object.fromEntries(
    repositoryMethods.map((method) => [method, subscriptionRepository[method]])
  );
  const servers = [1, 2, 3].map((id) => ({
    id,
    name: `persistent-server-${id}`,
    sub_url: `https://persistent.example/${id}/`,
    host: `persistent-${id}.example.com`,
    client_port: 443
  }));
  const nodeConfigs = servers.map((server) => ({
    user_id: 601,
    server_id: server.id,
    inbound_id: server.id * 10,
    sub_id: `persistent-sub-${server.id}`,
    uuid: `persistent-uuid-${server.id}`,
    remark: `direct-${server.id}`,
    protocol: 'vless',
    port: 443,
    settings: '{}',
    stream_settings: '{}'
  }));
  const failedIds = new Set(failedServerIds);
  const sources = new Map();
  const fetchCounts = new Map();
  const repairCalls = [];
  const userSyncServerIds = [];
  let savedNodes;
  let businessError;

  subscriptionRepository.findLatestUserSubscription = async () => undefined;
  subscriptionRepository.findSubscriptionUserById = async () => ({
    id: 601,
    email: 'persistent@example.com',
    sub_id: 'persistent-user-token',
    enabled: 1,
    traffic_limit: 1024
  });
  subscriptionRepository.listEnabledUserCfIps = async () => [{ ip: '1.1.1.1' }];
  subscriptionRepository.listOnlineServers = async () => servers;
  subscriptionRepository.listNodeSnapshots = async () => nodeConfigs;
  subscriptionRepository.listUserNodeConfigs = async () => nodeConfigs;
  subscriptionRepository.listUserSubscriptionSources = async () => Array.from(sources.values());
  subscriptionRepository.upsertSubscriptionSource = async (db, source) => {
    sources.set(`${source.server_id}:${source.inbound_id}`, { ...source });
  };
  subscriptionRepository.saveUserSubscriptionCache = async (db, userId, subId, nodes) => {
    savedNodes = nodes;
  };

  try {
    try {
      await userSubscriptionService.generateSubscription({}, 601, {
        info() {},
        warn() {},
        error() {}
      }, {
        dependencies: {
          async fetchOriginalSubscription(subUrl, subId) {
            const serverId = Number(subId.split('-').pop());
            fetchCounts.set(serverId, (fetchCounts.get(serverId) || 0) + 1);
            if (failedIds.has(serverId)) {
              throw new Error(`服务器 ${serverId} 持续失败`);
            }
            return Buffer.from(
              `vless://00000000-0000-0000-0000-${String(serverId).padStart(12, '0')}@127.0.0.1:443?encryption=none#node`
            ).toString('base64');
          },
          async syncSelectedServers(db, selectedServers) {
            repairCalls.push(selectedServers.map((server) => server.id));
            return {
              success: true,
              syncedCount: 0,
              failedCount: selectedServers.length,
              totalCount: selectedServers.length,
              results: selectedServers.map((server) => ({ success: false, serverId: server.id }))
            };
          },
          async syncUserToXuiServers(db, user, plan) {
            userSyncServerIds.push(plan.serverIds);
            return { success: true, successCount: failedServerIds.length, failureCount: 0 };
          }
        }
      });
    } catch (error) {
      businessError = error;
    }

    return { fetchCounts, repairCalls, userSyncServerIds, savedNodes, businessError };
  } finally {
    for (const method of repositoryMethods) {
      subscriptionRepository[method] = originals[method];
    }
  }
}

/**
 * 验证单个目标节点持续失败时只重试一次，其他成功节点仍生成并保存。
 *
 * @returns {Promise<void>}
 */
async function testPersistentSourceFailureShouldNotBlockSuccessfulNodes() {
  const scenario = await runPersistentSourceFailureScenario([2]);

  assert.deepStrictEqual(Object.fromEntries(scenario.fetchCounts), { 1: 1, 2: 2, 3: 1 });
  assert.deepStrictEqual(scenario.repairCalls, [[2]]);
  assert.deepStrictEqual(scenario.userSyncServerIds, []);
  assert.strictEqual(scenario.businessError, undefined);
  assert.strictEqual(scenario.savedNodes.length, 2);
}

/**
 * 验证全部目标节点持续失败时仅修复一轮，最终返回无可用节点业务错误。
 *
 * @returns {Promise<void>}
 */
async function testAllPersistentSourceFailuresShouldStopAfterSingleRepairRound() {
  const scenario = await runPersistentSourceFailureScenario([1, 2, 3]);

  assert.deepStrictEqual(Object.fromEntries(scenario.fetchCounts), { 1: 2, 2: 2, 3: 2 });
  assert.deepStrictEqual(scenario.repairCalls, [[1, 2, 3]]);
  assert.deepStrictEqual(scenario.userSyncServerIds, []);
  assert.strictEqual(scenario.savedNodes, undefined);
  assert(scenario.businessError);
  assert.strictEqual(scenario.businessError.code, 500);
  assert.strictEqual(scenario.businessError.message, '未生成任何可用节点，请稍后重试');
}

/**
 * 验证非首次生成发生增量节点同步时，汇总按实际远程服务器去重统计。
 *
 * @returns {Promise<void>}
 */
async function testExistingSubscriptionIncrementalSyncShouldReportSummary() {
  const methods = ['findLatestUserSubscription', 'findSubscriptionUserById', 'listEnabledUserCfIps',
    'listOnlineServers', 'listNodeSnapshots', 'listUserNodeConfigs', 'listUserSubscriptionSources',
    'upsertSubscriptionSource', 'saveUserSubscriptionCache'];
  const originals = Object.fromEntries(methods.map((method) => [method, subscriptionRepository[method]]));
  const servers = [1, 2, 3].map((id) => ({
    id, name: `summary-${id}`, sub_url: `https://summary/${id}/`,
    host: `summary-${id}.example.com`, client_port: 443
  }));
  const configs = servers.map((server) => ({
    user_id: 701, server_id: server.id, inbound_id: server.id * 10,
    sub_id: `summary-sub-${server.id}`, uuid: `summary-uuid-${server.id}`,
    remark: `direct-${server.id}`, protocol: 'vless', port: 443,
    settings: '{}', stream_settings: '{}'
  }));
  const now = Math.floor(Date.now() / 1000);
  const sources = new Map(configs.map((config) => {
    const server = servers[config.server_id - 1];
    return [`${config.server_id}:${config.inbound_id}`, {
      user_id: 701, server_id: config.server_id, inbound_id: config.inbound_id,
      sub_id: config.sub_id, original_link: `vless://old-${config.server_id}`,
      node_fingerprint: computeNodeFingerprint(config),
      server_fingerprint: config.server_id === 2 ? '损坏指纹' : computeServerFingerprint(server),
      fetched_at: now
    }];
  }));
  const logs = [];
  const syncCalls = [];

  subscriptionRepository.findLatestUserSubscription = async () => ({ id: 1 });
  subscriptionRepository.findSubscriptionUserById = async () => ({
    id: 701, email: 'summary@example.com', sub_id: 'summary-token', enabled: 1, traffic_limit: 1024
  });
  subscriptionRepository.listEnabledUserCfIps = async () => [{ ip: '1.1.1.1' }];
  subscriptionRepository.listOnlineServers = async () => servers;
  subscriptionRepository.listNodeSnapshots = async () => configs;
  subscriptionRepository.listUserNodeConfigs = async () => configs;
  subscriptionRepository.listUserSubscriptionSources = async () => Array.from(sources.values());
  subscriptionRepository.upsertSubscriptionSource = async (db, source) => {
    sources.set(`${source.server_id}:${source.inbound_id}`, { ...source });
  };
  subscriptionRepository.saveUserSubscriptionCache = async () => {};

  try {
    await userSubscriptionService.generateSubscription({}, 701, {
      info(message) { logs.push(message); }, warn() {}, error() {}
    }, {
      dependencies: {
        async syncSelectedServers(db, selectedServers) {
          syncCalls.push(...selectedServers.map((server) => server.id));
          return {
            success: true,
            syncedCount: selectedServers.length,
            failedCount: 0,
            totalCount: selectedServers.length,
            results: selectedServers.map((server) => ({ success: true, serverId: server.id }))
          };
        },
        async syncUserToXuiServers() {
          return { success: true, successCount: 1, failureCount: 0 };
        },
        async fetchOriginalSubscription(subUrl, subId) {
          const id = Number(subId.split('-').pop());
          return Buffer.from(`vless://00000000-0000-0000-0000-${String(id).padStart(12, '0')}@127.0.0.1:443?encryption=none#node`).toString('base64');
        }
      }
    });

    assert.deepStrictEqual(syncCalls, [2, 2]);
    const summary = logs.find((message) => message.includes('订阅生成汇总:'));
    assert(summary.includes('user=summary@example.com'));
    assert(summary.includes('localServers=[summary-1, summary-3]'));
    assert(summary.includes('remoteServers=[summary-2]'));
    assert(summary.includes('inboundSuccess=1'));
    assert(summary.includes('inboundFailed=0'));
  } finally {
    for (const method of methods) subscriptionRepository[method] = originals[method];
  }
}

/**
 * 顺序执行订阅生成性能回归测试，任一失败都会让进程以非零状态退出。
 *
 * @returns {Promise<void>}
 */
async function run() {
  await testOriginalSubscriptionShouldUsePerRequestTimeout();
  await testInterruptedOriginalSubscriptionShouldReject();
  await testApiClientShouldWriteTimeoutToAxiosConfig();
  await testXuiServiceShouldForwardInboundOptions();
  testInboundRequestTimeoutConstant();
  await testInboundRequestTimeoutNormalization();
  testCompleteLocalSnapshotShouldSkipRemoteSync();
  testOnlyGapServersShouldBeSelected();
  await testSelectedServerSyncShouldLimitConcurrencyAndIsolateFailures();
  await testTargetedUserSyncShouldReuseInboundSnapshotCache();
  await testGenerateSubscriptionShouldWireTargetedSyncDependencies();
  await testGenerateSubscriptionShouldCreateRequestScopedInboundCache();
  await testExistingGenerationMissingSnapshotsShouldUseConcurrentBatchSync();
  await testSourceRefreshShouldLimitConcurrencyAndKeepPartialSuccess();
  await testSourceRefreshShouldFailWhenNoNodeCanBeComposed();
  await testSourceRefreshShouldReuseValidOldCache();
  await testRepairShouldRetryOnlyFailedNodesWithoutValidCache();
  await testSourceRefreshShouldRejectInvalidOldCache();
  await testSourceRefreshShouldFailWithInvalidServerFingerprintCache();
  await testSourceRefreshShouldFailWithExpiredCache();
  await testSourceRefreshShouldWrapExternalFailuresWithoutMutation();
  await testMissingSourceUrlShouldLogItemDuration();
  await testFirstGenerationShouldRepairFailedServerOnlyOnce();
  await testPersistentSourceFailureShouldNotBlockSuccessfulNodes();
  await testAllPersistentSourceFailuresShouldStopAfterSingleRepairRound();
  await testExistingSubscriptionIncrementalSyncShouldReportSummary();
  console.log('subscription generation performance tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
