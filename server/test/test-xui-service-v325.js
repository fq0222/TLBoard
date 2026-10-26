/**
 * 测试 3X-UI 3.2.5 版本下的 XuiService 兼容逻辑。
 */

const assert = require('assert');
const XuiService = require('../integrations/xui/xui-service');
const XuiApiClientV325 = require('../integrations/xui/xui-api-client-v325');
const xuiSyncRepository = require('../repositories/xui-sync-repository');

function createServiceWithClient(client) {
  const service = new XuiService('https://xui.example.com', 'secret-token', {
    apiVersion: '3.2.5'
  });
  service.client = client;
  return service;
}

/**
 * 创建支持双键 PostgreSQL advisory lock 语义的数据库桩。
 * 同一锁键的后续连接会等待持有者解锁，用于复现跨请求并发创建。
 * @returns {Object} 仅实现 pool.connect() 的数据库桩。
 */
function createAdvisoryLockDb() {
  const locks = new Map();

  return {
    pool: {
      async connect() {
        let heldKey = '';
        let releaseHeldLock = null;
        return {
          async query(sql, params = []) {
            if (sql.includes('pg_advisory_lock')) {
              heldKey = params.join(':');
              const previous = locks.get(heldKey) || Promise.resolve();
              let resolveCurrent;
              const current = new Promise(resolve => { resolveCurrent = resolve; });
              locks.set(heldKey, previous.then(() => current));
              await previous;
              releaseHeldLock = resolveCurrent;
              return { rows: [{ pg_advisory_lock: null }] };
            }
            if (sql.includes('pg_advisory_unlock')) {
              releaseHeldLock?.();
              if (locks.get(heldKey)) {
                locks.get(heldKey).then(() => locks.delete(heldKey));
              }
              return { rows: [{ unlocked: true }] };
            }
            throw new Error(`unexpected SQL: ${sql}`);
          },
          release() {}
        };
      }
    }
  };
}

async function testResetClientTrafficUsesV325Route() {
  const client = new XuiApiClientV325('https://xui.example.com', 'secret-token');
  const requests = [];
  client.request = async (method, path) => {
    requests.push({ method, path });
    return { success: true, msg: 'reset' };
  };

  const result = await client.resetClientTraffic('foo+bar@example.com');

  assert.deepStrictEqual(result, { success: true, msg: 'reset' });
  assert.deepStrictEqual(requests, [
    {
      method: 'post',
      path: '/panel/api/clients/resetTraffic/foo%2Bbar%40example.com'
    }
  ]);
}

async function testUpsertServerClientAddsFullClientAndInboundIds() {
  const calls = [];
  const service = createServiceWithClient({
    version: '3.2.5',
    supportsClientApi: true,
    async getClientByEmail(email) {
      calls.push(['getClientByEmail', email]);
      return { success: false, msg: '  request failed: (record not found)  ' };
    },
    async addClient(payload) {
      calls.push(['addClient', payload]);
      return { success: true, msg: 'created' };
    }
  });

  const result = await service.upsertServerClient({
    email: 'full@example.com',
    inboundIds: [10, 11],
    client: {
      id: 'uuid-full',
      password: 'password-full',
      auth: 'auth-full',
      email: 'full@example.com',
      enable: true,
      expiryTime: 0,
      totalGB: 1024,
      limitIp: 0,
      tgId: 0,
      subId: 'sub-full',
      flow: 'xtls-rprx-vision'
    }
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.action, 'add');
  assert.deepStrictEqual(calls[1], ['addClient', {
    client: {
      id: 'uuid-full',
      password: 'password-full',
      auth: 'auth-full',
      email: 'full@example.com',
      enable: true,
      expiryTime: 0,
      totalGB: 1024,
      limitIp: 0,
      tgId: 0,
      subId: 'sub-full',
      flow: 'xtls-rprx-vision'
    },
    inboundIds: [10, 11]
  }]);
}

/**
 * 验证同一服务器、同一邮箱的并发 upsert 会串行化，并在获得锁后重新查询。
 */
async function testConcurrentServerClientUpsertsAddOnlyOnce() {
  let exists = false;
  let addCalls = 0;
  const service = createServiceWithClient({
    supportsClientApi: true,
    async getClientByEmail() {
      if (!exists) return { success: false, msg: '(record not found)' };
      return {
        success: true,
        obj: {
          client: { id: 'uuid-race', email: 'race@example.com' },
          inboundIds: [10]
        }
      };
    },
    async addClient() {
      addCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 20));
      exists = true;
      return { success: true, msg: 'created' };
    }
  });
  const db = createAdvisoryLockDb();
  const payload = {
    db,
    serverId: 17,
    email: 'race@example.com',
    inboundIds: [10],
    client: { id: 'uuid-race', email: 'race@example.com' }
  };

  const results = await Promise.all([
    service.upsertServerClient(payload),
    service.upsertServerClient(payload)
  ]);

  assert.strictEqual(results.every(result => result.success), true);
  assert.strictEqual(addCalls, 1);
}

