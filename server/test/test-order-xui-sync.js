const assert = require('assert');
const orderService = require('../services/shared/order-service');
const XuiService = require('../integrations/xui/xui-service');
const orderRepository = require('../repositories/order-repository');
const xuiSyncRepository = require('../repositories/xui-sync-repository');

/**
 * 临时替换模块对象上的方法，并返回恢复函数。
 *
 * @param {Object} target - 需要替换方法的模块对象。
 * @param {Object<string, Function>} replacements - 方法名与替代实现。
 * @returns {Function} 恢复全部原方法的函数。
 */
function replaceMethods(target, replacements) {
  const originals = {};

  for (const [name, replacement] of Object.entries(replacements)) {
    originals[name] = target[name];
    target[name] = replacement;
  }

  return () => {
    for (const [name, original] of Object.entries(originals)) {
      target[name] = original;
    }
  };
}

/**
 * 创建订单同步读取 inbound 客户端快照所需的最小辅助方法。
 *
 * @returns {Object<string, Function>} 不访问外部服务的快照辅助方法。
 */
function createXuiSnapshotHelpers() {
  return {
    /** 测试 inbound 不携带客户端快照。 */
    extractClientsFromSettings() {
      return [];
    },
    /** 空快照中不存在目标客户端。 */
    getClientsByEmailFromSnapshot() {
      return { clients: [] };
    }
  };
}

/**
 * 验证订单同步最多同时处理十台服务器，且单台失败不阻塞其余服务器。
 *
 * @returns {Promise<void>}
 */
async function testOrderSyncLimitsServerConcurrencyAndIsolatesFailures() {
  let activeServers = 0;
  let maxActiveServers = 0;
  const visitedServers = [];

  const restoreXui = replaceMethods(XuiService, {
    /** 按 API 地址构造可观测并发数的测试服务。 */
    async getInstance(apiUrl) {
      return {
        ...createXuiSnapshotHelpers(),
        /** 模拟成功写入单个 inbound 客户端。 */
        async upsertUniqueClient() {
          return { success: true, action: 'add' };
        },
        /** 记录服务器请求的并发峰值，并令第七台服务器失败。 */
        async getInbounds() {
          const serverId = Number(apiUrl.split('/').pop());
          visitedServers.push(serverId);
          activeServers += 1;
          maxActiveServers = Math.max(maxActiveServers, activeServers);
          await new Promise((resolve) => setTimeout(resolve, 5));
          activeServers -= 1;

          if (serverId === 7) {
            throw new Error('server-7 failed');
          }

          return {
            success: true,
            data: [{
              id: serverId * 10,
              protocol: 'vless',
              remark: `cf-${serverId}`
            }]
          };
        }
      };
    }
  });
  const restoreSyncRepository = replaceMethods(xuiSyncRepository, {
    /** 返回超过并发上限的二十五台在线服务器。 */
    async listOnlineXuiServers() {
      return Array.from({ length: 25 }, (_, index) => ({
        id: index + 1,
        name: `server-${index + 1}`,
        api_url: `https://xui/${index + 1}`,
        api_token: 'token',
        panel_version: '3.0.2'
      }));
    },
    /** 返回预置节点凭据，避免测试触发数据库写入。 */
    async findUserNodeConfig(db, userId, serverId, inboundId) {
      return {
        uuid: `uuid-${serverId}-${inboundId}`,
        auth: '',
        sub_id: `sub-${serverId}-${inboundId}`
      };
    }
  });
  const restoreOrderRepository = replaceMethods(orderRepository, {
    /** 隔离同步状态数据库写入。 */
    async updateUserSyncStatus() {}
  });

  try {
    const result = await orderService.syncUserToXuiServers({}, {
      id: 100,
      email: 'concurrency@example.com',
      enabled: 1,
      expire_at: 0,
      traffic_limit: 1073741824,
      referral_traffic_limit: 0
    }, {});

    assert.strictEqual(maxActiveServers, 10);
    assert.strictEqual(visitedServers.length, 25);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.successCount, 24);
    assert.strictEqual(result.failureCount, 1);
    assert.strictEqual(result.successCount + result.failureCount, 25);
    assert.match(result.message, /server-7 failed/);
    assert.strictEqual(result.message, 'server-7 failed');
  } finally {
    restoreOrderRepository();
    restoreSyncRepository();
    restoreXui();
  }
}

/**
 * 验证单台服务器内的 inbound 写入和流量重置保持顺序执行。
 *
 * @returns {Promise<void>}
 */
async function testOrderSyncKeepsSingleServerInboundSequence() {
  const events = [];
  const fakeXuiService = {
    ...createXuiSnapshotHelpers(),
    /** 返回两个按固定顺序排列的 inbound。 */
    async getInbounds() {
      events.push('getInbounds');
      return {
        success: true,
        data: [
          { id: 101, protocol: 'vless', remark: 'cf-a' },
          { id: 102, protocol: 'vless', remark: 'cf-b' }
        ]
      };
    },
    /** 记录每个 inbound 的客户端写入顺序。 */
    async upsertUniqueClient(db, context) {
      events.push(`upsert:${context.inbound.id}`);
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { success: true, action: 'update' };
    },
    /** 记录每个 inbound 写入后的流量重置顺序。 */
    async resetClientTraffic(inboundId) {
      events.push(`reset:${inboundId}`);
      return { success: true, message: 'reset' };
    }
  };

  const restoreXui = replaceMethods(XuiService, {
    /** 始终返回单台服务器的测试服务实例。 */
    async getInstance() {
      return fakeXuiService;
    }
  });
  const restoreSyncRepository = replaceMethods(xuiSyncRepository, {
    /** 返回一台在线服务器以验证其内部执行顺序。 */
    async listOnlineXuiServers() {
      return [{
        id: 1,
        name: 'single-server',
        api_url: 'https://xui/1',
        api_token: 'token',
        panel_version: '3.2.5'
      }];
    },
    /** 返回每个 inbound 的预置节点凭据。 */
    async findUserNodeConfig(db, userId, serverId, inboundId) {
      return {
        uuid: `uuid-${inboundId}`,
        auth: '',
        sub_id: `sub-${inboundId}`
      };
    }
  });
  const restoreOrderRepository = replaceMethods(orderRepository, {
    /** 隔离同步状态数据库写入。 */
    async updateUserSyncStatus() {}
  });

  try {
    const result = await orderService.syncUserToXuiServers({}, {
      id: 10,
      email: 'sequence@example.com',
      enabled: 1,
      expire_at: 1702592000,
      traffic_limit: 1073741824,
      referral_traffic_limit: 0
    }, {
      reset_client_traffic: true
    });

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(events, [
      'getInbounds',
      'upsert:101',
      'reset:101',
      'upsert:102',
      'reset:102'
    ]);
  } finally {
    restoreOrderRepository();
    restoreSyncRepository();
    restoreXui();
  }
}

/**
 * 顺序运行订单同步回归测试，并让任一断言失败时以非零状态退出。
 *
 * @returns {Promise<void>}
 */
async function run() {
  await testOrderSyncLimitsServerConcurrencyAndIsolatesFailures();
  await testOrderSyncKeepsSingleServerInboundSequence();
  console.log('order xui sync tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
