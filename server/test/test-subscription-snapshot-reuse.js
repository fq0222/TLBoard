const assert = require('assert');
const cacheService = require('../services/shared/subscription-cache-service');
const subscriptionService = require('../services/user/subscription-service');
const subscriptionRepository = require('../repositories/subscription-repository');

/**
 * 临时替换订阅仓储方法，并在场景结束后完整恢复，避免测试之间相互污染。
 *
 * @param {Object<string,Function>} mocks - 仓储方法替身
 * @param {Function} fn - 使用替身执行的异步场景
 * @returns {Promise<*>} 场景返回值
 */
async function withRepositoryMocks(mocks, fn) {
  const originals = {};
  for (const [key, value] of Object.entries(mocks)) {
    originals[key] = subscriptionRepository[key];
    subscriptionRepository[key] = value;
  }

  try {
    return await fn();
  } finally {
    Object.assign(subscriptionRepository, originals);
  }
}

/**
 * 为生成订阅编排测试构造一组可切换的新旧 inbound 快照。
 *
 * @param {Object} options - 场景选项
 * @param {boolean} [options.remainUntrusted=false] - 两轮补拉后是否仍保持缺少用户
 * @param {number[]} [options.trustedAfterFirstServerIds] - 首轮补拉后可信的服务器
 * @param {number[]} [options.trustedAfterSecondServerIds] - 补偿后二次补拉后可信的服务器
 * @param {Object} [options.compensationResult] - 用户补偿调用结果
 * @returns {Object} 仓储替身、调用记录和依赖替身
 */
