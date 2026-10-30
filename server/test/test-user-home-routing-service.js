/**
 * 用户家宽 routing 服务层测试。
 * 使用内存仓储和假的 XUI service 验证同步规则，不访问真实数据库或 3X-UI。
 */

const assert = require('assert');
const homeRoutingService = require('../services/shared/home-routing-service');
const homeRoutingRepository = require('../repositories/user-home-routing-repository');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createEntitlement(overrides = {}) {
  return {
    user_id: 1,
    email: 'user@example.com',
    home_plan_id: 10,
    home_expire_at: Math.floor(Date.now() / 1000) + 86400,
    home_plan_name: '洛杉矶家宽 IP',
    plan_type: 'home_ip',
    home_proxy_tag: 'local-ip-lax',
    home_proxy_id: 3,
    proxy_tag: 'local-ip-lax',
    ...overrides
  };
}

function createMemoryRepository(initialState = {}) {
  const state = {
    entitlement: initialState.entitlement,
    route: initialState.route,
    servers: initialState.servers || [],
    savedRoutes: [],
    deletedRoutes: []
  };

  return {
    state,
    async findHomeRoutingEntitlement() {
      return state.entitlement ? clone(state.entitlement) : undefined;
    },
    async findUserHomeRoutingContext() {
      return state.entitlement
        ? {
            user_id: state.entitlement.user_id,
            email: state.entitlement.email
          }
        : undefined;
    },
    async findUserHomeRoute() {
      return state.route ? clone(state.route) : undefined;
    },
    async listOnlineServers() {
      return clone(state.servers.filter((server) => Number(server.status) === 1));
    },
    async listServersByIds(db, ids) {
      const idSet = new Set((ids || []).map(Number));
      return clone(state.servers.filter((server) => idSet.has(Number(server.id))));
    },
    async upsertUserHomeRoute(db, payload) {
      state.savedRoutes.push(clone(payload));
      state.route = {
        user_id: payload.userId,
        home_proxy_tag: payload.homeProxyTag,
        server_ids: JSON.stringify(payload.serverIds),
        pending_cleanup_server_ids: JSON.stringify(payload.pendingCleanupServerIds || []),
        last_synced_at: payload.syncedAt,
        last_sync_status: 'success',
        last_sync_message: payload.message || '',
        show_home_node_prefix: payload.showHomeNodePrefix
      };
    },
    async deleteUserHomeRoute(db, userId) {
      state.deletedRoutes.push({ userId });
      state.route = undefined;
    }
  };
}

function createServer(id, name = `服务器${id}`, status = 1) {
  return {
    id,
    name,
    api_url: `server-${id}`,
    api_token: `token-${id}`,
    panel_version: '3.0.2',
    status
  };
}

function createFakeXuiFactory(configs, calls, failing = {}) {
  return async (apiUrl) => {
    const serverId = Number(String(apiUrl).replace('server-', ''));
    calls.factory = calls.factory || [];
    calls.factory.push(serverId);
    calls.events = calls.events || [];
    return {
      async getXrayConfig() {
        calls.get.push(serverId);
        calls.events.push(`get:${serverId}`);
        if (failing.get?.includes(serverId)) {
          throw new Error(`get failed ${serverId}`);
        }
        return {
          success: true,
          obj: {
            xraySetting: configs[serverId],
            outboundTestUrl: 'https://www.google.com/generate_204'
          }
        };
      },
      async getInbounds() {
        calls.inbounds = calls.inbounds || [];
        calls.inbounds.push(serverId);
        if (failing.inbounds?.includes(serverId)) {
          return { success: false, message: `inbounds failed ${serverId}`, data: [] };
        }
        return {
          success: true,
          data: clone(configs[serverId]?.inbounds || [])
        };
      },
      async updateXrayConfig(xraySetting) {
        calls.update.push(serverId);
        calls.events.push(`update:${serverId}`);
        if (failing.update?.includes(serverId)) {
          throw new Error(`update failed ${serverId}`);
        }
        configs[serverId] = clone(xraySetting);
        return { success: true, msg: 'ok' };
      }
    };
  };
}

function installTestDependencies(repository, factory) {
  homeRoutingService.setRepositoryForTest(repository);
  homeRoutingService.setXuiServiceFactoryForTest(factory);
}

async function testRejectsMissingEntitlement() {
  const repository = createMemoryRepository({
    entitlement: undefined,
    servers: [createServer(1)]
  });
  installTestDependencies(repository, createFakeXuiFactory({}, { get: [], update: [] }));

  await assert.rejects(
    () => homeRoutingService.updateHomeRouting({}, 1, { server_ids: [1] }),
    /购买家宽 IP 套餐后可配置/
  );
  assert.strictEqual(repository.state.savedRoutes.length, 0);
}

function testCooldownConstantIsFiveMinutes() {
  assert.strictEqual(homeRoutingService.HOME_ROUTING_COOLDOWN_SECONDS, 5 * 60);
}

async function testRejectsMoreThanTwoServers() {
  const repository = createMemoryRepository({
    entitlement: createEntitlement(),
    servers: [createServer(1), createServer(2), createServer(3)]
  });
  installTestDependencies(repository, createFakeXuiFactory({}, { get: [], update: [] }));

  await assert.rejects(
    () => homeRoutingService.updateHomeRouting({}, 1, { server_ids: [1, 2, 3] }),
    /最多选择两台服务器/
  );
  assert.strictEqual(repository.state.savedRoutes.length, 0);
}

