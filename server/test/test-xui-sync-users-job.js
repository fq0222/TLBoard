const assert = require('assert');
const { __testables } = require('../jobs/handlers/sync-xui-users');
const serversRepository = require('../repositories/servers-repository');
const { resolveServerClientCredentials } = require('../services/shared/xui-credential-resolver');
const { EventEmitter } = require('events');
const { Pool } = require('pg');
const XuiService = require('../integrations/xui/xui-service');
const xuiSyncRepository = require('../repositories/xui-sync-repository');
const { createDbProxy } = require('../db/proxy');
const { convertPlaceholders } = require('../db/sql-utils');

async function testServerRepositoryShouldUpdateOnlyLastCheckAt() {
  const calls = [];
  const db = {
    prepare(sql) {
      return {
        async run(...params) {
          calls.push({ sql, params });
        }
      };
    }
  };

  await serversRepository.updateServerLastCheckAt(db, 9, 123456);

  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0].sql.includes('SET last_check_at = ?'));
  assert.ok(!calls[0].sql.includes('status'));
  assert.deepStrictEqual(calls[0].params, [123456, 9]);
}

function testServerClientAlreadySyncedShouldMatchCredentialsStatusAndInbounds() {
  const desiredClient = {
    id: 'uuid-1',
    password: 'password-1',
    auth: 'authvalue0000000',
    enable: true,
    expiryTime: 0,
    totalGB: 1024,
    subId: 'sub-1',
    flow: 'xtls-rprx-vision'
  };

  assert.strictEqual(__testables.isServerClientAlreadySynced({
    success: true,
    client: {
      uuid: 'uuid-1',
      password: 'password-1',
      auth: 'authvalue0000000',
      enable: 1,
      expiryTime: '0',
      totalGB: '1024',
      subId: 'sub-1',
      flow: 'xtls-rprx-vision'
    },
    inboundIds: [1, 2, 3]
  }, [1, 2, 3], desiredClient), true);

  assert.strictEqual(__testables.isServerClientAlreadySynced({
    success: true,
    client: {
      uuid: 'uuid-1',
      password: 'password-1',
      auth: 'authvalue0000000',
      enable: 1,
      expiryTime: 0,
      totalGB: 1024,
      subId: 'sub-1',
      flow: 'xtls-rprx-vision'
    },
    inboundIds: [1, 2]
  }, [1, 2, 3], desiredClient), false);

  assert.strictEqual(__testables.isServerClientAlreadySynced({
    success: true,
    client: {
      uuid: 'uuid-1',
      password: 'password-1',
      auth: 'authvalue0000000',
      enable: 0,
      expiryTime: 0,
      totalGB: 1024,
      subId: 'sub-1',
      flow: 'xtls-rprx-vision'
    },
    inboundIds: [1, 2, 3]
  }, [1, 2, 3], desiredClient), false);

  assert.strictEqual(__testables.isServerClientAlreadySynced({
    success: true,
    client: {
      uuid: 'uuid-1',
      password: 'password-1',
      auth: 'authvalue0000000',
      enable: 1,
      expiryTime: 0,
      totalGB: 1024,
      subId: 'sub-1',
      flow: ''
    },
    inboundIds: [1, 2, 3]
  }, [1, 2, 3], desiredClient, [
    { id: 1, remark: 'cf' },
    { id: 2, remark: 'hy2' }
  ]), true);

  assert.strictEqual(__testables.isServerClientAlreadySynced({
    success: true,
    client: {
      uuid: 'uuid-1',
      password: 'password-1',
      auth: 'authvalue0000000',
      enable: 1,
      expiryTime: 0,
      totalGB: 1024,
      subId: 'sub-1',
      flow: 'other-flow'
    },
    inboundIds: [1, 2, 3]
  }, [1, 2, 3], desiredClient, [
    { id: 1, remark: 'direct' }
  ]), false);
}

function testServerClientSyncMismatchesShouldNameDifferentFields() {
  const desiredClient = {
    id: 'uuid-1',
    password: 'password-1',
    auth: 'authvalue0000000',
    enable: true,
    expiryTime: 0,
    totalGB: 1024,
    subId: 'sub-1',
    flow: 'xtls-rprx-vision'
  };

  assert.deepStrictEqual(
    __testables.getServerClientSyncMismatches({
      success: true,
      client: {
        uuid: 'uuid-1',
        password: 'password-1',
        auth: 'authvalue0000000',
        enable: 1,
        expiryTime: 0,
        totalGB: 2048,
        subId: 'sub-1',
        flow: ''
      },
      inboundIds: [1]
    }, [1, 2], desiredClient, [
      { id: 1, remark: 'direct' },
      { id: 2, remark: 'cf' }
    ]),
    ['inboundIds:missing=2', 'totalGB:2048->1024', 'flow:inbound=1:->xtls-rprx-vision']
  );

  assert.deepStrictEqual(
    __testables.getServerClientSyncMismatches({ success: false }, [1], desiredClient),
    ['client_missing']
  );
}

