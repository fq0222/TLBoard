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
    download_speed_limit: 0,
    blog_video_speed_limit: 300
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
    download_speed_limit: 2048,
    blog_video_speed_limit: 300
  });
  assert.strictEqual(
    db.settings.resource_config,
    JSON.stringify({ max_file_size: 512, download_speed_limit: 2048, blog_video_speed_limit: 300 })
  );
}

/** 最低提现配置缺失或旧值不合法时默认 2000 分，不影响其他设置键。 */
async function testWithdrawalDefaults() {
  for (const value of [undefined, '', '0', '-1', '1.5', '2000x', '9007199254740992']) {
    const db = createSettingsDb(value === undefined ? {} : { minimum_withdrawal_amount: value });
    assert.deepStrictEqual(await systemSettingsService.getWithdrawalConfig(db), { minimum_withdrawal_amount: 2000 });
  }
}

/** 写入严格接收正安全整数分；无效输入不能被四舍五入、截断或覆盖为默认额。 */
async function testSaveWithdrawalConfig() {
  const db = createSettingsDb({ clash_config_name: '原名称', traffic_usage_multiplier: '2', resource_config: '{"max_file_size":128}' });
  const original = { ...db.settings };
  assert.deepStrictEqual(await systemSettingsService.saveWithdrawalConfig(db, { minimum_withdrawal_amount: 2000 }), { minimum_withdrawal_amount: 2000 });
  assert.strictEqual(db.settings.minimum_withdrawal_amount, '2000');
  for (const amount of [0, -1, 20.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '2000', null, undefined, true, {}]) {
    await assert.rejects(() => systemSettingsService.saveWithdrawalConfig(db, { minimum_withdrawal_amount: amount }), error => error.statusCode === 400);
    assert.strictEqual(db.settings.minimum_withdrawal_amount, '2000');
  }
  await systemSettingsService.saveWithdrawalConfig(db, { minimum_withdrawal_amount: Number.MAX_SAFE_INTEGER });
  assert.deepStrictEqual(await systemSettingsService.getWithdrawalConfig(db), { minimum_withdrawal_amount: Number.MAX_SAFE_INTEGER });
  const { minimum_withdrawal_amount, ...rest } = db.settings;
  assert.deepStrictEqual(rest, original);
}

async function run() {
  await testWithdrawalDefaults();
  await testSaveWithdrawalConfig();
  await testMissingTelegramChannelUrlStaysEmpty();
  await testMissingOnlineCustomerServiceUrlStaysEmpty();
  await testSaveTelegramChannelUrl();
  await testSaveOnlineCustomerServiceUrl();
  await testEmailConfigDefaults();
  await testSaveEmailConfig();
  await testResourceConfigDefaults();
  await testSaveResourceConfig();
  console.log('✓ 系统设置测试通过：10/10（含最低提现整数分、原有订阅/邮件/资源配置）');
}

run().catch((error) => {
  console.error('✗ 系统订阅配置电报频道链接测试失败');
  console.error(error);
  process.exit(1);
});