function createGenerationScenario({
  remainUntrusted = false,
  firstGeneration = false,
  includeTrustedInvalid = false,
  trustedAfterFirstServerIds,
  trustedAfterSecondServerIds,
  compensationResult = { success: true, successCount: 2, failureCount: 0 },
  syncResultFor
} = {}) {
  const user = {
    id: 19,
    email: 'user@example.com',
    sub_id: 'user-token',
    enabled: 1,
    traffic_limit: 1024,
    traffic_used: 0,
    plan_type: 'traffic'
  };
  const servers = [
    {
      id: 1,
      name: '美国01-达拉斯',
      sub_url: 'https://us.example/sub/',
      host: 'us.example',
      client_port: 443,
      api_url: 'https://us.example'
    },
    {
      id: 2,
      name: '日本',
      sub_url: 'https://jp.example/sub/',
      host: 'jp.example',
      client_port: 443,
      api_url: 'https://jp.example'
    }
  ];
  const staleConfigs = [
    createJoinedConfig({
      server_id: 1,
      inbound_id: 10,
      remark: 'direct-us',
      uuid: 'uuid-us',
      sub_id: 'sub-us',
      settings: JSON.stringify({ clients: [] })
    }),
    createJoinedConfig({
      server_id: 1,
      inbound_id: 11,
      remark: 'direct-us-2',
      uuid: 'uuid-us-2',
      sub_id: 'sub-us-2',
      settings: JSON.stringify({ clients: [] })
    }),
    createJoinedConfig({
      server_id: 2,
      inbound_id: 20,
      remark: 'direct-jp',
      uuid: 'uuid-jp',
      sub_id: 'sub-jp',
      settings: JSON.stringify({ clients: [] })
    }),
    createJoinedConfig({
      server_id: 2,
      inbound_id: 21,
      remark: 'direct-jp-valid',
      uuid: 'uuid-jp-valid',
      sub_id: 'sub-jp-valid',
      settings: JSON.stringify({
        clients: [{
          email: 'user@example.com-direct-jp-valid',
          id: 'uuid-jp-valid',
          subId: 'sub-jp-valid'
        }]
      })
    })
  ];
  const trustedConfigs = staleConfigs.map((config) => ({
    ...config,
    settings: JSON.stringify({
      clients: [{
        email: `${user.email}-${config.remark}`,
        id: config.uuid,
        subId: config.sub_id
      }]
    })
  }));
  const sources = new Map(staleConfigs.map((config) => [
    `${config.server_id}:${config.inbound_id}`,
    {
      user_id: user.id,
      server_id: config.server_id,
      inbound_id: config.inbound_id,
      sub_id: config.sub_id,
      original_link: `vless://${config.uuid}@origin.example:443?security=none&type=tcp#old`,
      node_fingerprint: 'stale-fingerprint',
      server_fingerprint: cacheService.computeServerFingerprint(
        servers.find((server) => server.id === config.server_id)
      ),
      fetched_at: Math.floor(Date.now() / 1000)
    }
  ]));
  const initiallyValidConfig = staleConfigs[3];
  if (!includeTrustedInvalid) {
    sources.get('2:21').node_fingerprint = cacheService.computeNodeFingerprint(initiallyValidConfig);
  }
  let syncRound = 0;
  let configReadCount = 0;
  let compensationCalls = 0;
  const refreshedPairs = [];
  const syncCalls = [];
  const logs = [];
  const firstTrustedIds = new Set(
    trustedAfterFirstServerIds || (remainUntrusted ? [] : [1, 2])
  );
  const secondTrustedIds = new Set(
    trustedAfterSecondServerIds || (remainUntrusted ? [] : [1, 2])
  );

  /**
   * 按当前远端同步轮次返回各服务器对应的最新或旧快照。
   *
   * @returns {Object[]} 当前轮次用户节点配置
   */
  function getCurrentConfigs() {
    if (syncRound === 0) {
      return staleConfigs;
    }
    const trustedIds = syncRound === 1 ? firstTrustedIds : secondTrustedIds;
    return staleConfigs.map((config, index) => (
      trustedIds.has(config.server_id) ? trustedConfigs[index] : config
    ));
  }

  const repositoryMocks = {
    findLatestUserSubscription: async () => (firstGeneration ? null : { id: 1 }),
    findSubscriptionUserById: async () => user,
    listEnabledUserCfIps: async () => [{ ip: '1.1.1.1' }],
    listOnlineServers: async () => servers,
    listNodeSnapshots: async () => staleConfigs.map((config) => ({
      server_id: config.server_id,
      inbound_id: config.inbound_id
    })),
    listUserNodeConfigs: async () => {
      configReadCount += 1;
      return getCurrentConfigs();
    },
    listUserSubscriptionSources: async () => [...sources.values()],
    upsertSubscriptionSource: async (db, payload) => {
      refreshedPairs.push(`${payload.server_id}:${payload.inbound_id}`);
      sources.set(`${payload.server_id}:${payload.inbound_id}`, payload);
    },
    saveUserSubscriptionCache: async () => {}
  };
  const dependencies = {
    syncSelectedServers: async (db, selectedServers) => {
      syncCalls.push(selectedServers.map((server) => server.name));
      syncRound += 1;
      return {
        success: true,
        syncedCount: selectedServers.length,
        failedCount: 0,
        totalCount: selectedServers.length,
        results: selectedServers.map((server) => ({
          success: syncResultFor ? syncResultFor(syncRound, server) : true,
          serverId: server.id,
          nodeCount: 1
        }))
      };
    },
    syncUserToXuiServers: async () => {
      compensationCalls += 1;
      return compensationResult;
    },
    fetchOriginalSubscription: async (subUrl, subId) => Buffer.from(
      `vless://${subId}@origin.example:443?security=none&type=tcp#source`
    ).toString('base64')
  };
  const logger = {
    info: (message) => logs.push(message),
    warn: (message) => logs.push(message),
    error: (message) => logs.push(message)
  };

  return {
    repositoryMocks,
    dependencies,
    logger,
    syncCalls,
    refreshedPairs,
    logs,
    getConfigReadCount: () => configReadCount,
    getCompensationCalls: () => compensationCalls
  };
}

/**
 * 验证多个不可信服务器按服务器去重后仅批量补拉一次，并在补拉后重读配置。
 *
 * @returns {Promise<void>}
 */
async function testGenerateSubscriptionBatchesUntrustedServers() {
  const scenario = createGenerationScenario();

  await withRepositoryMocks(scenario.repositoryMocks, async () => {
    await subscriptionService.generateSubscription({}, 19, scenario.logger, {
      dependencies: scenario.dependencies
    });
  });

  assert.deepStrictEqual(
    scenario.syncCalls,
    [['美国01-达拉斯', '日本']],
    '多个不可信服务器应合并为一次批量补拉，同服务器不得重复'
  );
  assert.ok(
    scenario.getConfigReadCount() >= 2,
    'inbound 补拉完成后必须重新读取用户节点配置'
  );
  assert.deepStrictEqual(
    [...new Set(scenario.refreshedPairs)].sort(),
    ['1:10', '1:11', '2:20'],
    '只应刷新最初失效的 pair，不得刷新原本可用的来源缓存'
  );
  assert.strictEqual(scenario.getCompensationCalls(), 0);
}