function testServerClientSyncMismatchesShouldIgnoreWsFlow() {
  const desiredClient = {
    id: 'uuid-1',
    password: 'password-1',
    auth: 'authvalue0000000',
    enable: true,
    expiryTime: 0,
    totalGB: 1024,
    subId: 'sub-1',
    flow: 'xtls-rprx-vision'
  };

  assert.deepStrictEqual(
    __testables.getServerClientSyncMismatches({
      success: true,
      client: {
        uuid: 'uuid-1',
        password: 'password-1',
        auth: 'authvalue0000000',
        enable: 1,
        expiryTime: 0,
        totalGB: 1024,
        subId: 'sub-1',
        flow: ''
      },
      inboundIds: [3],
      inboundClientsById: {
        3: {
          uuid: 'uuid-1',
          password: 'password-1',
          auth: 'authvalue0000000',
          enable: 1,
          expiryTime: 0,
          totalGB: 1024,
          subId: 'sub-1',
          flow: ''
        }
      }
    }, [3], desiredClient, [
      { id: 3, remark: '意大利[AI]-ws' }
    ]),
    []
  );
}

function testServerClientSnapshotShouldBeBuiltFromInbounds() {
  const result = __testables.getServerClientFromInboundSnapshots('user@example.com', [
    {
      id: 10,
      remark: 'cf',
      settings: JSON.stringify({
        clients: [{
          email: 'user@example.com',
          id: 'uuid-1',
          password: 'password-1',
          auth: 'authvalue0000000',
          enable: true,
          expiryTime: 0,
          totalGB: 1024,
          subId: 'sub-1',
          flow: ''
        }]
      })
    },
    {
      id: 11,
      remark: 'direct',
      settings: JSON.stringify({
        clients: [{
          email: 'user@example.com',
          id: 'uuid-1',
          password: 'password-1',
          auth: 'authvalue0000000',
          enable: true,
          expiryTime: 0,
          totalGB: 1024,
          subId: 'sub-1',
          flow: 'xtls-rprx-vision'
        }]
      })
    },
    {
      id: 12,
      remark: 'hy2',
      settings: JSON.stringify({
        clients: [{
          email: 'user@example.com',
          id: 'uuid-1',
          password: 'password-1',
          auth: 'authvalue0000000',
          enable: true,
          expiryTime: 0,
          totalGB: 1024,
          subId: 'sub-1',
          flow: ''
        }]
      })
    }
  ]);

  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.inboundIds, [10, 11, 12]);
  assert.strictEqual(result.client.uuid, 'uuid-1');
  assert.strictEqual(result.client.password, 'password-1');
  assert.strictEqual(result.client.auth, 'authvalue0000000');
  assert.strictEqual(result.client.subId, 'sub-1');
  assert.strictEqual(result.client.flow, 'xtls-rprx-vision');
  assert.strictEqual(result.inboundClientsById[10].flow, '');
  assert.strictEqual(result.inboundClientsById[11].flow, 'xtls-rprx-vision');
  assert.strictEqual(result.inboundClientsById[12].flow, '');

  assert.deepStrictEqual(
    __testables.getServerClientSyncMismatches(result, [10, 11, 12], {
      id: 'uuid-1',
      password: 'password-1',
      auth: 'authvalue0000000',
      enable: true,
      expiryTime: 0,
      totalGB: 1024,
      subId: 'sub-1',
      flow: 'xtls-rprx-vision'
    }, [
      { id: 10, remark: 'cf' },
      { id: 11, remark: 'direct' },
      { id: 12, remark: 'hy2' }
    ]),
    []
  );
}

function testServerClientSnapshotShouldReturnNullWhenInboundSettingsInvalid() {
  assert.strictEqual(
    __testables.getServerClientFromInboundSnapshots('user@example.com', [
      { id: 10, settings: '{bad json' }
    ]),
    null
  );
}

function testInvalidLocalSubIdShouldBeRegeneratedInsteadOfAdoptingRemote() {
  const generatedFields = [];
  const result = resolveServerClientCredentials({
    localConfigs: [{
      inbound_id: 10,
      uuid: 'local-uuid',
      password: 'local-password',
      auth: 'localauthvalue01',
      sub_id: 'invalid-local-sub-id'
    }],
    remoteClient: { email: 'user@example.com', subId: 'abcdef0123456789' },
    expectedEmail: 'user@example.com',
    generators: {
      uuid: () => { generatedFields.push('uuid'); return 'generated-uuid'; },
      password: () => { generatedFields.push('password'); return 'generated-password'; },
      auth: () => { generatedFields.push('auth'); return 'generatedauth001'; },
      subId: () => { generatedFields.push('subId'); return '0123456789abcdef'; }
    }
  });

  assert.strictEqual(result.subId, '0123456789abcdef');
  assert.deepStrictEqual(generatedFields, ['subId']);
}

