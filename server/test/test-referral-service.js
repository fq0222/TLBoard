const assert = require('assert');
const { validationResult } = require('express-validator');
const referralRepository = require('../repositories/referral-repository');
const referralService = require('../services/referral-service');
const userRepository = require('../repositories/user-repository');
const orderRepository = require('../repositories/order-repository');
const authService = require('../services/user/auth-service');
const renewService = require('../services/user/renew-service');
const authRouter = require('../routes/user/auth');
const orderService = require('../services/shared/order-service');
const vmqService = require('../integrations/vmq/vmq-service');
const xuiSyncTaskService = require('../integrations/xui/xui-sync-task-service');
const sharedEmailService = require('../integrations/email/email-service');
const emailRepository = require('../repositories/email-repository');
const systemSettingsService = require('../services/admin/system-settings-service');
const orderActivationEmailService = require('../services/shared/order-activation-email-service');
const config = require('../config');

/**
 * Builds a PostgreSQL-style referral_codes.code duplicate error for retry tests.
 *
 * Responsibility: provide a stable database error shape without touching a real database.
 * Key params: none; the returned Error includes code, constraint, and message fields.
 * Branches: no runtime branching, callers decide how the simulated error is handled.
 *
 * @returns {Error} Duplicate code error
 */
function createDuplicateCodeError() {
  const error = new Error('duplicate key value violates unique constraint "referral_codes_code_key"');
  error.code = '23505';
  error.constraint = 'referral_codes_code_key';
  return error;
}

/**
 * Builds a PostgreSQL-style referral_codes.user_id duplicate error for retry guard tests.
 *
 * Responsibility: distinguish user_id uniqueness failures from random code collisions.
 * Key params: none; returned Error points at the referral_codes_user_id_key constraint.
 * Branches: no runtime branching, callers assert it is rethrown without retry.
 *
 * @returns {Error} Duplicate user referral code ownership error
 */
function createDuplicateReferralUserError() {
  const error = new Error('duplicate key value violates unique constraint "referral_codes_user_id_key"');
  error.code = '23505';
  error.constraint = 'referral_codes_user_id_key';
  return error;
}

/**
 * Builds a PostgreSQL-style unique conflict that is unrelated to referral_codes.code.
 *
 * Responsibility: prove retry guards do not swallow other database uniqueness failures.
 * Key params: none; callers compare the exact Error instance after rejection.
 * Branches: no runtime branching, the error shape always points at users.email.
 *
 * @returns {Error} Unrelated unique conflict error
 */
function createUnrelatedUniqueConflictError() {
  const error = new Error('duplicate key value violates unique constraint "users_email_key"');
  error.code = '23505';
  error.constraint = 'users_email_key';
  return error;
}

/**
 * Asserts an async operation rejects with the same Error object.
 *
 * Responsibility: keep tests strict about preserving the original database error.
 * Key params: action is the async call under test, expectedError is the exact thrown instance.
 * Branches: failing to throw or throwing a different object both fail the test.
 *
 * @param {Function} action - Async operation expected to reject
 * @param {Error} expectedError - Exact Error instance expected
 * @returns {Promise<void>}
 */
async function assertRejectsSameError(action, expectedError) {
  let actualError = null;

  try {
    await action();
  } catch (error) {
    actualError = error;
  }

  assert.strictEqual(actualError, expectedError);
}

/**
 * 临时替换 referral repository 方法，并在测试结束后恢复。
 *
 * 职责：让测试真实加载 service，同时隔离数据库访问。
 * 关键参数：overrides 为要替换的 repository 方法集合。
 * 核心分支：无论测试成功或失败，finally 都恢复原始方法，避免测试间串扰。
 *
 * @param {Object} overrides - repository 方法替身
 * @param {Function} runTest - 使用替身执行的测试函数
 * @returns {Promise<void>}
 */
async function withRepositoryMocks(overrides, runTest) {
  const originals = {};

  for (const [name, mock] of Object.entries(overrides)) {
    originals[name] = referralRepository[name];
    referralRepository[name] = mock;
  }

  try {
    await runTest();
  } finally {
    for (const [name, original] of Object.entries(originals)) {
      referralRepository[name] = original;
    }
  }
}

/**
 * 临时替换任意模块方法，并在测试结束后恢复。
 *
 * 职责：让跨 service 测试可以隔离数据库、支付网关和异步同步队列。
 * 关键参数：target 为要替换的模块对象，overrides 为方法名到 mock 的映射。
 * 核心分支：无论测试成功或失败，finally 都恢复原方法，避免影响后续用例。
 *
 * @param {Object} target - 被替换方法所在模块
 * @param {Object} overrides - mock 方法集合
 * @param {Function} runTest - 使用 mock 执行的测试函数
 * @returns {Promise<void>}
 */
async function withObjectMocks(target, overrides, runTest) {
  const originals = {};

  for (const [name, mock] of Object.entries(overrides)) {
    originals[name] = target[name];
    target[name] = mock;
  }

  try {
    await runTest();
  } finally {
    for (const [name, original] of Object.entries(originals)) {
      target[name] = original;
    }
  }
}

/**
 * 构造支持 better-sqlite3 风格 transaction 的假数据库。
 *
 * 职责：验证 service 是否把事务回调拿到的 transactionDb 继续传给下游。
 * 关键参数：transactionDb 为回调内应使用的数据库替身。
 * 核心分支：transaction 返回的函数执行时调用原回调，模拟真实事务包装。
 *
 * @param {Object} transactionDb - 事务内数据库替身
 * @returns {Object} 假数据库
 */
function createTransactionDb(transactionDb) {
  return {
    transaction(callback) {
      return () => callback(transactionDb);
    }
  };
}

/**
 * 构造请求对象替身，用于验证推广链接生成。
 *
 * 职责：提供 service.buildReferralLink 需要的 protocol 与 get('host')。
 * 关键参数：protocol 与 host 分别模拟 Express 请求中的协议和域名。
 * 核心分支：仅 host 查询返回域名，其他 header 返回 undefined。
 *
 * @param {string} protocol - 请求协议
 * @param {string} host - 请求域名
 * @returns {Object} Express 请求替身
 */
function createReq(protocol = 'https', host = 'example.com') {
  return {
    protocol,
    get(name) {
      return String(name).toLowerCase() === 'host' ? host : undefined;
    }
  };
}

/**
 * Executes an Express middleware and waits for callback or returned Promise completion.
 *
 * Responsibility: let tests run validator chains without booting an HTTP server.
 * Key params: middleware is a route stack handler, req carries the request-like payload under test.
 * Branches: supports sync middleware, Promise-returning middleware, and next-callback middleware.
 *
 * @param {Function} middleware - Express-compatible middleware
 * @param {Object} req - Request-like object for validator execution
 * @returns {Promise<void>}
 */
function runMiddleware(middleware, req) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    try {
      const result = middleware(req, {}, finish);
      if (result && typeof result.then === 'function') {
        result.then(() => finish(), finish);
      }
    } catch (error) {
      finish(error);
    }
  });
}

/**
 * 验证有效推广码能解析出推广人用户 ID。
 *
 * @returns {Promise<void>}
 */
async function testResolveReferrerReturnsUserIdForEnabledCode() {
  await withRepositoryMocks({
    findEnabledReferralCode: async () => ({
      user_id: 12,
      email: 'referrer@example.com',
      enabled: 1
    })
  }, async () => {
    const result = await referralService.resolveReferrerByCode({}, 'ABC123', 'new@example.com');
    assert.strictEqual(result, 12);
  });
}

/**
 * 验证禁用、不存在、自己推广自己都会被解析为空。
 *
 * @returns {Promise<void>}
 */