/**
 * 验证补拉后快照仍不可信时只执行一轮现有用户补偿，避免异常服务器形成循环。
 *
 * @returns {Promise<void>}
 */
async function testGenerateSubscriptionCompensatesAtMostOnce() {
  const scenario = createGenerationScenario({ remainUntrusted: true });

  await withRepositoryMocks(scenario.repositoryMocks, async () => {
    await subscriptionService.generateSubscription({}, 19, scenario.logger, {
      dependencies: scenario.dependencies
    });
  });

  assert.strictEqual(
    scenario.getCompensationCalls(),
    1,
    '补拉后仍不可信时最多执行一次用户补偿'
  );
  assert.strictEqual(scenario.syncCalls.length, 2, '补偿后最多追加一次批量 inbound 同步');
  assert.deepStrictEqual(scenario.refreshedPairs, [], '二次同步后仍不可信的 pair 不得刷新来源');
}

/**
 * 验证部分服务器补偿失败时，可信服务器仍可刷新且不可信服务器不会发布来源缓存。
 *
 * @returns {Promise<void>}
 */
async function testGenerateSubscriptionKeepsTrustedServersOnPartialCompensationFailure() {
  const scenario = createGenerationScenario({
    trustedAfterFirstServerIds: [1],
    trustedAfterSecondServerIds: [1],
    compensationResult: {
      success: false,
      successCount: 0,
      failureCount: 1,
      message: 'partial failure'
    }
  });

  await withRepositoryMocks(scenario.repositoryMocks, async () => {
    await subscriptionService.generateSubscription({}, 19, scenario.logger, {
      dependencies: scenario.dependencies
    });
  });

  assert.deepStrictEqual(
    scenario.syncCalls,
    [['美国01-达拉斯', '日本'], ['日本']],
    '二次同步只应覆盖补偿服务器且最多执行一次'
  );
  assert.strictEqual(scenario.getCompensationCalls(), 1);
  assert.deepStrictEqual(
    [...new Set(scenario.refreshedPairs)].sort(),
    ['1:10', '1:11'],
    '可信服务器应继续刷新，不可信服务器不得 fetch 或 upsert 来源'
  );
}

/**
 * 验证订阅生成关键日志统一使用用户邮箱和具体服务器名称，并且不泄露连接凭据。
 *
 * @returns {Promise<void>}
 */
async function testGenerateSubscriptionUsesNamedSafeSummaryLogs() {
  const scenario = createGenerationScenario({ includeTrustedInvalid: true });

  await withRepositoryMocks(scenario.repositoryMocks, async () => {
    await subscriptionService.generateSubscription({}, 19, scenario.logger, {
      dependencies: scenario.dependencies
    });
  });

  const snapshotLog = scenario.logs.find((message) => message.includes('本地 inbound 快照评估'));
  const remoteLog = scenario.logs.find((message) => message.includes('inbound 并发补拉完成'));
  const summaryLog = scenario.logs.find((message) => message.includes('订阅生成汇总'));

  assert.ok(snapshotLog, '应输出本地 inbound 快照评估日志');
  assert.ok(snapshotLog.includes('user=user@example.com'));
  assert.ok(snapshotLog.includes('servers=[美国01-达拉斯, 日本]'));
  assert.ok(remoteLog, '应输出 inbound 并发补拉完成日志');
  assert.ok(remoteLog.includes('user=user@example.com'));
  assert.ok(remoteLog.includes('servers=[美国01-达拉斯, 日本]'));
  assert.ok(summaryLog, '应输出订阅生成汇总日志');
  assert.ok(summaryLog.includes('user=user@example.com'));
  assert.ok(summaryLog.includes('localServers=[]'));
  assert.ok(summaryLog.includes('remoteServers=[美国01-达拉斯, 日本]'));
  assert.ok(summaryLog.includes('snapshotReused=1'));
  assert.ok(summaryLog.includes('snapshotRejected=3'));

  const combinedLogs = scenario.logs.join('\n');
  for (const secret of [
    'uuid-us',
    'uuid-us-2',
    'uuid-jp',
    'sub-us',
    'sub-us-2',
    'sub-jp',
    'user-token',
    'https://us.example',
    'https://jp.example'
  ]) {
    assert.ok(!combinedLogs.includes(secret), `日志不得输出敏感凭据：${secret}`);
  }
}

