/**
 * 验证订单同步在 3X-UI 3.4.2+ 下使用“每服务器一个全量 client + inboundIds 关联”。
 */

const assert = require('assert');
const Module = require('module');
const { RotationDatabase, generators, createService } = require('./test-subscription-credential-rotation-service');

const originalLoad = Module._load;
const calls = {
  upserts: [],
  saves: [],
  cacheClears: [],
  resetTraffic: [],
  logs: []
};

function clearOrderServiceCache() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes('server\\services\\shared\\order-service.js')
      || key.includes('server/services/shared/order-service.js')) {
      delete require.cache[key];
    }
  }
}

function createFakeDb() {
  const transactionDb = new RotationDatabase({ state: { configs: [] } });
  transactionDb.state.users.push({ id: 8, email: 'new@example.com', enabled: 1, sub_id: 'user-eight-public' });
  const database = {
    transactionDb,
    pool: {
      async connect() {
        await database.beforeProtectedConnect?.();
        return transactionDb.pool.connect();
      }
    },
    get nodeConfigs() { return transactionDb.state.configs; },
    prepare(sql) {
      return {
        async get(...params) {
          const nodeConfigs = transactionDb.state.configs;
          if (sql.includes('FROM user_node_configs')) {
            const [userId, serverId, inboundId] = params;
            return nodeConfigs.find((item) =>
              item.user_id === userId &&
              item.server_id === serverId &&
              item.inbound_id === inboundId
            );
          }
          return null;
        },
        async run(...params) {
          const nodeConfigs = transactionDb.state.configs;
          if (sql.includes('INSERT INTO user_node_configs')) {
            nodeConfigs.push({
              user_id: params[0],
              server_id: params[1],
              inbound_id: params[2],
              uuid: params[3],
              password: params[4],
              auth: params[5],
              sub_id: params[6]
            });
            calls.saves.push({ sql, params });
            return { changes: 1 };
          }
          if (sql.includes('UPDATE user_node_configs')) {
            const [uuid, password, auth, subId, userId, serverId, inboundId] = params;
            const existing = nodeConfigs.find((item) =>
              item.user_id === userId &&
              item.server_id === serverId &&
              item.inbound_id === inboundId
            );
            if (existing) {
              existing.uuid = uuid;
              existing.password = password;
              existing.auth = auth;
              existing.sub_id = subId;
            }
            calls.saves.push({ sql, params });
            return { changes: 1 };
          }
          return { changes: 1 };
        },
        async all(...params) {
          const nodeConfigs = transactionDb.state.configs;
          if (sql.includes('FROM user_node_configs')) {
            const [userId, serverId] = params;
            const snapshot = nodeConfigs
              .filter((item) => item.user_id === userId && item.server_id === serverId)
              .sort((left, right) => left.inbound_id - right.inbound_id)
              .map(item => ({ ...item }));
            await database.afterUnprotectedRead?.(snapshot);
            return snapshot;
          }
          return [];
        }
      };
    }
  };
  return database;
}

/**
 * 已有配置同步在获得保护前暂停，轮换先提交；同步继续时必须重读新值，禁止旧快照回写。
 * 修复前在锁外配置读取后暂停；修复后在连接获取前暂停，覆盖同一个竞争窗口。
 */