async function testResolveReferrerRejectsInvalidOrSelfReferral() {
  await withRepositoryMocks({
    findEnabledReferralCode: async () => null
  }, async () => {
    const missing = await referralService.resolveReferrerByCode({}, 'NOPE', 'new@example.com');
    assert.strictEqual(missing, null);
  });

  await withRepositoryMocks({
    findEnabledReferralCode: async () => ({
      user_id: 12,
      email: 'same@example.com',
      enabled: 1
    })
  }, async () => {
    const self = await referralService.resolveReferrerByCode({}, 'ABC123', ' SAME@example.com ');
    assert.strictEqual(self, null);
  });
}

/**
 * 验证有效推广码会记录点击。
 *
 * @returns {Promise<void>}
 */
async function testRecordClickPersistsEnabledCode() {
  const calls = [];

  await withRepositoryMocks({
    findEnabledReferralCode: async () => ({
      user_id: 12,
      code: 'ABC123',
      enabled: 1
    }),
    recordReferralClick: async (db, payload) => {
      calls.push(payload);
      return { changes: 1 };
    }
  }, async () => {
    const result = await referralService.recordClick({}, {
      code: 'ABC123',
      ip: '127.0.0.1',
      userAgent: 'NodeTest'
    });

    assert.deepStrictEqual(result, { recorded: true });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].referrerUserId, 12);
    assert.strictEqual(calls[0].code, 'ABC123');
  });
}

/**
 * 验证无效推广码不会记录点击。
 *
 * @returns {Promise<void>}
 */
async function testRecordClickSkipsInvalidCode() {
  let inserted = false;

  await withRepositoryMocks({
    findEnabledReferralCode: async () => null,
    recordReferralClick: async () => {
      inserted = true;
    }
  }, async () => {
    const result = await referralService.recordClick({}, {
      code: 'NOPE',
      ip: '127.0.0.1',
      userAgent: 'NodeTest'
    });

    assert.deepStrictEqual(result, { recorded: false });
    assert.strictEqual(inserted, false);
  });
}

/**
 * 验证首单奖励会按订单金额和奖励系数插入奖励并增加推广人余额。
 *
 * @returns {Promise<void>}
 */
async function testIssueFirstPaymentRewardGrantsBalance() {
  const calls = [];

  await withRepositoryMocks({
    findReferralRewardSetting: async () => ({ value: '0.1' }),
    insertReferralReward: async (db, payload) => {
      calls.push(['insert', payload]);
      return { lastInsertRowid: 7 };
    },
    incrementUserBalance: async (db, userId, rewardAmount) => {
      calls.push(['increment', { userId, rewardAmount }]);
      return { changes: 1 };
    }
  }, async () => {
    const result = await referralService.issueFirstPaymentReward({}, {
      id: 55,
      user_id: 20,
      referrer_user_id: 12,
      amount: 699
    });

    assert.strictEqual(result, true);
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0][1].referrerUserId, 12);
    assert.strictEqual(calls[0][1].referredUserId, 20);
    assert.strictEqual(calls[0][1].orderId, 55);
    assert.strictEqual(calls[0][1].rewardAmount, 69);
    assert.strictEqual(calls[1][1].rewardAmount, 69);
  });
}

/**
 * 验证奖励配置为 0 时不发放奖励。
 *
 * @returns {Promise<void>}
 */
/**
 * 验证订单缺失或没有推广人时，首单奖励会直接跳过且不访问仓储写入分支。
 *
 * @returns {Promise<void>}
 */
async function testIssueFirstPaymentRewardSkipsMissingReferrer() {
  const calls = {
    findSetting: 0,
    insertReward: 0,
    incrementTraffic: 0
  };

  await withRepositoryMocks({
    findReferralRewardSetting: async () => {
      calls.findSetting += 1;
      return { value: '1024' };
    },
    insertReferralReward: async () => {
      calls.insertReward += 1;
      return { lastInsertRowid: 1 };
    },
    incrementUserBalance: async () => {
      calls.incrementTraffic += 1;
      return { changes: 1 };
    }
  }, async () => {
    const missingOrder = await referralService.issueFirstPaymentReward({}, null);
    const missingReferrer = await referralService.issueFirstPaymentReward({}, {
      id: 1,
      user_id: 2
    });

    assert.strictEqual(missingOrder, false);
    assert.strictEqual(missingReferrer, false);
    assert.strictEqual(calls.findSetting, 0);
    assert.strictEqual(calls.insertReward, 0);
    assert.strictEqual(calls.incrementTraffic, 0);
  });
}

async function testIssueFirstPaymentRewardSkipsZeroReward() {
  let inserted = false;

  await withRepositoryMocks({
    findReferralRewardSetting: async () => ({ value: '0' }),
    insertReferralReward: async () => {
      inserted = true;
    }
  }, async () => {
    const result = await referralService.issueFirstPaymentReward({}, {
      id: 55,
      user_id: 20,
      referrer_user_id: 12
    });

    assert.strictEqual(result, false);
    assert.strictEqual(inserted, false);
  });
}

/**
 * 验证重复回调触发唯一约束时不重复发放且不抛错。
 *
 * @returns {Promise<void>}
 */
async function testIssueFirstPaymentRewardHandlesDuplicateConflict() {
  let incremented = false;
  const duplicateError = new Error('duplicate key value violates unique constraint "referral_rewards_order_id_key"');
  duplicateError.code = '23505';
  duplicateError.constraint = 'referral_rewards_order_id_key';

  await withRepositoryMocks({
    findReferralRewardSetting: async () => ({ value: '0.1' }),
    insertReferralReward: async () => {
      throw duplicateError;
    },
    incrementUserBalance: async () => {
      incremented = true;
    }
  }, async () => {
    const result = await referralService.issueFirstPaymentReward({}, {
      id: 55,
      user_id: 20,
      referrer_user_id: 12,
      amount: 1000
    });

    assert.strictEqual(result, false);
    assert.strictEqual(incremented, false);
  });
}

/**
 * Verifies only referral_rewards duplicate conflicts are treated as repeated payment callbacks.
 *
 * Responsibility: keep unrelated database uniqueness failures visible to callers.
 * Key params: mocked insertReferralReward throws a 23505 for another table.
 * Branches: non referral_rewards conflicts must be rethrown and must not increment balance.
 *
 * @returns {Promise<void>}
 */
async function testIssueFirstPaymentRewardRethrowsUnrelatedUniqueConflict() {
  let incremented = false;
  const duplicateError = new Error('duplicate key value violates unique constraint "users_email_key"');
  duplicateError.code = '23505';
  duplicateError.constraint = 'users_email_key';

  await withRepositoryMocks({
    findReferralRewardSetting: async () => ({ value: '0.1' }),
    insertReferralReward: async () => {
      throw duplicateError;
    },
    incrementUserBalance: async () => {
      incremented = true;
    }
  }, async () => {
    await assert.rejects(
      () => referralService.issueFirstPaymentReward({}, {
        id: 55,
        user_id: 20,
        referrer_user_id: 12,
        amount: 1000
      }),
      duplicateError
    );

    assert.strictEqual(incremented, false);
  });
}

/**
 * 验证用户汇总会创建缺失推广码，并格式化奖励金额。
 *
 * @returns {Promise<void>}
 */