/**
 * 验证同一服务器跨补拉轮次只出现一次，且最终成功数使用后一轮结果覆盖。
 *
 * @returns {Promise<void>}
 */
async function testGenerateSubscriptionSummaryUsesLatestRemoteOutcome() {
  const scenario = createGenerationScenario({
    remainUntrusted: true,
    syncResultFor: (round) => round === 1
  });

  await withRepositoryMocks(scenario.repositoryMocks, async () => {
    await subscriptionService.generateSubscription({}, 19, scenario.logger, {
      dependencies: scenario.dependencies
    });
  });

  const summaryLog = scenario.logs.find((message) => message.includes('订阅生成汇总'));
  assert.ok(summaryLog.includes('remoteServers=[美国01-达拉斯, 日本]'));
  assert.ok(summaryLog.includes('inboundSuccess=0'));
  assert.ok(summaryLog.includes('inboundFailed=2'));
}

/**
 * 验证首次生成与来源刷新成功、失败日志都使用用户邮箱且不输出凭据。
 *
 * @returns {Promise<void>}
 */
async function testSourceRefreshStageLogsUseEmail() {
  const refreshSubscriptionSources = subscriptionService.__testables.refreshSubscriptionSources;
  assert.strictEqual(typeof refreshSubscriptionSources, 'function');
  const user = { id: 19, email: 'user@example.com' };
  const config = createJoinedConfig();
  const server = {
    id: 1,
    name: '香港节点',
    sub_url: 'https://secret.example/sub/',
    api_url: 'https://secret.example'
  };
  const serversById = new Map([[server.id, server]]);
  const logs = [];
  const logger = {
    info: (message) => logs.push(message),
    warn: (message) => logs.push(message),
    error: (message) => logs.push(message)
  };

  await withRepositoryMocks({
    upsertSubscriptionSource: async () => {}
  }, async () => {
    await refreshSubscriptionSources({}, user, [config], serversById, logger, {
      fetchOriginalSubscription: async () => Buffer.from(
        'vless://safe@origin.example:443#source'
      ).toString('base64')
    });
    await refreshSubscriptionSources({}, user, [config], serversById, logger, {
      fetchOriginalSubscription: async () => {
        const error = new Error(
          'request failed: https://secret.example/sub/sub-id-1?token=user-token'
        );
        error.name = 'AxiosError';
        error.code = 'ECONNABORTED';
        throw error;
      }
    });
  });

  assert.ok(logs.some((message) => (
    message.includes('刷新原始订阅模板成功: user=user@example.com')
      && message.includes('servers=[香港节点]')
  )));
  assert.ok(logs.some((message) => (
    message.includes('刷新原始订阅模板失败: user=user@example.com')
      && message.includes('servers=[香港节点]')
      && message.includes('errorType=ECONNABORTED')
  )));
  const combinedLogs = logs.join('\n');
  assert.ok(!combinedLogs.includes('server=1'), '来源刷新日志不得输出服务器数字 ID');
  for (const secret of [
    'user=19',
    'uuid-1',
    'sub-id-1',
    'user-token',
    'https://secret.example',
    'request failed'
  ]) {
    assert.ok(!combinedLogs.includes(secret), `来源刷新日志不得输出标识或凭据：${secret}`);
  }
}

/**
 * 验证首次生成阶段日志统一使用用户邮箱。
 *
 * @returns {Promise<void>}
 */
async function testFirstGenerationStageLogsUseEmail() {
  const scenario = createGenerationScenario({ firstGeneration: true });

  await withRepositoryMocks(scenario.repositoryMocks, async () => {
    await subscriptionService.generateSubscription({}, 19, scenario.logger, {
      dependencies: scenario.dependencies
    });
  });

  assert.ok(scenario.logs.some((message) => (
    message.includes('用户 user@example.com 首次生成订阅，开始拉取全部原始订阅模板')
  )));
  assert.ok(scenario.logs.some((message) => (
    message.includes('用户 user@example.com 首次模板刷新结果')
  )));
  assert.ok(!scenario.logs.join('\n').includes('用户 19 首次'));
}

