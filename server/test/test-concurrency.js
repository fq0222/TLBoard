const assert = require('assert');
const { runWithConcurrency } = require('../utils/concurrency');
const XuiService = require('../integrations/xui/xui-service');
const trafficRepository = require('../repositories/traffic-repository');
const trafficManager = require('../services/shared/traffic-manager');

/**
 * 验证任务池限制并发数，并保持 allSettled 结果语义和输入顺序。
 *
 * @returns {Promise<void>}
 */
async function testConcurrencyAndSettledResults() {
  const items = Array.from({ length: 25 }, (_, index) => index);
  let active = 0;
  let maxActive = 0;
  const completed = [];

  const results = await runWithConcurrency(items, 10, async (item) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active -= 1;

    if (item === 6) {
      throw new Error('第7项失败');
    }

    completed.push(item);
    return `result-${item}`;
  });

  assert.strictEqual(maxActive, 10);
  assert.strictEqual(completed.length, 24);
  assert.strictEqual(results.length, items.length);
  assert.deepStrictEqual(
    results.map(result => result.status),
    items.map((_, index) => index === 6 ? 'rejected' : 'fulfilled')
  );
  assert.strictEqual(results[6].reason.message, '第7项失败');
  assert.deepStrictEqual(
    results.map((result, index) => result.status === 'fulfilled' ? result.value : `error-${index}`),
    items.map((item, index) => index === 6 ? 'error-6' : `result-${item}`)
  );
}

/**
 * 验证空数组不会调用工作函数。
 *
 * @returns {Promise<void>}
 */
async function testEmptyItems() {
  let called = false;
  const results = await runWithConcurrency([], 3, async () => {
    called = true;
  });

  assert.deepStrictEqual(results, []);
  assert.strictEqual(called, false);
}

/**
 * 验证公开参数的类型和取值约束。
 *
 * @returns {Promise<void>}
 */
async function testArgumentValidation() {
  await assert.rejects(() => runWithConcurrency(null, 1, async () => {}), TypeError);
  await assert.rejects(() => runWithConcurrency([], 0, async () => {}), RangeError);
  await assert.rejects(() => runWithConcurrency([], 1.5, async () => {}), RangeError);
  await assert.rejects(() => runWithConcurrency([], 1, null), TypeError);
}

/**
 * 验证流量同步仅以最多 10 个并发请求获取服务器 inbounds，并在全部请求完成后解析流量。
 *
 * @returns {Promise<void>}
 */
async function testTrafficInboundFetchConcurrencyLimit() {
  const originalListOnlineServers = trafficRepository.listOnlineServers;
  const originalGetInstance = XuiService.getInstance;
  const servers = Array.from({ length: 25 }, (_, index) => ({
    id: index + 1,
    name: `server-${index + 1}`,
    api_url: `http://server-${index + 1}`,
    api_token: `token-${index + 1}`,
    panel_version: '3.0.2'
  }));
  let activeRequests = 0;
  let maxActiveRequests = 0;
  let parsedInboundCount = 0;

  trafficRepository.listOnlineServers = async () => servers;
  XuiService.getInstance = async () => ({
    getInbounds: async () => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise(resolve => setTimeout(resolve, 10));
      activeRequests -= 1;
      return {
        success: true,
        data: [{
          id: 1,
          protocol: 'vless',
          settings: '{}',
          get clientStats() {
            assert.strictEqual(activeRequests, 0, '所有 inbounds 获取完成后才能开始解析流量');
            parsedInboundCount += 1;
            return [];
          }
        }]
      };
    }
  });

  try {
    const result = await trafficManager.fetchAllServerTraffic({});

    assert.strictEqual(maxActiveRequests, 10);
    assert.strictEqual(Object.keys(result).length, servers.length);
    assert.strictEqual(parsedInboundCount, servers.length);
  } finally {
    trafficRepository.listOnlineServers = originalListOnlineServers;
    XuiService.getInstance = originalGetInstance;
  }
}

/**
 * 运行通用并发任务池及流量同步并发边界测试；任一断言失败时以非零状态退出。
 *
 * @returns {Promise<void>}
 */
async function main() {
  await testConcurrencyAndSettledResults();
  await testEmptyItems();
  await testArgumentValidation();
  await testTrafficInboundFetchConcurrencyLimit();
  console.log('concurrency tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