async function testGetUserReferralSummaryCreatesCodeAndFormatsTraffic() {
  const generatedCode = 'feedfacefeedface';
  let upsertPayload = null;

  await withRepositoryMocks({
    findReferralCodeByUserId: async () => null,
    upsertReferralCode: async (db, payload) => {
      upsertPayload = payload;
      return {
        user_id: payload.userId,
        code: payload.code,
        enabled: 1
      };
    },
    countReferralClicks: async () => ({ count: 3 }),
    sumReferralRewards: async () => ({
      count: 2,
      total: 123
    })
  }, async () => {
    const result = await referralService.getUserReferralSummary(
      {},
      createReq('https', 'example.com'),
      12,
      () => generatedCode
    );

    assert.strictEqual(upsertPayload.userId, 12);
    assert.strictEqual(upsertPayload.code, generatedCode);
    assert.strictEqual(result.code, generatedCode);
    assert.strictEqual(result.enabled, true);
    assert(result.referral_url.endsWith('/?ref=feedfacefeedface'));
    assert.strictEqual(result.click_count, 3);
    assert.strictEqual(result.reward_count, 2);
    assert.strictEqual(result.reward_amount, 123);
    assert.strictEqual(result.reward_amount_text, '1.23 元');
  });
}

/**
 * Verifies missing referral codes are regenerated when the generated code collides once.
 *
 * Responsibility: cover getOrCreateReferralCode retry behavior on referral_codes.code conflicts.
 * Key params: codeFactory returns a colliding code first and a usable code second.
 * Branches: first upsert throws a code unique conflict, second upsert succeeds.
 *
 * @returns {Promise<void>}
 */
async function testGetOrCreateReferralCodeRetriesCodeUniqueConflict() {
  const generatedCodes = ['colliding-code', 'usable-code'];
  const attempts = [];

  await withRepositoryMocks({
    findReferralCodeByUserId: async () => null,
    upsertReferralCode: async (db, payload) => {
      attempts.push(payload.code);
      if (attempts.length === 1) {
        throw createDuplicateCodeError();
      }

      return {
        user_id: payload.userId,
        code: payload.code,
        enabled: payload.enabled
      };
    }
  }, async () => {
    const result = await referralService.getOrCreateReferralCode(
      {},
      12,
      () => generatedCodes.shift()
    );

    assert.deepStrictEqual(attempts, ['colliding-code', 'usable-code']);
    assert.strictEqual(result.code, 'usable-code');
  });
}

/**
 * Verifies creating a referral code rethrows unrelated unique conflicts without retrying.
 *
 * Responsibility: cover the branch where 23505 is not from referral_codes.code.
 * Key params: upsertReferralCode throws a users.email unique conflict on the first write.
 * Branches: the original error is rethrown, and no second code is generated.
 *
 * @returns {Promise<void>}
 */
async function testGetOrCreateReferralCodeRethrowsUnrelatedUniqueConflict() {
  const thrownError = createUnrelatedUniqueConflictError();
  const attempts = [];
  let generatedCount = 0;

  await withRepositoryMocks({
    findReferralCodeByUserId: async () => null,
    upsertReferralCode: async (db, payload) => {
      attempts.push(payload.code);
      throw thrownError;
    }
  }, async () => {
    await assertRejectsSameError(
      () => referralService.getOrCreateReferralCode({}, 12, () => {
        generatedCount += 1;
        return `unrelated-${generatedCount}`;
      }),
      thrownError
    );

    assert.deepStrictEqual(attempts, ['unrelated-1']);
    assert.strictEqual(generatedCount, 1);
  });
}

/**
 * Verifies creating a referral code does not retry on referral_codes.user_id conflicts.
 *
 * Responsibility: protect retry logic from confusing the table name with the code column.
 * Key params: upsertReferralCode throws referral_codes_user_id_key on the first write.
 * Branches: the original error is rethrown, and write attempts stop at one.
 *
 * @returns {Promise<void>}
 */
async function testGetOrCreateReferralCodeRethrowsReferralUserConflict() {
  const thrownError = createDuplicateReferralUserError();
  const attempts = [];
  let generatedCount = 0;

  await withRepositoryMocks({
    findReferralCodeByUserId: async () => null,
    upsertReferralCode: async (db, payload) => {
      attempts.push(payload.code);
      throw thrownError;
    }
  }, async () => {
    await assertRejectsSameError(
      () => referralService.getOrCreateReferralCode({}, 12, () => {
        generatedCount += 1;
        return `user-conflict-${generatedCount}`;
      }),
      thrownError
    );

    assert.deepStrictEqual(attempts, ['user-conflict-1']);
    assert.strictEqual(generatedCount, 1);
  });
}

/**
 * Verifies creating a referral code rethrows ordinary database errors without retrying.
 *
 * Responsibility: cover non-unique database errors in getOrCreateReferralCode.
 * Key params: upsertReferralCode throws a plain connection-style error.
 * Branches: the original error is rethrown, and write attempts stop at one.
 *
 * @returns {Promise<void>}
 */
async function testGetOrCreateReferralCodeRethrowsOrdinaryDatabaseError() {
  const thrownError = new Error('database connection lost');
  const attempts = [];
  let generatedCount = 0;

  await withRepositoryMocks({
    findReferralCodeByUserId: async () => null,
    upsertReferralCode: async (db, payload) => {
      attempts.push(payload.code);
      throw thrownError;
    }
  }, async () => {
    await assertRejectsSameError(
      () => referralService.getOrCreateReferralCode({}, 12, () => {
        generatedCount += 1;
        return `ordinary-${generatedCount}`;
      }),
      thrownError
    );

    assert.deepStrictEqual(attempts, ['ordinary-1']);
    assert.strictEqual(generatedCount, 1);
  });
}

/**
 * Verifies creating a referral code stops after five code collisions and throws the last error.
 *
 * Responsibility: prove retry limit behavior for referral_codes.code conflicts.
 * Key params: every upsertReferralCode call throws a fresh referral code duplicate error.
 * Branches: exactly five attempts run, then the fifth error is rethrown.
 *
 * @returns {Promise<void>}
 */
async function testGetOrCreateReferralCodeThrowsLastErrorAfterRetryLimit() {
  const attempts = [];
  const thrownErrors = [];
  let generatedCount = 0;

  await withRepositoryMocks({
    findReferralCodeByUserId: async () => null,
    upsertReferralCode: async (db, payload) => {
      attempts.push(payload.code);
      const error = createDuplicateCodeError();
      thrownErrors.push(error);
      throw error;
    }
  }, async () => {
    let actualError = null;

    try {
      await referralService.getOrCreateReferralCode({}, 12, () => {
        generatedCount += 1;
        return `collision-${generatedCount}`;
      });
    } catch (error) {
      actualError = error;
    }

    assert.deepStrictEqual(attempts, [
      'collision-1',
      'collision-2',
      'collision-3',
      'collision-4',
      'collision-5'
    ]);
    assert.strictEqual(generatedCount, 5);
    assert.strictEqual(thrownErrors.length, 5);
    assert.strictEqual(actualError, thrownErrors[4]);
  });
}

/**
 * Verifies resetting an existing referral code regenerates after a code collision.
 *
 * Responsibility: cover resetUserReferralCode retry behavior on referral_codes.code conflicts.
 * Key params: resetReferralCode fails once with a code unique conflict.
 * Branches: first reset throws, second reset succeeds and the latest record is returned.
 *
 * @returns {Promise<void>}
 */
async function testResetUserReferralCodeRetriesCodeUniqueConflict() {
  const generatedCodes = ['reset-collision', 'reset-success'];
  const resetAttempts = [];

  await withRepositoryMocks({
    findReferralCodeByUserId: async () => ({
      user_id: 12,
      code: resetAttempts.length > 1 ? 'reset-success' : 'old-code',
      enabled: 1
    }),
    resetReferralCode: async (db, payload) => {
      resetAttempts.push(payload.code);
      if (resetAttempts.length === 1) {
        throw createDuplicateCodeError();
      }

      return { changes: 1 };
    }
  }, async () => {
    const result = await referralService.resetUserReferralCode(
      {},
      12,
      () => generatedCodes.shift()
    );

    assert.deepStrictEqual(resetAttempts, ['reset-collision', 'reset-success']);
    assert.strictEqual(result.code, 'reset-success');
  });
}