/**
 * 构造可复用的用户节点配置与入站快照 JOIN 测试数据。
 *
 * @param {Object} [overrides={}] - 覆盖默认组合记录字段
 * @returns {Object} 用户凭据与入站快照的组合记录
 */
function createJoinedConfig(overrides = {}) {
  return {
    server_id: 1,
    inbound_id: 10,
    remark: 'direct-node',
    protocol: 'vless',
    uuid: 'uuid-1',
    sub_id: 'sub-id-1',
    settings: JSON.stringify({
      clients: [{
        email: 'user@example.com-direct-node',
        id: 'uuid-1',
        subId: 'sub-id-1'
      }]
    }),
    stream_settings: '{}',
    ...overrides
  };
}

/**
 * 验证用户入站快照可信度的全部拒绝分支和成功分支。
 *
 * @returns {void}
 */
function testInspectUserInNodeSnapshot() {
  const inspectUserInNodeSnapshot = subscriptionService.__testables.inspectUserInNodeSnapshot;
  assert.strictEqual(
    typeof inspectUserInNodeSnapshot,
    'function',
    '应导出 inspectUserInNodeSnapshot 测试入口'
  );

  const user = { email: 'user@example.com' };
  assert.deepStrictEqual(
    inspectUserInNodeSnapshot(user, null),
    { trusted: false, reason: 'missing_snapshot' }
  );
  assert.deepStrictEqual(
    inspectUserInNodeSnapshot(null, createJoinedConfig()),
    { trusted: false, reason: 'incomplete_snapshot' }
  );
  assert.deepStrictEqual(
    inspectUserInNodeSnapshot({}, createJoinedConfig()),
    { trusted: false, reason: 'incomplete_snapshot' }
  );

  const trusted = inspectUserInNodeSnapshot(user, createJoinedConfig());
  assert.strictEqual(trusted.trusted, true);
  assert.strictEqual(trusted.reason, 'ok');
  assert.strictEqual(trusted.client.email, 'user@example.com-direct-node');
  const trustedCanonical = inspectUserInNodeSnapshot(
    user,
    createJoinedConfig({
      settings: JSON.stringify({
        clients: [{
          email: 'user@example.com',
          id: 'uuid-1',
          password: 'password-1',
          auth: 'auth-1',
          subId: 'sub-id-1'
        }]
      })
    })
  );
  assert.strictEqual(trustedCanonical.trusted, true);
  assert.strictEqual(trustedCanonical.reason, 'ok');
  assert.strictEqual(trustedCanonical.client.email, 'user@example.com');
  assert.strictEqual(
    inspectUserInNodeSnapshot(user, createJoinedConfig({
      uuid: 123456,
      sub_id: 7890,
      settings: JSON.stringify({
        clients: [{
          email: 'user@example.com-direct-node',
          id: '123456',
          subId: '7890'
        }]
      })
    })).trusted,
    true,
    'UUID 和 subId 的数字/字符串表示等值时应信任快照'
  );

  const missingUser = inspectUserInNodeSnapshot(
    user,
    createJoinedConfig({ settings: JSON.stringify({ clients: [] }) })
  );
  assert.deepStrictEqual(missingUser, { trusted: false, reason: 'missing_user' });

  const subIdMismatch = inspectUserInNodeSnapshot(
    user,
    createJoinedConfig({
      settings: JSON.stringify({
        clients: [{
          email: 'user@example.com-direct-node',
          id: 'uuid-1',
          subId: 'different-sub-id'
        }]
      })
    })
  );
  assert.deepStrictEqual(subIdMismatch, { trusted: false, reason: 'sub_id_mismatch' });
  assert.deepStrictEqual(
    inspectUserInNodeSnapshot(
      user,
      createJoinedConfig({
        settings: JSON.stringify({
          clients: [{ email: 'user@example.com-direct-node', id: 'uuid-1', subId: '' }]
        })
      })
    ),
    { trusted: false, reason: 'sub_id_mismatch' }
  );
  assert.deepStrictEqual(
    inspectUserInNodeSnapshot(user, createJoinedConfig({ sub_id: '' })),
    { trusted: false, reason: 'sub_id_mismatch' }
  );

  const uuidMismatch = inspectUserInNodeSnapshot(
    user,
    createJoinedConfig({
      settings: JSON.stringify({
        clients: [{
          email: 'user@example.com-direct-node',
          id: 'different-uuid',
          subId: 'sub-id-1'
        }]
      })
    })
  );
  assert.deepStrictEqual(uuidMismatch, { trusted: false, reason: 'uuid_mismatch' });
  assert.deepStrictEqual(
    inspectUserInNodeSnapshot(
      user,
      createJoinedConfig({
        settings: JSON.stringify({
          clients: [{ email: 'user@example.com-direct-node', id: '', subId: 'sub-id-1' }]
        })
      })
    ),
    { trusted: false, reason: 'uuid_mismatch' }
  );
  assert.deepStrictEqual(
    inspectUserInNodeSnapshot(user, createJoinedConfig({ uuid: '' })),
    { trusted: false, reason: 'uuid_mismatch' }
  );

  const trustedHy2 = inspectUserInNodeSnapshot(
    user,
    createJoinedConfig({
      remark: 'hy2',
      protocol: 'hysteria2',
      uuid: '',
      auth: 'hy2-auth-1',
      settings: JSON.stringify({
        clients: [{
          email: 'user@example.com-hy2',
          password: 'hy2-auth-1',
          subId: 'sub-id-1'
        }]
      })
    })
  );
  assert.strictEqual(
    trustedHy2.trusted,
    true,
    'hy2 节点应使用 auth/password 校验身份，不应要求 UUID'
  );
  assert.deepStrictEqual(
    inspectUserInNodeSnapshot(
      user,
      createJoinedConfig({
        remark: 'hy2',
        protocol: 'hysteria2',
        uuid: '',
        auth: 'hy2-auth-1',
        settings: JSON.stringify({
          clients: [{
            email: 'user@example.com-hy2',
            auth: 'different-auth',
            subId: 'sub-id-1'
          }]
        })
      })
    ),
    { trusted: false, reason: 'auth_mismatch' }
  );

  const invalidSettings = inspectUserInNodeSnapshot(
    user,
    createJoinedConfig({ settings: '{invalid-json' })
  );
  assert.deepStrictEqual(invalidSettings, { trusted: false, reason: 'invalid_settings' });

  const invalidClients = inspectUserInNodeSnapshot(
    user,
    createJoinedConfig({ settings: JSON.stringify({ clients: {} }) })
  );
  assert.deepStrictEqual(invalidClients, { trusted: false, reason: 'invalid_clients' });

  const duplicateUser = inspectUserInNodeSnapshot(
    user,
    createJoinedConfig({
      settings: JSON.stringify({
        clients: [
          { email: 'user@example.com-direct-node', id: 'uuid-1', subId: 'sub-id-1' },
          { email: 'user@example.com-direct-node', id: 'uuid-1', subId: 'sub-id-1' }
        ]
      })
    })
  );
  assert.deepStrictEqual(duplicateUser, { trusted: false, reason: 'duplicate_user' });

  for (const field of ['server_id', 'inbound_id', 'protocol', 'settings', 'stream_settings']) {
    const incompleteSnapshot = createJoinedConfig();
    delete incompleteSnapshot[field];
    assert.deepStrictEqual(
      inspectUserInNodeSnapshot(user, incompleteSnapshot),
      { trusted: false, reason: 'incomplete_snapshot' },
      `缺少 ${field} 时应拒绝快照`
    );
  }

  const inboundFallback = inspectUserInNodeSnapshot(
    user,
    createJoinedConfig({
      remark: '',
      settings: JSON.stringify({
        clients: [{
          email: 'user@example.com-10',
          id: 'uuid-1',
          subId: 'sub-id-1'
        }]
      })
    })
  );
  assert.strictEqual(inboundFallback.trusted, true);
  assert.strictEqual(inboundFallback.client.email, 'user@example.com-10');
}

