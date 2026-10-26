/** 验证订阅类兼容性、真实本地代理链路、凭证隔离及错误契约，不访问外部服务。 */
const assert = require('assert');
const http = require('http');
const axios = require('axios');
const { Readable } = require('stream');
const subscriptionService = require('../services/shared/subscription-service');
const { SubscriptionService, parseSubscriptionContent, pickSingleNodeLink, getProtocolAliases } = subscriptionService;

/**
 * 在随机本地端口启动测试目标或代理。
 * @param {Function} handler - 请求处理回调，转发分支由调用方提供。
 * @returns {Promise<http.Server>} 已监听的测试服务。
 */
async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

/**
 * 清理测试服务，悬挂请求同样主动断开，避免测试进程无法结束。
 * @param {http.Server} server - 待关闭的本地服务。
 * @returns {Promise<void>} 关闭后完成。
 */
async function closeServer(server) {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

/**
 * 创建默认关闭代理的测试实例；缺少类时返回明确的契约断言失败。
 * @param {Object} [options={}] - 可覆盖 proxy、httpClient 和 timeout。
 * @returns {SubscriptionService} 独立订阅服务实例。
 */
function createService(options = {}) {
  assert.strictEqual(typeof SubscriptionService, 'function', '应导出 SubscriptionService 类');
  return new SubscriptionService({ proxy: { enabled: false }, ...options });
}

/** @returns {void} 默认导出应为类单例，实例四个公开方法须支持解构调用。 */
function testClassExportAndDestructuredMethods() {
  assert.strictEqual(typeof SubscriptionService, 'function', '应导出 SubscriptionService 类');
  assert(subscriptionService instanceof SubscriptionService, '默认导出应为订阅服务单例');
  const { parseSubscriptionContent: parse, pickSingleNodeLink: pick, getProtocolAliases: aliases } = createService();
  assert.deepStrictEqual(parse(Buffer.from('vless://a\nhysteria2://b\n').toString('base64')), ['vless://a', 'hysteria2://b']);
  assert.strictEqual(pick(['vless://a', 'hysteria2://b'], 'hysteria'), 'hysteria2://b');
  assert.deepStrictEqual(aliases('hy2'), ['hysteria2', 'hysteria', 'hy2']);
}

/** @returns {void} 既有模块解构导入继续保持解析、别名与严格协议筛选。 */
function testExistingProtocolMatching() {
  assert.deepStrictEqual(parseSubscriptionContent(Buffer.from('vless://a\nhysteria2://b\n').toString('base64')), ['vless://a', 'hysteria2://b']);
  assert.strictEqual(pickSingleNodeLink(['vless://a', 'hysteria2://b'], 'hysteria'), 'hysteria2://b');
  assert.strictEqual(pickSingleNodeLink(['hysteria2://b'], 'hysteria2'), 'hysteria2://b');
  assert.strictEqual(pickSingleNodeLink(['trojan://c'], 'vless'), null);
  assert.strictEqual(pickSingleNodeLink([null, ' ', ' vless://a ']), 'vless://a');
  assert.strictEqual(pickSingleNodeLink(null, 'vless'), null);
  assert.deepStrictEqual(getProtocolAliases('hysteria'), ['hysteria2', 'hysteria', 'hy2']);
  assert.deepStrictEqual(getProtocolAliases(' VLESS:// '), ['vless']);
  assert.deepStrictEqual(getProtocolAliases(''), []);
}

/** @returns {Promise<void>} 解构抓取应保留实例依赖、文本响应以及默认和单次超时归一化。 */
async function testInjectedClientAndTimeoutNormalization() {
  const requests = [];
  const httpClient = { async get(url, options) {
    requests.push({ url, options });
    return { status: 200, data: '12345' };
  } };
  const { fetchOriginalSubscription } = createService({ httpClient, timeout: 250 });
  for (const timeout of [undefined, 0, -1, Infinity, NaN, '10', 40]) {
    assert.strictEqual(await fetchOriginalSubscription('http://local/sub/', 'token', { timeout }), '12345');
  }
  assert.deepStrictEqual(requests.map(request => request.options.timeout), [250, 250, 250, 250, 250, 250, 40]);
  assert(requests.every(request => request.url === 'http://local/sub/token' && request.options.responseType === 'stream'));
  await createService({ httpClient, timeout: 0 }).fetchOriginalSubscription('http://local/', 'token');
  assert.strictEqual(requests.at(-1).options.timeout, 15000);
}

/** @returns {Promise<void>} 代理关闭时显式绕过环境代理，并原样返回看似 JSON 的文本。 */
async function testDisabledProxyIgnoresEnvironment() {
  const names = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const target = await startServer((request, response) => response.end('12345'));
  try {
    for (const name of names) process.env[name] = name.toLowerCase() === 'no_proxy' ? '' : 'http://127.0.0.1:1';
    assert.strictEqual(await createService().fetchOriginalSubscription(`http://127.0.0.1:${target.address().port}/`, 'token'), '12345');
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    await closeServer(target);
  }
}

/** @returns {Promise<void>} 必须经真实代理访问，代理认证和 Axios 全局面板认证不得成为目标 Authorization。 */
async function testRealProxyRequestAndCredentialIsolation() {
  const proxyRequests = [];
  const targetRequests = [];
  const target = await startServer((request, response) => {
    targetRequests.push({ path: request.url, headers: request.headers });
    response.end('proxy-subscription-content');
  });
  const proxy = await startServer((request, response) => {
    proxyRequests.push({ url: request.url, headers: request.headers });
    const headers = { ...request.headers };
    delete headers['proxy-authorization'];
    const forwarded = http.get(request.url, { headers }, upstream => {
      response.writeHead(upstream.statusCode, upstream.headers);
      upstream.pipe(response);
    });
    forwarded.on('error', () => { response.writeHead(502); response.end(); });
  });
  const oldAuthorization = axios.defaults.headers.common.Authorization;
  axios.defaults.headers.common.Authorization = 'Bearer panel-token-must-not-leak';
  try {
    const service = createService({ proxy: { enabled: true, protocol: 'http', host: '127.0.0.1', port: proxy.address().port, username: 'proxy-user', password: 'proxy-pass' } });
    const url = `http://127.0.0.1:${target.address().port}/sub/`;
    assert.strictEqual(await service.fetchOriginalSubscription(url, 'token'), 'proxy-subscription-content');
    assert.strictEqual(proxyRequests.length, 1);
    assert.strictEqual(proxyRequests[0].url, `${url}token`);
    assert.strictEqual(proxyRequests[0].headers['proxy-authorization'], `Basic ${Buffer.from('proxy-user:proxy-pass').toString('base64')}`);
    assert.strictEqual(proxyRequests[0].headers.authorization, undefined);
    assert.strictEqual(targetRequests.length, 1);
    assert.strictEqual(targetRequests[0].path, '/sub/token');
    assert.strictEqual(targetRequests[0].headers.authorization, undefined);
  } finally {
    if (oldAuthorization === undefined) delete axios.defaults.headers.common.Authorization;
    else axios.defaults.headers.common.Authorization = oldAuthorization;
    await closeServer(proxy);
    await closeServer(target);
  }
}

/** @returns {Promise<void>} 初始目标及跨端口重定向目标均不得收到继承的面板 Authorization。 */
async function testRedirectDoesNotLeakAuthorization() {
  const authorizations = [];
  const target = await startServer((request, response) => {
    authorizations.push(request.headers.authorization);
    response.end('redirected-content');
  });
  const redirect = await startServer((request, response) => {
    authorizations.push(request.headers.authorization);
    response.writeHead(302, { Location: `http://127.0.0.1:${target.address().port}/redirected` });
    response.end();
  });
  const oldAuthorization = axios.defaults.headers.common.Authorization;
  axios.defaults.headers.common.Authorization = 'Bearer panel-token-must-not-leak';
  try {
    assert.strictEqual(await createService().fetchOriginalSubscription(`http://127.0.0.1:${redirect.address().port}/`, 'token'), 'redirected-content');
    assert.deepStrictEqual(authorizations, [undefined, undefined]);
  } finally {
    if (oldAuthorization === undefined) delete axios.defaults.headers.common.Authorization;
    else axios.defaults.headers.common.Authorization = oldAuthorization;
    await closeServer(redirect);
    await closeServer(target);
  }
}

/** @returns {Promise<void>} 代理失败必须拒绝，不能触达可直连的目标。 */
async function testProxyFailureNeverFallsBackToDirect() {
  let targetRequests = 0;
  const target = await startServer((request, response) => { targetRequests++; response.end('must-not-reach'); });
  const proxy = await startServer(() => {});
  const proxyPort = proxy.address().port;
  await closeServer(proxy);
  try {
    const service = createService({ proxy: { enabled: true, protocol: 'http', host: '127.0.0.1', port: proxyPort } });
    await assert.rejects(service.fetchOriginalSubscription(`http://127.0.0.1:${target.address().port}/`, 'token', { timeout: 500 }), error => error.code === 'ECONNREFUSED');
    assert.strictEqual(targetRequests, 0);
  } finally {
    await closeServer(target);
  }
}

/** @returns {Promise<void>} 最终 HTTP 非 200（含其他 2xx）保留既有业务错误文案。 */
async function testNon200StatusKeepsBusinessError() {
  const target = await startServer((request, response) => { response.writeHead(Number(request.url.slice(1))); response.end(); });
  try {
    const service = createService();
    for (const status of [204, 404, 503]) {
      await assert.rejects(service.fetchOriginalSubscription(`http://127.0.0.1:${target.address().port}/`, String(status)), { message: `获取原始订阅失败，HTTP 状态码: ${status}` });
    }
  } finally {
    await closeServer(target);
  }
}

/** @returns {Promise<void>} 真实超时和 Axios 两种超时码均映射为稳定业务错误。 */
async function testStableTimeoutError() {
  const target = await startServer(() => {});
  try {
    const startedAt = Date.now();
    await assert.rejects(createService({ timeout: 30 }).fetchOriginalSubscription(`http://127.0.0.1:${target.address().port}/`, 'token'), { code: 'SUBSCRIPTION_FETCH_TIMEOUT', message: '获取原始订阅超时: 30ms' });
    assert(Date.now() - startedAt < 1000, '超时应主动结束悬挂请求');
    for (const code of ['ECONNABORTED', 'ETIMEDOUT']) {
      const service = createService({ httpClient: { async get() { throw Object.assign(new Error('Axios timeout'), { code }); } } });
      await assert.rejects(service.fetchOriginalSubscription('http://local/', 'token', { timeout: 20 }), { code: 'SUBSCRIPTION_FETCH_TIMEOUT', message: '获取原始订阅超时: 20ms' });
    }
  } finally {
    await closeServer(target);
  }
}

/** @returns {Promise<void>} 已收到 200 和部分正文后停发数据，仍须返回稳定的读取超时错误。 */
async function testPartial200ResponseKeepsStableReadTimeout() {
  const target = await startServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.write('partial');
  });
  try {
    await assert.rejects(createService().fetchOriginalSubscription(
      `http://127.0.0.1:${target.address().port}/`, 'token', { timeout: 40 }
    ), { code: 'SUBSCRIPTION_FETCH_TIMEOUT', message: '获取原始订阅超时: 40ms' });
  } finally {
    await closeServer(target);
  }
}

