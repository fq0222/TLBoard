/**
 * 流量超限禁用补偿测试。
 * 覆盖本地已禁用用户的 3X-UI 状态补偿、hy2 节点更新路径和部分节点失败判定。
 */

const assert = require('assert');
const trafficManager = require('../services/shared/traffic-manager');
const XuiService = require('../integrations/xui/xui-service');

function createTrafficDb(options = {}) {
  const executedUpdates = [];
  const enabled = options.enabled === undefined ? 0 : options.enabled;

  return {
    executedUpdates,
    prepare(sql) {
      return {
        async get(param) {
          if (sql.includes('pg_try_advisory_lock')) {
            return { locked: true };
          }
          if (sql.includes('pg_advisory_unlock')) {
            return { unlocked: true };
          }
          if (sql.includes('system_settings') && sql.includes('traffic_usage_multiplier')) {
            return { value: '1' };
          }
          if (sql.includes('FROM users') && sql.includes('WHERE id = ?')) {
            return {
              id: Number(param),
              email: 'disabled@example.com',
              enabled,
              traffic_used: 1200,
              traffic_limit: 1000,
              referral_traffic_limit: 0,
              traffic_used_at: 1710000000
            };
          }
          if (sql.includes('SELECT email FROM users WHERE id = ?')) {
            return { email: 'disabled@example.com' };
          }
          return undefined;
        },
        async all() {
          if (sql.includes('FROM users')) {
            return [
              {
                id: 1,
                email: 'disabled@example.com',
                enabled,
                traffic_used: 1200,
                traffic_limit: 1000,
                referral_traffic_limit: 0
              }
            ];
          }
          if (sql.includes('FROM xui_servers')) {
            return [
              { id: 10, name: 'server-a', api_url: 'http://server-a', api_token: 'token-a', panel_version: '3.0.2' },
              { id: 20, name: 'server-b', api_url: 'http://server-b', api_token: 'token-b', panel_version: '3.0.2' }
            ];
          }
          return [];
        },
        async run(...params) {
          executedUpdates.push({ sql, params });
        }
      };
    },
    pool: {
      async connect() {
        return {
          async query(sql) {
            if (sql.includes('SELECT user_id, server_id, last_sync_traffic')) {
              return { rows: [] };
            }
            return { rows: [], rowCount: 0 };
          },
          release() {}
        };
      }
    }
  };
}

function installMockXuiService({ updates, failHy2 = false }) {
  const originalGetInstance = XuiService.getInstance;

  XuiService.getInstance = async (apiUrl) => ({
    async getInbounds() {
      if (apiUrl === 'http://server-a') {
        return {
          success: true,
          data: [
            {
              id: 101,
              remark: 'direct',
              protocol: 'vless',
              clientStats: [
                { email: 'disabled@example.com-direct', up: 700, down: 600 }
              ],
              settings: JSON.stringify({
                clients: [
                  { email: 'disabled@example.com-direct', enable: true }
                ]
              })
            }
          ]
        };
      }

      return {
        success: true,
        data: [
          {
            id: 201,
            remark: 'hy2',
            protocol: 'hysteria2',
            clientStats: [
              { email: 'disabled@example.com-hy2', up: 300, down: 200 }
            ],
            settings: JSON.stringify({
              clients: [
                { email: 'disabled@example.com-hy2', enable: true, auth: 'hy2-secret' }
              ]
            })
          }
        ]
      };
    },
    async updateClient(inboundId, email, options) {
      updates.push({ method: 'updateClient', apiUrl, inboundId, email, options });
      return { success: true };
    },
    async updateClientByContext(inboundId, email, options) {
      updates.push({ method: 'updateClientByContext', apiUrl, inboundId, email, options });
      if (failHy2 && email.endsWith('-hy2')) {
        return { success: false, message: 'hy2 update failed' };
      }
      return { success: true };
    }
  });

  return () => {
    XuiService.getInstance = originalGetInstance;
  };
}

async function testDisabledUserCompensatesWithContextUpdater() {
  const db = createTrafficDb();
  const updates = [];
  const restore = installMockXuiService({ updates });

  try {
    const serverTrafficData = await trafficManager.fetchAllServerTraffic(db);
    const userTrafficData = await trafficManager.calculateUserTotalTraffic(db, serverTrafficData);

    assert(userTrafficData[1], '本地已禁用用户应该参与流量计算');
    assert.strictEqual(userTrafficData[1].enabled, 0);
    assert.strictEqual(userTrafficData[1].isOverLimit, true);

    const result = await trafficManager.checkAndDisableOverLimitUsers(db, userTrafficData, serverTrafficData);

    assert.strictEqual(result.compensatedCount, 1);
    assert.strictEqual(result.retryCount, 0);
    assert.strictEqual(updates.length, 2);
    assert(updates.every(item => item.method === 'updateClientByContext'), '禁用同步必须走 updateClientByContext');
    assert.deepStrictEqual(updates.map(item => item.options.strategy), ['direct', 'hy2']);
    assert.deepStrictEqual(updates.map(item => item.options.protocol), ['vless', 'hysteria2']);
    assert.deepStrictEqual(updates.map(item => item.options.enabled), [false, false]);
    assert.strictEqual(db.executedUpdates.length, 0, '本地已禁用用户不应重复写 enabled=0');
  } finally {
    restore();
  }
}

async function testPartialXuiFailureStillDisablesLocalUser() {
  const db = createTrafficDb({ enabled: 1 });
  const updates = [];
  const restore = installMockXuiService({ updates, failHy2: true });

  try {
    const serverTrafficData = await trafficManager.fetchAllServerTraffic(db);
    const userTrafficData = await trafficManager.calculateUserTotalTraffic(db, serverTrafficData);
    const result = await trafficManager.checkAndDisableOverLimitUsers(db, userTrafficData, serverTrafficData);

    assert.strictEqual(result.disabledCount, 1, '流量超限就应该写本地 enabled=0');
    assert.strictEqual(result.retryCount, 1, '存在节点失败时仍应进入待重试计数');
    assert.strictEqual(db.executedUpdates.length, 1, '即使 3X-UI 部分失败也应写 enabled=0');
    assert(db.executedUpdates[0].sql.includes('UPDATE users SET enabled = 0'));
    assert.strictEqual(updates.length, 2);
    assert(updates.every(item => item.method === 'updateClientByContext'), '所有节点都应走 updateClientByContext');
    assert(updates.some(item => item.email.endsWith('-hy2')));
  } finally {
    restore();
  }
}

async function run() {
  await testDisabledUserCompensatesWithContextUpdater();
  await testPartialXuiFailureStillDisablesLocalUser();
  console.log('test-traffic-disabled-compensation: PASS');
}

run().catch(error => {
  console.error('test-traffic-disabled-compensation: FAIL');
  console.error(error);
  process.exitCode = 1;
});
