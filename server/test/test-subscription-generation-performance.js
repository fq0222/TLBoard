const assert = require('assert');
const http = require('http');
const sharedSubscriptionService = require('../services/shared/subscription-service');
const XuiApiClientV302 = require('../integrations/xui/xui-api-client-v302');
const XuiService = require('../integrations/xui/xui-service');
const { INBOUND_REQUEST_TIMEOUT_MS } = require('../integrations/xui/xui-sync');

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
 * 顺序执行订阅生成性能回归测试，任一失败都会让进程以非零状态退出。
 *
 * @returns {Promise<void>}
 */
async function run() {
  await testOriginalSubscriptionShouldUsePerRequestTimeout();
  await testApiClientShouldWriteTimeoutToAxiosConfig();
  await testXuiServiceShouldForwardInboundOptions();
  testInboundRequestTimeoutConstant();
  console.log('subscription generation performance tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