function testIncompleteLocalCredentialsShouldGenerateMissingFieldsInsteadOfAdoptingRemote() {
  const generatedFields = [];
  const result = resolveServerClientCredentials({
    localConfigs: [{ inbound_id: 10, uuid: '', password: '', auth: '', sub_id: '' }],
    remoteClient: {
      email: 'user@example.com',
      uuid: 'remote-uuid',
      password: 'remote-password',
      auth: 'remoteauthvalue1',
      subId: 'abcdef0123456789'
    },
    expectedEmail: 'user@example.com',
    generators: {
      uuid: () => { generatedFields.push('uuid'); return 'generated-uuid'; },
      password: () => { generatedFields.push('password'); return 'generated-password'; },
      auth: () => { generatedFields.push('auth'); return 'generatedauth001'; },
      subId: () => { generatedFields.push('subId'); return '0123456789abcdef'; }
    }
  });

  assert.deepStrictEqual(result, {
    uuid: 'generated-uuid',
    password: 'generated-password',
    auth: 'generatedauth001',
    subId: '0123456789abcdef',
    source: 'local-repaired',
    generatedFields: ['uuid', 'password', 'auth', 'subId']
  });
  assert.deepStrictEqual(generatedFields, ['uuid', 'password', 'auth', 'subId']);
}

function testCompleteLocalCredentialsShouldNotGenerateAnything() {
  const failGenerator = () => {
    throw new Error('本地凭证完整时不应生成随机字段');
  };
  const result = resolveServerClientCredentials({
    localConfigs: [{
      inbound_id: 10,
      uuid: 'local-uuid',
      password: 'local-password',
      auth: 'localauthvalue01',
      sub_id: '0123456789abcdef'
    }],
    remoteClient: {
      email: 'user@example.com',
      uuid: 'remote-uuid',
      password: 'remote-password',
      auth: 'remoteauthvalue1',
      subId: 'abcdef0123456789'
    },
    expectedEmail: 'user@example.com',
    generators: {
      uuid: failGenerator,
      password: failGenerator,
      auth: failGenerator,
      subId: failGenerator
    }
  });

  assert.strictEqual(result.source, 'local');
  assert.deepStrictEqual(result.generatedFields, []);
  assert.strictEqual(result.uuid, 'local-uuid');
}

function testRemoteCredentialsShouldRequireMatchingLocalUserEmail() {
  assert.throws(() => resolveServerClientCredentials({
    localConfigs: [],
    remoteClient: {
      email: 'other@example.com',
      uuid: 'remote-uuid',
      password: 'remote-password',
      auth: 'remoteauthvalue1',
      subId: 'abcdef0123456789'
    },
    expectedEmail: 'user@example.com'
  }), /email 不一致/);
}

async function testSyncUsersShouldSkipByInboundSnapshotWithoutClientApi() {
  const logs = [];
  let clientApiCalls = 0;
  const lastCheckUpdates = [];
  const db = {};
  const server = {
    id: 3,
    name: 'server-a',
    api_url: 'https://xui.example.com',
    api_token: 'token',
    panel_version: '3.4.2'
  };
  const users = [{
    id: 7,
    email: 'user@example.com',
    enabled: 1,
    expire_at: 0,
    traffic_limit: 1024
  }];
  const inbounds = [{
    id: 10,
    remark: 'direct',
    settings: JSON.stringify({
      clients: [{
        email: 'user@example.com',
        id: 'uuid-1',
        password: 'password-1',
        auth: 'authvalue0000000',
        enable: true,
        expiryTime: 0,
        totalGB: 1024,
        subId: 'abcdef0123456789',
        flow: 'xtls-rprx-vision'
      }]
    })
  }];

  await __testables.syncUsersToServer(db, server, users, {
    logger: {
      info(message) { logs.push(message); },
      warn(message) { logs.push(message); },
      error(message) { logs.push(message); }
    },
    xuiService: {
      async getInbounds() {
        return { success: true, data: inbounds };
      },
      async getServerClientByEmail() {
        clientApiCalls += 1;
        return { success: false };
      },
      async upsertServerClient() {
        throw new Error('不应在快照一致时同步');
      }
    },
    snapshotService: {
      async refreshServerNodeSnapshots() {
        return { nodeCount: 1 };
      }
    },
    serversRepository: {
      async updateServerManagedUserCount() {},
      async updateServerLastCheckAt(dbArg, serverId, lastCheckAt) {
        lastCheckUpdates.push({ dbArg, serverId, lastCheckAt });
      }
    },
    repository: {
      async listUserNodeConfigsByServer() {
        return [{
          inbound_id: 10,
          uuid: 'uuid-1',
          password: 'password-1',
          auth: 'authvalue0000000',
          sub_id: 'abcdef0123456789'
        }];
      },
      async findUserNodeConfig() {
        return {
          uuid: 'uuid-1',
          password: 'password-1',
          auth: 'authvalue0000000',
          sub_id: 'abcdef0123456789'
        };
      },
      async saveUserNodeConfig() {}
    }
  });

  assert.strictEqual(clientApiCalls, 0);
  assert.strictEqual(lastCheckUpdates.length, 1);
  assert.strictEqual(lastCheckUpdates[0].dbArg, db);
  assert.strictEqual(lastCheckUpdates[0].serverId, 3);
  assert.ok(Number.isInteger(lastCheckUpdates[0].lastCheckAt));
  assert.ok(logs.some((message) => message.includes('已一致，跳过同步')));
}

