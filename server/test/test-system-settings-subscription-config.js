const assert = require('assert');
const systemSettingsService = require('../services/admin/system-settings-service');

/**
 * 构造最小系统设置数据库替身。
 * get 分支模拟读取 system_settings，pool.query 分支模拟 ON CONFLICT 写入。
 *
 * @param {Object} initialSettings - 初始系统设置键值
 * @returns {Object} 测试用数据库替身
 */
function createSettingsDb(initialSettings = {}) {
  const settings = { ...initialSettings };

  return {
    settings,
    prepare(sql) {
      assert(
        sql.includes('SELECT value FROM system_settings WHERE key = ?'),
        '测试替身只支持读取 system_settings'
      );

      return {
        get(key) {
          return Object.prototype.hasOwnProperty.call(settings, key)
            ? { value: settings[key] }
            : undefined;
        }
      };
    },
    pool: {
      async query(_sql, params) {
        const [key, value] = params;
        settings[key] = value;
      }
    }
  };
}

async function testMissingTelegramChannelUrlStaysEmpty() {
  const db = createSettingsDb();
  const config = await systemSettingsService.getSubscriptionConfig(db);

  assert.strictEqual(
    config.telegram_channel_url,
    '',
    '未配置时应返回空字符串，不能用默认链接伪装成已设置'
  );
}

async function testMissingOnlineCustomerServiceUrlStaysEmpty() {
  const db = createSettingsDb();
  const config = await systemSettingsService.getSubscriptionConfig(db);

  assert.strictEqual(
    config.online_customer_service_url,
    '',
    '未配置在线客服链接时应返回空字符串，用户端据此隐藏联系我们入口'
  );
}

async function testSaveTelegramChannelUrl() {
  const db = createSettingsDb();
  await systemSettingsService.saveSubscriptionConfig(db, {
    clash_config_name: '天澜大陆',
    clash_profile_update_interval: 6,
    telegram_channel_url: 'https://t.me/customChannel'
  });

  const config = await systemSettingsService.getSubscriptionConfig(db);

  assert.strictEqual(config.telegram_channel_url, 'https://t.me/customChannel');
  assert.strictEqual(db.settings.telegram_channel_url, 'https://t.me/customChannel');
}

async function testSaveOnlineCustomerServiceUrl() {
  const db = createSettingsDb();
  await systemSettingsService.saveSubscriptionConfig(db, {
    clash_config_name: '天澜大陆',
    clash_profile_update_interval: 6,
    telegram_channel_url: '',
    online_customer_service_url: '  https://service.example.com/chat  '
  });

  const config = await systemSettingsService.getSubscriptionConfig(db);

  assert.strictEqual(config.online_customer_service_url, 'https://service.example.com/chat');
  assert.strictEqual(db.settings.online_customer_service_url, 'https://service.example.com/chat');
}

async function testEmailConfigDefaults() {
  const db = createSettingsDb();
  const config = await systemSettingsService.getEmailConfig(db);

  assert.deepStrictEqual(config, {
    api_key: '',
    sender_email: '',
    sender_name: '',
    daily_limit: 200,
    campaign_daily_limit: 100
  });
}

async function testSaveEmailConfig() {
  const db = createSettingsDb();
  await systemSettingsService.saveEmailConfig(db, {
    api_key: 'brevo-key',
    sender_email: '  noreply@example.com  ',
    sender_name: '  天涯大陆  ',
    daily_limit: 88,
    campaign_daily_limit: 44
  });

  const config = await systemSettingsService.getEmailConfig(db);

  assert.deepStrictEqual(config, {
    api_key: 'brevo-key',
    sender_email: 'noreply@example.com',
    sender_name: '天涯大陆',
    daily_limit: 88,
    campaign_daily_limit: 44
  });
  assert.strictEqual(db.settings.brevo_api_key, 'brevo-key');
  assert.strictEqual(db.settings.brevo_sender_email, 'noreply@example.com');
  assert.strictEqual(db.settings.brevo_sender_name, '天涯大陆');
  assert.strictEqual(db.settings.brevo_daily_limit, '88');
  assert.strictEqual(db.settings.brevo_campaign_daily_limit, '44');
}

async function testResourceConfigDefaults() {
  const db = createSettingsDb();
  const config = await systemSettingsService.getResourceConfig(db);

  assert.deepStrictEqual(config, {
    max_file_size: 100,
    download_speed_limit: 0
  });
}

async function testSaveResourceConfig() {
  const db = createSettingsDb();
  await systemSettingsService.saveResourceConfig(db, {
    max_file_size: 512,
    download_speed_limit: 2048
  });

  const config = await systemSettingsService.getResourceConfig(db);

  assert.deepStrictEqual(config, {
    max_file_size: 512,
    download_speed_limit: 2048
  });
  assert.strictEqual(
    db.settings.resource_config,
    JSON.stringify({ max_file_size: 512, download_speed_limit: 2048 })
  );
}

async function run() {
  await testMissingTelegramChannelUrlStaysEmpty();
  await testMissingOnlineCustomerServiceUrlStaysEmpty();
  await testSaveTelegramChannelUrl();
  await testSaveOnlineCustomerServiceUrl();
  await testEmailConfigDefaults();
  await testSaveEmailConfig();
  await testResourceConfigDefaults();
  await testSaveResourceConfig();
  console.log('✓ 系统订阅配置链接测试通过');
}

run().catch((error) => {
  console.error('✗ 系统订阅配置电报频道链接测试失败');
  console.error(error);
  process.exit(1);
});