/** @returns {Promise<void>} 最终 503 响应头到达后立即拒绝，不等待永不结束的错误正文。 */
async function testPartial503ResponseRejectsBeforeBodyCompletes() {
  const target = await startServer((request, response) => {
    response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.write('partial error');
  });
  let guard;
  try {
    await assert.rejects(Promise.race([
      createService().fetchOriginalSubscription(`http://127.0.0.1:${target.address().port}/`, 'token', { timeout: 500 }),
      new Promise((resolve, reject) => { guard = setTimeout(() => reject(new Error('等待错误正文导致 HTTP 状态未及时返回')), 150); })
    ]), { message: '获取原始订阅失败，HTTP 状态码: 503' });
  } finally {
    clearTimeout(guard);
    await closeServer(target);
  }
}

/** @returns {Promise<void>} 服务端真实提前断流应保留原中文业务错误，且不能误判为超时。 */
async function testActualResponseInterruptionIsNotTimeout() {
  const target = await startServer((request, response) => {
    response.writeHead(200);
    response.write('partial');
    setImmediate(() => response.socket.destroy());
  });
  try {
    await assert.rejects(createService().fetchOriginalSubscription(
      `http://127.0.0.1:${target.address().port}/`, 'token', { timeout: 500 }
    ), error => error.code !== 'SUBSCRIPTION_FETCH_TIMEOUT'
      && error.message === '获取原始订阅失败：响应在完成前中断');
  } finally {
    await closeServer(target);
  }
}

