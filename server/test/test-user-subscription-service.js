const assert = require('assert');
const subscriptionService = require('../services/user/subscription-service');
const adminUsersService = require('../services/admin/users-service');
const subscriptionRepository = require('../repositories/subscription-repository');
const userRepository = require('../repositories/user-repository');

/**
 * 构造仅覆盖订阅查询 SQL 的轻量假数据库。
 *
 * @param {Object} subscription - 预置订阅记录
 * @returns {Object} 测试用数据库对象
 */
function createFakeDb(subscription) {
  return {
    prepare(sql) {
      return {
        get(token) {
          if (sql.includes('FROM user_subscriptions') && token === subscription?.sub_id) {
            return subscription;
          }
          return undefined;
        }
      };
    }
  };
}

/**
 * 验证默认订阅输出为 Base64 文本并附带用户流量头。
 *
 * @returns {Promise<void>}
 */
async function testDefaultSubscriptionContentShouldReturnBase64AndUserinfo() {
  const subscription = {
    sub_id: 'sub-token',
    email: 'user@example.com',
    enabled: 1,
    traffic_used: 1024,
    traffic_limit: 2048,
    expire_at: 1700000000,
    nodes_data: JSON.stringify([
      {
        node_name: 'Test-Node',
        link: 'vless://11111111-1111-1111-1111-111111111111@example.com:443?encryption=none&security=tls&type=ws&host=example.com&path=%2F#Test-Node'
      }
    ])
  };

  const result = await subscriptionService.getSubscriptionContent(
    createFakeDb(subscription),
    'sub-token',
    {}
  );

  assert.strictEqual(result.contentType, 'text/plain; charset=utf-8');
  assert.strictEqual(
    result.headers['Subscription-Userinfo'],
    'upload=0; download=1024; total=2048; expire=1700000000'
  );
  assert.strictEqual(
    Buffer.from(result.body, 'base64').toString('utf8'),
    'vless://11111111-1111-1111-1111-111111111111@example.com:443?encryption=none&security=tls&type=ws&host=example.com&path=%2F#Test-Node'
  );
}

/**
 * 验证 Clash 订阅输出会正确展开 YAML 与 IPv6 地址。
 *
 * @returns {Promise<void>}
 */
async function testClashSubscriptionShouldRenderYaml() {
  const subscription = {
    sub_id: 'sub-token-2',
    email: 'user@example.com',
    enabled: 1,
    traffic_used: 0,
    traffic_limit: 0,
    expire_at: 0,
    nodes_data: JSON.stringify([
      {
        node_name: 'CF-Node',
        link: 'vless://11111111-1111-1111-1111-111111111111@[2606:4700:4700::1111]:443?encryption=none&security=tls&type=ws&host=cdn.example.com&path=%2Fws#CF-Node'
      }
    ])
  };

  const result = await subscriptionService.getSubscriptionContent(
    createFakeDb(subscription),
    'sub-token-2',
    { clash: '1' }
  );

  assert.strictEqual(result.contentType, 'text/yaml; charset=utf-8');
  assert.ok(result.body.includes('type: vless'));
  assert.ok(result.body.includes('server: 2606:4700:4700::1111'));
  assert.ok(result.body.includes('Host: cdn.example.com'));
}

/**
 * 验证禁用账号会返回旧接口业务异常。
 *
 * @returns {Promise<void>}
 */
async function testDisabledSubscriptionShouldThrowBusinessError() {
  const subscription = {
    sub_id: 'sub-token-3',
    email: 'user@example.com',
    enabled: 0,
    traffic_used: 0,
    traffic_limit: 0,
    expire_at: 0,
    nodes_data: '[]'
  };

  await assert.rejects(
    () => subscriptionService.getSubscriptionContent(
      createFakeDb(subscription),
      'sub-token-3',
      {}
    ),
    (error) => error.isLegacyBusinessError && error.code === 2003
  );
}

/**
 * 验证管理端生成订阅时复用用户端增量流程，避免重新走旧全量拉取逻辑。
 *
 * @returns {Promise<void>}
 */
async function testAdminSubscriptionShouldReuseUserIncrementalGenerator() {
  const originalGenerateSubscription = subscriptionService.generateSubscription;
  const originalFindLatestUserSubscription = subscriptionRepository.findLatestUserSubscription;
  const fakeDb = {};
  const fakeLogger = {};
  let delegatedUserId = null;

  subscriptionService.generateSubscription = async (db, userId, logger) => {
    assert.strictEqual(db, fakeDb);
    assert.strictEqual(logger, fakeLogger);
    delegatedUserId = userId;
    return 'sub-token';
  };

  subscriptionRepository.findLatestUserSubscription = async (db, userId) => {
    assert.strictEqual(db, fakeDb);
    assert.strictEqual(userId, 9);
    return {
      nodes_data: JSON.stringify([
        { node_name: 'node-a' },
        { node_name: 'node-b' }
      ])
    };
  };

  try {
    const result = await adminUsersService.generateSubscription(fakeDb, 9, fakeLogger);

    assert.strictEqual(delegatedUserId, 9);
    assert.deepStrictEqual(result, {
      sub_id: 'sub-token',
      node_count: 2
    });
  } finally {
    subscriptionService.generateSubscription = originalGenerateSubscription;
    subscriptionRepository.findLatestUserSubscription = originalFindLatestUserSubscription;
  }
}

/**
 * 验证用户 CF IP 查询只读取当前 cf_ip_pool 表真实存在的字段。
 *
 * @returns {Promise<void>}
 */
async function testUserCfIpQueriesShouldMatchCurrentSchema() {
  const fakeDb = {
    prepare(sql) {
      assert.ok(!sql.includes('cp.port'), 'SQL 不应读取不存在的 cp.port 字段');
      assert.ok(!sql.includes('cp.location'), 'SQL 不应读取不存在的 cp.location 字段');
      assert.ok(!sql.includes('port, location'), 'SQL 不应读取不存在的 port/location 字段');
      return {
        all() {
          return [];
        }
      };
    }
  };

  await userRepository.listUserCfIps(fakeDb, 1);
  await userRepository.findActiveCfIpsForUser(fakeDb, 1);
  await userRepository.findEnabledCfIpsByIds(fakeDb, [1, 2]);
}

async function run() {
  await testDefaultSubscriptionContentShouldReturnBase64AndUserinfo();
  await testClashSubscriptionShouldRenderYaml();
  await testDisabledSubscriptionShouldThrowBusinessError();
  await testAdminSubscriptionShouldReuseUserIncrementalGenerator();
  await testUserCfIpQueriesShouldMatchCurrentSchema();
  console.log('user subscription service tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