async function testBuildsInboundTagsFromXrayConfig() {
  const configs = {
    1: {
      inbounds: [
        { tag: 'in-21443-tcp' },
        { tag: 'in-28905-udp' },
        { tag: 'in-21443-tcp' },
        { tag: '' }
      ],
      routing: { rules: [] }
    }
  };
  const calls = { get: [], update: [] };
  const repository = createMemoryRepository({
    entitlement: createEntitlement(),
    servers: [createServer(1)]
  });
  installTestDependencies(repository, createFakeXuiFactory(configs, calls));

  await homeRoutingService.updateHomeRouting({}, 1, { server_ids: [1] });

  assert.deepStrictEqual(configs[1].routing.rules[0].inboundTag, ['in-21443-tcp', 'in-28905-udp']);
  assert.strictEqual(configs[1].routing.rules[0].outboundTag, 'local-ip-lax');
  assert.strictEqual(configs[1].routing.rules[0].type, 'field');
  assert.deepStrictEqual(configs[1].routing.rules[0].user, ['user@example.com']);
  assert.deepStrictEqual(repository.state.savedRoutes[0].serverIds, [1]);
}

async function testFallsBackToLiveInboundsWhenXrayConfigHasNoInbounds() {
  const configs = {
    1: {
      inbounds: [
        { tag: 'api', protocol: 'tunnel' },
        { tag: 'in-21443-tcp', protocol: 'vless' },
        { tag: 'in-28905-udp', protocol: 'hysteria' }
      ],
      routing: { rules: [] }
    }
  };
  const calls = { get: [], update: [], inbounds: [] };
  const repository = createMemoryRepository({
    entitlement: createEntitlement(),
    servers: [createServer(1)]
  });
  installTestDependencies(repository, async (apiUrl) => {
    const service = await createFakeXuiFactory(configs, calls)(apiUrl);
    return {
      ...service,
      async getXrayConfig() {
        calls.get.push(1);
        return {
          success: true,
          obj: {
            xraySetting: {
              outbounds: [],
              routing: { rules: [] }
            },
            outboundTestUrl: 'https://www.google.com/generate_204'
          }
        };
      }
    };
  });

  await homeRoutingService.updateHomeRouting({}, 1, { server_ids: [1] });

  assert.deepStrictEqual(calls.inbounds, [1]);
  assert.deepStrictEqual(configs[1].routing.rules[0].inboundTag, ['in-21443-tcp', 'in-28905-udp']);
}

async function testUnwrapsNestedXraySettingResponse() {
  const rawXraySetting = {
    inbounds: [
      { tag: 'api' },
      { tag: 'in-21443-tcp' },
      { tag: 'in-28905-udp' }
    ],
    routing: { rules: [] }
  };
  const wrapped = {
    success: true,
    obj: JSON.stringify({
      xraySetting: JSON.stringify({
        xraySetting: JSON.stringify(rawXraySetting),
        outboundTestUrl: 'https://www.google.com/generate_204'
      })
    })
  };

  const normalized = homeRoutingService.__testables.normalizeXraySetting(wrapped);

  assert.deepStrictEqual(
    homeRoutingService.__testables.extractInboundTags(normalized),
    ['in-21443-tcp', 'in-28905-udp']
  );
}

async function testDeletesOldServerRuleAndWritesNewRule() {
  const configs = {
    1: {
      inbounds: [{ tag: 'old-in' }],
      routing: {
        rules: [
          { type: 'field', outboundTag: 'local-ip-lax', user: ['user@example.com'], inboundTag: ['old-in'] },
          { type: 'field', outboundTag: 'other-tag', user: ['user@example.com'], inboundTag: ['old-in'] }
        ]
      }
    },
    2: {
      inbounds: [{ tag: 'new-in' }],
      routing: { rules: [] }
    }
  };
  const calls = { get: [], update: [] };
  const repository = createMemoryRepository({
    entitlement: createEntitlement(),
    route: {
      user_id: 1,
      home_proxy_tag: 'local-ip-lax',
      server_ids: '[1]',
      last_synced_at: Math.floor(Date.now() / 1000) - 3600
    },
    servers: [createServer(1), createServer(2)]
  });
  installTestDependencies(repository, createFakeXuiFactory(configs, calls));

  await homeRoutingService.updateHomeRouting({}, 1, { server_ids: [2] });

  assert.strictEqual(configs[1].routing.rules.length, 1);
  assert.strictEqual(configs[1].routing.rules[0].outboundTag, 'other-tag');
  assert.deepStrictEqual(configs[2].routing.rules, [
    { type: 'field', inboundTag: ['new-in'], outboundTag: 'local-ip-lax', user: ['user@example.com'] }
  ]);
  assert.deepStrictEqual(repository.state.savedRoutes[0].serverIds, [2]);
  assert.deepStrictEqual(calls.events, ['get:1', 'update:1', 'get:2', 'update:2']);
}

/**
 * 验证旧绑定和历史 pending 离线时不调用 XUI，绑定成功后保留待清理 ID 并返回跳过提示。
 * @returns {Promise<void>} 新服务器绑定成功且仅离线目标留在 pending。
 */
async function testOfflineCleanupTargetsAreSkippedBeforeBinding() {
  const configs = { 2: { inbounds: [{ tag: 'new-in' }], routing: { rules: [] } } };
  const calls = { get: [], update: [] };
  const repository = createMemoryRepository({
    entitlement: createEntitlement(),
    route: {
      home_proxy_tag: 'local-ip-lax', server_ids: '[1]', pending_cleanup_server_ids: '[3,1]',
      last_synced_at: Math.floor(Date.now() / 1000) - 3600
    },
    servers: [createServer(1, '离线旧服务器', 0), createServer(2), createServer(3, '离线待清理服务器', 0)]
  });
  installTestDependencies(repository, createFakeXuiFactory(configs, calls));

  const result = await homeRoutingService.updateHomeRouting({}, 1, { server_ids: [2] });

  assert.deepStrictEqual(calls.factory, [2]);
  assert.deepStrictEqual(repository.state.savedRoutes[0].serverIds, [2]);
  assert.deepStrictEqual(repository.state.savedRoutes[0].pendingCleanupServerIds, [1, 3]);
  assert.deepStrictEqual(result.skipped_cleanup_servers.map((server) => ({ id: server.id, name: server.name })), [
    { id: 1, name: '离线旧服务器' }, { id: 3, name: '离线待清理服务器' }
  ]);
  assert.ok(result.skipped_cleanup_servers.every((server) => typeof server.message === 'string' && server.message));
  assert.deepStrictEqual(configs[2].routing.rules[0].user, ['user@example.com']);
}