/**
 * 验证 3X-UI 3.4.2+ 巡检发现远端凭证被修改时，以本地凭证覆盖远端且不反写本地。
 */
async function testSyncUsersShouldPreferLocalCredentialsOverRemote() {
  const savedConfigs = [];
  const upserts = [];
  const localConfig = {
    uuid: 'local-uuid',
    password: 'local-password',
    auth: 'localauthvalue01',
    sub_id: '1234567890abcdef'
  };
  const inbounds = [{
    id: 10,
    remark: 'direct',
    settings: JSON.stringify({
      clients: [{
        email: 'user@example.com',
        id: 'remote-uuid',
        password: 'remote-password',
        auth: 'remote-auth',
        enable: true,
        expiryTime: 0,
        totalGB: 1024,
        subId: 'remote-sub-id',
        flow: 'xtls-rprx-vision'
      }]
    })
  }];

  await __testables.syncUsersToServer({}, {
    id: 3,
    name: 'server-a',
    api_url: 'https://xui.example.com',
    api_token: 'token',
    panel_version: '3.4.2'
  }, [{
    id: 7,
    email: 'user@example.com',
    enabled: 1,
    expire_at: 0,
    traffic_limit: 1024
  }], {
    logger: { info() {}, warn() {}, error() {} },
    xuiService: {
      async getInbounds() {
        return { success: true, data: inbounds };
      },
      async upsertServerClient(payload) {
        upserts.push(payload);
        return { success: true };
      }
    },
    snapshotService: {
      async refreshServerNodeSnapshots() {
        return { nodeCount: 1 };
      }
    },
    serversRepository: {
      async updateServerManagedUserCount() {},
      async updateServerLastCheckAt() {}
    },
    repository: {
      async listUserNodeConfigsByServer() {
        return [{ inbound_id: 10, ...localConfig }];
      },
      async findUserNodeConfig() {
        return localConfig;
      },
      async saveUserNodeConfig(_db, payload) {
        savedConfigs.push(payload);
      }
    }
  });

  assert.strictEqual(upserts.length, 1);
  assert.deepStrictEqual(
    {
      id: upserts[0].client.id,
      password: upserts[0].client.password,
      auth: upserts[0].client.auth,
      subId: upserts[0].client.subId
    },
    {
      id: localConfig.uuid,
      password: localConfig.password,
      auth: localConfig.auth,
      subId: localConfig.sub_id
    }
  );
  assert.ok(savedConfigs.every((config) =>
    config.uuid === localConfig.uuid &&
    config.password === localConfig.password &&
    config.auth === localConfig.auth &&
    config.subId === localConfig.sub_id
  ));
}

/**
 * 验证 inbound 返回顺序变化及本地记录冲突时，固定采用最小 inbound_id 的本地凭证。
 */
