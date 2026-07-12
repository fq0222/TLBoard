const assert = require('assert');
const subscriptionService = require('../services/user/subscription-service');
const adminUsersService = require('../services/admin/users-service');
const systemSettingsRouter = require('../routes/admin/system-settings');
const subscriptionRepository = require('../repositories/subscription-repository');
const userRepository = require('../repositories/user-repository');

/**
 * 构造仅覆盖订阅查询 SQL 的轻量假数据库。
 *
 * @param {Object} subscription - 预置订阅记录
 * @returns {Object} 测试用数据库对象
 */
function createFakeDb(subscription, settings = {}) {
  return {
    prepare(sql) {
      return {
        all() {
          if (sql.includes('FROM announcements')) {
            return [];
          }
          throw new Error(`未支持的 all 查询: ${sql}`);
        },
        get(param) {
          if (sql.includes('FROM system_settings')) {
            return settings[param] === undefined ? undefined : { value: settings[param] };
          }

          const token = param;
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
 * 构造仅覆盖订阅配置读写的轻量系统设置数据库。
 *
 * @param {Object} initialSettings - 初始系统设置
 * @returns {{db:Object,writes:Array}} 假数据库与写入记录
 */
function createSystemSettingsFakeDb(initialSettings = {}) {
  const settings = { ...initialSettings };
  const writes = [];

  return {
    writes,
    db: {
      prepare(sql) {
        return {
          get(key) {
            if (sql.includes('FROM system_settings')) {
              return settings[key] === undefined ? undefined : { value: settings[key] };
            }
            return undefined;
          }
        };
      },
      pool: {
        async query(sql, params) {
          writes.push({ sql, params });
          settings[params[0]] = params[1];
          return { rows: [], rowCount: 1 };
        }
      }
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
  assert.strictEqual(
    result.headers['Subscription-Userinfo'],
    'upload=0; download=0; total=0; expire=0'
  );
  assert.strictEqual(
    result.headers['Content-Disposition'],
    `attachment; filename*=UTF-8''${encodeURIComponent('天澜大陆')}`
  );
  assert.strictEqual(result.headers['Profile-Update-Interval'], '2');
  assert.ok(result.body.includes('type: vless'));
  assert.ok(result.body.includes('server: 2606:4700:4700::1111'));
  assert.ok(result.body.includes('Host: cdn.example.com'));
}

/**
 * 验证 Clash 订阅响应头会优先使用系统设置中的订阅配置。
 *
 * @returns {Promise<void>}
 */
async function testClashSubscriptionShouldUseSystemSettingsHeaders() {
  const subscription = {
    sub_id: 'sub-token-settings',
    email: 'user@example.com',
    enabled: 1,
    traffic_used: 1024,
    traffic_limit: 2048,
    expire_at: 1700000000,
    nodes_data: '[]'
  };

  const result = await subscriptionService.getSubscriptionContent(
    createFakeDb(subscription, {
      clash_config_name: '自定义订阅',
      clash_profile_update_interval: '6'
    }),
    'sub-token-settings',
    { clash: '1' }
  );

  assert.strictEqual(
    result.headers['Content-Disposition'],
    `attachment; filename*=UTF-8''${encodeURIComponent('自定义订阅')}`
  );
  assert.strictEqual(result.headers['Profile-Update-Interval'], '6');
  assert.strictEqual(
    result.headers['Subscription-Userinfo'],
    'upload=0; download=1024; total=2048; expire=1700000000'
  );
}

/**
 * 验证订阅响应头只使用当前套餐流量，不再叠加历史推广流量字段。
 *
 * @returns {Promise<void>}
 */
async function testSubscriptionHeaderShouldIgnoreReferralTrafficLimit() {
  const subscription = {
    sub_id: 'sub-token-referral-traffic',
    email: 'user@example.com',
    enabled: 1,
    traffic_used: 1024,
    traffic_limit: 2048,
    referral_traffic_limit: 4096,
    expire_at: 1700000000,
    nodes_data: '[]'
  };

  const result = await subscriptionService.getSubscriptionContent(
    createFakeDb(subscription),
    'sub-token-referral-traffic',
    {}
  );

  assert.strictEqual(
    result.headers['Subscription-Userinfo'],
    'upload=0; download=1024; total=2048; expire=1700000000'
  );
}

/**
 * 验证订阅配置缺失时管理端设置接口返回默认值。
 *
 * @returns {Promise<void>}
 */
async function testSystemSettingsSubscriptionDefaults() {
  const { db } = createSystemSettingsFakeDb();
  const config = await systemSettingsRouter.getSubscriptionConfig(db);

  assert.deepStrictEqual(config, {
    clash_config_name: '天涯大陆',
    clash_profile_update_interval: 2,
    telegram_channel_url: '',
    online_customer_service_url: ''
  });
}

/**
 * 验证保存订阅配置会写入两个系统设置键。
 *
 * @returns {Promise<void>}
 */
async function testSystemSettingsSubscriptionSave() {
  const { db, writes } = createSystemSettingsFakeDb();
  await systemSettingsRouter.saveSubscriptionConfig(db, {
    clash_config_name: '自定义订阅',
    clash_profile_update_interval: 6,
    telegram_channel_url: 'https://t.me/customChannel',
    online_customer_service_url: 'https://service.example.com/chat'
  });

  assert.strictEqual(writes.length, 4);
  assert.strictEqual(writes[0].params[0], 'clash_config_name');
  assert.strictEqual(writes[0].params[1], '自定义订阅');
  assert.strictEqual(writes[1].params[0], 'clash_profile_update_interval');
  assert.strictEqual(writes[1].params[1], '6');
  assert.strictEqual(writes[2].params[0], 'telegram_channel_url');
  assert.strictEqual(writes[2].params[1], 'https://t.me/customChannel');
  assert.strictEqual(writes[3].params[0], 'online_customer_service_url');
  assert.strictEqual(writes[3].params[1], 'https://service.example.com/chat');
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
    (error) => (
      error.isLegacyBusinessError
      && error.code === 2003
      && error.message === '账号 user@example.com 已被禁用'
    )
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
 * 验证仅完成 CF 优选但尚未生成订阅时，不会提前暴露节点结果。
 *
 * @returns {Promise<void>}
 */
async function testSubscriptionInfoShouldHideNodesBeforeFirstGeneration() {
  const originals = {
    findSubscriptionUserById: subscriptionRepository.findSubscriptionUserById,
    findLatestUserSubscription: subscriptionRepository.findLatestUserSubscription,
    listEnabledUserCfIps: subscriptionRepository.listEnabledUserCfIps,
    listOnlineServersForDisplay: subscriptionRepository.listOnlineServersForDisplay
  };

  subscriptionRepository.findSubscriptionUserById = async () => ({
    id: 1,
    email: 'new-user@example.com',
    sub_id: 'new-user-sub-id',
    enabled: 1,
    traffic_used: 0,
    traffic_limit: 1024,
    referral_traffic_limit: 0,
    expire_at: 0
  });
  subscriptionRepository.findLatestUserSubscription = async () => undefined;
  subscriptionRepository.listEnabledUserCfIps = async () => [{ ip: '1.1.1.1' }];
  subscriptionRepository.listOnlineServersForDisplay = async () => {
    throw new Error('未生成订阅时不应查询节点');
  };

  try {
    const result = await subscriptionService.getSubscriptionInfo({}, 1);

    assert.strictEqual(result.cfOptimized, true);
    assert.strictEqual(result.subscriptionReady, false);
    assert.deepStrictEqual(result.nodes, []);
  } finally {
    Object.assign(subscriptionRepository, originals);
  }
}

/**
 * 验证公开订阅链接使用 32 位十六进制 ID，避免新用户继续拿到旧的 16 位链接。
 *
 * @returns {Promise<void>}
 */
async function testPublicSubscriptionIdShouldUse32HexChars() {
  const subId = subscriptionService.generatePublicSubscriptionId();

  assert.match(subId, /^[0-9a-f]{32}$/);
}

/**
 * 验证更换订阅链接只替换用户级 sub_id 并复用现有节点缓存，不触发全量订阅生成。
 *
 * @returns {Promise<void>}
 */
async function testReplaceSubscriptionLinkShouldInvalidateOldCacheAndRegenerate() {
  const originals = {
    findSubscriptionUserById: subscriptionRepository.findSubscriptionUserById,
    findLatestUserSubscription: subscriptionRepository.findLatestUserSubscription,
    replaceUserSubscriptionId: subscriptionRepository.replaceUserSubscriptionId,
    deleteUserSubscriptionCaches: subscriptionRepository.deleteUserSubscriptionCaches,
    saveUserSubscriptionCache: subscriptionRepository.saveUserSubscriptionCache
  };
  const calls = [];
  const logs = [];
  const nodes = [{ node_name: 'node-a', link: 'vless://node-a' }];

  subscriptionRepository.findSubscriptionUserById = async () => ({
    id: 7,
    email: 'replace@example.com',
    sub_id: 'old-sub-id',
    enabled: 1,
    traffic_used: 0,
    traffic_limit: 1024,
    referral_traffic_limit: 0,
    expire_at: 0
  });
  subscriptionRepository.findLatestUserSubscription = async (db, userId) => {
    calls.push(['findLatestUserSubscription', db, userId]);
    return {
      nodes_data: JSON.stringify(nodes)
    };
  };
  subscriptionRepository.replaceUserSubscriptionId = async (db, userId, subId) => {
    calls.push(['replaceUserSubscriptionId', db, userId, subId]);
  };
  subscriptionRepository.deleteUserSubscriptionCaches = async (db, userId) => {
    calls.push(['deleteUserSubscriptionCaches', db, userId]);
  };
  subscriptionRepository.saveUserSubscriptionCache = async (db, userId, subId, savedNodes) => {
    calls.push(['saveUserSubscriptionCache', db, userId, subId, savedNodes]);
  };

  try {
    const db = { name: 'fake-db' };
    const logger = {
      info(message) {
        logs.push(message);
      }
    };
    const result = await subscriptionService.replaceSubscriptionLink(db, 7, logger, {
      dependencies: {
        generatePublicSubscriptionId: () => '1234567890abcdef1234567890abcdef',
        generateSubscription: async () => {
          throw new Error('更换订阅链接不应触发全量订阅生成');
        }
      }
    });

    assert.strictEqual(result, '1234567890abcdef1234567890abcdef');
    assert.deepStrictEqual(calls, [
      ['findLatestUserSubscription', db, 7],
      ['replaceUserSubscriptionId', db, 7, '1234567890abcdef1234567890abcdef'],
      ['deleteUserSubscriptionCaches', db, 7],
      ['saveUserSubscriptionCache', db, 7, '1234567890abcdef1234567890abcdef', nodes]
    ]);
    assert.deepStrictEqual(logs, [
      '用户 replace@example.com 更换订阅链接成功，复用 1 个本地节点缓存'
    ]);
  } finally {
    Object.assign(subscriptionRepository, originals);
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
  await testClashSubscriptionShouldUseSystemSettingsHeaders();
  await testSubscriptionHeaderShouldIgnoreReferralTrafficLimit();
  await testSystemSettingsSubscriptionDefaults();
  await testSystemSettingsSubscriptionSave();
  await testDisabledSubscriptionShouldThrowBusinessError();
  await testAdminSubscriptionShouldReuseUserIncrementalGenerator();
  await testSubscriptionInfoShouldHideNodesBeforeFirstGeneration();
  await testPublicSubscriptionIdShouldUse32HexChars();
  await testReplaceSubscriptionLinkShouldInvalidateOldCacheAndRegenerate();
  await testUserCfIpQueriesShouldMatchCurrentSchema();
  console.log('user subscription service tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