/**
 * 验证在线旧服务器删除失败时阻断全部新绑定请求，保留原路由和冷却时间。
 * @returns {Promise<void>} 失败为 4107，且新服务器尚未创建 XUI 实例。
 */
async function testCleanupFailurePreventsEveryNewServerRequest() {
  const calls = { get: [], update: [] };
  const configs = {
    1: { inbounds: [{ tag: 'old-in' }], routing: { rules: [
      { type: 'field', outboundTag: 'local-ip-lax', user: ['user@example.com'] }
    ] } },
    2: { inbounds: [{ tag: 'new-in' }], routing: { rules: [] } }
  };
  const originalRoute = {
    home_proxy_tag: 'local-ip-lax', server_ids: '[1]', pending_cleanup_server_ids: '[]',
    last_synced_at: Math.floor(Date.now() / 1000) - 3600
  };
  const repository = createMemoryRepository({
    entitlement: createEntitlement(), route: originalRoute, servers: [createServer(1), createServer(2)]
  });
  installTestDependencies(repository, createFakeXuiFactory(configs, calls, { update: [1] }));

  await assert.rejects(
    () => homeRoutingService.updateHomeRouting({}, 1, { server_ids: [2] }),
    (error) => error.code === 4107 && error.data.failed_servers[0].id === 1
  );

  assert.deepStrictEqual(calls.factory, [1]);
  assert.deepStrictEqual(calls.events, ['get:1', 'update:1']);
  assert.strictEqual(repository.state.savedRoutes.length, 0);
  assert.deepStrictEqual(repository.state.route, originalRoute);
  assert.deepStrictEqual(configs[2].routing.rules, []);
}

/**
 * 验证历史 pending 恢复在线后先删除其规则，完成后才处理新的服务器绑定。
 * @returns {Promise<void>} pending 规则清空并从成功保存的记录中移除。
 */
async function testOnlinePendingIsCleanedBeforeNextBinding() {
  const calls = { get: [], update: [] };
  const configs = {
    1: { inbounds: [{ tag: 'old-in' }], routing: { rules: [
      { type: 'field', outboundTag: 'local-ip-lax', user: ['user@example.com'] }
    ] } },
    2: { inbounds: [{ tag: 'new-in' }], routing: { rules: [] } }
  };
  const repository = createMemoryRepository({
    entitlement: createEntitlement(),
    route: { home_proxy_tag: 'local-ip-lax', server_ids: '[]', pending_cleanup_server_ids: '[1]' },
    servers: [createServer(1), createServer(2)]
  });
  installTestDependencies(repository, createFakeXuiFactory(configs, calls));

  const result = await homeRoutingService.updateHomeRouting({}, 1, { server_ids: [2] });

  assert.deepStrictEqual(calls.events, ['get:1', 'update:1', 'get:2', 'update:2']);
  assert.deepStrictEqual(configs[1].routing.rules, []);
  assert.deepStrictEqual(repository.state.savedRoutes[0].pendingCleanupServerIds, []);
  assert.deepStrictEqual(result.skipped_cleanup_servers, []);
}

/**
 * 验证重新选择 pending 服务器时直接绑定，不先删除再写入同一服务器。
 * @returns {Promise<void>} 单次回写保留新绑定并移除 pending。
 */
async function testReselectedPendingIsBoundWithoutCleanup() {
  const calls = { get: [], update: [] };
  const configs = { 1: { inbounds: [{ tag: 'in-a' }], routing: { rules: [
    { type: 'field', outboundTag: 'local-ip-lax', user: ['user@example.com', 'other@example.com'] }
  ] } } };
  const repository = createMemoryRepository({
    entitlement: createEntitlement(),
    route: { home_proxy_tag: 'local-ip-lax', server_ids: '[]', pending_cleanup_server_ids: '[1]' },
    servers: [createServer(1)]
  });
  installTestDependencies(repository, createFakeXuiFactory(configs, calls));

  await homeRoutingService.updateHomeRouting({}, 1, { server_ids: [1] });

  assert.deepStrictEqual(calls.events, ['get:1', 'update:1']);
  assert.deepStrictEqual(repository.state.savedRoutes[0].pendingCleanupServerIds, []);
  assert.deepStrictEqual(configs[1].routing.rules[0].user, ['other@example.com', 'user@example.com']);
}

/**
 * 验证不存在的历史 pending 直接丢弃，不阻止新服务器绑定。
 * @returns {Promise<void>} 不存在的服务器不会发请求，也不会作为跳过项返回。
 */
async function testMissingPendingIsDiscarded() {
  const calls = { get: [], update: [] };
  const configs = { 2: { inbounds: [{ tag: 'in-a' }], routing: { rules: [] } } };
  const repository = createMemoryRepository({
    entitlement: createEntitlement(),
    route: { home_proxy_tag: 'local-ip-lax', server_ids: '[]', pending_cleanup_server_ids: '[99]' },
    servers: [createServer(2)]
  });
  installTestDependencies(repository, createFakeXuiFactory(configs, calls));

  const result = await homeRoutingService.updateHomeRouting({}, 1, { server_ids: [2] });

  assert.deepStrictEqual(calls.factory, [2]);
  assert.deepStrictEqual(repository.state.savedRoutes[0].pendingCleanupServerIds, []);
  assert.deepStrictEqual(result.skipped_cleanup_servers, []);
}