async function testExistingSyncDoesNotOverwriteCommittedRotation(orderService) {
  const db = createFakeDb();
  db.transactionDb.state.servers[0] = { id: 3, name: 'server-a', status: 1, panel_version: '3.4.2' };
  db.transactionDb.state.nodes = [{ server_id: 3, inbound_id: 10 }, { server_id: 3, inbound_id: 11 }];
  db.transactionDb.state.caches[0].nodes_data = '[{"server_id":3,"link":"vless://old"}]';
  for (const inboundId of [10, 11]) db.nodeConfigs.push({ user_id: 7, server_id: 3, inbound_id: inboundId,
    uuid: 'previous-uuid', password: 'previous-password', auth: 'previousauth0001', sub_id: 'aaaaaaaaaaaaaaaa' });
  let entered;
  let release;
  let paused = false;
  const enteredWindow = new Promise(resolve => { entered = resolve; });
  const resumeSync = new Promise(resolve => { release = resolve; });
  const pause = async () => {
    if (paused) return;
    paused = true;
    entered();
    await resumeSync;
  };
  db.afterUnprotectedRead = pause;
  db.beforeProtectedConnect = pause;
  calls.upserts = [];
  const ordinary = orderService.syncUserToXuiServers(db, { id: 7, email: 'u@example.com', enabled: 1, expire_at: 0, traffic_limit: 1024 }, {});
  try {
    await Promise.race([enteredWindow, ordinary.then(() => assert.fail('没有进入配置保护前的交错窗口'))]);
    await createService(generators([{ uuid: 'rotated-uuid', password: 'rotated-password', auth: 'rotatedauth00001' }]))
      .prepareRotation(db.transactionDb, 7);
    assert.deepStrictEqual(new Set(db.nodeConfigs.map(row => row.uuid)), new Set(['rotated-uuid']));
    release();
    const result = await ordinary;
    assert.strictEqual(result.success, true);
    for (const field of ['uuid', 'password', 'auth']) {
      const expected = { uuid: 'rotated-uuid', password: 'rotated-password', auth: 'rotatedauth00001' }[field];
      assert.deepStrictEqual(new Set(db.nodeConfigs.map(row => row[field])), new Set([expected]), '普通同步不得回写轮换前凭证或形成 mixed inbound');
    }
    assert.strictEqual(calls.upserts.at(-1).client.id, 'rotated-uuid');
    console.log('PASS testExistingSyncDoesNotOverwriteCommittedRotation');
  } finally {
    release();
    await ordinary;
  }
}

/**
 * 同用户无配置时首次同步先持用户行锁再持服务器锁；并发轮换等待同一用户后才进入服务器锁。
 * 在首次提交前固定暂停，直接检查它发出的锁顺序，避免靠不同用户绕过 FK 锁倒置。
 */
async function testMissingConfigSyncAndRotationUseUserThenServerLock(orderService) {
  const db = createFakeDb();
  db.transactionDb.state.servers[0] = { id: 3, name: 'server-a', status: 1, panel_version: '3.4.2' };
  db.transactionDb.state.nodes = [{ server_id: 3, inbound_id: 10 }, { server_id: 3, inbound_id: 11 }];
  db.transactionDb.state.caches[0].nodes_data = '[{"server_id":3,"link":"vless://old"}]';
  let entered;
  let release;
  const enteredCommit = new Promise(resolve => { entered = resolve; });
  const continueCommit = new Promise(resolve => { release = resolve; });
  db.transactionDb.options.beforeCommit = async state => {
    if (state.tasks.length === 0) { entered(); await continueCommit; }
  };
  const initial = orderService.syncUserToXuiServers(db, { id: 7, email: 'u@example.com', enabled: 1, expire_at: 0, traffic_limit: 1024 }, {});
  let rotation;
  try {
    await Promise.race([enteredCommit, initial.then(() => assert.fail('首次同步没有进入事务提交窗口'))]);
    const initialQueries = [...db.transactionDb.calls];
    const random = generators([{ uuid: 'same-user-new-uuid', password: 'same-user-new-password', auth: 'sameusernewauth01' }]);
    rotation = createService(random).prepareRotation(db.transactionDb, 7);
    await new Promise(resolve => setImmediate(resolve));
    const userLockIndex = initialQueries.findIndex(call => /FROM users.*FOR UPDATE/.test(call.sql) && call.params[0] === 7);
    const serverLockIndex = initialQueries.findIndex(call => call.sql.includes('pg_advisory_xact_lock'));
    assert.ok(userLockIndex >= 0 && userLockIndex < serverLockIndex, '同用户首次同步必须先 users 行锁再服务器锁，防止 FK KEY SHARE 与轮换死锁');
    assert.strictEqual(random.counts.uuid, 0);
    release();
    const [result] = await Promise.all([initial, rotation]);
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(new Set(db.nodeConfigs.map(row => row.uuid)), new Set(['same-user-new-uuid']));
    assert.strictEqual(db.transactionDb.state.tasks.length, 1);
    console.log('PASS testMissingConfigSyncAndRotationUseUserThenServerLock');
  } finally {
    release();
    await Promise.allSettled([initial, ...(rotation ? [rotation] : [])]);
  }
}

