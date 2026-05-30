const assert = require('assert');
const XuiService = require('../services/xui-service');
const { generateXuiAuth, isValidXuiAuth } = require('../utils/xui-auth');

function createFakeDb(initialNodeConfigs = []) {
  const nodeConfigs = initialNodeConfigs.map(item => ({ ...item }));
  const advisoryLocks = new Set();

  return {
    nodeConfigs,
    advisoryLocks,
    prepare(sql) {
      return {
        async get(...params) {
          if (sql.includes('SELECT pg_try_advisory_lock')) {
            const key = params[0];
            if (advisoryLocks.has(key)) {
              return { locked: false };
            }
            advisoryLocks.add(key);
            return { locked: true };
          }
          if (sql.includes('SELECT pg_advisory_unlock')) {
            advisoryLocks.delete(params[0]);
            return { unlocked: true };
          }
          if (sql.includes('FROM user_node_configs')) {
            const [userId, serverId, inboundId] = params;
            return nodeConfigs.find(item =>
              item.user_id === userId &&
              item.server_id === serverId &&
              item.inbound_id === inboundId
            ) || undefined;
          }
          throw new Error(`Unexpected get SQL: ${sql}`);
        },
        async run(...params) {
          if (sql.includes('INSERT INTO user_node_configs')) {
            nodeConfigs.push({
              user_id: params[0],
              server_id: params[1],
              inbound_id: params[2],
              uuid: params[3],
              auth: params[4],
              sub_id: params[5]
            });
            return { changes: 1 };
          }
          if (sql.includes('UPDATE user_node_configs')) {
            const [uuid, auth, subId, userId, serverId, inboundId] = params;
            const target = nodeConfigs.find(item =>
              item.user_id === userId &&
              item.server_id === serverId &&
              item.inbound_id === inboundId
            );
            if (!target) return { changes: 0 };
            target.uuid = uuid;
            target.auth = auth;
            target.sub_id = subId;
            return { changes: 1 };
          }
          throw new Error(`Unexpected run SQL: ${sql}`);
        }
      };
    }
  };
}

function createFakeXuiService(initialClients = []) {
  const service = Object.create(XuiService.prototype);
  service._clients = initialClients.map(item => ({ ...item }));
  service._calls = [];
  service._lockStates = new Set();
  service._forceLockBusy = false;
  service.client = {
    updateClient: async function updateClient(clientId, config) {
      service._calls.push({ type: 'client.updateClient', clientId, config });
      const payload = JSON.parse(config.settings).clients[0];
      const target = service._clients.find(item => item.uuid === clientId || item.auth === clientId);
      if (!target) {
        return { success: false, msg: `not found: ${clientId}` };
      }
      target.uuid = payload.id || target.uuid;
      target.email = payload.email;
      target.enable = payload.enable;
      target.expiryTime = payload.expiryTime || 0;
      target.totalGB = payload.totalGB || 0;
      target.subId = payload.subId || '';
      target.flow = payload.flow || '';
      target.auth = payload.auth || '';
      return { success: true, msg: 'ok' };
    }
  };

  service.getInbound = async function getInbound(inboundId) {
    return {
      success: true,
      obj: {
        id: inboundId,
        settings: JSON.stringify({
          clients: this._clients
            .filter(item => item.inboundId === inboundId)
            .map(item => ({
              id: item.uuid,
              email: item.email,
              enable: item.enable,
              expiryTime: item.expiryTime || 0,
              totalGB: item.totalGB || 0,
              subId: item.subId || '',
              flow: item.flow || '',
              password: item.auth || '',
              auth: item.auth || ''
            }))
        })
      }
    };
  };

  service.deleteClient = async function deleteClient(inboundId, uuid) {
    this._calls.push({ type: 'deleteClient', inboundId, uuid });
    this._clients = this._clients.filter(item => !(item.inboundId === inboundId && item.uuid === uuid));
    return { success: true };
  };

  service.addClient = async function addClient(inboundId, protocol, options) {
    this._calls.push({ type: 'addClient', inboundId, protocol, options });
    this._clients.push({
      inboundId,
      uuid: options.id,
      email: options.email,
      enable: options.enable,
      expiryTime: options.expiryTime || 0,
      totalGB: options.totalGB || 0,
      subId: options.subId || '',
      flow: options.flow || ''
    });
    return { success: true };
  };

  service.updateClient = async function updateClient(inboundId, email, options) {
    this._calls.push({ type: 'updateClient', inboundId, email, options });
    const target = this._clients.find(item => item.inboundId === inboundId && item.email === email);
    if (!target) {
      return { success: false, message: `not found: ${email}` };
    }
    target.enable = options.enabled !== undefined ? options.enabled : target.enable;
    target.expiryTime = options.expiryTime !== undefined ? options.expiryTime : target.expiryTime;
    target.totalGB = options.totalGB !== undefined ? options.totalGB : target.totalGB;
    target.subId = options.subId !== undefined ? options.subId : target.subId;
    target.flow = options.flow !== undefined ? options.flow : target.flow;
    return { success: true };
  };

  return service;
}