/**
 * Verifies resetting a referral code rethrows unrelated unique conflicts without retrying.
 *
 * Responsibility: cover the branch where reset writes hit a non referral_codes.code conflict.
 * Key params: resetReferralCode throws a users.email unique conflict on the first write.
 * Branches: the original error is rethrown, and reset attempts stop at one.
 *
 * @returns {Promise<void>}
 */
async function testResetUserReferralCodeRethrowsUnrelatedUniqueConflict() {
  const thrownError = createUnrelatedUniqueConflictError();
  const resetAttempts = [];
  let generatedCount = 0;

  await withRepositoryMocks({
    findReferralCodeByUserId: async () => ({
      user_id: 12,
      code: 'old-code',
      enabled: 1
    }),
    resetReferralCode: async (db, payload) => {
      resetAttempts.push(payload.code);
      throw thrownError;
    }
  }, async () => {
    await assertRejectsSameError(
      () => referralService.resetUserReferralCode({}, 12, () => {
        generatedCount += 1;
        return `reset-unrelated-${generatedCount}`;
      }),
      thrownError
    );

    assert.deepStrictEqual(resetAttempts, ['reset-unrelated-1']);
    assert.strictEqual(generatedCount, 1);
  });
}

/**
 * Verifies resetting a referral code does not retry on referral_codes.user_id conflicts.
 *
 * Responsibility: keep reset retry behavior scoped to random code collisions only.
 * Key params: resetReferralCode throws referral_codes_user_id_key on the first write.
 * Branches: the original error is rethrown, and reset attempts stop at one.
 *
 * @returns {Promise<void>}
 */
async function testResetUserReferralCodeRethrowsReferralUserConflict() {
  const thrownError = createDuplicateReferralUserError();
  const resetAttempts = [];
  let generatedCount = 0;

  await withRepositoryMocks({
    findReferralCodeByUserId: async () => ({
      user_id: 12,
      code: 'old-code',
      enabled: 1
    }),
    resetReferralCode: async (db, payload) => {
      resetAttempts.push(payload.code);
      throw thrownError;
    }
  }, async () => {
    await assertRejectsSameError(
      () => referralService.resetUserReferralCode({}, 12, () => {
        generatedCount += 1;
        return `reset-user-conflict-${generatedCount}`;
      }),
      thrownError
    );

    assert.deepStrictEqual(resetAttempts, ['reset-user-conflict-1']);
    assert.strictEqual(generatedCount, 1);
  });
}

/**
 * Verifies resetting a referral code rethrows ordinary database errors without retrying.
 *
 * Responsibility: cover non-unique database errors in resetUserReferralCode.
 * Key params: resetReferralCode throws a plain timeout-style error.
 * Branches: the original error is rethrown, and reset attempts stop at one.
 *
 * @returns {Promise<void>}
 */
async function testResetUserReferralCodeRethrowsOrdinaryDatabaseError() {
  const thrownError = new Error('database timeout');
  const resetAttempts = [];
  let generatedCount = 0;

  await withRepositoryMocks({
    findReferralCodeByUserId: async () => ({
      user_id: 12,
      code: 'old-code',
      enabled: 1
    }),
    resetReferralCode: async (db, payload) => {
      resetAttempts.push(payload.code);
      throw thrownError;
    }
  }, async () => {
    await assertRejectsSameError(
      () => referralService.resetUserReferralCode({}, 12, () => {
        generatedCount += 1;
        return `reset-ordinary-${generatedCount}`;
      }),
      thrownError
    );

    assert.deepStrictEqual(resetAttempts, ['reset-ordinary-1']);
    assert.strictEqual(generatedCount, 1);
  });
}

/**
 * Verifies resetting a referral code stops after five code collisions and throws the last error.
 *
 * Responsibility: prove retry limit behavior for resetUserReferralCode.
 * Key params: every resetReferralCode call throws a fresh referral code duplicate error.
 * Branches: exactly five attempts run, then the fifth error is rethrown.
 *
 * @returns {Promise<void>}
 */
async function testResetUserReferralCodeThrowsLastErrorAfterRetryLimit() {
  const resetAttempts = [];
  const thrownErrors = [];
  let generatedCount = 0;

  await withRepositoryMocks({
    findReferralCodeByUserId: async () => ({
      user_id: 12,
      code: 'old-code',
      enabled: 1
    }),
    resetReferralCode: async (db, payload) => {
      resetAttempts.push(payload.code);
      const error = createDuplicateCodeError();
      thrownErrors.push(error);
      throw error;
    }
  }, async () => {
    let actualError = null;

    try {
      await referralService.resetUserReferralCode({}, 12, () => {
        generatedCount += 1;
        return `reset-collision-${generatedCount}`;
      });
    } catch (error) {
      actualError = error;
    }

    assert.deepStrictEqual(resetAttempts, [
      'reset-collision-1',
      'reset-collision-2',
      'reset-collision-3',
      'reset-collision-4',
      'reset-collision-5'
    ]);
    assert.strictEqual(generatedCount, 5);
    assert.strictEqual(thrownErrors.length, 5);
    assert.strictEqual(actualError, thrownErrors[4]);
  });
}

/**
 * Verifies invalid admin userId filters are ignored before SQL parameter binding.
 *
 * Responsibility: prevent NaN or non-positive IDs from reaching repository SQL params.
 * Key params: filters.userId receives an invalid string.
 * Branches: invalid userId is skipped while other filters still bind normally.
 *
 * @returns {Promise<void>}
 */
async function testAdminSummaryFiltersIgnoreInvalidUserId() {
  let receivedParams = null;
  const db = {
    prepare() {
      return {
        get(...params) {
          receivedParams = params;
          return { total: 0 };
        }
      };
    }
  };

  await referralRepository.countAdminReferralSummaries(db, {
    userId: 'not-a-number',
    email: 'user@example.com'
  });

  assert.deepStrictEqual(receivedParams, ['%user@example.com%']);
}

/**
 * 串行执行推广服务测试。
 *
 * @returns {Promise<void>}
 */
/**
 * 验证注册下单会解析推广码，并把有效推广人 ID 写入待支付订单。
 *
 * 职责：覆盖 authService.registerAndPay 的注册归因传递链路。
 * 关键参数：payload.referral_code 为注册提交的推广码，createPendingOrder 接收 referrerUserId。
 * 核心分支：有效推广码返回推广人 ID；订单创建使用事务内 db 并携带该 ID。
 *
 * @returns {Promise<void>}
 */
