/**
 * 家宽 IP 服务层测试。
 * 使用内存仓储和假的 XUI service 验证同步状态机，不访问真实数据库或 3X-UI。
 */

const assert = require('assert');
const homeProxiesService = require('../services/admin/home-proxies-service');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createMemoryRepository(initialState = {}) {
  const state = {
    nextId: initialState.nextId || 1,
    homeProxies: clone(initialState.homeProxies || []),
    servers: clone(initialState.servers || []),
    deletedIds: []
  };

  return {
    state,
    async listHomeProxies() {
      return clone(state.homeProxies).sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
    },
    async findHomeProxyById(db, id) {
      const item = state.homeProxies.find((proxy) => Number(proxy.id) === Number(id));
      return item ? clone(item) : undefined;
    },
    async findHomeProxyByTag(db, tag) {
      const item = state.homeProxies.find((proxy) => proxy.tag === tag);
      return item ? clone(item) : undefined;
    },
    async createHomeProxy(db, payload) {
      const row = {
        id: state.nextId,
        tag: payload.tag,
        address: payload.address,
        port: payload.port,
        username: payload.username,
        password: payload.password,
        sync_status: 'pending',
        failed_server_ids: '[]',
        last_sync_at: null,
        last_sync_success_count: 0,
        last_sync_failed_count: 0,
        last_sync_message: '',
        created_at: state.nextId,
        updated_at: state.nextId
      };
      state.homeProxies.push(row);
      state.nextId += 1;
      return { lastInsertRowid: row.id };
    },
    async updateHomeProxy(db, id, payload) {
      const item = state.homeProxies.find((proxy) => Number(proxy.id) === Number(id));
      Object.assign(item, {
        tag: payload.tag,
        address: payload.address,
        port: payload.port,
        username: payload.username,
        password: payload.password,
        sync_status: 'pending',
        failed_server_ids: '[]',
        last_sync_success_count: 0,
        last_sync_failed_count: 0,
        last_sync_message: '配置已更新，等待重新同步'
      });
    },
    async updateSyncState(db, id, payload) {
      const item = state.homeProxies.find((proxy) => Number(proxy.id) === Number(id));
      Object.assign(item, {
        sync_status: payload.syncStatus,
        failed_server_ids: JSON.stringify(payload.failedServerIds || []),
        last_sync_at: payload.lastSyncAt,
        last_sync_success_count: payload.successCount,
        last_sync_failed_count: payload.failedCount,
        last_sync_message: payload.message
      });
    },
    async deleteHomeProxy(db, id) {
      state.deletedIds.push(Number(id));
      state.homeProxies = state.homeProxies.filter((proxy) => Number(proxy.id) !== Number(id));
    },
    async listOnlineServers() {
      return clone(state.servers.filter((server) => Number(server.status) === 1));
    },
    async listServersByIds(db, ids) {
      const idSet = new Set((ids || []).map(Number));
      return clone(state.servers.filter((server) => idSet.has(Number(server.id))));
    }
  };
}

function createFakeXuiFactory(configs, calls, failingServerIds = [], options = {}) {
  return async (apiUrl) => {
    const serverId = Number(String(apiUrl).replace('server-', ''));
    return {
      async getXrayConfig() {
        calls.get.push(serverId);
        const payload = {
          xraySetting: configs[serverId] || { outbounds: [] },
          outboundTestUrl: 'https://www.google.com/generate_204'
        };
        return options.wrapXrayResponseAsString
          ? { success: true, obj: JSON.stringify(payload) }
          : { success: true, obj: payload };
      },
      async updateXrayConfig(xraySetting, outboundTestUrlOrOptions) {
        calls.update.push(serverId);
        if (failingServerIds.includes(serverId)) {
          throw new Error(`server ${serverId} failed`);
        }
        calls.outboundTestUrls = calls.outboundTestUrls || [];
        if (typeof outboundTestUrlOrOptions === 'string') {
          calls.outboundTestUrls.push(outboundTestUrlOrOptions);
        }
        configs[serverId] = clone(xraySetting);
        return { success: true, msg: 'ok' };
      }
    };
  };
}

function installTestDependencies(repository, factory) {
  homeProxiesService.setRepositoryForTest(repository);
  homeProxiesService.setXuiServiceFactoryForTest(factory);
}