/**
 * 验证 1—2 台新服务器中任意一台离线或不存在时，旧路由也不能执行远程清理。
 * @returns {Promise<void>} 校验先于所有远程请求，且本地记录保持原样。
 */
async function testInvalidSelectionPreventsCleanupRequests() {
  for (const selectedIds of [[2, 3], [2, 99], [3]]) {
    const calls = { get: [], update: [] };
    const repository = createMemoryRepository({
      entitlement: createEntitlement(),
      route: { home_proxy_tag: 'local-ip-lax', server_ids: '[1]', pending_cleanup_server_ids: '[4]' },
      servers: [createServer(1), createServer(2), createServer(3, '离线新服务器', 0), createServer(4)]
    });
    installTestDependencies(repository, createFakeXuiFactory({}, calls));

    await assert.rejects(
      () => homeRoutingService.updateHomeRouting({}, 1, { server_ids: selectedIds }),
      (error) => error.code === 4108
    );

    assert.deepStrictEqual(calls.get, []);
    assert.deepStrictEqual(calls.update, []);
    assert.strictEqual(calls.factory, undefined);
    assert.strictEqual(repository.state.savedRoutes.length, 0);
  }
}

/**
 * 验证只有待清理记录时，正常和过期权益的 options 都不展示有效绑定。
 * @returns {Promise<void>} 内部 pending 记录仍保留，但用户拿到 route: null。
 */
async function testPendingOnlyRouteIsHiddenInOptions() {
  const repository = createMemoryRepository({
    entitlement: createEntitlement(),
    route: { home_proxy_tag: 'local-ip-lax', server_ids: '[]', pending_cleanup_server_ids: '[1]' },
    servers: [createServer(1, '待清理服务器', 0)]
  });
  installTestDependencies(repository, createFakeXuiFactory({}, { get: [], update: [] }));

  assert.strictEqual((await homeRoutingService.getHomeRoutingOptions({}, 1)).route, null);
  repository.state.entitlement = createEntitlement({ home_status: 'expired' });
  assert.strictEqual((await homeRoutingService.getHomeRoutingOptions({}, 1)).route, null);
  assert.strictEqual(repository.state.route.pending_cleanup_server_ids, '[1]');
}

/**
 * 验证两台新服务器只有一台绑定成功时，不能保存新绑定或覆盖旧 pending。
 * @returns {Promise<void>} 远端部分成功不更新本地记录，也不产生新的冷却时间。
 */
async function testPartialBindingFailureKeepsOriginalPending() {
  const calls = { get: [], update: [] };
  const configs = {
    2: { inbounds: [{ tag: 'new-in-a' }], routing: { rules: [] } },
    3: { inbounds: [{ tag: 'new-in-b' }], routing: { rules: [] } }
  };
  const originalRoute = {
    home_proxy_tag: 'local-ip-lax', server_ids: '[1]', pending_cleanup_server_ids: '[4]',
    last_synced_at: Math.floor(Date.now() / 1000) - 3600
  };
  const repository = createMemoryRepository({
    entitlement: createEntitlement(), route: originalRoute,
    servers: [createServer(1, '离线旧服务器', 0), createServer(2), createServer(3), createServer(4, '离线 pending', 0)]
  });
  installTestDependencies(repository, createFakeXuiFactory(configs, calls, { update: [3] }));

  await assert.rejects(
    () => homeRoutingService.updateHomeRouting({}, 1, { server_ids: [2, 3] }),
    (error) => error.code === 4107 && error.data.failed_servers[0].id === 3
  );

  assert.deepStrictEqual(calls.factory, [2, 3]);
  assert.strictEqual(repository.state.savedRoutes.length, 0);
  assert.deepStrictEqual(repository.state.route, originalRoute);
}

async function testRemoteDeleteFailureDoesNotSaveOrCooldown() {
  const oldSyncedAt = Math.floor(Date.now() / 1000) - 3600;
  const configs = {
    1: {
      inbounds: [{ tag: 'old-in' }],
      routing: {
        rules: [
          { type: 'field', outboundTag: 'local-ip-lax', user: ['user@example.com'], inboundTag: ['old-in'] }
        ]
      }
    },
    2: {
      inbounds: [{ tag: 'new-in' }],
      routing: { rules: [] }
    }
  };
  const calls = { get: [], update: [] };
  const repository = createMemoryRepository({
    entitlement: createEntitlement(),
    route: {
      user_id: 1,
      home_proxy_tag: 'local-ip-lax',
      server_ids: '[1]',
      last_synced_at: oldSyncedAt
    },
    servers: [createServer(1, '旧服务器'), createServer(2, '新服务器')]
  });
  installTestDependencies(repository, createFakeXuiFactory(configs, calls, { update: [1] }));

  await assert.rejects(
    () => homeRoutingService.updateHomeRouting({}, 1, { server_ids: [2] }),
    /家宽 IP routing 同步失败/
  );

  assert.strictEqual(repository.state.savedRoutes.length, 0);
  assert.strictEqual(repository.state.route.last_synced_at, oldSyncedAt);
}

async function testRemoteWriteFailureDoesNotSaveOrCooldown() {
  const oldSyncedAt = Math.floor(Date.now() / 1000) - 3600;
  const configs = {
    1: { inbounds: [{ tag: 'old-in' }], routing: { rules: [] } },
    2: { inbounds: [{ tag: 'new-in' }], routing: { rules: [] } }
  };
  const calls = { get: [], update: [] };
  const repository = createMemoryRepository({
    entitlement: createEntitlement(),
    route: {
      user_id: 1,
      home_proxy_tag: 'local-ip-lax',
      server_ids: '[1]',
      last_synced_at: oldSyncedAt
    },
    servers: [createServer(1, '旧服务器'), createServer(2, '新服务器')]
  });
  installTestDependencies(repository, createFakeXuiFactory(configs, calls, { update: [2] }));

  await assert.rejects(
    () => homeRoutingService.updateHomeRouting({}, 1, { server_ids: [2] }),
    /家宽 IP routing 同步失败/
  );

  assert.strictEqual(repository.state.savedRoutes.length, 0);
  assert.strictEqual(repository.state.route.last_synced_at, oldSyncedAt);
}