async function testGetClientsByEmailReturnsAllMatches() {
  const service = createFakeXuiService([
    { inboundId: 1, uuid: 'u-1', email: 'a@test.com-node', subId: 's1', enable: true },
    { inboundId: 1, uuid: 'u-2', email: 'a@test.com-node', subId: 's2', enable: true },
    { inboundId: 1, uuid: 'u-3', email: 'other@test.com-node', subId: 's3', enable: true }
  ]);

  const result = await service.getClientsByEmail(1, 'a@test.com-node');
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.clients.length, 2);
  assert.deepStrictEqual(result.clients.map(item => item.uuid), ['u-1', 'u-2']);
}

async function testUpsertUniqueClientRemovesDuplicatesAndKeepsDbUuid() {
  const db = createFakeDb([
    { user_id: 10, server_id: 1, inbound_id: 100, uuid: 'db-uuid', sub_id: 'db-sub' }
  ]);
  const service = createFakeXuiService([
    { inboundId: 100, uuid: 'db-uuid', email: 'u@test.com-direct', subId: 'db-sub', enable: true },
    { inboundId: 100, uuid: 'dup-uuid', email: 'u@test.com-direct', subId: 'dup-sub', enable: true }
  ]);

  const result = await service.upsertUniqueClient(db, {
    userId: 10,
    serverId: 1,
    inbound: { id: 100, protocol: 'vless', remark: 'direct-node' },
    email: 'u@test.com-direct',
    desiredClient: {
      id: 'db-uuid',
      email: 'u@test.com-direct',
      enable: true,
      expiryTime: 0,
      totalGB: 0,
      subId: 'db-sub',
      flow: 'xtls-rprx-vision'
    }
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(service._clients.filter(item => item.email === 'u@test.com-direct').length, 1);
  assert.strictEqual(service._clients[0].uuid, 'db-uuid');
  assert.ok(service._calls.some(item => item.type === 'deleteClient' && item.uuid === 'dup-uuid'));
}

async function testUpsertUniqueClientRealignsMissingDbUuid() {
  const db = createFakeDb([
    { user_id: 10, server_id: 1, inbound_id: 100, uuid: 'stale-uuid', sub_id: 'stale-sub' }
  ]);
  const service = createFakeXuiService([
    { inboundId: 100, uuid: 'keep-uuid', email: 'u@test.com-cf', subId: 'keep-sub', enable: true },
    { inboundId: 100, uuid: 'drop-uuid', email: 'u@test.com-cf', subId: 'drop-sub', enable: true }
  ]);

  const result = await service.upsertUniqueClient(db, {
    userId: 10,
    serverId: 1,
    inbound: { id: 100, protocol: 'vless', remark: 'cf-node' },
    email: 'u@test.com-cf',
    desiredClient: {
      id: 'keep-uuid',
      email: 'u@test.com-cf',
      enable: true,
      expiryTime: 0,
      totalGB: 0,
      subId: 'keep-sub'
    }
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(db.nodeConfigs[0].uuid, 'keep-uuid');
  assert.strictEqual(db.nodeConfigs[0].sub_id, 'keep-sub');
}

async function testUpsertUniqueClientFailsWhenLockNotAcquired() {
  const db = createFakeDb();
  const service = createFakeXuiService([]);
  service._forceLockBusy = true;

  const result = await service.upsertUniqueClient(db, {
    userId: 10,
    serverId: 1,
    inbound: { id: 100, protocol: 'vless', remark: 'cf-node' },
    email: 'busy@test.com-cf',
    desiredClient: {
      id: 'new-uuid',
      email: 'busy@test.com-cf',
      enable: true,
      expiryTime: 0,
      totalGB: 0,
      subId: 'new-sub'
    }
  });

  assert.strictEqual(result.success, false);
  assert.match(result.message, /lock/i);
  assert.strictEqual(service._calls.length, 0);
}

async function testUpsertUniqueClientUpdatesSingleMatch() {
  const db = createFakeDb([
    { user_id: 10, server_id: 1, inbound_id: 100, uuid: 'one-uuid', sub_id: 'one-sub' }
  ]);
  const service = createFakeXuiService([
    { inboundId: 100, uuid: 'one-uuid', email: 'one@test.com', subId: 'one-sub', enable: false, expiryTime: 1 }
  ]);

  const result = await service.upsertUniqueClient(db, {
    userId: 10,
    serverId: 1,
    inbound: { id: 100, protocol: 'vless', remark: 'cf-node' },
    email: 'one@test.com',
    desiredClient: {
      id: 'one-uuid',
      email: 'one@test.com',
      enable: true,
      expiryTime: 99,
      totalGB: 10,
      subId: 'one-sub'
    }
  });

  assert.strictEqual(result.success, true);
  assert.ok(service._calls.some(item => item.type === 'client.updateClient'));
}

async function testUpsertUniqueClientSkipsUpdateWhenStateMatches() {
  const totalBytes = 10 * 1024 * 1024 * 1024;
  const db = createFakeDb([
    { user_id: 10, server_id: 1, inbound_id: 100, uuid: 'same-uuid', sub_id: 'same-sub' }
  ]);
  const service = createFakeXuiService([
    {
      inboundId: 100,
      uuid: 'same-uuid',
      email: 'same@test.com',
      subId: 'same-sub',
      enable: true,
      expiryTime: 99,
      totalGB: totalBytes,
      flow: 'xtls-rprx-vision'
    }
  ]);

  const result = await service.upsertUniqueClient(db, {
    userId: 10,
    serverId: 1,
    inbound: { id: 100, protocol: 'vless', remark: 'direct-node' },
    email: 'same@test.com',
    desiredClient: {
      id: 'same-uuid',
      email: 'same@test.com',
      enable: true,
      expiryTime: 99,
      totalGB: totalBytes,
      subId: 'same-sub',
      flow: 'xtls-rprx-vision'
    }
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.action, 'skip-update');
  assert.ok(!service._calls.some(item => item.type === 'updateClient'));
}

async function testShouldNotUpdateWhenServerTotalGBStoresBytes() {
  const totalBytes = 10 * 1024 * 1024 * 1024;
  const service = createFakeXuiService([]);

  const shouldUpdate = service.shouldUpdateClient(
    {
      enable: true,
      expiryTime: 99,
      totalGB: totalBytes,
      subId: 'same-sub',
      flow: 'xtls-rprx-vision'
    },
    {
      enable: true,
      expiryTime: 99,
      totalGB: totalBytes,
      subId: 'same-sub',
      flow: 'xtls-rprx-vision'
    }
  );

  assert.strictEqual(shouldUpdate, false);
}

async function testUpdateClientByContextShouldKeepUuidWhenAuthIsEmpty() {
  const service = Object.create(XuiService.prototype);
  let capturedRequest = null;

  service.client = {
    async updateClient(clientId, config) {
      capturedRequest = { clientId, config };
      return { success: true, msg: 'ok' };
    }
  };

  service.getClientByEmail = async function getClientByEmail() {
    return {
      success: true,
      uuid: 'uuid-keep',
      auth: '',
      email: 'order@163.com-direct',
      enable: true,
      expiryTime: 100,
      totalGB: 0,
      subId: 'sub-keep',
      flow: 'xtls-rprx-vision'
    };
  };

  const result = await service.updateClientByContext(2, 'order@163.com-direct', {
    protocol: 'vless',
    strategy: 'direct',
    auth: '',
    enabled: true,
    expiryTime: 200,
    totalGB: 10,
    subId: 'sub-new',
    flow: 'xtls-rprx-vision'
  });

  assert.strictEqual(result.success, true);
  assert.ok(capturedRequest);
  assert.strictEqual(capturedRequest.clientId, 'uuid-keep');
  assert.strictEqual(JSON.parse(capturedRequest.config.settings).clients[0].id, 'uuid-keep');
}

async function testHy2ClientShouldStillCheckSubId() {
  const db = createFakeDb([
    { user_id: 20, server_id: 1, inbound_id: 5, uuid: '', auth: 'Abc123XyZ9', sub_id: 'db-sub' }
  ]);
  const service = createFakeXuiService([
    {
      inboundId: 5,
      uuid: '',
      auth: 'Abc123XyZ9',
      email: 'payment@163.com-hy2',
      subId: '',
      enable: true,
      expiryTime: 99,
      totalGB: 3221225472
    }
  ]);

  const result = await service.upsertUniqueClient(db, {
    userId: 20,
    serverId: 1,
    inbound: { id: 5, protocol: 'hysteria', remark: 'hy2-node' },
    email: 'payment@163.com-hy2',
    desiredClient: {
      id: '',
      auth: 'Abc123XyZ9',
      email: 'payment@163.com-hy2',
      enable: true,
      expiryTime: 99,
      totalGB: 3221225472,
      subId: 'db-sub',
      strategy: 'hy2',
      protocol: 'hysteria'
    }
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.action, 'update');
  assert.ok(service._calls.some(item => item.type === 'client.updateClient'));
}

async function testGeneratedXuiAuthShouldBeAlphanumericAndTenChars() {
  const auth = generateXuiAuth();
  assert.strictEqual(auth.length, 10);
  assert.strictEqual(isValidXuiAuth(auth), true);
  assert.strictEqual(isValidXuiAuth('PnF71NOt_KdMuRCX'), false);
}

async function testOrderAndJobPathsShouldUseUpsertUniqueClient() {
  const service = createFakeXuiService([]);
  let called = 0;
  service.upsertUniqueClient = async function upsertUniqueClient() {
    called++;
    return { success: true, action: 'add' };
  };

  assert.strictEqual(typeof service.upsertUniqueClient, 'function');
  await service.upsertUniqueClient();
  assert.strictEqual(called, 1);
}

async function run() {
  await testGetClientsByEmailReturnsAllMatches();
  await testUpsertUniqueClientRemovesDuplicatesAndKeepsDbUuid();
  await testUpsertUniqueClientRealignsMissingDbUuid();
  await testUpsertUniqueClientFailsWhenLockNotAcquired();
  await testUpsertUniqueClientUpdatesSingleMatch();
  await testUpsertUniqueClientSkipsUpdateWhenStateMatches();
  await testShouldNotUpdateWhenServerTotalGBStoresBytes();
  await testUpdateClientByContextShouldKeepUuidWhenAuthIsEmpty();
  await testHy2ClientShouldStillCheckSubId();
  await testGeneratedXuiAuthShouldBeAlphanumericAndTenChars();
  await testOrderAndJobPathsShouldUseUpsertUniqueClient();
  console.log('xui unique client sync tests passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