async function testSyncUsersShouldChooseDeterministicLocalCredentials() {
  const upserts = [];
  const configs = [
    { inbound_id: 11, uuid: 'local-uuid-11', password: 'password-11', auth: 'authvalue0000001', sub_id: '1111111111111111' },
    { inbound_id: 10, uuid: 'local-uuid-10', password: 'password-10', auth: 'authvalue0000000', sub_id: '1010101010101010' }
  ];
  const inbounds = [
    { id: 11, remark: 'cf', settings: JSON.stringify({ clients: [] }) },
    { id: 10, remark: 'direct', settings: JSON.stringify({ clients: [] }) }
  ];

  await __testables.syncUsersToServer({}, {
    id: 3,
    name: 'server-a',
    panel_version: '3.4.2'
  }, [{ id: 7, email: 'user@example.com', enabled: 1, expire_at: 0, traffic_limit: 1024 }], {
    logger: { info() {}, warn() {}, error() {} },
    xuiService: {
      async getInbounds() { return { success: true, data: inbounds }; },
      async upsertServerClient(payload) {
        upserts.push(payload);
        return { success: true };
      }
    },
    snapshotService: { async refreshServerNodeSnapshots() { return { nodeCount: 2 }; } },
    serversRepository: { async updateServerLastCheckAt() {}, async updateServerManagedUserCount() {} },
    repository: {
      async listUserNodeConfigsByServer() { return configs; },
      async findUserNodeConfig(_db, _userId, _serverId, inboundId) {
        return configs.find((config) => config.inbound_id === inboundId);
      },
      async saveUserNodeConfig() {}
    }
  });

  assert.strictEqual(upserts.length, 1);
  assert.strictEqual(upserts[0].client.id, 'local-uuid-10');
  assert.strictEqual(upserts[0].client.subId, '1010101010101010');
}

/**
 * 提供隔离数据库和远端面板的巡检依赖，记录真实任务编排产生的边界调用。
 * @param {number} userCount 本轮用户数；默认使用缺失远端用户触发补同步。
 */
class UserSyncFixture {
  constructor(userCount) {
    this.db = {
      prepare() { return { async get() { return null; } }; },
      pool: {
        async connect() {
          return {
            async query() { return { rows: [], rowCount: 0 }; },
            release() {}
          };
        }
      }
    };
    this.server = { id: 3, name: 'server-concurrency', panel_version: '3.4.2' };
    this.users = Array.from({ length: userCount }, (_, index) => ({
      id: index + 1,
      email: `user-${index + 1}@example.com`,
      enabled: 1,
      expire_at: 0,
      traffic_limit: 1024
    }));
    this.inbounds = [{ id: 10, remark: 'direct', protocol: 'vless', settings: '{"clients":[]}' }];
    this.logs = [];
    this.inboundReads = 0;
    this.snapshotRefreshes = 0;
    this.lastCheckUpdates = 0;
    this.dependencies = {
      logger: {
        info: (message) => this.logs.push(message),
        warn: (message) => this.logs.push(message),
        error: (message) => this.logs.push(message)
      },
      xuiService: {
        getInbounds: async () => {
          this.inboundReads++;
          return { success: true, data: this.inbounds };
        }
      },
      snapshotService: {
        refreshServerNodeSnapshots: async () => {
          this.snapshotRefreshes++;
          return { nodeCount: this.inbounds.length };
        }
      },
      serversRepository: {
        async updateServerManagedUserCount() {},
        updateServerLastCheckAt: async () => { this.lastCheckUpdates++; }
      },
      repository: {
        async listUserNodeConfigsByServer() { return []; },
        async findUserNodeConfig() { return null; },
        async saveUserNodeConfig() {}
      }
    };
  }

  /** 运行被测生产方法，保持夹具的远端调用与编排断言可观测。 */
  async run() {
    await __testables.syncUsersToServer(this.db, this.server, this.users, this.dependencies);
  }
}

/** 验证新版用户任务池确实达到 10 并发，且一次巡检仅加载和刷新一次节点。 */
async function testModernSyncShouldLimitUserConcurrencyToTen() {
  const fixture = new UserSyncFixture(25);
  let active = 0;
  let maxActive = 0;
  const emails = [];
  fixture.dependencies.xuiService.upsertServerClient = async ({ email }) => {
    active++;
    maxActive = Math.max(maxActive, active);
    emails.push(email);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return { success: true };
  };

  await fixture.run();

  assert.strictEqual(maxActive, 10);
  assert.strictEqual(emails.length, 25);
  assert.deepStrictEqual(emails.sort(), fixture.users.map((user) => user.email).sort());
  assert.strictEqual(fixture.inboundReads, 1);
  assert.strictEqual(fixture.snapshotRefreshes, 1);
  assert.strictEqual(fixture.lastCheckUpdates, 1);
}

/** 验证新版快照解析失败时回退 clients API，仍补同步该用户。 */
async function testModernSyncShouldFallbackToClientsApiWhenInboundSettingsMalformed() {
  const fixture = new UserSyncFixture(1);
  fixture.inbounds[0].settings = '{bad json';
  const queriedEmails = [];
  const syncedEmails = [];
  fixture.dependencies.xuiService.getServerClientByEmail = async (email) => {
    queriedEmails.push(email);
    return { success: false };
  };
  fixture.dependencies.xuiService.upsertServerClient = async ({ email }) => {
    syncedEmails.push(email);
    return { success: true };
  };

  await fixture.run();

  assert.deepStrictEqual(queriedEmails, ['user-1@example.com']);
  assert.deepStrictEqual(syncedEmails, ['user-1@example.com']);
  assert.ok(fixture.logs.some((message) => message.includes('回退 clients API')));
}