/**
 * 验证 advisory unlock 抛错时仍会归还专用数据库连接，避免连接池泄漏。
 */
async function testServerClientLockReleasesConnectionWhenUnlockFails() {
  let released = false;
  const db = {
    pool: {
      async connect() {
        return {
          async query(sql) {
            if (sql.includes('pg_advisory_unlock')) {
              throw new Error('connection lost while unlocking');
            }
            return { rows: [] };
          },
          release() {
            released = true;
          }
        };
      }
    }
  };

  await assert.rejects(
    xuiSyncRepository.withServerClientLock(db, 17, 'unlock@example.com', async () => 'ok'),
    /connection lost while unlocking/
  );
  assert.strictEqual(released, true);
}

/**
 * 验证服务器级客户端查询只有明确的 record not found 才归类为不存在。
 */
async function testGetServerClientByEmailReturnsThreeStates() {
  const foundService = createServiceWithClient({
    supportsClientApi: true,
    async getClientByEmail() {
      return { success: true, obj: { client: { id: 'uuid-found', email: 'found@example.com' }, inboundIds: [1] } };
    }
  });
  const missingService = createServiceWithClient({
    supportsClientApi: true,
    async getClientByEmail() {
      return { success: false, msg: '  (record not found)  ' };
    }
  });
  const unknownFailureService = createServiceWithClient({
    supportsClientApi: true,
    async getClientByEmail() {
      return { success: false, msg: 'permission denied' };
    }
  });
  const timeoutService = createServiceWithClient({
    supportsClientApi: true,
    async getClientByEmail() {
      const error = new Error('request timed out');
      error.code = 'ETIMEDOUT';
      throw error;
    }
  });

  const found = await foundService.getServerClientByEmail('found@example.com');
  const missing = await missingService.getServerClientByEmail('missing@example.com');
  const unknownFailure = await unknownFailureService.getServerClientByEmail('unknown@example.com');
  const timeout = await timeoutService.getServerClientByEmail('timeout@example.com');

  assert.strictEqual(found.status, 'found');
  assert.strictEqual(found.success, true);
  assert.strictEqual(missing.status, 'not_found');
  assert.strictEqual(missing.success, false);
  assert.strictEqual(unknownFailure.status, 'error');
  assert.strictEqual(unknownFailure.retryable, true);
  assert.strictEqual(timeout.status, 'error');
  assert.strictEqual(timeout.retryable, true);
}

/**
 * 验证查询超时或未知失败时 upsert 不会误调用 addClient。
 */