/** @returns {Promise<void>} 跨数据块的 UTF-8 字符必须完整解码，不能逐块拼接导致乱码。 */
async function testStreamChunksPreserveUtf8Content() {
  const bytes = Buffer.from('中文订阅');
  const service = createService({ httpClient: { async get() {
    return { status: 200, data: Readable.from([bytes.subarray(0, 1), bytes.subarray(1, 5), bytes.subarray(5)]) };
  } } });
  assert.strictEqual(await service.fetchOriginalSubscription('http://local/', 'token'), '中文订阅');
}

/** @returns {Promise<void>} 逐条输出结果，失败时继续显示其他独立用例的 RED 原因。 */
async function run() {
  let failures = 0;
  const tests = [testClassExportAndDestructuredMethods, testExistingProtocolMatching,
    testInjectedClientAndTimeoutNormalization, testDisabledProxyIgnoresEnvironment,
    testRealProxyRequestAndCredentialIsolation, testRedirectDoesNotLeakAuthorization,
    testProxyFailureNeverFallsBackToDirect, testNon200StatusKeepsBusinessError, testStableTimeoutError,
    testPartial200ResponseKeepsStableReadTimeout, testPartial503ResponseRejectsBeforeBodyCompletes,
    testActualResponseInterruptionIsNotTimeout, testStreamChunksPreserveUtf8Content];
  for (const test of tests) {
    try { await test(); console.log(`PASS ${test.name}`); }
    catch (error) { failures++; console.error(`FAIL ${test.name}: ${error.message}`); }
  }
  assert.strictEqual(failures, 0, `subscription service tests: ${failures} failed`);
  console.log(`subscription service tests passed (${tests.length}/${tests.length})`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