/** 验证抛错与远端业务失败分别计入失败，不阻断其他新版用户。 */
async function testModernSyncShouldIsolateUserFailures() {
  const fixture = new UserSyncFixture(12);
  const emails = [];
  fixture.dependencies.xuiService.upsertServerClient = async ({ email }) => {
    emails.push(email);
    if (email === 'user-1@example.com') throw new Error('network peak');
    if (email === 'user-2@example.com') return { success: false, message: 'remote rejected' };
    return { success: true };
  };

  await fixture.run();

  assert.strictEqual(emails.length, 12);
  assert.deepStrictEqual(emails.sort(), fixture.users.map((user) => user.email).sort());
  assert.ok(fixture.logs.some((message) =>
    message.includes('成功 10 个用户') && message.includes('失败 2 个用户')));
  for (const [email, reason] of [
    ['user-1@example.com', 'network peak'],
    ['user-2@example.com', 'remote rejected']
  ]) {
    assert.ok(fixture.logs.some((message) =>
      message.includes(email) && message.includes(fixture.server.name) && message.includes(reason)));
  }
}

/** 验证每个旧版 inbound 内并发 10，用户抛错隔离且下一个 inbound 等待全部任务结束。 */
async function testLegacySyncShouldLimitEachInboundUserConcurrencyToTen() {
  for (const inboundCount of [1, 2]) {
    const fixture = new UserSyncFixture(25);
    fixture.server.panel_version = '3.0.2';
    if (inboundCount === 2) {
      fixture.inbounds.push({ id: 11, remark: 'cf', protocol: 'vless', settings: '{"clients":[]}' });
    }
    let active = 0;
    let maxActive = 0;
    let firstInboundCompleted = 0;
    const calls = [];
    fixture.dependencies.xuiService.upsertUniqueClient = async (db, payload) => {
      assert.notStrictEqual(db, fixture.db, '旧版用户应使用连接绑定的数据库接口');
      assert.strictEqual(typeof db.prepare, 'function');
      if (payload.inbound.id === 11) assert.strictEqual(firstInboundCompleted, 25);
      active++;
      maxActive = Math.max(maxActive, active);
      calls.push({ inboundId: payload.inbound.id, email: payload.email });
      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (payload.userId === 1) throw new Error('legacy network peak');
        return { success: true, action: 'updated' };
      } finally {
        active--;
        if (payload.inbound.id === 10) firstInboundCompleted++;
      }
    };

    await fixture.run();

    assert.strictEqual(maxActive, 10);
    assert.strictEqual(calls.length, 25 * inboundCount);
    for (const inbound of fixture.inbounds) {
      assert.deepStrictEqual(
        calls.filter((call) => call.inboundId === inbound.id).map((call) => call.email).sort(),
        fixture.users.map((user) => `${user.email}-${inbound.remark}`).sort()
      );
    }
    assert.strictEqual(fixture.inboundReads, 1);
    assert.strictEqual(fixture.snapshotRefreshes, 1);
    assert.strictEqual(fixture.lastCheckUpdates, 1);
    assert.ok(fixture.logs.some((message) => message.includes('legacy network peak') &&
      message.includes('user-1@example.com') && message.includes(fixture.server.name)));
  }
}

/** 验证旧版异常 settings 仅跳过该 inbound，继续同步后续正常 inbound 并记录上下文。 */
async function testLegacySyncShouldSkipMalformedInboundSettings() {
  const fixture = new UserSyncFixture(1);
  fixture.server.panel_version = '3.0.2';
  fixture.inbounds.unshift({ id: 9, remark: 'cf', settings: '{bad json' });
  const inboundIds = [];
  fixture.dependencies.xuiService.upsertUniqueClient = async (_db, { inbound }) => {
    inboundIds.push(inbound.id);
    return { success: true };
  };

  await fixture.run();

  assert.deepStrictEqual(inboundIds, [10]);
  assert.ok(fixture.logs.some((message) => message.includes(fixture.server.name) &&
    message.includes('inbound 9') && message.includes('settings 解析失败')));
}