/**
 * 首次同步必须在同一服务器事务锁内检查并保存，轮换等待提交后才能挑选下一组凭证。
 * 旧实现没有事务时会直接完成同步，从而触发明确断言；测试不靠随机调度制造碰撞。
 */
async function testInitialSyncAndRotationShareServerCredentialLock(orderService) {
  const db = createFakeDb();
  db.transactionDb.state.servers[0] = { id: 3, name: 'server-a', status: 1, panel_version: '3.4.2' };
  db.transactionDb.state.nodes = [{ server_id: 3, inbound_id: 10 }, { server_id: 3, inbound_id: 11 }];
  db.transactionDb.state.caches[0].nodes_data = '[{"server_id":3,"link":"vless://old"}]';
  let entered;
  let release;
  const enteredCommit = new Promise(resolve => { entered = resolve; });
  const continueCommit = new Promise(resolve => { release = resolve; });
  db.transactionDb.options.beforeCommit = async state => {
    if (state.tasks.length === 0) { entered(); await continueCommit; }
  };
  const initial = orderService.syncUserToXuiServers(db, { id: 8, email: 'new@example.com', enabled: 1, expire_at: 0, traffic_limit: 1024 }, {});
  try {
    await Promise.race([
      enteredCommit,
      initial.then(() => { assert.fail('普通首次同步未在服务器锁事务内提交'); })
    ]);
    const first = db.transactionDb.calls.find(call => call.sql.includes('INSERT INTO user_node_configs'));
    assert.ok(first, '事务内必须先保存本地凭证');
    const random = generators([{ uuid: first.params[3], password: first.params[4], auth: first.params[5] }]);
    const rotation = createService(random).prepareRotation(db, 7);
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(db.transactionDb.calls.some(call => call.sql.includes('pg_advisory_xact_lock') && call.params[0] === 31002 && call.params[1] === 3));
    assert.strictEqual(random.counts.uuid, 0, '首次同步未提交时轮换不能检查或生成凭证');
    release();
    const [initialResult] = await Promise.all([initial, rotation]);
    assert.strictEqual(initialResult.success, true);
    assert.deepStrictEqual([random.counts.uuid, random.counts.password, random.counts.auth], [2, 2, 2]);
    for (const field of ['uuid', 'password', 'auth']) {
      const initialValue = db.nodeConfigs.find(row => row.user_id === 8)[field];
      const rotatedValue = db.nodeConfigs.find(row => row.user_id === 7)[field];
      assert.notStrictEqual(initialValue, rotatedValue);
    }
    // 已有完整配置的续费路径仍原样复用；同一服务器锁保护重读和写入，不再重新生成。
    const saved = db.nodeConfigs.filter(row => row.user_id === 8).map(row => ({ ...row }));
    db.transactionDb.calls.length = 0;
    await orderService.syncUserToXuiServers(db, { id: 8, email: 'new@example.com', enabled: 1, expire_at: 0, traffic_limit: 1024 }, {});
    assert.deepStrictEqual(db.nodeConfigs.filter(row => row.user_id === 8), saved);
    assert.ok(db.transactionDb.calls.some(call => call.sql.includes('pg_advisory_xact_lock')));
    console.log('PASS testInitialSyncAndRotationShareServerCredentialLock');
  } finally {
    release();
  }
}

