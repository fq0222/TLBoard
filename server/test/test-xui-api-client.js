/**
 * 测试 3X-UI API 客户端与版本工厂。
 */

const assert = require('assert');
const Module = require('module');

const originalLoad = Module._load;
const requests = [];
const clientOptions = [];
const v3102RouteWhitelist = new Set([
  'GET /panel/api/inbounds/list',
  'GET /panel/api/inbounds/get/7',
  'POST /panel/api/inbounds/add',
  'POST /panel/api/inbounds/update/7',
  'POST /panel/api/inbounds/del/7',
  'POST /panel/api/clients/add',
  'GET /panel/api/clients/get/legacy%2Buser%40example.com',
  'POST /panel/api/clients/legacy%2Buser%40example.com/attach',
  'POST /panel/api/clients/legacy%2Buser%40example.com/detach',
  'POST /panel/api/clients/update/legacy%2Buser%40example.com',
  'POST /panel/api/clients/del/legacy%2Buser%40example.com',
  'GET /panel/api/clients/list',
  'GET /panel/api/clients/traffic/legacy%2Buser%40example.com',
  'POST /panel/api/clients/ips/legacy%2Buser%40example.com',
  'POST /panel/api/clients/clearIps/legacy%2Buser%40example.com',
  'POST /panel/api/clients/resetTraffic/legacy%2Buser%40example.com',
  'POST /panel/api/clients/onlines',
  'POST /panel/api/clients/lastOnline',
  'POST /panel/api/clients/updateTraffic/legacy%2Buser%40example.com',
  'POST /panel/api/inbounds/resetAllTraffics',
  'POST /panel/api/clients/delDepleted',
  'POST /panel/api/inbounds/import',
  'GET /panel/api/server/status',
  'GET /panel/api/server/getDb',
  'GET /panel/api/server/getMigration',
  'POST /panel/api/xray/',
  'POST /panel/api/xray/update'
]);

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'axios') {
    return {
      create(options) {
        clientOptions.push(options);
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
            const routeKey = `${String(requestConfig.method).toUpperCase()} ${requestConfig.url}`;
            if (options.baseURL === 'https://v3102-xui.example.com' && !v3102RouteWhitelist.has(routeKey)) {
              throw new Error(`v3.10.2 route is not allowed: ${routeKey}`);
            }
            requests.push({ baseURL: options.baseURL, timeout: options.timeout, ...requestConfig });
            const obj = requestConfig.url === '/panel/api/clients/list'
              ? [{ email: 'legacy+user@example.com', uuid: 'legacy-uuid' }]
              : [];
            return { data: { success: true, msg: 'ok', obj }, config: requestConfig };
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
  const XuiApiClientV3102 = require('../integrations/xui/xui-api-client-v3102');
  const { buildXuiProxyConfig } = require('../integrations/xui/xui-proxy-config');
  const {
    createXuiApiClient,
    resolveClientVersion
  } = require('../integrations/xui/xui-api-client-factory');

  // 公共构建器需统一处理关闭、协议归一化、认证与无效配置。
  assert.strictEqual(buildXuiProxyConfig(), false);
  assert.strictEqual(buildXuiProxyConfig({ enabled: false, host: 'ignored' }), false);
  assert.deepStrictEqual(buildXuiProxyConfig({
    enabled: true,
    protocol: ' https: ',
    host: ' 127.0.0.1 ',
    port: '27891',
    username: 'user',
    password: 'pass'
  }), {
    protocol: 'https',
    host: '127.0.0.1',
    port: 27891,
    auth: { username: 'user', password: 'pass' }
  });
  assert.throws(() => buildXuiProxyConfig({ enabled: true, protocol: 'socks5', host: 'localhost', port: 80 }), /3X-UI 代理协议仅支持 http 或 https/);

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
  const v3102FactoryResult = createXuiApiClient('https://v3102-xui.example.com/', 'v3102-token', {
    timeout: 9123,
    apiVersion: '3.10.2',
    proxy: { enabled: false }
  });
  const v331ResolvedResult = resolveClientVersion('3.3.1');
  const v342ResolvedResult = resolveClientVersion('3.4.2');
  const v360ResolvedResult = resolveClientVersion('3.6.0');
  const v3102ResolvedResult = resolveClientVersion('3.10.2');
  const fallbackResult = resolveClientVersion('9.9.9');
  const v325Client = new XuiApiClientV325('https://xui.example.com/', 'secret-token', { timeout: 4321 });
  const proxiedV3102 = new XuiApiClientV3102('https://proxied-v3102.example.com/', 'v3102-token', {
    proxy: {
      enabled: true,
      protocol: 'https:',
      host: '127.0.0.1',
      port: 27891,
      username: 'v3102-user',
      password: 'v3102-password'
    }
  });
  const proxiedClient = new XuiApiClient('https://proxied-xui.example.com/', 'proxy-token', {
    proxy: {
      enabled: true,
      protocol: 'http',
      host: '127.0.0.1',
      port: 27890,
      username: 'proxy-user',
      password: 'proxy-password'
    }
  });
  const directClient = new XuiApiClient('https://direct-xui.example.com/', 'direct-token', {
    proxy: { enabled: false }
  });
  const unauthenticatedProxyClient = new XuiApiClient(
    'https://unauthenticated-proxy.example.com/',
    'proxy-token',
    {
      proxy: {
        enabled: true,
        protocol: 'http',
        host: '127.0.0.1',
        port: 27890
      }
    }
  );

  const proxiedOptions = clientOptions.find((options) => options.baseURL === 'https://proxied-xui.example.com');
  const directOptions = clientOptions.find((options) => options.baseURL === 'https://direct-xui.example.com');
  const unauthenticatedProxyOptions = clientOptions.find(
    (options) => options.baseURL === 'https://unauthenticated-proxy.example.com'
  );
  assert.deepStrictEqual(proxiedOptions.proxy, {
    protocol: 'http',
    host: '127.0.0.1',
    port: 27890,
    auth: {
      username: 'proxy-user',
      password: 'proxy-password'
    }
  });
  assert.strictEqual(directOptions.proxy, false);
  assert.deepStrictEqual(unauthenticatedProxyOptions.proxy, {
    protocol: 'http',
    host: '127.0.0.1',
    port: 27890
  });
  const proxiedV3102Options = clientOptions.find(
    (options) => options.baseURL === 'https://proxied-v3102.example.com'
  );
  assert.deepStrictEqual(proxiedV3102Options.proxy, {
    protocol: 'https',
    host: '127.0.0.1',
    port: 27891,
    auth: { username: 'v3102-user', password: 'v3102-password' }
  });
  assert.strictEqual(proxiedV3102.version, '3.10.2');
  assert.throws(
    () => new XuiApiClient('https://invalid-proxy.example.com/', 'invalid-token', {
      proxy: {
        enabled: true,
        protocol: 'http',
        host: '',
        port: 27890
      }
    }),
    /3X-UI 代理主机不能为空/
  );
  assert.throws(
    () => new XuiApiClient('https://invalid-port.example.com/', 'invalid-token', {
      proxy: {
        enabled: true,
        protocol: 'http',
        host: '127.0.0.1',
        port: 0
      }
    }),
    /3X-UI 代理端口无效/
  );
  assert.throws(
    () => new XuiApiClient('https://incomplete-auth.example.com/', 'invalid-token', {
      proxy: {
        enabled: true,
        protocol: 'http',
        host: '127.0.0.1',
        port: 27890,
        username: 'proxy-user',
        password: ''
      }
    }),
    /3X-UI 代理用户名和密码必须同时配置/
  );

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
  assert.strictEqual(v3102FactoryResult.client.constructor, XuiApiClientV3102);
  assert.strictEqual(v3102FactoryResult.client.version, '3.10.2');
  assert.strictEqual(v3102FactoryResult.client.supportsClientApi, true);
  assert.strictEqual(v3102FactoryResult.requestedVersion, '3.10.2');
  assert.strictEqual(v3102FactoryResult.resolvedVersion, '3.10.2');
  assert.strictEqual(v3102ResolvedResult.ClientClass, XuiApiClientV3102);
  assert.strictEqual(v3102ResolvedResult.resolvedVersion, '3.10.2');
  assert.strictEqual(v3102FactoryResult.client instanceof XuiApiClientV325, false);
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

  const v3102 = v3102FactoryResult.client;
  const v3102RequestStart = requests.length;
  await v3102.getInbounds({ timeout: 60000 });
  await v3102.getInbound(7);
  await v3102.addInbound({ remark: '新增节点' });
  await v3102.updateInbound(7, { remark: '更新节点' });
  await v3102.deleteInbound(7);
  await v3102.addClient({
    id: 7,
    settings: JSON.stringify({
      clients: [{
        id: 'legacy-uuid',
        email: 'legacy+user@example.com',
        enable: '0',
        expiryTime: 123,
        totalGB: 456,
        limitIp: 2,
        tgId: 3,
        subId: 'legacy-sub',
        flow: 'xtls-rprx-vision',
        comment: '保留当前字段',
        reset: 1,
        group: 'legacy-group',
        limitHwid: 9,
        resetDay: 8,
        reverse: { tag: '不得发送' }
      }]
    })
  });
  await v3102.addClient({
    client: {
      id: 'modern-uuid',
      password: 'modern-password',
      auth: 'modern-auth',
      email: 'modern@example.com',
      enable: true,
      expiryTime: 789,
      totalGB: 1024,
      limitIp: 1,
      tgId: 4,
      subId: 'modern-sub',
      security: 'auto'
    },
    inboundIds: [8, '9', 0, 'bad']
  });
  await v3102.getClientByEmail('legacy+user@example.com');
  await v3102.attachClient('legacy+user@example.com', [7, '8', 0]);
  await v3102.detachClient('legacy+user@example.com', [9]);
  await v3102.updateClient('ignored-id', {
    id: 7,
    settings: JSON.stringify({
      clients: [{
        id: 'legacy-uuid',
        email: 'legacy+user@example.com',
        enable: false,
        expiryTime: 321,
        totalGB: 654,
        limitIp: 1,
        tgId: 5,
        subId: 'updated-sub',
        limitHwid: 9,
        resetWeekday: 6,
        resetMax: 5
      }]
    })
  });
  await v3102.deleteClientByEmail(7, 'legacy+user@example.com');
  await v3102.deleteClient(7, 'legacy-uuid');
  await v3102.getClientTrafficsByEmail('legacy+user@example.com');
  await v3102.getClientTrafficsById('legacy-uuid');
  await v3102.getClientIps('legacy+user@example.com');
  await v3102.clearClientIps('legacy+user@example.com');
  await v3102.resetClientTraffic('legacy+user@example.com');
  await v3102.getOnlineClients();
  await v3102.getLastOnline();
  await v3102.updateClientTraffic('legacy+user@example.com', { up: 1, down: 2 });
  await v3102.resetAllTraffics();
  const requestCountBeforeUnsupportedReset = requests.length;
  await assert.rejects(
    () => v3102.resetAllClientTraffics(7),
    /v3\.10\.2 不支持按 inbound 重置全部客户端流量/
  );
  assert.strictEqual(requests.length, requestCountBeforeUnsupportedReset);
  await v3102.deleteDepletedClients();
  await assert.rejects(
    () => v3102.deleteDepletedClients(7),
    /v3\.10\.2 不支持按 inbound 删除耗尽流量的客户端/
  );
  await v3102.importInbound({ inbounds: [] });
  await assert.rejects(
    () => v3102.createBackup(),
    /v3\.10\.2 不支持 createBackup，请使用 getDb 或 getMigration/
  );
  await v3102.getServerStatus();
  await v3102.getDb();
  await v3102.getMigration();
  await v3102.getXrayConfig({ timeout: 45000 });
  await v3102.updateXrayConfig({ outbounds: [] }, 'https://check.example.com', { timeout: 46000 });

  const v3102Requests = requests.slice(v3102RequestStart);
  assert.deepStrictEqual(
    v3102Requests.map(({ method, url }) => `${method.toUpperCase()} ${url}`),
    [
      'GET /panel/api/inbounds/list',
      'GET /panel/api/inbounds/get/7',
      'POST /panel/api/inbounds/add',
      'POST /panel/api/inbounds/update/7',
      'POST /panel/api/inbounds/del/7',
      'POST /panel/api/clients/add',
      'POST /panel/api/clients/add',
      'GET /panel/api/clients/get/legacy%2Buser%40example.com',
      'POST /panel/api/clients/legacy%2Buser%40example.com/attach',
      'POST /panel/api/clients/legacy%2Buser%40example.com/detach',
      'POST /panel/api/clients/update/legacy%2Buser%40example.com',
      'POST /panel/api/clients/del/legacy%2Buser%40example.com',
      'GET /panel/api/clients/list',
      'POST /panel/api/clients/del/legacy%2Buser%40example.com',
      'GET /panel/api/clients/traffic/legacy%2Buser%40example.com',
      'GET /panel/api/clients/list',
      'GET /panel/api/clients/traffic/legacy%2Buser%40example.com',
      'POST /panel/api/clients/ips/legacy%2Buser%40example.com',
      'POST /panel/api/clients/clearIps/legacy%2Buser%40example.com',
      'POST /panel/api/clients/resetTraffic/legacy%2Buser%40example.com',
      'POST /panel/api/clients/onlines',
      'POST /panel/api/clients/lastOnline',
      'POST /panel/api/clients/updateTraffic/legacy%2Buser%40example.com',
      'POST /panel/api/inbounds/resetAllTraffics',
      'POST /panel/api/clients/delDepleted',
      'POST /panel/api/inbounds/import',
      'GET /panel/api/server/status',
      'GET /panel/api/server/getDb',
      'GET /panel/api/server/getMigration',
      'POST /panel/api/xray/',
      'POST /panel/api/xray/update'
    ]
  );
  assert.strictEqual(v3102Requests[0].timeout, 60000);
  assert.strictEqual(v3102Requests[0].headers.Authorization, 'Bearer v3102-token');
  assert.deepStrictEqual(v3102Requests[5].data, {
    client: {
      email: 'legacy+user@example.com',
      enable: false,
      expiryTime: 123,
      totalGB: 456,
      limitIp: 2,
      tgId: 3,
      subId: 'legacy-sub',
      id: 'legacy-uuid',
      flow: 'xtls-rprx-vision',
      comment: '保留当前字段',
      reset: 1,
      group: 'legacy-group'
    },
    inboundIds: [7]
  });
  assert.deepStrictEqual(v3102Requests[6].data.inboundIds, [8, 9]);
  assert.strictEqual(Object.hasOwn(v3102Requests[5].data.client, 'limitHwid'), false);
  assert.strictEqual(Object.hasOwn(v3102Requests[5].data.client, 'resetDay'), false);
  assert.strictEqual(Object.hasOwn(v3102Requests[5].data.client, 'reverse'), false);
  assert.strictEqual(Object.hasOwn(v3102Requests[10].data, 'resetWeekday'), false);
  assert.strictEqual(Object.hasOwn(v3102Requests[10].data, 'resetMax'), false);
  assert.strictEqual(v3102Requests[27].responseType, 'arraybuffer');
  assert.strictEqual(v3102Requests[28].responseType, 'arraybuffer');
  assert.strictEqual(v3102Requests[29].timeout, 45000);
  assert.strictEqual(v3102Requests[30].timeout, 46000);
  assert.strictEqual(v3102Requests[30].headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.strictEqual(v3102Requests[30].data.get('xraySetting'), '{"outbounds":[]}');
  assert.strictEqual(v3102Requests[30].data.get('outboundTestUrl'), 'https://check.example.com');

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
