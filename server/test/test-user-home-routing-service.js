/**
 * 用户家宽 routing 服务层测试。
 * 使用内存仓储和假的 XUI service 验证同步规则，不访问真实数据库或 3X-UI。
 */

const assert = require('assert');
const homeRoutingService = require('../services/user/home-routing-service');

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
    savedRoutes: []
  };

  return {
    state,
    async findHomeRoutingEntitlement() {
      return state.entitlement ? clone(state.entitlement) : undefined;
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
        last_synced_at: payload.syncedAt,
        last_sync_status: 'success',
        last_sync_message: payload.message || ''
      };
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
    return {
      async getXrayConfig() {
        calls.get.push(serverId);
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

async function run() {
  try {
    await testRejectsMissingEntitlement();
    await testRejectsMoreThanTwoServers();
    await testBuildsInboundTagsFromXrayConfig();
    await testFallsBackToLiveInboundsWhenXrayConfigHasNoInbounds();
    await testUnwrapsNestedXraySettingResponse();
    await testDeletesOldServerRuleAndWritesNewRule();
    await testRemoteDeleteFailureDoesNotSaveOrCooldown();
    await testRemoteWriteFailureDoesNotSaveOrCooldown();
    await testCooldownBlocksRecentSuccessfulChange();
    await testDuplicateRulesAreCollapsed();
    await testMergesUsersIntoSameHomeRoutingRule();
    await testRemovingUserKeepsSharedHomeRoutingRule();
    await testChangedHomeProxyTagRemovesOldTagRule();
  } finally {
    homeRoutingService.resetTestDependencies();
  }

  console.log('用户家宽 routing 服务层测试通过');
}

run().catch((error) => {
  console.error('用户家宽 routing 服务层测试失败:', error);
  process.exit(1);
});