async function testCreateRejectsDuplicateTag() {
  const repository = createMemoryRepository({
    homeProxies: [
      {
        id: 1,
        tag: 'local-ip-lax',
        address: '1.1.1.1',
        port: 1080,
        username: 'u',
        password: 'p',
        sync_status: 'pending',
        failed_server_ids: '[]'
      }
    ]
  });
  installTestDependencies(repository, createFakeXuiFactory({}, { get: [], update: [] }));

  await assert.rejects(
    () => homeProxiesService.createHomeProxy({}, {
      tag: 'local-ip-lax',
      address: '2.2.2.2',
      port: 1080,
      user: 'u2',
      pass: 'p2'
    }),
    /tag 已存在/
  );
}

async function testUpdateResetsPendingAndFailedServers() {
  const repository = createMemoryRepository({
    homeProxies: [
      {
        id: 1,
        tag: 'old',
        address: '1.1.1.1',
        port: 1080,
        username: 'u',
        password: 'p',
        sync_status: 'partial_failed',
        failed_server_ids: '[2,3]',
        last_sync_success_count: 1,
        last_sync_failed_count: 2,
        last_sync_message: '旧失败'
      }
    ]
  });
  installTestDependencies(repository, createFakeXuiFactory({}, { get: [], update: [] }));

  const result = await homeProxiesService.updateHomeProxy({}, 1, {
    tag: 'new',
    address: '2.2.2.2',
    port: 1081,
    user: 'u2',
    pass: 'p2'
  });

  assert.strictEqual(result.sync_status, 'pending');
  assert.deepStrictEqual(result.failed_server_ids, []);
  assert.strictEqual(result.last_sync_success_count, 0);
  assert.strictEqual(result.last_sync_failed_count, 0);
}

async function testSyncAllOnlineServersWhenNoFailures() {
  const configs = {
    1: { outbounds: [] },
    2: { outbounds: [] }
  };
  const calls = { get: [], update: [] };
  const repository = createMemoryRepository({
    homeProxies: [
      {
        id: 1,
        tag: 'local-ip-lax',
        address: '104.206.10.19',
        port: 6716,
        username: 'user1',
        password: 'pass1',
        sync_status: 'pending',
        failed_server_ids: '[]'
      }
    ],
    servers: [
      { id: 1, name: '服务器一', api_url: 'server-1', api_token: 'token', status: 1 },
      { id: 2, name: '服务器二', api_url: 'server-2', api_token: 'token', status: 1 }
    ]
  });
  installTestDependencies(repository, createFakeXuiFactory(configs, calls));

  const result = await homeProxiesService.syncHomeProxy({}, 1);

  assert.deepStrictEqual(calls.update.sort(), [1, 2]);
  assert.strictEqual(result.sync_status, 'success');
  assert.strictEqual(configs[1].outbounds[0].tag, 'local-ip-lax');
  assert.strictEqual(configs[2].outbounds[0].settings.servers[0].address, '104.206.10.19');
}

async function testSyncRetriesOnlyFailedServers() {
  const configs = {
    1: { outbounds: [] },
    2: { outbounds: [] },
    3: { outbounds: [] }
  };
  const calls = { get: [], update: [] };
  const repository = createMemoryRepository({
    homeProxies: [
      {
        id: 1,
        tag: 'retry-tag',
        address: '2.2.2.2',
        port: 1080,
        username: 'u',
        password: 'p',
        sync_status: 'partial_failed',
        failed_server_ids: '[2]'
      }
    ],
    servers: [
      { id: 1, name: '服务器一', api_url: 'server-1', api_token: 'token', status: 1 },
      { id: 2, name: '服务器二', api_url: 'server-2', api_token: 'token', status: 1 },
      { id: 3, name: '服务器三', api_url: 'server-3', api_token: 'token', status: 1 }
    ]
  });
  installTestDependencies(repository, createFakeXuiFactory(configs, calls));

  const result = await homeProxiesService.syncHomeProxy({}, 1);

  assert.deepStrictEqual(calls.update, [2]);
  assert.strictEqual(result.sync_status, 'success');
  assert.deepStrictEqual(result.failed_server_ids, []);
}

