const assert = require('assert');
const systemSettingsRouter = require('../routes/admin/system-settings');

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
  const config = await systemSettingsRouter.getSubscriptionConfig(db);

  assert.strictEqual(
    config.telegram_channel_url,
    '',
    '未配置时应返回空字符串，不能用默认链接伪装成已设置'
  );
}

async function testSaveTelegramChannelUrl() {
  const db = createSettingsDb();
  await systemSettingsRouter.saveSubscriptionConfig(db, {
    clash_config_name: '天澜大陆',
    clash_profile_update_interval: 6,
    telegram_channel_url: 'https://t.me/customChannel'
  });

  const config = await systemSettingsRouter.getSubscriptionConfig(db);

  assert.strictEqual(config.telegram_channel_url, 'https://t.me/customChannel');
  assert.strictEqual(db.settings.telegram_channel_url, 'https://t.me/customChannel');
}

async function run() {
  await testMissingTelegramChannelUrlStaysEmpty();
  await testSaveTelegramChannelUrl();
  console.log('✓ 系统订阅配置电报频道链接测试通过');
}

run().catch((error) => {
  console.error('✗ 系统订阅配置电报频道链接测试失败');
  console.error(error);
  process.exit(1);
});