/** 收编远端三字段时也必须查同服务器其他用户，任何字段冲突均重新生成整组。 */
async function testInitialAdoptionRejectsOtherUserCredentialCollision(orderService) {
  for (const [field, value] of [['uuid', 'existing-uuid'], ['password', 'existing-password'], ['auth', 'ps6ne77kxinlotaz']]) {
    const db = createFakeDb();
    db.nodeConfigs.push({ user_id: 9, server_id: 3, inbound_id: 10, [field]: value });
    calls.upserts = [];
    const result = await orderService.syncUserToXuiServers(db, { id: 7, email: 'u@example.com', enabled: 1, expire_at: 0, traffic_limit: 1024 }, {});
    assert.strictEqual(result.success, true);
    const saved = db.nodeConfigs.find(row => row.user_id === 7);
    assert.notStrictEqual(saved.uuid, 'existing-uuid', '任一字段冲突后 uuid 也必须重生');
    assert.notStrictEqual(saved.password, 'existing-password');
    assert.notStrictEqual(saved.auth, 'ps6ne77kxinlotaz');
    assert.strictEqual(saved.sub_id, '5a26dbe784ebbd6f');
  }
  console.log('PASS testInitialAdoptionRejectsOtherUserCredentialCollision');
}

/** 仅注入随机源，订单服务和共享凭证类的真实校验、碰撞重试、事务写入均不替换。 */
function loadOrderServiceWithGenerators(random) {
  const baseLoad = Module._load;
  Module._load = function patchedGeneratorLoad(request, parent, isMain) {
    const loaded = baseLoad(request, parent, isMain);
    if (request === './xui-server-credential-service') {
      return {
        ...loaded,
        XuiServerCredentialService: class extends loaded.XuiServerCredentialService {
          /** 把确定性三字段候选交给真实共享生成算法，确保碰撞行为可复现。 */
          constructor(options = {}) { super({ ...options, generators: random }); }
        }
      };
    }
    return loaded;
  };
  try {
    clearOrderServiceCache();
    return require('../services/shared/order-service');
  } finally {
    Module._load = baseLoad;
  }
}

/**
 * 历史已有配置缺密码或 auth 非法时，只修复这些字段；新值必须避开同服务器其他用户。
 * 每种缺陷独立执行，断言远端与每个 inbound 使用同一组修复值，合法字段和内部 ID 不轮换。
 */