/**
 * 验证服务器名称格式化保持输入顺序，并按服务器 ID 去重。
 *
 * @returns {void}
 */
function testFormatServerNames() {
  const formatServerNames = subscriptionService.__testables.formatServerNames;
  assert.strictEqual(typeof formatServerNames, 'function', '应导出 formatServerNames 测试入口');
  assert.strictEqual(formatServerNames([]), '[]');
  assert.strictEqual(
    formatServerNames([
      { id: 2, name: '美国01-达拉斯' },
      { id: 1, name: '日本' },
      { id: 2, name: '重复名称不应输出' }
    ]),
    '[美国01-达拉斯, 日本]'
  );
  assert.strictEqual(
    formatServerNames([
      { id: 3 },
      { id: '3', name: '字符串编号不应重复' },
      { name: '无编号甲' },
      { name: '无编号乙' },
      { name: '无编号甲' },
      {},
      { name: '' }
    ]),
    '[未知服务器-3, 无编号甲, 无编号乙]'
  );
}

/**
 * 验证入站刷新计划复用可信快照，并按服务器归并远程补拉任务。
 *
 * @returns {void}
 */
function testBuildInboundRefreshPlan() {
  const buildInboundRefreshPlan = subscriptionService.__testables.buildInboundRefreshPlan;
  assert.strictEqual(
    typeof buildInboundRefreshPlan,
    'function',
    '应导出 buildInboundRefreshPlan 测试入口'
  );

  const user = { email: 'user@example.com' };
  const reusableConfig = createJoinedConfig();
  const missingUserConfig = createJoinedConfig({
    inbound_id: 11,
    remark: 'missing-user',
    settings: JSON.stringify({ clients: [] })
  });
  const duplicateServerConfig = createJoinedConfig({
    inbound_id: 12,
    remark: 'missing-user-2',
    settings: JSON.stringify({ clients: [] })
  });
  const invalidSettingsConfig = createJoinedConfig({
    server_id: 2,
    inbound_id: 20,
    remark: 'invalid-settings',
    settings: '{invalid-json'
  });
  const missingServerConfig = createJoinedConfig({
    server_id: 3,
    inbound_id: 30,
    remark: 'missing-server',
    settings: JSON.stringify({ clients: [] })
  });
  const invalidPairs = [
    { key: '1:10', config: reusableConfig, reason: 'cache_expired' },
    { key: '1:11', config: missingUserConfig, reason: 'missing_source' },
    { key: '1:12', config: duplicateServerConfig, reason: 'missing_source' },
    { key: '2:20', config: invalidSettingsConfig, reason: 'node_fingerprint_mismatch' },
    { key: '3:30', config: missingServerConfig, reason: 'missing_source' }
  ];
  const serversById = new Map([
    [1, { id: 1, name: '香港节点' }],
    [2, { id: 2, name: '美国节点' }]
  ]);

  const plan = buildInboundRefreshPlan(user, invalidPairs, serversById);

  assert.deepStrictEqual(plan.reusablePairs, [invalidPairs[0]]);
  assert.deepStrictEqual(plan.remotePairs, invalidPairs.slice(1));
  assert.ok(plan.remoteServerIds instanceof Set);
  assert.deepStrictEqual([...plan.remoteServerIds], [1, 2]);
  assert.deepStrictEqual(plan.remoteServers, [
    { id: 1, name: '香港节点' },
    { id: 2, name: '美国节点' }
  ]);
  assert.deepStrictEqual(plan.reasonCounts, {
    missing_user: 3,
    invalid_settings: 1
  });
}