async function testRegisterAndPayPassesResolvedReferrerToPendingOrder() {
  const transactionDb = { name: 'transaction-db' };
  const db = createTransactionDb(transactionDb);
  let pendingOrderPayload = null;
  let createPendingOrderDb = null;

  await withRepositoryMocks({
    findEnabledReferralCode: async () => ({
      user_id: 12,
      email: 'referrer@example.com',
      enabled: 1
    })
  }, async () => {
    await withObjectMocks(userRepository, {
      findUserRegisterSnapshotByEmail: async () => null,
      findEnabledPlanById: async () => ({
        id: 3,
        price: 1200,
        traffic_limit: 1024,
        sales_limit: -1,
        sales_count: 0
      }),
      createRegisteredUser: async () => ({ lastInsertRowid: 20 }),
      createPendingOrder: async (receivedDb, payload) => {
        createPendingOrderDb = receivedDb;
        pendingOrderPayload = payload;
        return { lastInsertRowid: 55 };
      },
      updateOrderPaymentInfo: async () => {},
      markOrderExpiredByOutTradeNo: async () => {}
    }, async () => {
      await withObjectMocks(vmqService, {
        isMonitorOnline: async () => true,
        createOrder: async () => ({
          code: 1,
          data: {
            orderId: 'VMQ-55',
            payUrl: 'https://pay.example/55',
            payType: 2,
            reallyPrice: '12.00',
            timeOut: 5
          }
        })
      }, async () => {
        const result = await authService.registerAndPay(db, {
          email: 'new@example.com',
          password: 'abc12345',
          plan_id: 3,
          pay_type: 2,
          referral_code: 'ABC123'
        });

        assert.strictEqual(createPendingOrderDb, transactionDb);
        assert.strictEqual(pendingOrderPayload.referrerUserId, 12);
        assert.strictEqual(result.order_id, 55);
      });
    });
  });
}

/**
 * Verifies invalid referral codes do not block registerAndPay and persist a null referrer.
 *
 * Responsibility: cover the compatibility branch where resolveReferrerByCode returns null.
 * Key params: payload.referral_code contains an unknown code, createPendingOrder records referrerUserId.
 * Branches: invalid referral codes should continue normal registration and write null attribution.
 *
 * @returns {Promise<void>}
 */
async function testRegisterAndPayKeepsOrderingWhenReferralCodeIsInvalid() {
  const transactionDb = { name: 'transaction-db' };
  const db = createTransactionDb(transactionDb);
  let pendingOrderPayload = null;
  let createPendingOrderDb = null;

  await withRepositoryMocks({
    findEnabledReferralCode: async () => null
  }, async () => {
    await withObjectMocks(userRepository, {
      findUserRegisterSnapshotByEmail: async () => null,
      findEnabledPlanById: async () => ({
        id: 3,
        price: 1200,
        traffic_limit: 1024,
        sales_limit: -1,
        sales_count: 0
      }),
      createRegisteredUser: async () => ({ lastInsertRowid: 20 }),
      createPendingOrder: async (receivedDb, payload) => {
        createPendingOrderDb = receivedDb;
        pendingOrderPayload = payload;
        return { lastInsertRowid: 55 };
      },
      updateOrderPaymentInfo: async () => {},
      markOrderExpiredByOutTradeNo: async () => {}
    }, async () => {
      await withObjectMocks(vmqService, {
        isMonitorOnline: async () => true,
        createOrder: async () => ({
          code: 1,
          data: {
            orderId: 'VMQ-55',
            payUrl: 'https://pay.example/55',
            payType: 2,
            reallyPrice: '12.00',
            timeOut: 5
          }
        })
      }, async () => {
        const result = await authService.registerAndPay(db, {
          email: 'new@example.com',
          password: 'abc12345',
          plan_id: 3,
          pay_type: 2,
          referral_code: 'INVALID'
        });

        assert.strictEqual(createPendingOrderDb, transactionDb);
        assert.strictEqual(pendingOrderPayload.referrerUserId, null);
        assert.strictEqual(result.order_id, 55);
      });
    });
  });
}

/**
 * 验证已付费账号不能再次通过注册购买入口创建新购订单。
 *
 * 职责：防止已付费老账号绕过续费入口生成第二个 ORD 订单。
 * 关键参数：findUserRegisterSnapshotByEmail 返回 payment_count > 0 的用户快照。
 * 核心分支：已付费账号直接抛出业务错误，不查询套餐、不调用 VMQ、不创建订单。
 *
 * @returns {Promise<void>}
 */
async function testRegisterAndPayRejectsPaidExistingUserBeforeCreatingOrdOrder() {
  let planChecked = false;
  let vmqChecked = false;
  let pendingOrderCreated = false;

  await withObjectMocks(userRepository, {
    findUserRegisterSnapshotByEmail: async () => ({
      id: 20,
      enabled: 0,
      expire_at: 0,
      payment_count: 1
    }),
    findEnabledPlanById: async () => {
      planChecked = true;
      return null;
    },
    createPendingOrder: async () => {
      pendingOrderCreated = true;
    }
  }, async () => {
    await withObjectMocks(vmqService, {
      isMonitorOnline: async () => {
        vmqChecked = true;
        return true;
      }
    }, async () => {
      await assert.rejects(
        () => authService.registerAndPay({}, {
          email: 'old@example.com',
          password: 'abc12345',
          plan_id: 3,
          pay_type: 2
        }),
        (error) => error.isLegacyBusinessError
          && error.code === 2001
          && error.message === '该邮箱已注册，请登录后续费'
      );
    });
  });

  assert.strictEqual(planChecked, false);
  assert.strictEqual(vmqChecked, false);
  assert.strictEqual(pendingOrderCreated, false);
}

/**
 * 验证未支付账号可以再次通过注册入口复用同一用户并创建新订单。
 *
 * 职责：覆盖 payment_count=0 的邮箱占用恢复路径，避免 12 小时清理窗口阻塞重新下单。
 * 关键参数：findUserRegisterSnapshotByEmail 返回未支付用户快照。
 * 核心分支：复用旧 user_id 更新注册资料，不创建重复用户，并创建新的 pending 订单。
 *
 * @returns {Promise<void>}
 */
async function testRegisterAndPayReusesUnpaidExistingUserForNewOrder() {
  const transactionDb = { name: 'transaction-db' };
  const db = createTransactionDb(transactionDb);
  let updatedUserPayload = null;
  let createdUser = false;
  let pendingOrderPayload = null;

  await withRepositoryMocks({
    findEnabledReferralCode: async () => null
  }, async () => {
    await withObjectMocks(userRepository, {
      findUserRegisterSnapshotByEmail: async () => ({
        id: 20,
        enabled: 0,
        expire_at: 0,
        payment_count: 0
      }),
      findEnabledPlanById: async () => ({
        id: 3,
        price: 1200,
        traffic_limit: 1024,
        sales_limit: -1,
        sales_count: 0
      }),
      updateRegisteredUserForPlan: async (receivedDb, payload) => {
        assert.strictEqual(receivedDb, transactionDb);
        updatedUserPayload = payload;
      },
      createRegisteredUser: async () => {
        createdUser = true;
        return { lastInsertRowid: 999 };
      },
      createPendingOrder: async (receivedDb, payload) => {
        assert.strictEqual(receivedDb, transactionDb);
        pendingOrderPayload = payload;
        return { lastInsertRowid: 56 };
      },
      updateOrderPaymentInfo: async () => {},
      markOrderExpiredByOutTradeNo: async () => {}
    }, async () => {
      await withObjectMocks(vmqService, {
        isMonitorOnline: async () => true,
        createOrder: async () => ({
          code: 1,
          data: {
            orderId: 'VMQ-56',
            payUrl: 'https://pay.example/56',
            payType: 2,
            reallyPrice: '12.00',
            timeOut: 5
          }
        })
      }, async () => {
        const result = await authService.registerAndPay(db, {
          email: 'retry@example.com',
          password: 'abc12345',
          plan_id: 3,
          pay_type: 2
        });

        assert.strictEqual(updatedUserPayload.userId, 20);
        assert.strictEqual(updatedUserPayload.planId, 3);
        assert.strictEqual(createdUser, false);
        assert.strictEqual(pendingOrderPayload.userId, 20);
        assert.strictEqual(pendingOrderPayload.email, 'retry@example.com');
        assert.strictEqual(result.user_id, 20);
        assert.strictEqual(result.order_id, 56);
      });
    });
  });
}

