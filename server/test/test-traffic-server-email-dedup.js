/**
 * 服务器级客户端流量去重回归测试。
 * 职责：验证同一完整 email 出现在多个 inbound 时只保留最大的一份完整流量快照。
 */

const assert = require('assert');
const XuiService = require('../integrations/xui/xui-service');
const trafficManager = require('../services/shared/traffic-manager');
const trafficUsageStatsService = require('../services/admin/traffic-usage-stats-service');

function createDb() {
  return {
    prepare(sql) {
      return {
        async all() {
          if (sql.includes('FROM xui_servers')) {
            return [{
              id: 2,
              name: 'server-a',
              api_url: 'https://server-a.example.com',
              api_token: 'token-a',
              panel_version: '3.6.0'
            }];
          }
          return [];
        }
      };
    }
  };
}

async function testSameEmailAcrossInboundsKeepsLargestCompleteSnapshot() {
  const originalGetInstance = XuiService.getInstance;
  let getInboundsCallCount = 0;
  XuiService.getInstance = async () => ({
    async getInbounds() {
      getInboundsCallCount++;
      return {
        success: true,
        data: [
          {
            id: 2,
            remark: 'cf',
            protocol: 'vless',
            settings: JSON.stringify({ clients: [{ email: 'user@example.com', enable: true }] }),
            clientStats: [{ email: 'user@example.com', up: 400, down: 600, enable: true }]
          },
          {
            id: 3,
            remark: 'hy2',
            protocol: 'hysteria',
            settings: JSON.stringify({ clients: [{ email: 'user@example.com', enable: true }] }),
            clientStats: [{ email: 'user@example.com', up: 300, down: 900, enable: true }]
          },
          {
            id: 4,
            remark: 'direct',
            protocol: 'vless',
            settings: JSON.stringify({ clients: [{ email: 'user@example.com', enable: true }] }),
            clientStats: [{ email: 'user@example.com', up: 300, down: 900, enable: true }]
          }
        ]
      };
    }
  });

  try {
    const result = await trafficManager.fetchAllServerTraffic(createDb());

    assert.strictEqual(getInboundsCallCount, 1);
    assert.deepStrictEqual(result[2]['user@example.com'], {
      up: 300,
      down: 900,
      total: 1200,
      enabled: true,
      enabledKnown: true,
      inboundIds: [2, 3, 4],
      inboundId: 3,
      selectedInboundId: 3,
      protocol: 'hysteria',
      strategy: 'hy2'
    });
  } finally {
    XuiService.getInstance = originalGetInstance;
  }
}

function createCalculationDb() {
  return {
    prepare(sql) {
      return {
        async get() {
          if (sql.includes('traffic_usage_multiplier')) {
            return { value: '1' };
          }
          return undefined;
        },
        async all() {
          if (sql.includes('FROM users')) {
            return [{
              id: 1,
              email: 'user@example.com',
              enabled: 1,
              traffic_used: 1000,
              traffic_limit: 10000
            }];
          }
          if (sql.includes('FROM xui_servers')) {
            return [{ id: 2, name: 'server-a' }];
          }
          return [];
        }
      };
    },
    pool: {
      async connect() {
        return {
          async query(sql) {
            if (sql.includes('SELECT user_id, server_id, last_sync_traffic')) {
              return { rows: [{ user_id: 1, server_id: 2, last_sync_traffic: 100 }] };
            }
            return { rows: [], rowCount: 0 };
          },
          release() {}
        };
      }
    }
  };
}

async function testTrafficCalculationUsesExactEmailOnly() {
  const result = await trafficManager.calculateUserTotalTraffic(createCalculationDb(), {
    2: {
      'user@example.com': { total: 300 },
      'user@example.com-cf': { total: 900 }
    }
  });

  assert.strictEqual(result[1].increment, 200);
  assert.strictEqual(result[1].trafficUsed, 1200);
}

async function testTrafficCalculationAddsIndependentServerIncrements() {
  const db = createCalculationDb();
  db.prepare = (sql) => ({
    async get() {
      if (sql.includes('traffic_usage_multiplier')) {
        return { value: '1' };
      }
      return undefined;
    },
    async all() {
      if (sql.includes('FROM users')) {
        return [{
          id: 1,
          email: 'user@example.com',
          enabled: 1,
          traffic_used: 1000,
          traffic_limit: 10000
        }];
      }
      if (sql.includes('FROM xui_servers')) {
        return [{ id: 2, name: 'server-a' }, { id: 3, name: 'server-b' }];
      }
      return [];
    }
  });
  db.pool.connect = async () => ({
    async query(sql) {
      if (sql.includes('SELECT user_id, server_id, last_sync_traffic')) {
        return {
          rows: [
            { user_id: 1, server_id: 2, last_sync_traffic: 100 },
            { user_id: 1, server_id: 3, last_sync_traffic: 400 }
          ]
        };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {}
  });

  const result = await trafficManager.calculateUserTotalTraffic(db, {
    2: { 'user@example.com': { total: 300 } },
    3: { 'user@example.com': { total: 700 } }
  });

  assert.strictEqual(result[1].increment, 500);
  assert.strictEqual(result[1].trafficUsed, 1500);
}

function testAdminSnapshotUsesExactEmailOnly() {
  const snapshot = trafficUsageStatsService.buildCurrentTrafficUsageSnapshot({
    serverTrafficData: {
      2: {
        'user@example.com': { total: 300 },
        'user@example.com-cf': { total: 900 }
      }
    },
    users: [{ id: 1, email: 'user@example.com' }],
    syncLogMap: new Map([['1-2', 100]]),
    serversById: new Map([['2', { id: 2, name: 'server-a' }]]),
    multiplier: 1,
    syncAt: 123456
  });

  assert.deepStrictEqual(snapshot[0].users, [
    { userId: 1, email: 'user@example.com', traffic: 200 }
  ]);
}

async function run() {
  await testSameEmailAcrossInboundsKeepsLargestCompleteSnapshot();
  await testTrafficCalculationUsesExactEmailOnly();
  await testTrafficCalculationAddsIndependentServerIncrements();
  testAdminSnapshotUsesExactEmailOnly();
  console.log('test-traffic-server-email-dedup: PASS');
}

run().catch((error) => {
  console.error('test-traffic-server-email-dedup: FAIL');
  console.error(error);
  process.exitCode = 1;
});
