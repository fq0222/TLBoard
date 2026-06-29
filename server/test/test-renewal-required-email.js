const assert = require('assert');
const path = require('path');

const servicePath = path.resolve(__dirname, '../services/shared/renewal-required-email-service.js');
const activationServicePath = path.resolve(__dirname, '../services/shared/order-activation-email-service.js');
const sharedEmailServicePath = path.resolve(__dirname, '../integrations/email/email-service.js');
const emailRepositoryPath = path.resolve(__dirname, '../repositories/email-repository.js');
const loggerPath = path.resolve(__dirname, '../utils/logger.js');
const siteUrlPath = path.resolve(__dirname, '../utils/site-url.js');
const mockedModulePaths = [
  servicePath,
  activationServicePath,
  sharedEmailServicePath,
  emailRepositoryPath,
  loggerPath,
  siteUrlPath
];

/**
 * 快照模块缓存，供测试结束后完整恢复。
 * @returns {Map<string, {existed:boolean,value:Object|undefined}>} 缓存快照
 */
function snapshotRequireCache() {
  return new Map(mockedModulePaths.map((modulePath) => [
    modulePath,
    {
      existed: Object.prototype.hasOwnProperty.call(require.cache, modulePath),
      value: require.cache[modulePath]
    }
  ]));
}

/**
 * 恢复测试前的模块缓存，避免依赖桩污染同进程后续测试。
 * @param {Map<string, {existed:boolean,value:Object|undefined}>} snapshot - 缓存快照
 */
function restoreRequireCache(snapshot) {
  for (const [modulePath, entry] of snapshot) {
    delete require.cache[modulePath];
    if (entry.existed) {
      require.cache[modulePath] = entry.value;
    }
  }
}

/**
 * 使用隔离依赖加载续费提醒服务。
 * @param {Object} overrides - 邮件、仓储与配额依赖桩。
 * @returns {Object} 待测服务导出。
 */