/**
 * Verifies register-and-pay validators keep the legacy flow compatible when referral_code is omitted.
 *
 * Responsibility: execute the auth route validator stack with a valid legacy payload.
 * Key params: the request body intentionally omits referral_code while keeping required fields valid.
 * Branches: optional referral_code should contribute no validation errors when absent.
 *
 * @returns {Promise<void>}
 */
async function testRegisterAndPayValidatorAllowsMissingReferralCode() {
  const registerRouteLayer = authRouter.stack.find((layer) => layer.route && layer.route.path === '/register-and-pay');
  assert.ok(registerRouteLayer, 'register-and-pay route should exist');

  const validatorMiddlewares = registerRouteLayer.route.stack.slice(1, -1).map((layer) => layer.handle);
  const req = {
    body: {
      email: 'new@example.com',
      password: 'abc12345',
      plan_id: 3,
      pay_type: 2
    },
    params: {},
    query: {},
    headers: {},
    cookies: {}
  };

  for (const middleware of validatorMiddlewares) {
    await runMiddleware(middleware, req);
  }

  assert.deepStrictEqual(validationResult(req).array(), []);
}

/**
 * 验证支付完成只在新购首单且存在推广人时，于本地事务中触发首单奖励。
 *
 * 职责：覆盖 completePaidOrder 的发奖条件和 transactionDb 传递。
 * 关键参数：order.current_payment_count 表示支付前次数，out_trade_no 前缀区分续费。
 * 核心分支：已支付、续费、非首单、无推广人都不发奖；有效首单发奖一次。
 *
 * @returns {Promise<void>}
 */
async function testCompletePaidOrderIssuesRewardOnlyForFirstAttributedPurchase() {
  const transactionDb = { name: 'payment-transaction-db' };
  const enqueuedTasks = [];
  const baseOrder = {
    id: 55,
    out_trade_no: 'ORD-55',
    status: 'pending',
    user_id: 20,
    email: 'new@example.com',
    plan_id: 3,
    current_expire_at: 0,
    current_traffic_limit: 0,
    current_plan_id: null,
    current_enabled: 1,
    current_disable_reason: null,
    subscription_token: 'sub-token',
    trade_no: 'VMQ-OLD',
    referrer_user_id: 12,
    current_payment_count: 0
  };
  const plan = {
    id: 3,
    traffic_limit: 1024,
    duration_days: 30
  };
  const rewardCalls = [];

  await withObjectMocks(orderRepository, {
    findPaidOrderContextByOutTradeNo: async (db, outTradeNo) => {
      if (outTradeNo === 'ORD-paid') {
        return { ...baseOrder, out_trade_no: outTradeNo, status: 'paid' };
      }
      if (outTradeNo === 'REN-55') {
        return { ...baseOrder, out_trade_no: outTradeNo };
      }
      if (outTradeNo === 'ORD-second') {
        return { ...baseOrder, out_trade_no: outTradeNo, current_payment_count: 1 };
      }
      if (outTradeNo === 'ORD-no-referrer') {
        return { ...baseOrder, out_trade_no: outTradeNo, referrer_user_id: null };
      }
      return { ...baseOrder, out_trade_no: outTradeNo };
    },
    findPlanById: async () => plan,
    markOrderPaid: async () => {},
    updateUserAfterPaidOrder: async () => {},
    incrementPlanSalesCount: async () => {},
    decrementPlanSalesCount: async () => {},
    updateUserSyncStatus: async () => {}
  }, async () => {
    await withObjectMocks(referralService, {
      issueFirstPaymentReward: async (receivedDb, order) => {
        rewardCalls.push({ db: receivedDb, order });
        return true;
      }
    }, async () => {
      await withObjectMocks(xuiSyncTaskService, {
        enqueueTask: async (db, payload) => {
          enqueuedTasks.push(payload);
          return 1;
        },
        processTask: () => Promise.resolve()
      }, async () => {
        await withObjectMocks(orderActivationEmailService, {
          sendOrderActivationEmail: async () => ({ sent: true, status: 'mocked' })
        }, async () => {
          await orderService.completePaidOrder(createTransactionDb(transactionDb), 'ORD-55', 'VMQ-55');
          await orderService.completePaidOrder(createTransactionDb(transactionDb), 'ORD-paid', 'VMQ-PAID');
          await orderService.completePaidOrder(createTransactionDb(transactionDb), 'REN-55', 'VMQ-REN');
          await orderService.completePaidOrder(createTransactionDb(transactionDb), 'ORD-second', 'VMQ-SECOND');
          await orderService.completePaidOrder(createTransactionDb(transactionDb), 'ORD-no-referrer', 'VMQ-NO-REF');

          assert.strictEqual(rewardCalls.length, 1);
          assert.strictEqual(rewardCalls[0].db, transactionDb);
          assert.strictEqual(rewardCalls[0].order.id, 55);
          assert.ok(enqueuedTasks.length >= 1);
          assert.strictEqual(enqueuedTasks[0].payload.user.total_traffic_limit, 1024);
        });
      });
    });
  });
}

/**
 * 验证支付完成后会复用系统邮件能力发送账号开通提醒。
 *
 * 职责：覆盖 completePaidOrder 在本地落账后触发邮件通知的主路径。
 * 关键参数：out_trade_no 区分新购和续费，plan 提供邮件中的套餐详情。
 * 核心分支：配额充足时发送邮件并写入 email_logs，避免新系统邮件绕过统一配额口径。
 *
 * @returns {Promise<void>}
 */