async function testExistingIncompleteCredentialsAreRepairedWithoutRotatingValidFields() {
  const failures = [];
  for (const scenario of [
    { name: 'empty-password', password: '', auth: 'keepauthvalue000', collisionField: 'password', expectedCounts: [0, 2, 0] },
    { name: 'empty-auth', password: 'preserved-password', auth: '', collisionField: 'auth', expectedCounts: [0, 0, 2] },
    { name: 'invalid-auth', password: 'preserved-password', auth: 'invalid:AUTH', collisionField: 'auth', expectedCounts: [0, 0, 2] },
    { name: 'empty-password-and-auth', password: '', auth: '', collisionField: 'password', expectedCounts: [0, 2, 2] }
  ]) {
    try {
      const random = generators([
        { uuid: 'generated-first-uuid', password: '1111111111111111', auth: 'aaaaaaaaaaaaaaaa' },
        { uuid: 'generated-second-uuid', password: '2222222222222222', auth: 'bbbbbbbbbbbbbbbb' }
      ]);
      const orderService = loadOrderServiceWithGenerators(random);
      const db = createFakeDb();
      for (const [inboundId, subId] of [[10, 'aaaaaaaaaaaaaaaa'], [11, 'bbbbbbbbbbbbbbbb']]) {
        db.nodeConfigs.push({ user_id: 7, server_id: 3, inbound_id: inboundId, uuid: 'preserved-uuid',
          password: scenario.password, auth: scenario.auth, sub_id: subId });
      }
      db.nodeConfigs.push({ user_id: 9, server_id: 3, inbound_id: 10,
        uuid: 'another-users-uuid', password: scenario.collisionField === 'password' ? '1111111111111111' : 'another-users-password',
        auth: scenario.collisionField === 'auth' ? 'aaaaaaaaaaaaaaaa' : 'otherauthvalue00' });
      calls.upserts = [];
      const user = { id: 7, email: 'u@example.com', enabled: 1, expire_at: 0, traffic_limit: 1024 };
      const result = await orderService.syncUserToXuiServers(db, user, {});
      assert.strictEqual(result.success, true);
      const sent = calls.upserts.at(-1).client;
      assert.ok(sent.password, `${scenario.name}: 不得向远端发送空 password`);
      assert.match(sent.auth, /^[a-z0-9]{16}$/, `${scenario.name}: auth 必须修复为合法非空值`);
      assert.strictEqual(sent.id, 'preserved-uuid', '修复密码或 auth 不得轮换已有 UUID');
      assert.strictEqual(sent.password, scenario.password || '2222222222222222');
      assert.strictEqual(sent.auth, scenario.auth === 'keepauthvalue000' ? 'keepauthvalue000' : 'bbbbbbbbbbbbbbbb');
      assert.strictEqual(sent.subId, 'aaaaaaaaaaaaaaaa');
      const rows = db.nodeConfigs.filter(row => row.user_id === 7);
      for (const row of rows) {
        assert.deepStrictEqual([row.uuid, row.password, row.auth], [sent.id, sent.password, sent.auth]);
        const other = db.nodeConfigs.find(item => item.user_id === 9);
        assert.notStrictEqual(row[scenario.collisionField], other[scenario.collisionField], '新生成字段不得与同服务器其他用户冲突');
        assert.strictEqual(row.sub_id, row.inbound_id === 10 ? 'aaaaaaaaaaaaaaaa' : 'bbbbbbbbbbbbbbbb');
      }
      assert.deepStrictEqual([random.counts.uuid, random.counts.password, random.counts.auth], scenario.expectedCounts, '共享生成器只为待修复字段生成新值，碰撞时重生这些字段');
      const countsAfterRepair = { ...random.counts };
      await orderService.syncUserToXuiServers(db, user, {});
      assert.deepStrictEqual(random.counts, countsAfterRepair, '修复完成后普通同步不得再次生成凭证');
      console.log(`PASS repair-existing-${scenario.name}`);
    } catch (error) {
      console.error(`FAIL repair-existing-${scenario.name}: ${error.stack}`);
      failures.push(error);
    }
  }
  if (failures.length > 0) throw failures[0];
}

Module._load = function patchedLoad(request, parent, isMain) {
  if (request.endsWith('../../utils/logger')) {
    return {
      createLogger() {
        return {
          info(message) {
            calls.logs.push(message);
          },
          warn(message) {
            calls.logs.push(message);
          },
          error(message) {
            calls.logs.push(message);
          }
        };
      }
    };
  }

  if (request.endsWith('../../integrations/xui/xui-service')) {
    return {
      async getInstance() {
        return {
          async getServerClientByEmail(email) {
            return {
              success: true,
              client: {
                uuid: 'existing-uuid',
                password: 'existing-password',
                auth: 'ps6ne77kxinlotaz',
                subId: '5a26dbe784ebbd6f',
                email
              },
              inboundIds: [10]
            };
          },
          async upsertServerClient(payload) {
            calls.upserts.push(JSON.parse(JSON.stringify(payload)));
            return { success: true, action: 'update' };
          },
          async resetClientTraffic(_inboundId, email) {
            calls.resetTraffic.push(email);
            return { success: true };
          }
        };
      }
    };
  }

  if (request.endsWith('../../integrations/xui/xui-sync')) {
    return {
      async getServerInboundsSnapshot() {
        return {
          success: true,
          data: [
            { id: 10, remark: 'direct', protocol: 'vless', settings: '{}' },
            { id: 11, remark: 'hy2', protocol: 'hysteria2', settings: '{}' }
          ]
        };
      }
    };
  }

  if (request.endsWith('../../repositories/order-repository')) {
    return {
      async updateUserSyncStatus() {},
      async clearUserSubscriptionSourceCache(_db, payload) {
        calls.cacheClears.push(payload);
      }
    };
  }

  if (request.endsWith('../../repositories/xui-sync-repository')) {
    const actual = originalLoad(request, parent, isMain);
    return {
      ...actual,
      async listOnlineXuiServers() {
        return [{
          id: 3,
          name: 'server-a',
          api_url: 'https://xui.example.com',
          api_token: 'token',
          panel_version: '3.4.2'
        }];
      }
    };
  }

  return originalLoad(request, parent, isMain);
};