async function testCooldownBlocksRecentSuccessfulChange() {
  const recentSyncedAt = Math.floor(Date.now() / 1000) - 60;
  const calls = { get: [], update: [] };
  const repository = createMemoryRepository({
    entitlement: createEntitlement(),
    route: {
      user_id: 1,
      home_proxy_tag: 'local-ip-lax',
      server_ids: '[1]',
      last_synced_at: recentSyncedAt
    },
    servers: [createServer(1), createServer(2)]
  });
  installTestDependencies(repository, createFakeXuiFactory({}, calls));

  await assert.rejects(
    () => homeRoutingService.updateHomeRouting({}, 1, { server_ids: [2] }),
    /请稍后再修改/
  );
  assert.deepStrictEqual(calls.get, []);
  assert.strictEqual(repository.state.savedRoutes.length, 0);
}

async function testUpdateCanSkipCooldownForAdmin() {
  const recentSyncedAt = Math.floor(Date.now() / 1000) - 60;
  const configs = {
    1: {
      inbounds: [{ tag: 'old-in' }],
      routing: {
        rules: [
          { type: 'field', outboundTag: 'local-ip-lax', user: ['user@example.com'], inboundTag: ['old-in'] }
        ]
      }
    },
    2: {
      inbounds: [{ tag: 'new-in' }],
      routing: { rules: [] }
    }
  };
  const calls = { get: [], update: [] };
  const repository = createMemoryRepository({
    entitlement: createEntitlement(),
    route: {
      user_id: 1,
      home_proxy_tag: 'local-ip-lax',
      server_ids: '[1]',
      last_synced_at: recentSyncedAt
    },
    servers: [createServer(1), createServer(2)]
  });
  installTestDependencies(repository, createFakeXuiFactory(configs, calls));

  await homeRoutingService.updateHomeRouting({}, 1, { server_ids: [2] }, console, { skipCooldown: true });

  assert.deepStrictEqual(calls.get, [1, 2]);
  assert.deepStrictEqual(repository.state.savedRoutes[0].serverIds, [2]);
}

/**
 * 验证新绑定默认开启，显式布尔值和 0/1 可切换，管理端未传字段保留已有选择。
 * @returns {Promise<void>} 所有输入分支和返回的布尔状态均应符合用户选择。
 */
async function testHomeNodePrefixTogglePersistsAcrossUpdates() {
  const cases = [
    { initial: undefined, input: undefined, expected: true },
    { initial: undefined, input: false, expected: false },
    { initial: undefined, input: 0, expected: false },
    { initial: undefined, input: '0', expected: false },
    { initial: undefined, input: true, expected: true },
    { initial: undefined, input: 1, expected: true },
    { initial: undefined, input: '1', expected: true },
    { initial: 0, input: undefined, expected: false },
    { initial: 1, input: undefined, expected: true }
  ];

  for (const scenario of cases) {
    const configs = { 1: { inbounds: [{ tag: 'in-a' }], routing: { rules: [] } } };
    const calls = { get: [], update: [] };
    const route = scenario.initial === undefined ? undefined : {
      user_id: 1,
      home_proxy_tag: 'local-ip-lax',
      server_ids: '[1]',
      last_synced_at: Math.floor(Date.now() / 1000) - 600,
      show_home_node_prefix: scenario.initial
    };
    const repository = createMemoryRepository({
      entitlement: createEntitlement(), route, servers: [createServer(1)]
    });
    installTestDependencies(repository, createFakeXuiFactory(configs, calls));
    const payload = { server_ids: [1] };
    if (scenario.input !== undefined) payload.show_home_node_prefix = scenario.input;

    const options = await homeRoutingService.updateHomeRouting({}, 1, payload);

    assert.strictEqual(repository.state.savedRoutes[0].showHomeNodePrefix, scenario.expected);
    assert.strictEqual(options.route.show_home_node_prefix, scenario.expected);
    assert.deepStrictEqual(calls.update, [1]);
  }
}

/**
 * 验证历史绑定没有开关字段时，配置接口仍返回布尔开启状态。
 * @returns {Promise<void>} 正常和过期权益均按兼容默认值展示。
 */
async function testLegacyRouteDefaultsPrefixEnabled() {
  const repository = createMemoryRepository({
    entitlement: createEntitlement(),
    route: { home_proxy_tag: 'local-ip-lax', server_ids: '[1]', last_synced_at: 0 },
    servers: [createServer(1)]
  });
  installTestDependencies(repository, createFakeXuiFactory({}, { get: [], update: [] }));
  const active = await homeRoutingService.getHomeRoutingOptions({}, 1);
  assert.strictEqual(active.route.show_home_node_prefix, true);

  repository.state.entitlement = createEntitlement({ home_status: 'expired' });
  const expired = await homeRoutingService.getHomeRoutingOptions({}, 1);
  assert.strictEqual(expired.route.show_home_node_prefix, true);
}

/**
 * 验证仓储写入开关列，冲突更新沿用新值，布尔值写入为 PostgreSQL 整数。
 * @returns {Promise<void>} 两次写入分别携带 0 和 1，且冲突分支覆盖开关列。
 */