/** 验证任务级服务器仍按输入顺序逐台等待，用户和服务器列表每轮只查询一次。 */
async function testRunXuiSyncShouldKeepServersSequential() {
  const fixture = new UserSyncFixture(1);
  const servers = [{ id: 1, name: 'first' }, { id: 2, name: 'second' }];
  const events = [];
  let userQueries = 0;
  let serverQueries = 0;
  let activeServers = 0;
  let maxActiveServers = 0;
  await __testables.runXuiSync(fixture.db, {
    logger: fixture.dependencies.logger,
    repository: {
      async listUsersForXuiSync(db, now) {
        assert.strictEqual(db, fixture.db);
        assert.ok(Number.isInteger(now));
        userQueries++;
        return fixture.users;
      },
      async listOnlineXuiServers(db) {
        assert.strictEqual(db, fixture.db);
        serverQueries++;
        return servers;
      }
    },
    async syncServer(db, server, users) {
      assert.strictEqual(db, fixture.db);
      assert.strictEqual(users, fixture.users);
      activeServers++;
      maxActiveServers = Math.max(maxActiveServers, activeServers);
      events.push(`start-${server.id}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push(`end-${server.id}`);
      activeServers--;
    }
  });

  assert.deepStrictEqual(events, ['start-1', 'end-1', 'start-2', 'end-2']);
  assert.strictEqual(maxActiveServers, 1);
  assert.strictEqual(userQueries, 1);
  assert.strictEqual(serverQueries, 1);
}

/**
 * 物理 PostgreSQL session 替身；由真实 pg-pool 分配，锁仅可由持有它的 session 释放。
 * @param {Object} options pg-pool 传入的连接参数，sessionState 保存锁、节点配置和查询轨迹。
 */
class SessionLockClient extends EventEmitter {
  constructor(options) {
    super();
    this.state = options.sessionState;
    this.id = ++this.state.nextSessionId;
    this._queryable = true;
    this._ending = false;
  }

  /** 模拟异步连接完成，将后续复用顺序交给真实 pg-pool。 */
  connect(callback) {
    setImmediate(() => callback(null));
  }

  /**
   * 执行被测服务/仓储实际发出的 SQL，支持 pg-pool 回调与专用 client Promise 两种接口。
   * @param {string} sql 真实 SQL；保留 PostgreSQL session advisory lock 的归属语义。
   * @param {Array} params 查询参数。
   * @param {Function} callback pool.query 提供的可选完成回调。
   */
  query(sql, params = [], callback) {
    const pending = new Promise((resolve) => setImmediate(resolve))
      .then(() => this.execute(sql, params));
    if (callback) {
      pending.then((result) => callback(null, result), callback);
      return;
    }
    return pending;
  }

  /**
   * 应用 session 级锁和节点配置读写；无法识别的 SQL 直接失败，避免替身静默吞掉生产行为。
   * @param {string} sql PostgreSQL 格式语句。
   * @param {Array} params 参数列表。
   */
  execute(sql, params) {
    if (sql.includes('pg_try_advisory_lock')) {
      const owner = this.state.locks.get(params[0]);
      if (owner !== undefined && owner !== this.id) return { rows: [{ locked: false }] };
      this.state.locks.set(params[0], this.id);
      this.state.lockAcquisitions++;
      return { rows: [{ locked: true }] };
    }
    if (sql.includes('pg_advisory_unlock')) {
      const unlocked = this.state.locks.get(params[0]) === this.id;
      if (unlocked) this.state.locks.delete(params[0]);
      else this.state.failedUnlocks++;
      return { rows: [{ unlocked }] };
    }
    if (sql.includes('FROM user_node_configs')) {
      assert.ok(sql.includes('user_id = $1'), '必须复用 PostgreSQL 占位符转换');
      this.state.configSessions.push({ userId: params[0], sessionId: this.id });
      const config = this.state.configs.get(params[0]);
      return { rows: config ? [config] : [] };
    }
    if (sql.includes('INSERT INTO user_node_configs')) {
      if (params[0] === this.state.failSaveUserId) throw new Error('config save failed');
      this.state.configSessions.push({ userId: params[0], sessionId: this.id });
      this.state.configs.set(params[0], {
        uuid: params[3], password: params[4], auth: params[5], sub_id: params[6]
      });
      return { rows: [{ id: params[0] }], rowCount: 1 };
    }
    throw new Error(`Unexpected session SQL: ${sql}`);
  }

  /** 结束物理连接，通知真实连接池完成清理。 */
  end(callback) {
    this._ending = true;
    this.emit('end');
    if (callback) callback();
  }
}

/** 验证真实旧版 upsert 和仓储锁路径在并发时不遗留 session 锁，配置读写使用同一连接。 */
async function testLegacySyncShouldReleaseSessionLocksOnOwningConnection() {
  for (const withFailures of [false, true]) {
    const fixture = new UserSyncFixture(25);
    fixture.server.panel_version = '3.0.2';
    const state = {
      nextSessionId: 0, locks: new Map(), configs: new Map(), configSessions: [],
      lockAcquisitions: 0, failedUnlocks: 0, failSaveUserId: withFailures ? 3 : null
    };
    const pool = new Pool({ Client: SessionLockClient, sessionState: state, max: 20, idleTimeoutMillis: 0 });
    let borrowed = 0;
    let maxBorrowed = 0;
    pool.on('acquire', () => { borrowed++; maxBorrowed = Math.max(maxBorrowed, borrowed); });
    pool.on('release', () => { borrowed--; });
    fixture.db = createDbProxy({
      pool, queryWithRetry: pool.query.bind(pool), convertPlaceholders, logger: fixture.dependencies.logger
    });
    fixture.dependencies.repository = xuiSyncRepository;
    const service = Object.create(XuiService.prototype);
    service.getInbounds = fixture.dependencies.xuiService.getInbounds;
    const addedEmails = [];
    service.addClientByContext = async (_inboundId, _protocol, { email }) => {
      addedEmails.push(email);
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (withFailures && email === 'user-1@example.com-direct') throw new Error('remote exception');
      if (withFailures && email === 'user-2@example.com-direct') return { success: false, message: 'remote failed' };
      return { success: true };
    };
    fixture.dependencies.xuiService = service;

    try {
      await fixture.run();
      assert.strictEqual(addedEmails.length, 25);
      assert.strictEqual(state.configs.size, withFailures ? 22 : 25);
      assert.strictEqual(state.lockAcquisitions, 25);
      console.log(`legacy session locks (${withFailures ? 'failures' : 'success'}): failedUnlocks=${state.failedUnlocks}, retainedLocks=${state.locks.size}`);
      assert.strictEqual(state.failedUnlocks, 0, 'advisory unlock 必须使用持锁 session');
      assert.strictEqual(state.locks.size, 0, '不能将仍持 advisory lock 的连接归还池');
      assert.strictEqual(borrowed, 0);
      assert.strictEqual(maxBorrowed, 10);
      assert.strictEqual(pool.idleCount, pool.totalCount, '所有借用连接必须已归还');
      if (withFailures) {
        assert.ok(fixture.logs.some((message) => message.includes('成功 22 个用户，失败 3 个用户')));
        for (const reason of ['remote exception', 'remote failed', 'config save failed']) {
          assert.ok(fixture.logs.some((message) => message.includes(reason)));
        }
      }
      for (const user of fixture.users) {
        const sessions = new Set(state.configSessions.filter((item) => item.userId === user.id)
          .map((item) => item.sessionId));
        assert.strictEqual(sessions.size, 1, '同一用户的配置查询和保存必须使用同一 session');
      }
    } finally {
      await pool.end();
    }
  }
}

function run() {
  return testServerRepositoryShouldUpdateOnlyLastCheckAt()
    .then(() => {
      testServerClientAlreadySyncedShouldMatchCredentialsStatusAndInbounds();
      testServerClientSyncMismatchesShouldNameDifferentFields();
      testServerClientSyncMismatchesShouldIgnoreWsFlow();
      testServerClientSnapshotShouldBeBuiltFromInbounds();
      testServerClientSnapshotShouldReturnNullWhenInboundSettingsInvalid();
      testInvalidLocalSubIdShouldBeRegeneratedInsteadOfAdoptingRemote();
      testIncompleteLocalCredentialsShouldGenerateMissingFieldsInsteadOfAdoptingRemote();
      testCompleteLocalCredentialsShouldNotGenerateAnything();
      testRemoteCredentialsShouldRequireMatchingLocalUserEmail();
      return testSyncUsersShouldSkipByInboundSnapshotWithoutClientApi();
    })
    .then(() => {
      return testSyncUsersShouldPreferLocalCredentialsOverRemote();
    })
    .then(() => {
      return testSyncUsersShouldChooseDeterministicLocalCredentials();
    })
    .then(() => {
      return testModernSyncShouldLimitUserConcurrencyToTen();
    })
    .then(() => {
      return testModernSyncShouldFallbackToClientsApiWhenInboundSettingsMalformed();
    })
    .then(() => {
      return testModernSyncShouldIsolateUserFailures();
    })
    .then(() => {
      return testLegacySyncShouldLimitEachInboundUserConcurrencyToTen();
    })
    .then(() => {
      return testLegacySyncShouldSkipMalformedInboundSettings();
    })
    .then(() => {
      return testRunXuiSyncShouldKeepServersSequential();
    })
    .then(() => {
      return testLegacySyncShouldReleaseSessionLocksOnOwningConnection();
    })
    .then(() => {
      console.log('test-xui-sync-users-job: PASS');
    });
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