async function run() {
  clearOrderServiceCache();
  const orderService = require('../services/shared/order-service');
  const db = createFakeDb();

  const result = await orderService.syncUserToXuiServers(db, {
    id: 7,
    email: 'u@example.com',
    enabled: 1,
    expire_at: 0,
    traffic_limit: 1024
  }, {
    total_traffic_limit: 1024
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(calls.upserts.length, 1);
  assert.deepStrictEqual(calls.upserts[0].inboundIds, [10, 11]);
  assert.strictEqual(calls.upserts[0].email, 'u@example.com');
  assert.strictEqual(calls.upserts[0].client.email, 'u@example.com');
  assert.strictEqual(calls.upserts[0].client.id, 'existing-uuid');
  assert.strictEqual(calls.upserts[0].client.password, 'existing-password');
  assert.strictEqual(calls.upserts[0].client.auth, 'ps6ne77kxinlotaz');
  assert.strictEqual(calls.upserts[0].client.subId, '5a26dbe784ebbd6f');
  assert.strictEqual(calls.upserts[0].client.flow, 'xtls-rprx-vision');
  assert.ok(calls.logs.includes('构建客户端配置: protocol=vless, strategy=direct, email=u@example.com, hasAuth=true, hasId=true'));
  assert.ok(calls.logs.includes('构建客户端配置: protocol=hysteria2, strategy=hy2, email=u@example.com, hasAuth=true, hasId=true'));
  assert.strictEqual(db.nodeConfigs.length, 2);
  assert.deepStrictEqual(new Set(db.nodeConfigs.map((item) => item.uuid)), new Set(['existing-uuid']));
  assert.deepStrictEqual(new Set(db.nodeConfigs.map((item) => item.password)), new Set(['existing-password']));
  assert.deepStrictEqual(new Set(db.nodeConfigs.map((item) => item.auth)), new Set(['ps6ne77kxinlotaz']));
  await testInitialAdoptionRejectsOtherUserCredentialCollision(orderService);

  // 已建立本地凭证后，即使远端凭证不同，订单同步也必须以本地为主。
  calls.upserts = [];
  const localPrimaryDb = createFakeDb();
  localPrimaryDb.nodeConfigs.push({
    user_id: 7,
    server_id: 3,
    inbound_id: 10,
    uuid: 'local-uuid',
    password: 'local-password',
    auth: 'localauthvalue01',
    sub_id: '0123456789abcdef'
  });

  const localPrimaryResult = await orderService.syncUserToXuiServers(localPrimaryDb, {
    id: 7,
    email: 'u@example.com',
    enabled: 1,
    expire_at: 0,
    traffic_limit: 1024
  }, {
    total_traffic_limit: 1024
  });

  assert.strictEqual(localPrimaryResult.success, true);
  assert.strictEqual(calls.upserts.length, 1);
  assert.deepStrictEqual(
    {
      id: calls.upserts[0].client.id,
      password: calls.upserts[0].client.password,
      auth: calls.upserts[0].client.auth,
      subId: calls.upserts[0].client.subId
    },
    {
      id: 'local-uuid',
      password: 'local-password',
      auth: 'localauthvalue01',
      subId: '0123456789abcdef'
    }
  );

  calls.upserts = [];
  db.nodeConfigs.length = 0;
  let upsertAttempts = 0;
  const basePatchedLoad = Module._load;
  Module._load = function patchedConflictLoad(request, parent, isMain) {
    if (request.endsWith('../../integrations/xui/xui-service')) {
      return {
        async getInstance() {
          return {
            async getServerClientByEmail(email) {
              return {
                success: true,
                client: {
                  uuid: 'existing-uuid',
                  password: 'existing-password',
                  auth: 'ps6ne77kxinlotaz',
                  subId: '5a26dbe784ebbd6f\r',
                  email
                },
                inboundIds: []
              };
            },
            async upsertServerClient(payload) {
              calls.upserts.push(JSON.parse(JSON.stringify(payload)));
              upsertAttempts++;
              if (upsertAttempts === 1) {
                return {
                  success: false,
                  message: 'Something went wrong (subId already in use: 5a26dbe784ebbd6f\r)'
                };
              }
              return { success: true, action: 'add' };
            },
            async resetClientTraffic() {
              return { success: true };
            }
          };
        }
      };
    }

    return basePatchedLoad(request, parent, isMain);
  };

  clearOrderServiceCache();
  const retryOrderService = require('../services/shared/order-service');
  const retryResult = await retryOrderService.syncUserToXuiServers(db, {
    id: 7,
    email: 'u@example.com',
    enabled: 1,
    expire_at: 0,
    traffic_limit: 1024
  }, {
    total_traffic_limit: 1024
  });

  assert.strictEqual(retryResult.success, true);
  assert.strictEqual(calls.upserts.length, 2);
  assert.strictEqual(calls.upserts[0].client.subId, '5a26dbe784ebbd6f');
  assert.notStrictEqual(calls.upserts[1].client.subId, calls.upserts[0].client.subId);
  assert.ok(/^[0-9a-f]{16}$/.test(calls.upserts[1].client.subId));
  assert.deepStrictEqual(
    new Set(db.nodeConfigs.map((item) => item.sub_id)),
    new Set([calls.upserts[1].client.subId])
  );

  calls.upserts = [];
  const generatedDb = createFakeDb();
  Module._load = function patchedGeneratedLoad(request, parent, isMain) {
    if (request.endsWith('../../integrations/xui/xui-service')) {
      return {
        async getInstance() {
          return {
            async getServerClientByEmail() {
              return { success: false, message: 'not found' };
            },
            async upsertServerClient(payload) {
              calls.upserts.push(JSON.parse(JSON.stringify(payload)));
              return { success: true, action: 'add' };
            },
            async resetClientTraffic() {
              return { success: true };
            }
          };
        }
      };
    }

    return basePatchedLoad(request, parent, isMain);
  };

  clearOrderServiceCache();
  const generatedOrderService = require('../services/shared/order-service');
  const generatedResult = await generatedOrderService.syncUserToXuiServers(generatedDb, {
    id: 8,
    email: 'new@example.com',
    enabled: 1,
    expire_at: 0,
    traffic_limit: 1024
  }, {
    total_traffic_limit: 1024
  });

  assert.strictEqual(generatedResult.success, true);
  assert.strictEqual(calls.upserts.length, 1);
  assert.ok(/^[a-z0-9]{16}$/.test(calls.upserts[0].client.auth));
  assert.strictEqual(calls.upserts[0].client.flow, 'xtls-rprx-vision');
  const failures = [];
  for (const test of [testExistingIncompleteCredentialsAreRepairedWithoutRotatingValidFields,
    testExistingSyncDoesNotOverwriteCommittedRotation, testMissingConfigSyncAndRotationUseUserThenServerLock,
    testInitialSyncAndRotationShareServerCredentialLock]) {
    try { await test(generatedOrderService); }
    catch (error) { console.error(`FAIL ${test.name}: ${error.stack}`); failures.push(error); }
  }
  if (failures.length > 0) throw failures[0];
}

run()
  .then(() => {
    console.log('test-xui-server-client-order-sync: PASS');
  })
  .catch((error) => {
    console.error('test-xui-server-client-order-sync: FAIL');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    Module._load = originalLoad;
  });
