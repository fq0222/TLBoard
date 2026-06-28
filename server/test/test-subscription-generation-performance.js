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
    'listUserSubscriptionSources'
  ];
  const originals = Object.fromEntries(
    repositoryMethods.map((method) => [method, subscriptionRepository[method]])
  );
  const originalGetInstance = XuiService.getInstance;
  const servers = [
    { id: 1, name: 'one', api_url: 'http://one', api_token: 'token' },
    { id: 2, name: 'two', api_url: 'http://two', api_token: 'token' },
    { id: 3, name: 'three', api_url: 'http://three', api_token: 'token' }
  ];
  const user = {
    id: 9,
    email: 'user@example.com',
    sub_id: 'sub-token',
    enabled: 1,
    traffic_limit: 1024
  };
  const logger = { info() {}, warn() {}, error() {} };
  let remoteCalls = 0;

  subscriptionRepository.findLatestUserSubscription = async () => undefined;
  subscriptionRepository.findSubscriptionUserById = async () => user;
  subscriptionRepository.listEnabledUserCfIps = async () => [{ ip: '1.1.1.1' }];
  subscriptionRepository.listOnlineServers = async () => servers;
  subscriptionRepository.listUserSubscriptionSources = async () => [];
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
      { server_id: 1, inbound_id: 11, sub_id: 'sub-1' },
      { server_id: 2, inbound_id: 21, sub_id: 'sub-2' },
      { server_id: 3, inbound_id: 31, sub_id: 'sub-3' }
    ];
    let selectedSyncCalls = 0;
    await assert.rejects(
      userSubscriptionService.generateSubscription({}, user.id, logger, {
        dependencies: {
          async syncSelectedServers() {
            selectedSyncCalls += 1;
            return { success: true, syncedCount: 0, failedCount: 0, totalCount: 0, results: [] };
          }
        }
      }),
      (error) => error.code === 500
    );
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
      { server_id: 1, inbound_id: 11, sub_id: 'sub-1' }
    ];
    await assert.rejects(
      userSubscriptionService.generateSubscription({}, user.id, logger, {
        inboundSnapshotCache,
        dependencies: {
          async syncSelectedServers(db, selectedServers) {
            selectedServerIds.push(...selectedServers.map((server) => server.id));
            return { success: true, syncedCount: 2, failedCount: 0, totalCount: 2, results: [] };
          },
          async syncUserToXuiServers(db, syncedUser, plan) {
            receivedUserSyncPlan = plan;
            return { success: true, successCount: 1, failureCount: 0 };
          }
        }
      }),
      (error) => error.code === 500
    );

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
  console.log('subscription generation performance tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