async function testHomeNodePrefixIsStoredAsInteger() {
  const writes = [];
  const db = {
    prepare(sql) {
      return { run: async (...params) => { writes.push({ sql, params }); } };
    }
  };
  const payload = {
    userId: 1, homeProxyTag: 'local-ip-lax', serverIds: [1], syncedAt: 1234, message: 'ok'
  };
  await homeRoutingRepository.upsertUserHomeRoute(db, { ...payload, showHomeNodePrefix: false });
  await homeRoutingRepository.upsertUserHomeRoute(db, { ...payload, showHomeNodePrefix: true });

  assert.match(writes[0].sql, /show_home_node_prefix\s*=\s*EXCLUDED\.show_home_node_prefix/);
  assert.ok(writes[0].sql.includes('show_home_node_prefix'));
  assert.strictEqual(writes[0].params[3], 0);
  assert.strictEqual(writes[1].params[3], 1);
}

async function testDuplicateRulesAreCollapsed() {
  const configs = {
    1: {
      inbounds: [{ tag: 'in-a' }, { tag: 'in-b' }],
      routing: {
        rules: [
          { type: 'field', outboundTag: 'local-ip-lax', user: ['user@example.com'], inboundTag: ['old-a'] },
          { type: 'field', outboundTag: 'local-ip-lax', user: ['user@example.com'], inboundTag: ['old-b'] },
          { type: 'field', outboundTag: 'local-ip-lax', user: ['other@example.com'], inboundTag: ['old-c'] }
        ]
      }
    }
  };
  const calls = { get: [], update: [] };
  const repository = createMemoryRepository({
    entitlement: createEntitlement(),
    servers: [createServer(1)]
  });
  installTestDependencies(repository, createFakeXuiFactory(configs, calls));

  await homeRoutingService.updateHomeRouting({}, 1, { server_ids: [1] });

  const userRules = configs[1].routing.rules.filter((rule) => (
    rule.outboundTag === 'local-ip-lax' && rule.user.includes('user@example.com')
  ));
  const otherRules = configs[1].routing.rules.filter((rule) => (
    rule.outboundTag === 'local-ip-lax' && rule.user.includes('other@example.com')
  ));
  assert.strictEqual(userRules.length, 1);
  assert.deepStrictEqual(userRules[0].inboundTag, ['in-a', 'in-b']);
  assert.strictEqual(otherRules.length, 1);
}

async function testMergesUsersIntoSameHomeRoutingRule() {
  const configs = {
    1: {
      inbounds: [{ tag: 'in-a' }, { tag: 'in-b' }],
      routing: {
        rules: [
          { type: 'field', inboundTag: ['in-a', 'in-b'], outboundTag: 'local-ip-lax', user: ['first@example.com'] }
        ]
      }
    }
  };
  const calls = { get: [], update: [] };
  const repository = createMemoryRepository({
    entitlement: createEntitlement({ email: 'second@example.com' }),
    servers: [createServer(1)]
  });
  installTestDependencies(repository, createFakeXuiFactory(configs, calls));

  await homeRoutingService.updateHomeRouting({}, 1, { server_ids: [1] });

  assert.deepStrictEqual(configs[1].routing.rules, [
    {
      type: 'field',
      inboundTag: ['in-a', 'in-b'],
      outboundTag: 'local-ip-lax',
      user: ['first@example.com', 'second@example.com']
    }
  ]);
}

async function testRemovingUserKeepsSharedHomeRoutingRule() {
  const configs = {
    1: {
      inbounds: [{ tag: 'in-a' }, { tag: 'in-b' }],
      routing: {
        rules: [
          {
            type: 'field',
            inboundTag: ['in-a', 'in-b'],
            outboundTag: 'local-ip-lax',
            user: ['first@example.com', 'second@example.com']
          }
        ]
      }
    },
    2: {
      inbounds: [{ tag: 'new-in' }],
      routing: { rules: [] }
    }
  };
  const calls = { get: [], update: [] };
  const repository = createMemoryRepository({
    entitlement: createEntitlement({ email: 'second@example.com' }),
    route: {
      user_id: 1,
      home_proxy_tag: 'local-ip-lax',
      server_ids: '[1]',
      last_synced_at: Math.floor(Date.now() / 1000) - 3600
    },
    servers: [createServer(1), createServer(2)]
  });
  installTestDependencies(repository, createFakeXuiFactory(configs, calls));

  await homeRoutingService.updateHomeRouting({}, 1, { server_ids: [2] });

  assert.deepStrictEqual(configs[1].routing.rules, [
    {
      type: 'field',
      inboundTag: ['in-a', 'in-b'],
      outboundTag: 'local-ip-lax',
      user: ['first@example.com']
    }
  ]);
  assert.deepStrictEqual(configs[2].routing.rules, [
    { type: 'field', inboundTag: ['new-in'], outboundTag: 'local-ip-lax', user: ['second@example.com'] }
  ]);
}

async function testChangedHomeProxyTagRemovesOldTagRule() {
  const configs = {
    1: {
      inbounds: [{ tag: 'in-a' }],
      routing: {
        rules: [
          { type: 'field', outboundTag: 'old-home-tag', user: ['user@example.com'], inboundTag: ['old-in'] }
        ]
      }
    }
  };
  const calls = { get: [], update: [] };
  const repository = createMemoryRepository({
    entitlement: createEntitlement({ home_proxy_tag: 'new-home-tag', proxy_tag: 'new-home-tag' }),
    route: {
      user_id: 1,
      home_proxy_tag: 'old-home-tag',
      server_ids: '[1]',
      last_synced_at: Math.floor(Date.now() / 1000) - 3600
    },
    servers: [createServer(1)]
  });
  installTestDependencies(repository, createFakeXuiFactory(configs, calls));

  await homeRoutingService.updateHomeRouting({}, 1, { server_ids: [1] });

  assert.strictEqual(
    configs[1].routing.rules.some((rule) => rule.outboundTag === 'old-home-tag'),
    false
  );
  assert.deepStrictEqual(configs[1].routing.rules, [
    { type: 'field', inboundTag: ['in-a'], outboundTag: 'new-home-tag', user: ['user@example.com'] }
  ]);
  assert.strictEqual(repository.state.savedRoutes[0].homeProxyTag, 'new-home-tag');
}

