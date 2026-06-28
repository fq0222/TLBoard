const assert = require('assert');
const http = require('http');
const sharedSubscriptionService = require('../services/shared/subscription-service');
const XuiApiClientV302 = require('../integrations/xui/xui-api-client-v302');
const XuiService = require('../integrations/xui/xui-service');
const {
  INBOUND_REQUEST_TIMEOUT_MS,
  normalizePositiveTimeout
} = require('../integrations/xui/xui-sync');

/**
 * 启动一个接受请求但永不响应的本地 HTTP 服务，用于验证请求超时会主动取消连接。
 *
 * @returns {Promise<{server:http.Server,url:string}>} 测试服务及其订阅基础地址。
 */
async function createHangingHttpServer() {
  const server = http.createServer(() => {});
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}/subscription/`
  };
}

/**
 * 启动一个先返回 200 和部分正文、随后立即断开连接的本地 HTTP 服务。
 *
 * @returns {Promise<{server:http.Server,url:string}>} 测试服务及其订阅基础地址。
 */
async function createInterruptedHttpServer() {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.write('partial-content');
    setImmediate(() => response.socket.destroy());
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}/subscription/`
  };
}

/**
 * 关闭测试 HTTP 服务；若仍有残留连接则主动销毁，避免测试进程挂起。
 *
 * @param {http.Server} server - 待关闭的本地测试服务。
 * @returns {Promise<void>}
 */
async function closeHttpServer(server) {
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
  }
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

/**
 * 验证原始订阅请求使用单次超时，并在超时后拒绝且释放悬挂连接。
 *
 * @returns {Promise<void>}
 */
async function testOriginalSubscriptionShouldUsePerRequestTimeout() {
  const { server, url } = await createHangingHttpServer();
  const startedAt = Date.now();

  try {
    await assert.rejects(
      sharedSubscriptionService.fetchOriginalSubscription(url, 'token', { timeout: 50 }),
      (error) => error instanceof Error && error.message.includes('50ms')
    );
    assert(
      Date.now() - startedAt < 1000,
      '单次 50ms 超时不应等待默认的 15000ms'
    );
  } finally {
    await closeHttpServer(server);
  }
}

/**
 * 验证 200 响应正文尚未接收完整便断开时会拒绝，而不会永久等待。
 *
 * @returns {Promise<void>}
 */
async function testInterruptedOriginalSubscriptionShouldReject() {
  const { server, url } = await createInterruptedHttpServer();
  let guardTimer;

  try {
    await assert.rejects(
      Promise.race([
        sharedSubscriptionService.fetchOriginalSubscription(url, 'token', { timeout: 1000 }),
        new Promise((resolve, reject) => {
          guardTimer = setTimeout(
            () => reject(new Error('响应中断后订阅请求仍处于 pending 状态')),
            300
          );
        })
      ]),
      (error) => !error.message.includes('pending 状态')
    );
  } finally {
    clearTimeout(guardTimer);
    await closeHttpServer(server);
  }
}

/**
 * 验证 3X-UI API 客户端把单次 timeout 写入 Axios 请求配置。
 *
 * @returns {Promise<void>}
 */
async function testApiClientShouldWriteTimeoutToAxiosConfig() {
  const client = new XuiApiClientV302('http://127.0.0.1', 'token');
  let requestConfig;
  client.api.request = async (config) => {
    requestConfig = config;
    return { data: { success: true, obj: [] } };
  };

  await client.getInbounds({ timeout: 10000 });
  assert.strictEqual(requestConfig.timeout, 10000);
}

/**
 * 验证 XuiService 获取 inbound 时透传单次请求选项，并保留标准化响应。
 *
 * @returns {Promise<void>}
 */
async function testXuiServiceShouldForwardInboundOptions() {
  const service = new XuiService('http://127.0.0.1', 'token');
  let receivedOptions;
  service.client = {
    async getInbounds(options) {
      receivedOptions = options;
      return { success: true, obj: [{ id: 1 }] };
    }
  };

  const result = await service.getInbounds({ timeout: 10000 });
  assert.deepStrictEqual(receivedOptions, { timeout: 10000 });
  assert.deepStrictEqual(result, { success: true, data: [{ id: 1 }] });
}

/**
 * 验证 inbound 快照请求的默认单次超时常量保持为 10 秒。
 *
 * @returns {void}
 */
function testInboundRequestTimeoutConstant() {
  assert.strictEqual(INBOUND_REQUEST_TIMEOUT_MS, 10000);
}

/**
 * 验证 inbound 单次超时仅接受有限正数，其他类型和值均回退到默认值。
 *
 * @returns {void}
 */
function testInboundRequestTimeoutNormalization() {
  assert.strictEqual(normalizePositiveTimeout(2500), 2500);
  assert.strictEqual(normalizePositiveTimeout(-1), 10000);
  assert.strictEqual(normalizePositiveTimeout('2500'), 10000);
  assert.strictEqual(normalizePositiveTimeout(Infinity), 10000);
}

/**
 * 顺序执行订阅生成性能回归测试，任一失败都会让进程以非零状态退出。
 *
 * @returns {Promise<void>}
 */
async function run() {
  await testOriginalSubscriptionShouldUsePerRequestTimeout();
  await testInterruptedOriginalSubscriptionShouldReject();
  await testApiClientShouldWriteTimeoutToAxiosConfig();
  await testXuiServiceShouldForwardInboundOptions();
  testInboundRequestTimeoutConstant();
  testInboundRequestTimeoutNormalization();
  console.log('subscription generation performance tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