/**
 * 验证静默评估来源缓存时，节点指纹不匹配不会输出失效日志。
 *
 * @returns {void}
 */
function testNodeFingerprintMismatchStaysSilent() {
  const node = {
    server_id: 1,
    inbound_id: 10,
    remark: 'direct-node',
    protocol: 'vless',
    port: 443,
    settings: '{invalid-json',
    stream_settings: '{}'
  };
  const server = {
    id: 1,
    sub_url: 'https://demo.example/sub/',
    host: 'demo.example',
    client_port: 8443
  };
  const source = {
    sub_id: 'abcdef1234567890',
    node_fingerprint: 'stale-node-fingerprint',
    server_fingerprint: cacheService.computeServerFingerprint(server),
    fetched_at: 1710000000
  };
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  const messages = [];
  const warnings = [];

  console.log = (...args) => {
    messages.push(args);
  };
  console.warn = (...args) => {
    warnings.push(args);
  };

  try {
    const result = cacheService.isSourceCacheUsable({
      source,
      node,
      server,
      subId: 'abcdef1234567890',
      now: 1710000300,
      maxAgeSeconds: 86400,
      silent: true
    });

    assert.deepStrictEqual(result, {
      usable: false,
      reason: 'node_fingerprint_mismatch'
    });
    assert.strictEqual(messages.length, 0, 'silent=true 时不应输出缓存失效日志');
    assert.strictEqual(warnings.length, 0, 'silent=true 时不应输出指纹解析警告');
  } finally {
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
  }
}