async function testDeleteRemovesOnlyCurrentUserFromSharedRuleAndDeletesLocalRoute() {
  const configs = {
    1: {
      inbounds: [{ tag: 'in-a' }],
      routing: {
        rules: [
          {
            type: 'field',
            inboundTag: ['in-a'],
            outboundTag: 'local-ip-lax',
            user: ['first@example.com', 'second@example.com']
          }
        ]
      }
    },
    2: {
      inbounds: [{ tag: 'in-b' }],
      routing: {
        rules: [
          {
            type: 'field',
            inboundTag: ['in-b'],
            outboundTag: 'local-ip-lax',
            user: ['second@example.com']
          }
        ]
      }
    }
  };
  const calls = { get: [], update: [] };
  const repository = createMemoryRepository({
    entitlement: createEntitlement({ email: 'second@example.com' }),
    route: {
      user_id: 1,
      home_proxy_tag: 'local-ip-lax',
      server_ids: '[1,2]',
      last_synced_at: Math.floor(Date.now() / 1000) - 3600
    },
    servers: [createServer(1), createServer(2)]
  });
  installTestDependencies(repository, createFakeXuiFactory(configs, calls));

  await homeRoutingService.deleteHomeRouting({}, 1);

  assert.deepStrictEqual(configs[1].routing.rules, [
    {
      type: 'field',
      inboundTag: ['in-a'],
      outboundTag: 'local-ip-lax',
      user: ['first@example.com']
    }
  ]);
  assert.deepStrictEqual(configs[2].routing.rules, []);
  assert.deepStrictEqual(repository.state.deletedRoutes, [{ userId: 1 }]);
}

async function testDeleteFailureKeepsLocalRoute() {
  const configs = {
    1: {
      inbounds: [{ tag: 'in-a' }],
      routing: {
        rules: [
          { type: 'field', inboundTag: ['in-a'], outboundTag: 'local-ip-lax', user: ['second@example.com'] }
        ]
      }
    }
  };
  const calls = { get: [], update: [] };
  const repository = createMemoryRepository({
    entitlement: createEntitlement({ email: 'second@example.com' }),
    route: {
      user_id: 1,
      home_proxy_tag: 'local-ip-lax',
      server_ids: '[1]',
      last_synced_at: Math.floor(Date.now() / 1000) - 3600
    },
    servers: [createServer(1)]
  });
  installTestDependencies(repository, createFakeXuiFactory(configs, calls, { update: [1] }));

  await assert.rejects(
    () => homeRoutingService.deleteHomeRouting({}, 1),
    /家宽 IP routing 删除失败/
  );

  assert.strictEqual(repository.state.deletedRoutes.length, 0);
  assert.ok(repository.state.route);
}

async function testDeleteIsBlockedByCooldown() {
  const calls = { get: [], update: [] };
  const repository = createMemoryRepository({
    entitlement: createEntitlement({ email: 'second@example.com' }),
    route: {
      user_id: 1,
      home_proxy_tag: 'local-ip-lax',
      server_ids: '[1]',
      last_synced_at: Math.floor(Date.now() / 1000) - 60
    },
    servers: [createServer(1)]
  });
  installTestDependencies(repository, createFakeXuiFactory({}, calls));

  await assert.rejects(
    () => homeRoutingService.deleteHomeRouting({}, 1),
    /请稍后再修改/
  );

  assert.deepStrictEqual(calls.get, []);
  assert.strictEqual(repository.state.deletedRoutes.length, 0);
}

async function testDeleteCanSkipCooldownForAdmin() {
  const configs = {
    1: {
      inbounds: [{ tag: 'in-a' }],
      routing: {
        rules: [
          { type: 'field', inboundTag: ['in-a'], outboundTag: 'local-ip-lax', user: ['second@example.com'] }
        ]
      }
    }
  };
  const calls = { get: [], update: [] };
  const repository = createMemoryRepository({
    entitlement: createEntitlement({ email: 'second@example.com' }),
    route: {
      user_id: 1,
      home_proxy_tag: 'local-ip-lax',
      server_ids: '[1]',
      last_synced_at: Math.floor(Date.now() / 1000) - 60
    },
    servers: [createServer(1)]
  });
  installTestDependencies(repository, createFakeXuiFactory(configs, calls));

  await homeRoutingService.deleteHomeRouting({}, 1, console, { skipCooldown: true });

  assert.deepStrictEqual(calls.get, [1]);
  assert.deepStrictEqual(repository.state.deletedRoutes, [{ userId: 1 }]);
}

/**
 * 验证手动解绑合并 active/pending 并只保留离线清理记录。
 * 参数无；离线跳过、在线失败保留原记录、全部完成则删除本地记录。
 */
async function testDeleteMergesPendingAndSkipsOfflineServers() {
  const calls = { get: [], update: [], factory: [] };
  const configs = { 2: { routing: { rules: [
    { type: 'field', outboundTag: 'local-ip-lax', user: ['user@example.com', 'other@example.com'] }
  ] } } };
  const repository = createMemoryRepository({
    entitlement: createEntitlement(),
    route: {
      user_id: 1, home_proxy_tag: 'local-ip-lax', server_ids: '[1]',
      pending_cleanup_server_ids: '[2,3]', show_home_node_prefix: 0, last_synced_at: 1
    },
    servers: [createServer(1, '离线服务器', 0), createServer(2)]
  });
  installTestDependencies(repository, createFakeXuiFactory(configs, calls));

  const result = await homeRoutingService.deleteHomeRouting({}, 1);

  assert.deepStrictEqual(calls.factory, [2]);
  assert.deepStrictEqual(calls.update, [2]);
  assert.deepStrictEqual(configs[2].routing.rules[0].user, ['other@example.com']);
  assert.deepStrictEqual(JSON.parse(repository.state.route.server_ids), []);
  assert.deepStrictEqual(JSON.parse(repository.state.route.pending_cleanup_server_ids), [1]);
  assert.strictEqual(repository.state.route.show_home_node_prefix, false);
  assert.strictEqual(result.route, null);
  assert.strictEqual(repository.state.deletedRoutes.length, 0);
}