async function testCompletePaidOrderSendsAccountActivationEmail() {
  const transactionDb = { name: 'payment-transaction-db' };
  const emailCalls = [];
  const emailLogCalls = [];
  const originalSiteConfig = { ...config.site };
  const baseOrder = {
    id: 56,
    out_trade_no: 'ORD-56',
    status: 'pending',
    user_id: 21,
    email: 'new-user@example.com',
    plan_id: 4,
    current_expire_at: 0,
    current_traffic_limit: 0,
    current_traffic_used: 0,
    current_plan_id: null,
    current_enabled: 1,
    current_disable_reason: null,
    subscription_token: 'sub-token',
    trade_no: 'VMQ-OLD',
    referrer_user_id: null,
    current_payment_count: 0,
    amount: 1299
  };
  const plan = {
    id: 4,
    name: '星河套餐',
    traffic_limit: 10 * 1024 * 1024 * 1024,
    duration_days: 30,
    plan_type: 'limited'
  };

  config.site.protocol = 'https';
  config.site.host = 'api.example.com';
  config.site.userAppUrl = 'https://official.example.com/user';

  try {
    await withObjectMocks(orderRepository, {
      findPaidOrderContextByOutTradeNo: async () => ({ ...baseOrder }),
      findPlanById: async () => plan,
      markOrderPaid: async () => {},
      updateUserAfterPaidOrder: async () => {},
      incrementPlanSalesCount: async () => {},
      decrementPlanSalesCount: async () => {},
      updateUserSyncStatus: async () => {}
    }, async () => {
      await withObjectMocks(xuiSyncTaskService, {
        enqueueTask: async () => 1,
        processTask: () => Promise.resolve()
      }, async () => {
        await withObjectMocks(emailRepository, {
          countTodayEmailLogs: async () => ({ count: 0 }),
          findBrevoDailyLimit: async () => ({ value: '200' }),
          createEmailLog: async (db, payload) => {
            emailLogCalls.push({ db, payload });
          }
        }, async () => {
          await withObjectMocks(systemSettingsService, {
            getSubscriptionConfig: async () => ({
              telegram_channel_url: 'https://t.me/tianlan',
              online_customer_service_url: ''
            })
          }, async () => {
            await withObjectMocks(sharedEmailService, {
              sendEmail: async (db, payload) => {
                emailCalls.push({ db, payload });
                return { success: true, messageId: 'email-56' };
              }
            }, async () => {
              await orderService.completePaidOrder(createTransactionDb(transactionDb), 'ORD-56', 'VMQ-56');

              assert.strictEqual(emailCalls.length, 1);
              assert.strictEqual(emailCalls[0].payload.to, 'new-user@example.com');
              assert.strictEqual(emailCalls[0].payload.subject, '【天澜大陆消息】账号new-user开通提醒');
              const emailContent = emailCalls[0].payload.content;
              assert.ok(emailCalls[0].payload.content.includes('订单号'));
              assert.ok(emailCalls[0].payload.content.includes('ORD-56'));
              assert.ok(emailCalls[0].payload.content.includes('星河套餐'));
              assert.ok(emailContent.includes('访问官方网站'));
              assert.ok(emailContent.includes('官方网站'));
              assert.ok(emailContent.includes('官方网站：<a href="https://official.example.com/user"'));
              assert.ok(emailContent.includes('https://official.example.com/user'));
              assert.strictEqual(emailContent.includes('https://api.example.com'), false);
              assert.ok(/<table role="presentation"[\s\S]*访问官方网站[\s\S]*加入官方电报频道[\s\S]*<\/table>/.test(emailContent));
              assert.ok(emailContent.indexOf('官方网站：') < emailContent.indexOf('官方电报频道：'));
              assert.strictEqual(
                emailContent.includes('<td style="padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;color:#64748b;">官方网站</td>'),
                false
              );
              assert.ok(emailContent.includes('https://t.me/tianlan'));
              assert.strictEqual(emailLogCalls.length, 1);
              assert.strictEqual(emailLogCalls[0].payload.userId, 21);
              assert.strictEqual(emailLogCalls[0].payload.status, 'sent');
            });
          });
        });
      });
    });
  } finally {
    config.site = originalSiteConfig;
  }
}

/**
 * 验证续费邮件只展示本次续费套餐流量，不暴露续费后的账号总流量。
 *
 * 职责：覆盖续费订单流量累加时邮件模板的数据来源。
 * 关键参数：current_traffic_limit 为原账号流量，plan.traffic_limit 为本次套餐流量。
 * 核心分支：权益仍累加为总流量，但邮件“套餐流量”只能使用本次套餐流量。
 *
 * @returns {Promise<void>}
 */
async function testRenewActivationEmailUsesCurrentPlanTrafficOnly() {
  const transactionDb = { name: 'payment-transaction-db' };
  const emailCalls = [];
  const baseOrder = {
    id: 58,
    out_trade_no: 'REN-58',
    status: 'pending',
    user_id: 23,
    email: 'renew-user@example.com',
    plan_id: 6,
    current_expire_at: 0,
    current_traffic_limit: 20 * 1024 * 1024 * 1024,
    current_traffic_used: 0,
    current_plan_id: 6,
    current_enabled: 1,
    current_disable_reason: null,
    subscription_token: 'sub-token',
    trade_no: 'VMQ-OLD',
    referrer_user_id: null,
    current_payment_count: 1,
    amount: 700
  };
  const plan = {
    id: 6,
    name: '续费 7G 套餐',
    traffic_limit: 7 * 1024 * 1024 * 1024,
    duration_days: 30,
    plan_type: 'limited'
  };

  await withObjectMocks(orderRepository, {
    findPaidOrderContextByOutTradeNo: async () => ({ ...baseOrder }),
    findPlanById: async () => plan,
    markOrderPaid: async () => {},
    updateUserAfterPaidOrder: async (db, payload) => {
      assert.strictEqual(payload.trafficLimit, 27 * 1024 * 1024 * 1024);
    },
    incrementPlanSalesCount: async () => {},
    decrementPlanSalesCount: async () => {},
    updateUserSyncStatus: async () => {}
  }, async () => {
    await withObjectMocks(xuiSyncTaskService, {
      enqueueTask: async () => 1,
      processTask: () => Promise.resolve()
    }, async () => {
      await withObjectMocks(emailRepository, {
        countTodayEmailLogs: async () => ({ count: 0 }),
        findBrevoDailyLimit: async () => ({ value: '200' }),
        createEmailLog: async () => {}
      }, async () => {
        await withObjectMocks(systemSettingsService, {
          getSubscriptionConfig: async () => ({
            telegram_channel_url: '',
            online_customer_service_url: ''
          })
        }, async () => {
          await withObjectMocks(sharedEmailService, {
            sendEmail: async (db, payload) => {
              emailCalls.push({ db, payload });
              return { success: true, messageId: 'email-renew-58' };
            }
          }, async () => {
            await orderService.completePaidOrder(createTransactionDb(transactionDb), 'REN-58', 'VMQ-58');

            assert.strictEqual(emailCalls.length, 1);
            assert.ok(emailCalls[0].payload.content.includes('7 GB'));
            assert.strictEqual(emailCalls[0].payload.content.includes('27 GB'), false);
          });
        });
      });
    });
  });
}

/**
 * 验证邮件异常不会影响支付落账结果和 3X-UI 同步任务创建。
 *
 * 职责：覆盖 Brevo 未配置或发送失败时的降级行为。
 * 关键参数：sendEmail 抛错模拟 Brevo 初始化失败，enqueueTask 记录同步任务。
 * 核心分支：同步任务必须先入队，completePaidOrder 仍返回 handled=true。
 *
 * @returns {Promise<void>}
 */
async function testCompletePaidOrderKeepsEntitlementAndSyncWhenEmailFails() {
  const transactionDb = { name: 'payment-transaction-db' };
  const calls = [];
  const baseOrder = {
    id: 57,
    out_trade_no: 'ORD-57',
    status: 'pending',
    user_id: 22,
    email: 'mail-fail@example.com',
    plan_id: 5,
    current_expire_at: 0,
    current_traffic_limit: 0,
    current_traffic_used: 0,
    current_plan_id: null,
    current_enabled: 1,
    current_disable_reason: null,
    subscription_token: 'sub-token',
    trade_no: 'VMQ-OLD',
    referrer_user_id: null,
    current_payment_count: 0,
    amount: 990
  };
  const plan = {
    id: 5,
    name: '邮件失败套餐',
    traffic_limit: 1024,
    duration_days: 30,
    plan_type: 'limited'
  };

  await withObjectMocks(orderRepository, {
    findPaidOrderContextByOutTradeNo: async () => ({ ...baseOrder }),
    findPlanById: async () => plan,
    markOrderPaid: async () => calls.push('markOrderPaid'),
    updateUserAfterPaidOrder: async () => calls.push('updateUserAfterPaidOrder'),
    incrementPlanSalesCount: async () => calls.push('incrementPlanSalesCount'),
    decrementPlanSalesCount: async () => {},
    updateUserSyncStatus: async () => {}
  }, async () => {
    await withObjectMocks(xuiSyncTaskService, {
      enqueueTask: async () => {
        calls.push('enqueueTask');
        return 1;
      },
      processTask: () => Promise.resolve()
    }, async () => {
      await withObjectMocks(emailRepository, {
        countTodayEmailLogs: async () => ({ count: 0 }),
        findBrevoDailyLimit: async () => ({ value: '200' }),
        createEmailLog: async () => {
          calls.push('createEmailLog');
        }
      }, async () => {
        await withObjectMocks(systemSettingsService, {
          getSubscriptionConfig: async () => ({
            telegram_channel_url: '',
            online_customer_service_url: ''
          })
        }, async () => {
          await withObjectMocks(sharedEmailService, {
            sendEmail: async () => {
              calls.push('sendEmail');
              throw new Error('Brevo API Key 未配置');
            }
          }, async () => {
            const result = await orderService.completePaidOrder(createTransactionDb(transactionDb), 'ORD-57', 'VMQ-57');

            assert.strictEqual(result.handled, true);
            assert.strictEqual(result.alreadyPaid, false);
            assert.ok(calls.includes('markOrderPaid'));
            assert.ok(calls.includes('updateUserAfterPaidOrder'));
            assert.ok(calls.includes('enqueueTask'));
            assert.ok(calls.includes('sendEmail'));
            assert.ok(calls.indexOf('enqueueTask') < calls.indexOf('sendEmail'));
            assert.strictEqual(calls.includes('createEmailLog'), false);
          });
        });
      });
    });
  });
}