/**
 * 验证非静默计算节点指纹时，JSON 解析警告使用统一日志格式。
 *
 * @returns {void}
 */
function testInvalidNodeSettingsUsesUnifiedWarnLogger() {
  const originalConsoleWarn = console.warn;
  const warnings = [];

  console.warn = (...args) => {
    warnings.push(args.join(' '));
  };

  try {
    cacheService.computeNodeFingerprint({
      server_id: 1,
      inbound_id: 10,
      settings: '{invalid-json',
      stream_settings: '{}'
    });

    assert.strictEqual(warnings.length, 1, '非法节点 settings 应输出一条解析警告');
    assert.ok(
      warnings[0].includes('[SUBSCRIPTION-CACHE-SERVICE] [WARN]')
        && warnings[0].includes('stableJson 解析 JSON 失败'),
      `应使用统一警告格式，实际输出：${warnings[0]}`
    );
  } finally {
    console.warn = originalConsoleWarn;
  }
}

/**
 * 验证非静默评估来源缓存时，节点指纹失效日志使用统一日志格式。
 *
 * @returns {void}
 */
function testNodeFingerprintMismatchUsesUnifiedLogger() {
  const node = {
    server_id: 1,
    inbound_id: 10,
    remark: 'direct-node',
    protocol: 'vless',
    port: 443,
    settings: '{}',
    stream_settings: '{}'
  };
  const server = {
    id: 1,
    sub_url: 'https://demo.example/sub/',
    host: 'demo.example',
    client_port: 8443
  };
  const source = {
    sub_id: 'abcdef1234567890',
    node_fingerprint: 'stale-node-fingerprint',
    server_fingerprint: cacheService.computeServerFingerprint(server),
    fetched_at: 1710000000
  };
  const originalConsoleLog = console.log;
  const messages = [];

  console.log = (...args) => {
    messages.push(args.join(' '));
  };

  try {
    const result = cacheService.isSourceCacheUsable({
      source,
      node,
      server,
      subId: 'abcdef1234567890',
      now: 1710000300,
      maxAgeSeconds: 86400
    });

    assert.strictEqual(result.reason, 'node_fingerprint_mismatch');
    assert.strictEqual(messages.length, 1, '非静默评估应输出一条缓存失效日志');
    assert.ok(
      messages[0].includes('[SUBSCRIPTION-CACHE-SERVICE] [INFO]')
        && messages[0].includes('来源缓存失效：节点指纹不匹配'),
      `应使用统一日志格式，实际输出：${messages[0]}`
    );
  } finally {
    console.log = originalConsoleLog;
  }
}

/**
 * 验证用户节点配置查询会带出服务器级全量 client 所需的 password/auth 字段。
 *
 * @returns {Promise<void>}
 */
async function testListUserNodeConfigsSelectsAuth() {
  let capturedSql = '';
  const db = {
    prepare(sql) {
      capturedSql = sql;
      return {
        async all() {
          return [];
        }
      };
    }
  };

  await subscriptionRepository.listUserNodeConfigs(db, 1);
  assert.match(capturedSql, /unc\.password/);
  assert.match(capturedSql, /unc\.auth/);
}

async function run() {
  testFormatServerNames();
  testBuildInboundRefreshPlan();
  testNodeFingerprintMismatchStaysSilent();
  testInvalidNodeSettingsUsesUnifiedWarnLogger();
  testNodeFingerprintMismatchUsesUnifiedLogger();
  testInspectUserInNodeSnapshot();
  await testListUserNodeConfigsSelectsAuth();
  await testGenerateSubscriptionBatchesUntrustedServers();
  await testGenerateSubscriptionCompensatesAtMostOnce();
  await testGenerateSubscriptionKeepsTrustedServersOnPartialCompensationFailure();
  await testGenerateSubscriptionUsesNamedSafeSummaryLogs();
  await testGenerateSubscriptionSummaryUsesLatestRemoteOutcome();
  await testSourceRefreshStageLogsUseEmail();
  await testFirstGenerationStageLogsUseEmail();
  console.log('subscription snapshot reuse tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
