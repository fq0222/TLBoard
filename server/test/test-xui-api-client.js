/**
 * 测试 3X-UI API 客户端与版本工厂。
 */

const assert = require('assert');
const Module = require('module');

const originalLoad = Module._load;
const requests = [];

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'axios') {
    return {
      create(options) {
        return {
          defaults: { headers: {} },
          interceptors: {
            request: { use(handler) { this.handler = handler; } },
            response: { use(success, failure) { this.success = success; this.failure = failure; } }
          },
          async request(config) {
            const requestConfig = this.interceptors.request.handler
              ? await this.interceptors.request.handler({ headers: {}, ...config })
              : config;
            requests.push({ baseURL: options.baseURL, timeout: options.timeout, ...requestConfig });
            return { data: { success: true, msg: 'ok', obj: [] }, config: requestConfig };
          }
        };
      }
    };
  }
  return originalLoad(request, parent, isMain);
};

async function run() {
  const XuiApiClient = require('../integrations/xui/xui-api-client');
  const XuiApiClientV325 = require('../integrations/xui/xui-api-client-v325');
  const {
    createXuiApiClient,
    resolveClientVersion
  } = require('../integrations/xui/xui-api-client-factory');

  const client = new XuiApiClient('https://xui.example.com/', 'secret-token', { timeout: 1234 });
  const factoryResult = createXuiApiClient('https://xui.example.com/', 'secret-token', { timeout: 5678 });
  const v325FactoryResult = createXuiApiClient('https://xui.example.com/', 'secret-token', {
    timeout: 6789,
    apiVersion: '3.2.5'
  });
  const v331FactoryResult = createXuiApiClient('https://xui.example.com/', 'secret-token', {
    timeout: 7890,
    apiVersion: '3.3.1'
  });
  const v342FactoryResult = createXuiApiClient('https://xui.example.com/', 'secret-token', {
    timeout: 8901,
    apiVersion: '3.4.2'
  });
  const v360FactoryResult = createXuiApiClient('https://xui.example.com/', 'secret-token', {
    timeout: 9012,
    apiVersion: '3.6.0'
  });
  const v331ResolvedResult = resolveClientVersion('3.3.1');
  const v342ResolvedResult = resolveClientVersion('3.4.2');
  const v360ResolvedResult = resolveClientVersion('3.6.0');
  const fallbackResult = resolveClientVersion('9.9.9');
  const v325Client = new XuiApiClientV325('https://xui.example.com/', 'secret-token', { timeout: 4321 });

  const loginResult = await client.login();
  assert.deepStrictEqual(loginResult, { success: true, msg: 'Authenticated via API token' });
  assert.strictEqual(client.version, '3.0.2');
  assert.strictEqual(factoryResult.client.version, '3.0.2');
  assert.strictEqual(factoryResult.requestedVersion, '3.0.2');
  assert.strictEqual(factoryResult.resolvedVersion, '3.0.2');
  assert.strictEqual(v325FactoryResult.client.version, '3.2.5');
  assert.strictEqual(v325FactoryResult.requestedVersion, '3.2.5');
  assert.strictEqual(v325FactoryResult.resolvedVersion, '3.2.5');
  assert.strictEqual(v331FactoryResult.client.supportsClientApi, true);
  assert.strictEqual(v331FactoryResult.client.version, '3.2.5');
  assert.strictEqual(v331FactoryResult.requestedVersion, '3.3.1');
  assert.strictEqual(v331FactoryResult.resolvedVersion, '3.3.1');
  assert.strictEqual(v331ResolvedResult.requestedVersion, '3.3.1');
  assert.strictEqual(v331ResolvedResult.resolvedVersion, '3.3.1');
  assert.strictEqual(v342FactoryResult.client.version, '3.4.2');
  assert.strictEqual(v342FactoryResult.client.supportsClientApi, true);
  assert.strictEqual(v342FactoryResult.requestedVersion, '3.4.2');
  assert.strictEqual(v342FactoryResult.resolvedVersion, '3.4.2');
  assert.strictEqual(v342ResolvedResult.requestedVersion, '3.4.2');
  assert.strictEqual(v342ResolvedResult.resolvedVersion, '3.4.2');
  assert.strictEqual(v360FactoryResult.client.version, '3.4.2');
  assert.strictEqual(v360FactoryResult.client.supportsClientApi, true);
  assert.strictEqual(v360FactoryResult.requestedVersion, '3.6.0');
  assert.strictEqual(v360FactoryResult.resolvedVersion, '3.6.0');
  assert.strictEqual(v360ResolvedResult.requestedVersion, '3.6.0');
  assert.strictEqual(v360ResolvedResult.resolvedVersion, '3.6.0');
  assert.strictEqual(fallbackResult.requestedVersion, '9.9.9');
  assert.strictEqual(fallbackResult.resolvedVersion, '3.0.2');

  await client.getInbounds();
  await client.updateClient('client-uuid', { id: 2, settings: '{"clients":[]}' });
  await client.getDb();
  const serverStatusResult = await client.getServerStatus();
  await v325Client.getOnlineClients();
  await v325Client.getLastOnline();
  await v325Client.getClientTrafficsByEmail('foo@example.com');
  await v325Client.addClient({
    id: 5,
    settings: JSON.stringify({
      clients: [{
        id: 'uuid-1',
        email: 'foo@example.com',
        enable: true,
        expiryTime: 0,
        totalGB: 1073741824,
        limitIp: 0,
        tgId: 0,
        subId: 'sub-1',
        flow: 'xtls-rprx-vision'
      }]
    })
  });
  await v325Client.addClient({
    client: {
      id: 'uuid-full',
      password: 'password-full',
      auth: 'auth-full',
      email: 'full@example.com',
      enable: true,
      expiryTime: 0,
      totalGB: 1073741824,
      limitIp: 0,
      tgId: 0,
      subId: 'sub-full',
      flow: 'xtls-rprx-vision'
    },
    inboundIds: [10, 11]
  });
  await v325Client.attachClient('full@example.com', [10, 11]);
  await v325Client.detachClient('full@example.com', [12]);
  await v325Client.updateClient('full@example.com', {
    id: 'uuid-full',
    password: 'password-full-2',
    auth: 'auth-full-2',
    email: 'full@example.com',
    enable: false,
    expiryTime: 456,
    totalGB: 2048,
    limitIp: 1,
    tgId: 2,
    subId: 'sub-full-2'
  });
  await v325Client.updateClient('ignored-uuid', {
    id: 5,
    settings: JSON.stringify({
      clients: [{
        id: 'uuid-1',
        email: 'foo@example.com',
        enable: false,
        expiryTime: 123,
        totalGB: 2147483648,
        limitIp: 1,
        tgId: 2,
        subId: 'sub-2'
      }]
    })
  });
  await v325Client.deleteClientByEmail(5, 'foo@example.com');
  const v325ServerStatusResult = await v325Client.getServerStatus();
  await v342FactoryResult.client.getMigration();

  assert.deepStrictEqual(serverStatusResult, { success: true, msg: 'ok', obj: [] });
  assert.deepStrictEqual(v325ServerStatusResult, { success: true, msg: 'ok', obj: [] });

  assert.strictEqual(requests[0].baseURL, 'https://xui.example.com');
  assert.strictEqual(requests[0].timeout, 1234);
  assert.strictEqual(requests[0].method, 'get');
  assert.strictEqual(requests[0].url, '/panel/api/inbounds/list');
  assert.strictEqual(requests[0].headers.Authorization, 'Bearer secret-token');

  assert.strictEqual(requests[1].method, 'post');
  assert.strictEqual(requests[1].url, '/panel/api/inbounds/updateClient/client-uuid');
  assert.deepStrictEqual(requests[1].data, { id: 2, settings: '{"clients":[]}' });

  assert.strictEqual(requests[2].method, 'get');
  assert.strictEqual(requests[2].url, '/panel/api/server/getDb');
  assert.strictEqual(requests[2].responseType, 'arraybuffer');
  assert.strictEqual(requests[2].headers.Authorization, 'Bearer secret-token');

  assert.strictEqual(requests[3].method, 'get');
  assert.strictEqual(requests[3].url, '/panel/api/server/status');
  assert.strictEqual(requests[3].headers.Authorization, 'Bearer secret-token');

  assert.strictEqual(requests[4].method, 'post');
  assert.strictEqual(requests[4].url, '/panel/api/clients/onlines');

  assert.strictEqual(requests[5].method, 'post');
  assert.strictEqual(requests[5].url, '/panel/api/clients/lastOnline');

  assert.strictEqual(requests[6].method, 'get');
  assert.strictEqual(requests[6].url, '/panel/api/clients/traffic/foo%40example.com');

  assert.strictEqual(requests[7].method, 'post');
  assert.strictEqual(requests[7].url, '/panel/api/clients/add');
  assert.deepStrictEqual(requests[7].data, {
    client: {
      id: 'uuid-1',
      email: 'foo@example.com',
      enable: true,
      expiryTime: 0,
      totalGB: 1073741824,
      limitIp: 0,
      tgId: 0,
      subId: 'sub-1',
      flow: 'xtls-rprx-vision'
    },
    inboundIds: [5]
  });

  assert.strictEqual(requests[8].method, 'post');
  assert.strictEqual(requests[8].url, '/panel/api/clients/add');
  assert.deepStrictEqual(requests[8].data, {
    client: {
      id: 'uuid-full',
      password: 'password-full',
      auth: 'auth-full',
      email: 'full@example.com',
      enable: true,
      expiryTime: 0,
      totalGB: 1073741824,
      limitIp: 0,
      tgId: 0,
      subId: 'sub-full',
      flow: 'xtls-rprx-vision'
    },
    inboundIds: [10, 11]
  });

  assert.strictEqual(requests[9].method, 'post');
  assert.strictEqual(requests[9].url, '/panel/api/clients/full%40example.com/attach');
  assert.deepStrictEqual(requests[9].data, { inboundIds: [10, 11] });

  assert.strictEqual(requests[10].method, 'post');
  assert.strictEqual(requests[10].url, '/panel/api/clients/full%40example.com/detach');
  assert.deepStrictEqual(requests[10].data, { inboundIds: [12] });

  assert.strictEqual(requests[11].method, 'post');
  assert.strictEqual(requests[11].url, '/panel/api/clients/update/full%40example.com');
  assert.deepStrictEqual(requests[11].data, {
    id: 'uuid-full',
    password: 'password-full-2',
    auth: 'auth-full-2',
    email: 'full@example.com',
    enable: false,
    expiryTime: 456,
    totalGB: 2048,
    limitIp: 1,
    tgId: 2,
    subId: 'sub-full-2'
  });

  assert.strictEqual(requests[12].method, 'post');
  assert.strictEqual(requests[12].url, '/panel/api/clients/update/foo%40example.com');
  assert.deepStrictEqual(requests[12].data, {
    id: 'uuid-1',
    email: 'foo@example.com',
    enable: false,
    expiryTime: 123,
    totalGB: 2147483648,
    limitIp: 1,
    tgId: 2,
    subId: 'sub-2'
  });

  assert.strictEqual(requests[13].method, 'post');
  assert.strictEqual(requests[13].url, '/panel/api/clients/del/foo%40example.com');

  assert.strictEqual(requests[14].method, 'get');
  assert.strictEqual(requests[14].url, '/panel/api/server/status');

  assert.strictEqual(requests[15].method, 'get');
  assert.strictEqual(requests[15].url, '/panel/api/server/getMigration');
  assert.strictEqual(requests[15].responseType, 'arraybuffer');
  assert.strictEqual(requests[15].headers.Authorization, 'Bearer secret-token');

  console.log('test-xui-api-client: PASS');
}

run()
  .catch((error) => {
    console.error('test-xui-api-client: FAIL');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    Module._load = originalLoad;
  });