async function testUpsertServerClientDoesNotAddWhenLookupErrors() {
  for (const failure of [
    { success: false, msg: 'upstream internal error' },
    new Error('socket timeout')
  ]) {
    let addCalls = 0;
    const service = createServiceWithClient({
      supportsClientApi: true,
      async getClientByEmail() {
        if (failure instanceof Error) throw failure;
        return failure;
      },
      async addClient() {
        addCalls++;
        return { success: true };
      }
    });

    const result = await service.upsertServerClient({
      email: 'unsafe@example.com',
      inboundIds: [10],
      client: { id: 'uuid-unsafe', email: 'unsafe@example.com' }
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.retryable, true);
    assert.strictEqual(addCalls, 0);
  }
}

/**
 * 验证 add 响应因网络异常丢失时会只读核验，避免把已成功写入误报为失败。
 */
async function testUpsertServerClientVerifiesUnknownAddResult() {
  let lookupCalls = 0;
  let addCalls = 0;
  const service = createServiceWithClient({
    supportsClientApi: true,
    async getClientByEmail() {
      lookupCalls++;
      if (lookupCalls === 1) {
        return { success: false, msg: '(record not found)' };
      }
      return {
        success: true,
        obj: {
          client: { id: 'uuid-verified', email: 'verified@example.com' },
          inboundIds: [10]
        }
      };
    },
    async addClient() {
      addCalls++;
      throw new Error('socket disconnected after write');
    }
  });

  const result = await service.upsertServerClient({
    email: 'verified@example.com',
    inboundIds: [10],
    client: { id: 'uuid-verified', email: 'verified@example.com' }
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.action, 'add');
  assert.strictEqual(addCalls, 1);
  assert.strictEqual(lookupCalls, 2);
}

/** 验证 update 抛异常后，仅在只读状态完整符合期望时确认成功。 */
async function testUpsertServerClientVerifiesUnknownUpdateResult() {
  const desired = {
    id: 'uuid-update', password: 'new-password', auth: 'new-auth', email: 'update@example.com',
    enable: true, expiryTime: 0, totalGB: 1024, subId: 'new-sub'
  };

  for (const verificationMatches of [true, false]) {
    let lookupCalls = 0;
    const service = createServiceWithClient({
      supportsClientApi: true,
      async getClientByEmail() {
        lookupCalls += 1;
        const client = lookupCalls === 1
          ? { ...desired, password: 'old-password' }
          : { ...desired, password: verificationMatches ? desired.password : 'still-old' };
        return { success: true, obj: { client, inboundIds: [10] } };
      },
      async updateClient() { throw new Error('update response lost'); }
    });

    const result = await service.upsertServerClient({ email: desired.email, inboundIds: [10], client: desired });
    assert.strictEqual(result.success, verificationMatches);
    assert.strictEqual(Boolean(result.retryable), !verificationMatches);
    assert.strictEqual(lookupCalls, 2);
  }
}

/** 验证 attach 抛异常后，仅在关联集合与身份均完整符合期望时确认成功。 */
async function testUpsertServerClientVerifiesUnknownAttachResult() {
  const desired = {
    id: 'uuid-attach', password: 'password', auth: 'auth', email: 'attach@example.com',
    enable: true, expiryTime: 0, totalGB: 1024, subId: 'sub'
  };

  for (const verificationMatches of [true, false]) {
    let lookupCalls = 0;
    const service = createServiceWithClient({
      supportsClientApi: true,
      async getClientByEmail() {
        lookupCalls += 1;
        return {
          success: true,
          obj: { client: desired, inboundIds: lookupCalls === 1 ? [10] : (verificationMatches ? [10, 11] : [10]) }
        };
      },
      async attachClient() { throw new Error('attach response lost'); }
    });

    const result = await service.upsertServerClient({ email: desired.email, inboundIds: [10, 11], client: desired });
    assert.strictEqual(result.success, verificationMatches);
    assert.strictEqual(Boolean(result.retryable), !verificationMatches);
    assert.strictEqual(lookupCalls, 2);
  }
}

/**
 * 验证强制修复只绕过字段差异判断，不绕过服务器级客户端查询。
 * 普通一致调用不得产生写入，巡检显式强制时必须重写完整客户端。
 */
async function testUpsertServerClientForceUpdateRepairsMatchingClient() {
  const desired = {
    id: 'uuid-repair',
    password: 'password-repair',
    auth: 'auth-repair',
    email: 'repair@example.com',
    enable: true,
    expiryTime: 0,
    totalGB: 1024,
    limitIp: 0,
    tgId: 0,
    subId: 'sub-repair',
    flow: 'xtls-rprx-vision'
  };
  let lookupCalls = 0;
  let updateCalls = 0;
  const service = createServiceWithClient({
    supportsClientApi: true,
    async getClientByEmail(email) {
      lookupCalls += 1;
      assert.strictEqual(email, desired.email);
      return { success: true, obj: { client: { ...desired }, inboundIds: [10] } };
    },
    async updateClient(email, client) {
      updateCalls += 1;
      assert.strictEqual(email, desired.email);
      assert.deepStrictEqual(client, desired);
      return { success: true, msg: 'repaired' };
    }
  });

  const normalResult = await service.upsertServerClient({
    email: desired.email,
    inboundIds: [10],
    client: desired
  });
  assert.strictEqual(normalResult.success, true);
  assert.strictEqual(normalResult.action, 'noop');
  assert.strictEqual(updateCalls, 0);

  const repairResult = await service.upsertServerClient({
    email: desired.email,
    inboundIds: [10],
    client: desired,
    forceUpdate: true
  });
  assert.strictEqual(repairResult.success, true);
  assert.strictEqual(repairResult.action, 'repair');
  assert.strictEqual(updateCalls, 1);
  assert.strictEqual(lookupCalls, 2);
}

/**
 * 验证仅为修复 inbound 投影而强制写入时，既有 canonical 状态不能用于确认未知写结果。
 * 否则 update 在真正写入前断网，也会被原本一致的 clients API 结果误报为修复成功。
 */
async function testForceUpdateDoesNotVerifyUnknownWriteFromPreexistingState() {
  const desired = {
    id: 'uuid-uncertain-repair',
    password: 'password-uncertain-repair',
    auth: 'auth-uncertain-repair',
    email: 'uncertain-repair@example.com',
    enable: true,
    expiryTime: 0,
    totalGB: 1024,
    subId: 'sub-uncertain-repair'
  };
  let lookupCalls = 0;
  const service = createServiceWithClient({
    supportsClientApi: true,
    async getClientByEmail() {
      lookupCalls += 1;
      return { success: true, obj: { client: { ...desired }, inboundIds: [10] } };
    },
    async updateClient() {
      throw new Error('connection closed before repair response');
    }
  });

  const result = await service.upsertServerClient({
    email: desired.email,
    inboundIds: [10],
    client: desired,
    forceUpdate: true
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.retryable, true);
  assert.strictEqual(lookupCalls, 1);
}

async function testUpsertServerClientUpdatesAndAttachesMissingInbounds() {
  const calls = [];
  const service = createServiceWithClient({
    version: '3.2.5',
    supportsClientApi: true,
    async getClientByEmail(email) {
      calls.push(['getClientByEmail', email]);
      return {
        success: true,
        obj: {
          client: {
            id: 'uuid-full',
            password: 'old-password',
            auth: 'old-auth',
            email: 'full@example.com',
            enable: false,
            expiryTime: 1,
            totalGB: 1,
            subId: 'old-sub'
          },
          inboundIds: [10]
        }
      };
    },
    async updateClient(_clientId, payload) {
      calls.push(['updateClient', payload]);
      return { success: true, msg: 'updated' };
    },
    async attachClient(email, inboundIds) {
      calls.push(['attachClient', email, inboundIds]);
      return { success: true, msg: 'attached' };
    }
  });

  const result = await service.upsertServerClient({
    email: 'full@example.com',
    inboundIds: [10, 11],
    client: {
      id: 'uuid-full',
      password: 'password-full',
      auth: 'auth-full',
      email: 'full@example.com',
      enable: true,
      expiryTime: 0,
      totalGB: 1024,
      limitIp: 0,
      tgId: 0,
      subId: 'sub-full',
      flow: 'xtls-rprx-vision'
    }
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.action, 'update');
  assert.deepStrictEqual(calls[1], ['updateClient', {
    id: 'uuid-full',
    password: 'password-full',
    auth: 'auth-full',
    email: 'full@example.com',
    enable: true,
    expiryTime: 0,
    totalGB: 1024,
    limitIp: 0,
    tgId: 0,
    subId: 'sub-full',
    flow: 'xtls-rprx-vision'
  }]);
  assert.deepStrictEqual(calls[2], ['attachClient', 'full@example.com', [11]]);
}

async function testGetInboundsRetriesTransientNetworkError() {
  let attempts = 0;
  const service = createServiceWithClient({
    async getInbounds() {
      attempts++;
      if (attempts === 1) {
        throw new Error('Client network socket disconnected before secure TLS connection was established');
      }
      return { success: true, obj: [{ id: 1 }] };
    }
  });

  const result = await service.getInbounds();

  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.data, [{ id: 1 }]);
  assert.strictEqual(attempts, 2);
}

async function run() {
  await testResetClientTrafficUsesV325Route();
  await testUpsertServerClientAddsFullClientAndInboundIds();
  await testConcurrentServerClientUpsertsAddOnlyOnce();
  await testServerClientLockReleasesConnectionWhenUnlockFails();
  await testGetServerClientByEmailReturnsThreeStates();
  await testUpsertServerClientDoesNotAddWhenLookupErrors();
  await testUpsertServerClientVerifiesUnknownAddResult();
  await testUpsertServerClientVerifiesUnknownUpdateResult();
  await testUpsertServerClientVerifiesUnknownAttachResult();
  await testUpsertServerClientForceUpdateRepairsMatchingClient();
  await testForceUpdateDoesNotVerifyUnknownWriteFromPreexistingState();
  await testUpsertServerClientUpdatesAndAttachesMissingInbounds();
  await testGetInboundsRetriesTransientNetworkError();

  const service = createServiceWithClient({
    version: '3.2.5',
    supportsClientApi: true,
    async getClientByEmail(email) {
      assert.strictEqual(email, 'foo@example.com');
      return {
        success: true,
        obj: {
          client: {
            uuid: 'uuid-1',
            email: 'foo@example.com',
            enable: true,
            expiryTime: 123,
            totalGB: 456,
            subId: 'sub-1',
            flow: 'xtls-rprx-vision',
            auth: 'auth-1'
          },
          inboundIds: [5]
        }
      };
    },
    async deleteClientByEmail(inboundId, email) {
      assert.strictEqual(inboundId, 5);
      assert.strictEqual(email, 'foo@example.com');
      return { success: true, msg: 'deleted' };
    }
  });

  const result = await service.getClientsByEmail(5, 'foo@example.com');
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.clients.length, 1);
  assert.deepStrictEqual(result.clients[0], {
    uuid: 'uuid-1',
    email: 'foo@example.com',
    enable: true,
    expiryTime: 123,
    totalGB: 456,
    subId: 'sub-1',
    flow: 'xtls-rprx-vision',
    password: '',
    auth: 'auth-1'
  });

  const wrongInbound = await service.getClientsByEmail(9, 'foo@example.com');
  assert.strictEqual(wrongInbound.success, true);
  assert.deepStrictEqual(wrongInbound.clients, []);

  const deleteResult = await service.deleteClientByEmail(5, 'foo@example.com');
  assert.deepStrictEqual(deleteResult, {
    success: true,
    message: 'deleted'
  });

  const missingService = createServiceWithClient({
    version: '3.2.5',
    supportsClientApi: true,
    async getClientByEmail(email) {
      assert.strictEqual(email, 'missing@example.com');
      return {
        success: false,
        msg: ' (record not found)'
      };
    }
  });

  const missingResult = await missingService.getClientsByEmail(5, 'missing@example.com');
  assert.strictEqual(missingResult.success, true);
  assert.deepStrictEqual(missingResult.clients, []);

  console.log('test-xui-service-v325: PASS');
}

run().catch((error) => {
  console.error('test-xui-service-v325: FAIL');
  console.error(error);
  process.exitCode = 1;
});
