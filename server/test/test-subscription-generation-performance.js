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
  assert(logs.includes('user=91, server=7, inbound=107, duration='));
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
  const frozenLog = scenario.logMessages.find((message) => message.includes('server=11, inbound=111'));
  const stringLog = scenario.logMessages.find((message) => message.includes('server=12, inbound=112'));

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
    (message) => message.includes('server=11, inbound=111')
  );

  assert.strictEqual(scenario.savedNodes.length, 24);
  assert(missingUrlLog);
  assert(Number(missingUrlLog.match(/duration=(\d+)ms/)[1]) < 30);
}

/**
 * 验证首次模板失败仅按服务器做一轮定向修复，并复用同一 inbound 快照缓存。
 * 核心分支：服务器 2 的节点首次及重试均失败，成功节点不重复拉取，且不存在第三次拉取或第二轮修复。
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
  const sources = new Map();
  const fetchCounts = new Map();
  const repairCalls = [];
  const userSyncPlans = [];
  const logs = [];
  const inboundSnapshotCache = new Map();
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
  subscriptionRepository.listUserNodeConfigs = async () => nodeConfigs;
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
          const serverId = Number(subId.split('-').pop());
          fetchCounts.set(serverId, (fetchCounts.get(serverId) || 0) + 1);
          if (serverId === 2) {
            throw new Error('sensitive-error private-user-token private-uuid-2 api-token-2');
          }
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
            syncedCount: 0,
            failedCount: selectedServers.length,
            totalCount: selectedServers.length,
            results: selectedServers.map((server) => ({ success: false, serverId: server.id }))
          };
        },
        async syncUserToXuiServers(db, user, plan) {
          userSyncPlans.push(plan);
          return { success: true, successCount: 1, failureCount: 0 };
        }
      }
    });

    assert.strictEqual(result, 'private-user-token');
    assert.deepStrictEqual(repairCalls.map((call) => call.ids), [[2]]);
    assert.strictEqual(repairCalls[0].cache, inboundSnapshotCache);
    assert.deepStrictEqual(userSyncPlans.map((plan) => plan.serverIds), [[2]]);
    assert.strictEqual(userSyncPlans[0].inboundSnapshotCache, inboundSnapshotCache);
    assert.deepStrictEqual(Object.fromEntries(fetchCounts), { 1: 1, 2: 2, 3: 1 });
    assert.strictEqual(savedNodes.length, 2);

    const summary = logs.find((message) => message.includes('订阅生成汇总:'));
    assert(summary);
    for (const field of [
      'user=501',
      'localServers=3',
      'remoteServers=0',
      'inboundSuccess=0',
      'inboundFailed=1',
      'sourceSuccess=2',
      'sourceFailed=2',
      'repairServers=1',
      'nodes=2',
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
  await testSourceRefreshShouldLimitConcurrencyAndKeepPartialSuccess();
  await testSourceRefreshShouldFailWhenNoNodeCanBeComposed();
  await testSourceRefreshShouldReuseValidOldCache();
  await testSourceRefreshShouldRejectInvalidOldCache();
  await testSourceRefreshShouldFailWithInvalidServerFingerprintCache();
  await testSourceRefreshShouldFailWithExpiredCache();
  await testSourceRefreshShouldWrapExternalFailuresWithoutMutation();
  await testMissingSourceUrlShouldLogItemDuration();
  await testFirstGenerationShouldRepairFailedServerOnlyOnce();
  console.log('subscription generation performance tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