async function testSyncKeepsOfflineFailedServer() {
  const configs = {
    2: { outbounds: [] }
  };
  const calls = { get: [], update: [] };
  const repository = createMemoryRepository({
    homeProxies: [
      {
        id: 1,
        tag: 'offline-retry',
        address: '3.3.3.3',
        port: 1080,
        username: 'u',
        password: 'p',
        sync_status: 'partial_failed',
        failed_server_ids: '[2,3]'
      }
    ],
    servers: [
      { id: 2, name: '在线失败服务器', api_url: 'server-2', api_token: 'token', status: 1 },
      { id: 3, name: '离线失败服务器', api_url: 'server-3', api_token: 'token', status: 0 }
    ]
  });
  installTestDependencies(repository, createFakeXuiFactory(configs, calls));

  const result = await homeProxiesService.syncHomeProxy({}, 1);

  assert.deepStrictEqual(calls.update, [2]);
  assert.strictEqual(result.sync_status, 'partial_failed');
  assert.deepStrictEqual(result.failed_server_ids, [3]);
  assert.deepStrictEqual(result.failed_server_names, ['离线失败服务器']);
}

async function testDeleteKeepsLocalRecordWhenRemoteDeleteFails() {
  const configs = {
    1: { outbounds: [{ tag: 'delete-tag', protocol: 'socks', settings: {} }] },
    2: { outbounds: [{ tag: 'delete-tag', protocol: 'socks', settings: {} }] }
  };
  const calls = { get: [], update: [] };
  const repository = createMemoryRepository({
    homeProxies: [
      {
        id: 1,
        tag: 'delete-tag',
        address: '4.4.4.4',
        port: 1080,
        username: 'u',
        password: 'p',
        sync_status: 'success',
        failed_server_ids: '[]',
        last_sync_at: 100
      }
    ],
    servers: [
      { id: 1, name: '服务器一', api_url: 'server-1', api_token: 'token', status: 1 },
      { id: 2, name: '服务器二', api_url: 'server-2', api_token: 'token', status: 1 }
    ]
  });
  installTestDependencies(repository, createFakeXuiFactory(configs, calls, [2]));

  await assert.rejects(
    () => homeProxiesService.deleteHomeProxy({}, 1),
    /远端 outbound 未全部删除/
  );

  assert.strictEqual(repository.state.homeProxies.length, 1);
  assert.deepStrictEqual(repository.state.deletedIds, []);
  assert.strictEqual(repository.state.homeProxies[0].sync_status, 'delete_failed');
  assert.deepStrictEqual(JSON.parse(repository.state.homeProxies[0].failed_server_ids), [2]);
}

async function testWrappedXrayResponseKeepsExistingOutbounds() {
  const configs = {
    1: { outbounds: [] }
  };
  const calls = { get: [], update: [], outboundTestUrls: [] };
  const repository = createMemoryRepository({
    homeProxies: [
      {
        id: 1,
        tag: 'first-tag',
        address: '5.5.5.5',
        port: 1080,
        username: 'u1',
        password: 'p1',
        sync_status: 'pending',
        failed_server_ids: '[]'
      },
      {
        id: 2,
        tag: 'second-tag',
        address: '6.6.6.6',
        port: 1081,
        username: 'u2',
        password: 'p2',
        sync_status: 'pending',
        failed_server_ids: '[]'
      }
    ],
    servers: [
      { id: 1, name: '服务器一', api_url: 'server-1', api_token: 'token', status: 1 }
    ]
  });
  installTestDependencies(repository, createFakeXuiFactory(configs, calls, [], {
    wrapXrayResponseAsString: true
  }));

  await homeProxiesService.syncHomeProxy({}, 1);
  await homeProxiesService.syncHomeProxy({}, 2);

  assert.deepStrictEqual(
    configs[1].outbounds.map((outbound) => outbound.tag),
    ['first-tag', 'second-tag']
  );
  assert.deepStrictEqual(calls.outboundTestUrls, [
    'https://www.google.com/generate_204',
    'https://www.google.com/generate_204'
  ]);
}

async function run() {
  try {
    await testCreateRejectsDuplicateTag();
    await testUpdateResetsPendingAndFailedServers();
    await testSyncAllOnlineServersWhenNoFailures();
    await testSyncRetriesOnlyFailedServers();
    await testSyncKeepsOfflineFailedServer();
    await testDeleteKeepsLocalRecordWhenRemoteDeleteFails();
    await testWrappedXrayResponseKeepsExistingOutbounds();
  } finally {
    homeProxiesService.resetTestDependencies();
  }

  console.log('家宽 IP 服务层测试通过');
}

run().catch((error) => {
  console.error('家宽 IP 服务层测试失败:', error);
  process.exit(1);
});