/**
 * 验证余额支付续费会扣除余额并直接完成订单，不创建 VMQ 订单。
 *
 * 职责：覆盖 renewService 的余额支付分支，避免余额续费误走外部支付。
 * 关键参数：pay_type=9 表示余额支付，用户余额大于套餐价格。
 * 核心分支：事务内创建订单和扣余额，事务后调用统一订单完结逻辑。
 *
 * @returns {Promise<void>}
 */
async function testBalanceRenewCompletesWithoutVmq() {
  const transactionDb = { name: 'balance-renew-transaction-db' };
  const calls = [];

  await withObjectMocks(orderRepository, {
    findUserById: async () => ({
      id: 8,
      email: 'user@example.com',
      plan_id: 1,
      enabled: 1,
      disable_reason: null,
      traffic_limit: 1024,
      balance: 2000
    }),
    findEnabledPlanById: async () => ({
      id: 2,
      price: 1500,
      traffic_limit: 2048,
      duration_days: 30,
      sales_limit: -1,
      sales_count: 0
    }),
    findPlanById: async () => ({
      id: 1,
      plan_type: 'lifetime',
      duration_days: 0
    }),
    createPendingRenewOrder: async (db, payload) => {
      calls.push(['createOrder', db, payload]);
      return { lastInsertRowid: 66 };
    },
    decrementUserBalance: async (db, payload) => {
      calls.push(['decrementBalance', db, payload]);
      return { changes: 1 };
    }
  }, async () => {
    await withObjectMocks(orderService, {
      completePaidOrder: async (db, outTradeNo, tradeNo) => {
        calls.push(['completeOrder', db, { outTradeNo, tradeNo }]);
        return { handled: true };
      }
    }, async () => {
      await withObjectMocks(vmqService, {
        createOrder: async () => {
          throw new Error('VMQ should not be called for balance payment');
        }
      }, async () => {
        const result = await renewService.createRenewOrder(
          createTransactionDb(transactionDb),
          8,
          { plan_id: 2, pay_type: 9 }
        );

        assert.strictEqual(result.order_id, 66);
        assert.strictEqual(result.payment_method, 'balance');
        assert.strictEqual(result.paid, true);
        assert.strictEqual(calls[0][0], 'createOrder');
        assert.strictEqual(calls[0][1], transactionDb);
        assert.strictEqual(calls[0][2].amount, 1500);
        assert.strictEqual(calls[1][0], 'decrementBalance');
        assert.strictEqual(calls[1][1], transactionDb);
        assert.deepStrictEqual(calls[1][2], { userId: 8, amount: 1500 });
        assert.strictEqual(calls[2][0], 'completeOrder');
        assert.ok(calls[2][2].tradeNo.startsWith('BALANCE-'));
      });
    });
  });
}

/**
 * 验证余额不足时续费会返回业务错误且不会创建订单。
 *
 * 职责：覆盖余额支付的失败分支，防止余额不足时生成待支付订单。
 * 关键参数：pay_type=9 且 users.balance 小于套餐 price。
 * 核心分支：服务层在事务前拒绝请求，错误码为 4001。
 *
 * @returns {Promise<void>}
 */
async function testBalanceRenewRejectsInsufficientBalance() {
  let createdOrder = false;

  await withObjectMocks(orderRepository, {
    findUserById: async () => ({
      id: 8,
      email: 'user@example.com',
      plan_id: 1,
      enabled: 1,
      disable_reason: null,
      traffic_limit: 1024,
      balance: 100
    }),
    findEnabledPlanById: async () => ({
      id: 2,
      price: 1500,
      traffic_limit: 2048,
      duration_days: 30,
      sales_limit: -1,
      sales_count: 0
    }),
    findPlanById: async () => ({
      id: 1,
      plan_type: 'lifetime',
      duration_days: 0
    }),
    createPendingRenewOrder: async () => {
      createdOrder = true;
    }
  }, async () => {
    await assert.rejects(
      () => renewService.createRenewOrder({}, 8, { plan_id: 2, pay_type: 9 }),
      (error) => error.isLegacyBusinessError && error.code === 4001 && error.message.includes('余额不足')
    );
  });

  assert.strictEqual(createdOrder, false);
}

async function main() {
  await testResolveReferrerReturnsUserIdForEnabledCode();
  await testResolveReferrerRejectsInvalidOrSelfReferral();
  await testRecordClickPersistsEnabledCode();
  await testRecordClickSkipsInvalidCode();
  await testIssueFirstPaymentRewardGrantsBalance();
  await testIssueFirstPaymentRewardSkipsMissingReferrer();
  await testIssueFirstPaymentRewardSkipsZeroReward();
  await testIssueFirstPaymentRewardHandlesDuplicateConflict();
  await testIssueFirstPaymentRewardRethrowsUnrelatedUniqueConflict();
  await testGetUserReferralSummaryCreatesCodeAndFormatsTraffic();
  await testGetOrCreateReferralCodeRetriesCodeUniqueConflict();
  await testGetOrCreateReferralCodeRethrowsUnrelatedUniqueConflict();
  await testGetOrCreateReferralCodeRethrowsReferralUserConflict();
  await testGetOrCreateReferralCodeRethrowsOrdinaryDatabaseError();
  await testGetOrCreateReferralCodeThrowsLastErrorAfterRetryLimit();
  await testResetUserReferralCodeRetriesCodeUniqueConflict();
  await testResetUserReferralCodeRethrowsUnrelatedUniqueConflict();
  await testResetUserReferralCodeRethrowsReferralUserConflict();
  await testResetUserReferralCodeRethrowsOrdinaryDatabaseError();
  await testResetUserReferralCodeThrowsLastErrorAfterRetryLimit();
  await testAdminSummaryFiltersIgnoreInvalidUserId();
  await testRegisterAndPayPassesResolvedReferrerToPendingOrder();
  await testRegisterAndPayKeepsOrderingWhenReferralCodeIsInvalid();
  await testRegisterAndPayRejectsPaidExistingUserBeforeCreatingOrdOrder();
  await testRegisterAndPayReusesUnpaidExistingUserForNewOrder();
  await testRegisterAndPayValidatorAllowsMissingReferralCode();
  await testCompletePaidOrderIssuesRewardOnlyForFirstAttributedPurchase();
  await testCompletePaidOrderSendsAccountActivationEmail();
  await testRenewActivationEmailUsesCurrentPlanTrafficOnly();
  await testCompletePaidOrderKeepsEntitlementAndSyncWhenEmailFails();
  await testBalanceRenewCompletesWithoutVmq();
  await testBalanceRenewRejectsInsufficientBalance();
  console.log('referral service tests passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
