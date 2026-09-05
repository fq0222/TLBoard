const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const sharedEmailServicePath = path.resolve(__dirname, '../integrations/email/email-service.js');
const adminEmailServicePath = path.resolve(__dirname, '../services/admin/email-service.js');
const brevoModulePath = require.resolve('@getbrevo/brevo');
const systemSettingsServicePath = path.resolve(__dirname, '../services/admin/system-settings-service.js');
const emailRepositoryPath = path.resolve(__dirname, '../repositories/email-repository.js');
const loggerPath = path.resolve(__dirname, '../utils/logger.js');

/**
 * 保存可替换模块的 require 缓存，便于每个测试结束后恢复现场。
 *
 * @param {string[]} modulePaths - 需要保存的模块绝对路径
 * @returns {Map<string,{existed:boolean,value:Object}>} 原始缓存快照
 */
function snapshotRequireCache(modulePaths) {
  return new Map(modulePaths.map((modulePath) => [
    modulePath,
    {
      existed: Object.prototype.hasOwnProperty.call(require.cache, modulePath),
      value: require.cache[modulePath]
    }
  ]));
}

/**
 * 还原 require 缓存，避免本文件的模块替身影响其他测试。
 *
 * @param {Map<string,{existed:boolean,value:Object}>} snapshot - 缓存快照
 */
function restoreRequireCache(snapshot) {
  for (const [modulePath, entry] of snapshot.entries()) {
    if (entry.existed) {
      require.cache[modulePath] = entry.value;
    } else {
      delete require.cache[modulePath];
    }
  }
}

/**
 * 装载带 Brevo 替身的邮件服务。
 * 核心分支：可通过 sendTransacEmail 控制 SDK 成功或失败，验证重试与初始化行为。
 *
 * @param {Function} sendTransacEmail - Brevo 发送方法替身
 * @returns {{sharedEmailService:Object, adminEmailService:Object, clientConstructCount:Function}}
 */
function loadEmailServicesWithMockBrevo(sendTransacEmail) {
  let constructCount = 0;

  delete require.cache[sharedEmailServicePath];
  delete require.cache[adminEmailServicePath];
  require.cache[brevoModulePath] = {
    id: brevoModulePath,
    filename: brevoModulePath,
    loaded: true,
    exports: {
      BrevoClient: class MockBrevoClient {
        constructor() {
          constructCount += 1;
          this.transactionalEmails = { sendTransacEmail };
        }
      }
    }
  };
  require.cache[systemSettingsServicePath] = {
    id: systemSettingsServicePath,
    filename: systemSettingsServicePath,
    loaded: true,
    exports: {
      getEmailConfig: async () => ({
        api_key: 'test-api-key',
        sender_email: 'sender@example.com',
        sender_name: 'Sender',
        daily_limit: 200,
        campaign_daily_limit: 100
      }),
      saveEmailConfig: async () => ({})
    }
  };
  require.cache[emailRepositoryPath] = {
    id: emailRepositoryPath,
    filename: emailRepositoryPath,
    loaded: true,
    exports: {}
  };
  require.cache[loggerPath] = {
    id: loggerPath,
    filename: loggerPath,
    loaded: true,
    exports: {
      createLogger: () => ({
        info: () => {},
        warn: () => {},
        error: () => {}
      })
    }
  };

  return {
    sharedEmailService: require(sharedEmailServicePath),
    adminEmailService: require(adminEmailServicePath),
    clientConstructCount: () => constructCount
  };
}

test('连续发送管理端测试邮件只复用同一个 Brevo 客户端', async () => {
  const snapshot = snapshotRequireCache([
    sharedEmailServicePath,
    adminEmailServicePath,
    brevoModulePath,
    systemSettingsServicePath,
    emailRepositoryPath,
    loggerPath
  ]);

  try {
    const { adminEmailService, clientConstructCount } = loadEmailServicesWithMockBrevo(
      async () => ({ messageId: 'msg-test' })
    );

    const firstResult = await adminEmailService.sendTestEmail({}, 'first@example.com');
    const secondResult = await adminEmailService.sendTestEmail({}, 'second@example.com');

    assert.equal(firstResult.success, true);
    assert.equal(secondResult.success, true);
    assert.equal(clientConstructCount(), 1);
  } finally {
    restoreRequireCache(snapshot);
  }
});

test('fetch failed 可重试错误按 1s/2s/4s 退避后继续发送', async () => {
  const snapshot = snapshotRequireCache([
    sharedEmailServicePath,
    adminEmailServicePath,
    brevoModulePath,
    systemSettingsServicePath,
    emailRepositoryPath,
    loggerPath
  ]);

  try {
    const delays = [];
    let attempts = 0;
    const { sharedEmailService } = loadEmailServicesWithMockBrevo(async () => {
      attempts += 1;
      if (attempts < 4) {
        throw new TypeError('fetch failed');
      }
      return { messageId: 'msg-retry' };
    });

    sharedEmailService.setRetryDelayForTest(async (delayMs) => {
      delays.push(delayMs);
    });

    const result = await sharedEmailService.sendEmail({}, {
      to: 'retry@example.com',
      subject: '重试测试',
      content: '<p>retry</p>'
    });

    assert.equal(result.success, true);
    assert.equal(attempts, 4);
    assert.deepEqual(delays, [1000, 2000, 4000]);
  } finally {
    restoreRequireCache(snapshot);
  }
});