/** 验证在线 pending 也必须清理；两个列表为空（含初始已空）才删除 route。 */
async function testDeleteRemovesRouteAfterActiveAndPendingAreEmpty() {
  for (const serverIds of [[1], []]) {
    const calls = { get: [], update: [], factory: [] };
    const configs = { 1: { routing: { rules: [] } }, 2: { routing: { rules: [] } } };
    const pendingIds = serverIds.length ? [2] : [];
    const repository = createMemoryRepository({
      entitlement: createEntitlement(),
      route: {
        user_id: 1, home_proxy_tag: 'local-ip-lax', server_ids: JSON.stringify(serverIds),
        pending_cleanup_server_ids: JSON.stringify(pendingIds), last_synced_at: 1
      },
      servers: [createServer(1), createServer(2)]
    });
    installTestDependencies(repository, createFakeXuiFactory(configs, calls));
    const result = await homeRoutingService.deleteHomeRouting({}, 1);
    assert.deepStrictEqual(calls.factory, serverIds.length ? [1, 2] : []);
    assert.deepStrictEqual(calls.update, serverIds.length ? [1, 2] : []);
    assert.strictEqual(repository.state.route, undefined);
    assert.strictEqual(result.route, null);
    assert.deepStrictEqual(repository.state.deletedRoutes, [{ userId: 1 }]);
  }
}

/** 验证在线 pending 删除失败阻止解绑，完整保留 active 和 pending 供重试。 */
async function testDeletePendingFailureKeepsOriginalRoute() {
  const calls = { get: [], update: [] };
  const route = {
    user_id: 1, home_proxy_tag: 'local-ip-lax', server_ids: '[1]',
    pending_cleanup_server_ids: '[2]', last_synced_at: 1
  };
  const repository = createMemoryRepository({
    entitlement: createEntitlement(), route,
    servers: [createServer(1, '离线服务器', 0), createServer(2)]
  });
  installTestDependencies(repository, createFakeXuiFactory({ 2: { routing: { rules: [] } } }, calls, { update: [2] }));
  await assert.rejects(() => homeRoutingService.deleteHomeRouting({}, 1), (error) => {
    assert.strictEqual(error.code, 4110);
    assert.deepStrictEqual(error.data.failed_servers.map((server) => server.id), [2]);
    return true;
  });
  assert.deepStrictEqual(repository.state.route, route);
  assert.strictEqual(repository.state.savedRoutes.length, 0);
  assert.strictEqual(repository.state.deletedRoutes.length, 0);
}

async function run() {
  try {
    const cleanupTests = [
      testDeleteMergesPendingAndSkipsOfflineServers,
      testDeleteRemovesRouteAfterActiveAndPendingAreEmpty,
      testDeletePendingFailureKeepsOriginalRoute,
      testOfflineCleanupTargetsAreSkippedBeforeBinding,
      testCleanupFailurePreventsEveryNewServerRequest,
      testOnlinePendingIsCleanedBeforeNextBinding,
      testReselectedPendingIsBoundWithoutCleanup,
      testMissingPendingIsDiscarded,
      testInvalidSelectionPreventsCleanupRequests,
      testPendingOnlyRouteIsHiddenInOptions,
      testPartialBindingFailureKeepsOriginalPending
    ];
    const failures = [];
    for (const test of cleanupTests) {
      try {
        await test();
        console.log(`通过: ${test.name}`);
      } catch (error) {
        console.error(`失败: ${test.name}: ${error.message}`);
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, `${failures.length} 项离线清理行为测试失败`);
    }
    testCooldownConstantIsFiveMinutes();
    await testRejectsMissingEntitlement();
    await testRejectsMoreThanTwoServers();
    await testBuildsInboundTagsFromXrayConfig();
    await testFallsBackToLiveInboundsWhenXrayConfigHasNoInbounds();
    await testUnwrapsNestedXraySettingResponse();
    await testDeletesOldServerRuleAndWritesNewRule();
    await testRemoteDeleteFailureDoesNotSaveOrCooldown();
    await testRemoteWriteFailureDoesNotSaveOrCooldown();
    await testCooldownBlocksRecentSuccessfulChange();
    await testUpdateCanSkipCooldownForAdmin();
    await testHomeNodePrefixTogglePersistsAcrossUpdates();
    await testLegacyRouteDefaultsPrefixEnabled();
    await testHomeNodePrefixIsStoredAsInteger();
    await testDuplicateRulesAreCollapsed();
    await testMergesUsersIntoSameHomeRoutingRule();
    await testRemovingUserKeepsSharedHomeRoutingRule();
    await testChangedHomeProxyTagRemovesOldTagRule();
    await testDeleteRemovesOnlyCurrentUserFromSharedRuleAndDeletesLocalRoute();
    await testDeleteFailureKeepsLocalRoute();
    await testDeleteIsBlockedByCooldown();
    await testDeleteCanSkipCooldownForAdmin();
  } finally {
    homeRoutingService.resetTestDependencies();
  }

  console.log('用户家宽 routing 服务层测试通过');
}

run().catch((error) => {
  console.error('用户家宽 routing 服务层测试失败:', error);
  process.exit(1);
});