function loadService(overrides = {}) {
  delete require.cache[servicePath];
  require.cache[activationServicePath] = {
    id: activationServicePath,
    filename: activationServicePath,
    loaded: true,
    exports: {
      checkDailyEmailQuota: overrides.checkDailyEmailQuota || (async () => ({
        allowed: true,
        todayCount: 0,
        dailyLimit: 200
      })),
      formatTraffic: (value) => `${Number(value) / 1024 / 1024 / 1024} GB`,
      formatExpireAt: (value) => `到期-${value}`,
      getUsernameFromEmail: (email) => String(email).split('@')[0]
    }
  };
  require.cache[sharedEmailServicePath] = {
    id: sharedEmailServicePath,
    filename: sharedEmailServicePath,
    loaded: true,
    exports: {
      sendEmail: overrides.sendEmail || (async () => ({ success: true }))
    }
  };
  require.cache[emailRepositoryPath] = {
    id: emailRepositoryPath,
    filename: emailRepositoryPath,
    loaded: true,
    exports: {
      findEmailUserProfileById: overrides.findProfile || (async () => ({
        email: 'demo@example.com',
        plan_name: '星河套餐',
        traffic_used: 5 * 1024 ** 3,
        traffic_limit: 10 * 1024 ** 3,
        expire_at: 1900000000
      })),
      createEmailLog: overrides.createEmailLog || (async () => {})
    }
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
  require.cache[siteUrlPath] = {
    id: siteUrlPath,
    filename: siteUrlPath,
    loaded: true,
    exports: {
      getUserAppBaseUrl: () => 'https://example.com/user?from=email&next="renew"'
    }
  };
  return require(servicePath);
}

async function runAssertions() {
  const service = loadService();
  const undefinedPayload = await service.sendRenewalRequiredEmail({}, undefined);
  assert.deepStrictEqual(undefinedPayload, { sent: false, status: 'invalid_request' });
  const nullPayload = await service.sendRenewalRequiredEmail({}, null);
  assert.deepStrictEqual(nullPayload, { sent: false, status: 'invalid_request' });
  assert.strictEqual(
    service.buildRenewalRequiredEmailSubject('demo@example.com'),
    '【天澜大陆消息】亲爱的 demo，您的魔法传送能量已经耗尽！'
  );

  const unsafeProfile = {
    email: 'demo<script>@example.com',
    plan_name: '<星河&套餐>',
    traffic_used: 5 * 1024 ** 3,
    traffic_limit: 10 * 1024 ** 3,
    expire_at: 1900000000
  };
  const trafficHtml = service.buildRenewalRequiredEmailContent(unsafeProfile, 'traffic_limit');
  assert.match(trafficHtml, /魔法传送能量已经耗尽/);
  assert.match(trafficHtml, /background:#f0fdf4|background-color:#f0fdf4/);
  assert.match(trafficHtml, /用户中心/);
  assert.match(trafficHtml, /账号/);
  assert.match(trafficHtml, /套餐/);
  assert.match(trafficHtml, /已用流量/);
  assert.match(trafficHtml, /流量上限/);
  assert.match(trafficHtml, /到期时间/);
  assert.match(trafficHtml, /demo&lt;script&gt;@example\.com/);
  assert.match(trafficHtml, /5 GB/);
  assert.match(trafficHtml, /10 GB/);
  assert.match(trafficHtml, /到期-1900000000/);
  assert.match(trafficHtml, /href="https:\/\/example\.com\/user\?from=email&amp;next=&quot;renew&quot;"/);
  assert.ok(!trafficHtml.includes('<script>'));
  assert.ok(trafficHtml.includes('&lt;星河&amp;套餐&gt;'));

  const expiredHtml = service.buildRenewalRequiredEmailContent(unsafeProfile, 'expired');
  assert.match(expiredHtml, /限时套餐已经到期/);
  assert.throws(
    () => service.buildRenewalRequiredEmailContent(unsafeProfile, 'unknown'),
    /reason/
  );

  let sendCount = 0;
  let logCount = 0;
  let queriedUserId = null;
  let sentPayload = null;
  const sendingService = loadService({
    findProfile: async (_db, userId) => {
      queriedUserId = userId;
      return unsafeProfile;
    },
    sendEmail: async (_db, payload) => {
      sendCount += 1;
      sentPayload = payload;
      return { success: true };
    },
    createEmailLog: async (_db, payload) => {
      logCount += 1;
      assert.strictEqual(payload.userId, 42);
      assert.strictEqual(payload.status, 'sent');
    }
  });
  const success = await sendingService.sendRenewalRequiredEmail({}, {
    userId: 42,
    reason: 'traffic_limit'
  });
  assert.deepStrictEqual(success, { sent: true, status: 'email_sent' });
  assert.strictEqual(queriedUserId, 42);
  assert.strictEqual(sendCount, 1);
  assert.strictEqual(logCount, 1);
  assert.strictEqual(sentPayload.to, unsafeProfile.email);
  assert.ok(!sentPayload.subject.includes('{{username}}'));
  assert.match(sentPayload.subject, /demo<script>/);

  let resolveLateSend;
  logCount = 0;
  const timeoutService = loadService({
    sendEmail: async () => new Promise((resolve) => {
      resolveLateSend = resolve;
    }),
    createEmailLog: async () => {
      logCount += 1;
    }
  });
  const timeoutStartedAt = Date.now();
  const timeoutResult = await Promise.race([
    timeoutService.sendRenewalRequiredEmail(
      {},
      { userId: 43, reason: 'traffic_limit' },
      { sendTimeoutMs: 5 }
    ),
    new Promise((resolve) => setTimeout(
      () => resolve({ sent: false, status: 'test_watchdog_timeout' }),
      50
    ))
  ]);
  const timeoutElapsed = Date.now() - timeoutStartedAt;
  assert.deepStrictEqual(timeoutResult, { sent: false, status: 'email_send_timeout' });
  assert.ok(timeoutElapsed < 100, `超时应及时返回，实际耗时 ${timeoutElapsed}ms`);
  assert.strictEqual(logCount, 0);

  resolveLateSend({ success: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(logCount, 0, '底层晚完成后不得补写成功日志');

  sendCount = 0;
  const quotaService = loadService({
    checkDailyEmailQuota: async () => ({ allowed: false, todayCount: 200, dailyLimit: 200 }),
    sendEmail: async () => {
      sendCount += 1;
      return { success: true };
    }
  });
  const quotaResult = await quotaService.sendRenewalRequiredEmail({}, {
    userId: 7,
    reason: 'expired'
  });
  assert.deepStrictEqual(quotaResult, { sent: false, status: 'daily_email_limit_reached' });
  assert.strictEqual(sendCount, 0);

  for (const failure of [
    async () => ({ success: false, error: '配置缺失' }),
    async () => {
      throw new Error('网络异常');
    }
  ]) {
    logCount = 0;
    sendCount = 0;
    const failureService = loadService({
      sendEmail: async (...args) => {
        sendCount += 1;
        return failure(...args);
      },
      createEmailLog: async () => {
        logCount += 1;
      }
    });
    const result = await failureService.sendRenewalRequiredEmail({}, {
      userId: 9,
      reason: 'expired'
    });
    assert.strictEqual(result.sent, false);
    assert.ok(['email_send_failed', 'email_error'].includes(result.status));
    assert.strictEqual(sendCount, 1);
    assert.strictEqual(logCount, 0);
  }

  let quotaCheckCount = 0;
  sendCount = 0;
  const quotaErrorService = loadService({
    checkDailyEmailQuota: async () => {
      quotaCheckCount += 1;
      throw new Error('配额查询异常');
    },
    sendEmail: async () => {
      sendCount += 1;
      return { success: true };
    }
  });
  const quotaError = await quotaErrorService.sendRenewalRequiredEmail({}, {
    userId: 10,
    reason: 'expired'
  });
  assert.strictEqual(quotaError.status, 'email_error');
  assert.strictEqual(quotaCheckCount, 1);
  assert.strictEqual(sendCount, 0);

  let profileQueryCount = 0;
  sendCount = 0;
  const profileErrorService = loadService({
    findProfile: async () => {
      profileQueryCount += 1;
      throw new Error('资料查询异常');
    },
    sendEmail: async () => {
      sendCount += 1;
      return { success: true };
    }
  });
  const profileError = await profileErrorService.sendRenewalRequiredEmail({}, {
    userId: 11,
    reason: 'traffic_limit'
  });
  assert.strictEqual(profileError.status, 'email_error');
  assert.strictEqual(profileQueryCount, 1);
  assert.strictEqual(sendCount, 0);

  sendCount = 0;
  logCount = 0;
  const logErrorService = loadService({
    sendEmail: async () => {
      sendCount += 1;
      return { success: true };
    },
    createEmailLog: async () => {
      logCount += 1;
      throw new Error('日志写入异常');
    }
  });
  const logError = await logErrorService.sendRenewalRequiredEmail({}, {
    userId: 12,
    reason: 'expired'
  });
  assert.strictEqual(logError.sent, true);
  assert.strictEqual(logError.status, 'email_sent_log_failed');
  assert.match(logError.error, /日志写入异常/);
  assert.strictEqual(sendCount, 1);
  assert.strictEqual(logCount, 1);

  console.log('PASS: 续费提醒主题、正文、转义、配额及发送审计测试通过');
}

async function run() {
  const cacheSnapshot = snapshotRequireCache();
  try {
    await runAssertions();
  } finally {
    restoreRequireCache(cacheSnapshot);
  }
}

run().catch((error) => {
  console.error('FAIL:', error);
  process.exit(1);
});
