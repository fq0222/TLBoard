/**
 * 续费提醒状态数据库结构测试。
 * 负责校验新库表定义与增量迁移均包含提醒尝试时间、原因字段及独立字段检查。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const migration = require('../db/migrations/019-renewal-notice-state');
const trafficRepository = require('../repositories/traffic-repository');
const orderRepository = require('../repositories/order-repository');
const trafficManager = require('../services/shared/traffic-manager');
const renewalRequiredEmailService = require('../services/shared/renewal-required-email-service');
const sharedEmailService = require('../integrations/email/email-service');
const xuiSyncTaskService = require('../integrations/xui/xui-sync-task-service');

const tablesPath = path.join(__dirname, '../db/schema/tables.js');
const migrationPath = path.join(__dirname, '../db/migrations/019-renewal-notice-state.js');

/**
 * 构造迁移运行时测试使用的 PostgreSQL 连接池桩。
 *
 * @param {Object} options - 字段存在状态与失败分支配置
 * @param {Set<string>} options.existingColumns - users 表中已存在的字段
 * @param {string} options.failAlterColumn - 执行 ALTER 时需要抛错的字段
 * @returns {{pool:Object,calls:Array,state:Object}} 连接池桩、SQL 记录与释放状态
 */
function createPoolStub(options = {}) {
  const existingColumns = options.existingColumns || new Set();
  const calls = [];
  const state = { released: false };
  const client = {
    /**
     * 记录迁移 SQL，并模拟字段检查、ALTER 与事务响应。
     *
     * @param {string} sql - PostgreSQL SQL 文本
     * @param {Array<*>} params - SQL 绑定参数
     * @returns {Promise<Object|undefined>} 模拟查询结果
     */
    async query(sql, params = []) {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: normalizedSql, params });

      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalizedSql)) {
        return undefined;
      }

      if (normalizedSql.includes('information_schema.columns')) {
        return {
          rows: existingColumns.has(params[0]) ? [{ column_name: params[0] }] : []
        };
      }

      if (normalizedSql.startsWith('ALTER TABLE users')) {
        if (options.failAlterColumn && normalizedSql.includes(options.failAlterColumn)) {
          throw new Error('alter failed');
        }
        return { rowCount: 0 };
      }

      throw new Error(`unexpected sql: ${normalizedSql}`);
    },

    /**
     * 标记专用连接已释放。
     */
    release() {
      state.released = true;
    }
  };

  return {
    calls,
    state,
    pool: {
      /**
       * 返回迁移专用的 PostgreSQL client 桩。
       * @returns {Promise<Object>} client 桩
       */
      async connect() {
        return client;
      }
    }
  };
}

/**
 * 构造仓储测试使用的数据库桩，真实执行仓储方法并记录 SQL、参数与调用方式。
 *
 * @param {Object|undefined} returnedRow - get() 返回的更新结果；undefined 表示条件未命中
 * @returns {{db:Object,calls:Array}} 数据库桩与调用记录
 */
function createRepositoryDbStub(returnedRow) {
  const calls = [];

  return {
    calls,
    db: {
      /**
       * 记录仓储准备的 SQL，并提供 SQLite 风格的 get/run 适配接口。
       *
       * @param {string} sql - 仓储 SQL
       * @returns {Object} 语句执行桩
       */
      prepare(sql) {
        const normalizedSql = sql.replace(/\s+/g, ' ').trim();
        return {
          async get(...params) {
            calls.push({ method: 'get', sql: normalizedSql, params });
            return returnedRow;
          },
          async run(...params) {
            calls.push({ method: 'run', sql: normalizedSql, params });
            return { changes: 1 };
          }
        };
      }
    }
  };
}

/**
 * 构造续费提醒行锁事务桩，模拟同一专用连接上的事务顺序。
 * @param {Object|undefined} lockedRow - SELECT FOR UPDATE 返回的用户状态
 * @returns {{db:Object,calls:Array,state:Object}} 数据库桩、SQL 记录与事务状态
 */
function createRenewalNoticeTransactionDb(lockedRow) {
  const calls = [];
  const state = { committed: false, rolledBack: false, released: false };
  const transactionDb = {
    prepare(sql) {
      return {
        async get(...params) {
          calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
          return lockedRow;
        }
      };
    }
  };

  return {
    calls,
    state,
    db: {
      transaction(handler) {
        return async () => {
          calls.push({ sql: 'BEGIN', params: [] });
          try {
            const result = await handler(transactionDb);
            state.committed = true;
            calls.push({ sql: 'COMMIT', params: [] });
            return result;
          } catch (error) {
            state.rolledBack = true;
            calls.push({ sql: 'ROLLBACK', params: [] });
            throw error;
          } finally {
            state.released = true;
          }
        };
      }
    }
  };
}

test('users 表定义包含续费提醒状态字段', () => {
  const source = fs.readFileSync(tablesPath, 'utf8');

  assert.match(source, /renewal_notice_attempted_at\s+BIGINT/);
  assert.match(source, /renewal_notice_reason\s+VARCHAR\(50\)/);
});

test('迁移通过 information_schema.columns 分别检查两个提醒字段', () => {
  const source = fs.readFileSync(migrationPath, 'utf8');

  assert.match(source, /information_schema\.columns/);
  assert.match(source, /columnExists\(client,\s*['"]renewal_notice_attempted_at['"]\)/);
  assert.match(source, /columnExists\(client,\s*['"]renewal_notice_reason['"]\)/);
  assert.match(source, /ADD\s+COLUMN\s+renewal_notice_attempted_at\s+BIGINT/);
  assert.match(source, /ADD\s+COLUMN\s+renewal_notice_reason\s+VARCHAR\(50\)/);
});

test('首次迁移添加两个字段并提交事务后释放连接', async () => {
  const { pool, calls, state } = createPoolStub();

  const result = await migration.up(pool);

  assert.deepEqual(result, {
    addedColumns: ['renewal_notice_attempted_at', 'renewal_notice_reason'],
    skippedColumns: []
  });
  assert.equal(calls[0].sql, 'BEGIN');
  assert.equal(calls[calls.length - 1].sql, 'COMMIT');
  assert.equal(calls.filter((call) => call.sql.startsWith('ALTER TABLE users')).length, 2);
  assert.equal(state.released, true);
});

test('一个字段已存在时仅添加另一个字段', async () => {
  const { pool, calls, state } = createPoolStub({
    existingColumns: new Set(['renewal_notice_attempted_at'])
  });

  const result = await migration.up(pool);
  const alterCalls = calls.filter((call) => call.sql.startsWith('ALTER TABLE users'));

  assert.deepEqual(result, {
    addedColumns: ['renewal_notice_reason'],
    skippedColumns: ['renewal_notice_attempted_at']
  });
  assert.equal(alterCalls.length, 1);
  assert.match(alterCalls[0].sql, /renewal_notice_reason VARCHAR\(50\)/);
  assert.equal(state.released, true);
});

test('两个字段均存在时不执行 ALTER', async () => {
  const existingColumns = new Set([
    'renewal_notice_attempted_at',
    'renewal_notice_reason'
  ]);
  const { pool, calls, state } = createPoolStub({ existingColumns });

  const result = await migration.up(pool);

  assert.deepEqual(result, {
    addedColumns: [],
    skippedColumns: Array.from(existingColumns)
  });
  assert.equal(calls.some((call) => call.sql.startsWith('ALTER TABLE users')), false);
  assert.equal(calls[calls.length - 1].sql, 'COMMIT');
  assert.equal(state.released, true);
});

test('ALTER 失败时回滚事务并释放连接', async () => {
  const { pool, calls, state } = createPoolStub({
    failAlterColumn: 'renewal_notice_attempted_at'
  });
  const originalConsoleError = console.error;

  try {
    console.error = () => {};
    await assert.rejects(() => migration.up(pool), /alter failed/);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(calls.some((call) => call.sql === 'ROLLBACK'), true);
  assert.equal(calls.some((call) => call.sql === 'COMMIT'), false);
  assert.equal(state.released, true);
});

test('流量禁用首次命中时原子领取带毫秒标识的提醒资格', async () => {
  const { db, calls } = createRepositoryDbStub({
    notification_claimed: true,
    renewal_notice_attempted_at: 1700000000123
  });

  const result = await trafficRepository.disableUserByTrafficLimit(
    db,
    7,
    1700000000,
    'traffic_limit',
    1700000000123
  );

  assert.deepEqual(result, {
    disabled: true,
    notificationClaimed: true,
    renewalNoticeAttemptedAt: 1700000000123
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'get');
  assert.match(calls[0].sql, /WHERE u\.id = \? AND u\.enabled = 1/);
  assert.match(calls[0].sql, /renewal_notice_attempted_at IS NULL AS notification_claimed/);
  assert.match(calls[0].sql, /CASE WHEN t\.notification_claimed THEN \?/);
  assert.match(calls[0].sql, /renewal_notice_reason = CASE WHEN t\.notification_claimed THEN \?/);
  assert.deepEqual(calls[0].params, [
    7,
    1700000000,
    'traffic_limit',
    1700000000123,
    'traffic_limit'
  ]);
});

test('流量禁用已领取提醒资格时不重复领取', async () => {
  const { db } = createRepositoryDbStub({ notification_claimed: false });

  const result = await trafficRepository.disableUserByTrafficLimit(
    db,
    8,
    1700000001,
    'traffic_limit'
  );

  assert.deepEqual(result, { disabled: true, notificationClaimed: false });
});

test('到期禁用返回本次领取的毫秒提醒标识', async () => {
  const { db, calls } = createRepositoryDbStub({
    notification_claimed: true,
    renewal_notice_attempted_at: 1700000002123
  });

  const result = await trafficRepository.disableUserByExpired(
    db,
    9,
    'expired',
    1700000002,
    1700000002123
  );

  assert.deepEqual(result, {
    disabled: true,
    notificationClaimed: true,
    renewalNoticeAttemptedAt: 1700000002123
  });
  assert.match(calls[0].sql, /u\.enabled = 1/);
  assert.match(calls[0].sql, /u\.expire_at <= \?/);
  assert.match(calls[0].sql, /COALESCE\(p\.plan_type, 'lifetime'\) = 'timed'/);
  assert.match(calls[0].sql, /renewal_notice_attempted_at IS NULL AS notification_claimed/);
  assert.deepEqual(calls[0].params, [
    9,
    1700000002,
    'expired',
    1700000002123,
    'expired'
  ]);
});

test('提醒发送前续费已清空标记并启用时旧 claim 不发送', async () => {
  const { db, calls, state } = createRenewalNoticeTransactionDb(undefined);
  let sendCount = 0;

  const result = await trafficRepository.withClaimedRenewalNotice(
    db,
    12,
    'traffic_limit',
    1700000003123,
    async () => {
      sendCount += 1;
    }
  );

  assert.deepEqual(result, { matched: false });
  assert.equal(sendCount, 0);
  assert.match(calls[1].sql, /SELECT.+FROM users.+FOR UPDATE/);
  assert.match(calls[1].sql, /enabled = 0/);
  assert.deepEqual(calls[1].params, [12, 1700000003123, 'traffic_limit']);
  assert.equal(state.committed, true);
  assert.equal(state.released, true);
});

test('状态与 claim 精确匹配时持有用户行锁发送一次', async () => {
  const { db, calls, state } = createRenewalNoticeTransactionDb({ id: 13 });
  const events = [];

  const result = await trafficRepository.withClaimedRenewalNotice(
    db,
    13,
    'expired',
    1700000004123,
    async (...args) => {
      assert.equal(args.length, 0, '持锁回调不得暴露事务连接');
      events.push('email');
      return { sent: true };
    }
  );

  assert.deepEqual(result, { matched: true, result: { sent: true } });
  assert.deepEqual(events, ['email']);
  assert.equal(calls[0].sql, 'BEGIN');
  assert.equal(calls[calls.length - 1].sql, 'COMMIT');
  assert.equal(state.committed, true);
  assert.equal(state.released, true);
});

test('锁内发送异常时事务回滚并释放专用连接', async () => {
  const { db, state } = createRenewalNoticeTransactionDb({ id: 14 });

  await assert.rejects(
    () => trafficRepository.withClaimedRenewalNotice(
      db,
      14,
      'expired',
      1700000005123,
      async () => {
        throw new Error('send failed');
      }
    ),
    /send failed/
  );

  assert.equal(state.committed, false);
  assert.equal(state.rolledBack, true);
  assert.equal(state.released, true);
});

test('锁内邮件超时后及时提交事务并释放专用连接', async () => {
  const { db, state } = createRenewalNoticeTransactionDb({ id: 15 });
  const originalSendEmail = sharedEmailService.sendEmail;
  const rootDb = {
    lateQueries: 0,
    prepare() {
      this.lateQueries += 1;
      return {};
    }
  };
  sharedEmailService.sendEmail = async (receivedDb) => new Promise((resolve) => {
    setTimeout(() => {
      receivedDb.prepare('SELECT late');
      resolve({ success: true });
    }, 20);
  });

  try {
    const startedAt = Date.now();
    const result = await trafficRepository.withClaimedRenewalNotice(
      db,
      15,
      'traffic_limit',
      1700000006123,
      async () => renewalRequiredEmailService.sendEmailWithTimeout(rootDb, {}, 5)
    );

    assert.deepEqual(result, { matched: true, result: { timedOut: true } });
    assert.ok(Date.now() - startedAt < 100);
    assert.equal(state.committed, true);
    assert.equal(state.rolledBack, false);
    assert.equal(state.released, true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(rootDb.lateQueries, 1, '迟到数据库访问必须使用 root db');
  } finally {
    sharedEmailService.sendEmail = originalSendEmail;
  }
});

test('禁用条件未命中时返回统一的未禁用结构', async () => {
  const trafficDb = createRepositoryDbStub(undefined).db;
  const expiredDb = createRepositoryDbStub(undefined).db;

  assert.deepEqual(
    await trafficRepository.disableUserByTrafficLimit(
      trafficDb,
      10,
      1700000003,
      'traffic_limit'
    ),
    { disabled: false, notificationClaimed: false }
  );
  assert.deepEqual(
    await trafficRepository.disableUserByExpired(
      expiredDb,
      10,
      'expired',
      1700000003
    ),
    { disabled: false, notificationClaimed: false }
  );
});

test('支付后更新用户权益时无条件清空续费提醒状态', async () => {
  const { db, calls } = createRepositoryDbStub(undefined);

  await orderRepository.updateUserAfterPaidOrder(db, {
    userId: 11,
    planId: 2,
    trafficLimit: 1024,
    expireAt: 1701000000,
    resetTrafficUsed: false,
    updatedAt: 1700000004
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /renewal_notice_attempted_at = NULL/);
  assert.match(calls[0].sql, /renewal_notice_reason = NULL/);
});

/**
 * 构造用户状态锁数据库桩。
 * @param {boolean} locked - 是否成功获取状态锁
 * @returns {Object} advisory lock 数据库桩
 */
function createStatusLockDb(locked = true) {
  return {
    prepare(sql) {
      return {
        async get() {
          if (sql.includes('pg_try_advisory_lock')) return { locked };
          if (sql.includes('pg_advisory_unlock')) return { unlocked: true };
          throw new Error(`unexpected sql: ${sql}`);
        }
      };
    }
  };
}

test('traffic manager 仅在首次禁用领取资格后发送一次续费提醒', async (t) => {
  const originals = {
    findLatestUserDisableState: trafficRepository.findLatestUserDisableState,
    disableUserByTrafficLimit: trafficRepository.disableUserByTrafficLimit,
    listOnlineServers: trafficRepository.listOnlineServers,
    findUserEmailById: trafficRepository.findUserEmailById,
    listExpiredEnabledUsers: trafficRepository.listExpiredEnabledUsers,
    disableUserByExpired: trafficRepository.disableUserByExpired,
    withClaimedRenewalNotice: trafficRepository.withClaimedRenewalNotice,
    sendRenewalRequiredEmail: renewalRequiredEmailService.sendRenewalRequiredEmail,
    enqueueTask: xuiSyncTaskService.enqueueTask
  };
  const sent = [];
  const emailDbs = [];
  const events = [];
  renewalRequiredEmailService.sendRenewalRequiredEmail = async (receivedDb, payload) => {
    emailDbs.push(receivedDb);
    events.push('email');
    sent.push(payload);
    return { sent: true, status: 'email_sent' };
  };
  trafficRepository.listOnlineServers = async () => [];
  trafficRepository.findUserEmailById = async (_db, userId) => ({
    id: userId,
    email: 'notice@example.com'
  });
  xuiSyncTaskService.enqueueTask = async () => {
    events.push('enqueue');
    return 1;
  };
  trafficRepository.withClaimedRenewalNotice = async (_db, _userId, _reason, _claim, handler) => ({
    matched: true,
    result: await handler({ transactionDb: true })
  });

  try {
    await t.test('流量 claimed=false、锁忙、二次校验未命中和补偿路径均不发信', async () => {
      trafficRepository.findLatestUserDisableState = async () => ({
        enabled: 1, traffic_used: 100, traffic_limit: 100
      });
      trafficRepository.disableUserByTrafficLimit = async () => ({
        disabled: true, notificationClaimed: false
      });
      await trafficManager.checkAndDisableOverLimitUsers(createStatusLockDb(true), {
        1: { email: 'notice@example.com', isOverLimit: true }
      });
      await trafficManager.checkAndDisableOverLimitUsers(createStatusLockDb(false), {
        2: { email: 'notice@example.com', isOverLimit: true }
      });
      trafficRepository.findLatestUserDisableState = async () => ({
        enabled: 1, traffic_used: 99, traffic_limit: 100
      });
      await trafficManager.checkAndDisableOverLimitUsers(createStatusLockDb(true), {
        3: { email: 'notice@example.com', isOverLimit: true }
      });
      trafficRepository.findLatestUserDisableState = async () => ({
        enabled: 0, traffic_used: 100, traffic_limit: 100
      });
      await trafficManager.checkAndDisableOverLimitUsers(createStatusLockDb(true), {
        4: { email: 'notice@example.com', isOverLimit: true }
      }, {
        server: {
          'notice@example.com-node': { enabledKnown: true, enabled: false }
        }
      });
      assert.deepEqual(sent, []);
    });

    await t.test('到期 claimed=true 发一次 expired，其他分支不发且邮件异常不破坏禁用', async () => {
      trafficRepository.listExpiredEnabledUsers = async () => [
        { id: 10, email: 'expired@example.com', expire_at: 1 }
      ];
      trafficRepository.disableUserByExpired = async () => ({
        disabled: true,
        notificationClaimed: true,
        renewalNoticeAttemptedAt: 1700000000001
      });
      const claimedDb = createStatusLockDb(true);
      const claimedResult = await trafficManager.checkAndDisableExpiredUsers(claimedDb, 2);
      assert.equal(claimedResult.disabledCount, 1);
      assert.deepEqual(sent, [{ userId: 10, reason: 'expired' }]);
      assert.equal(emailDbs[0], claimedDb, '邮件服务必须收到 root db');
      assert.deepEqual(events, ['enqueue', 'email']);

      sent.length = 0;
      events.length = 0;
      trafficRepository.disableUserByExpired = async () => ({
        disabled: true, notificationClaimed: false
      });
      await trafficManager.checkAndDisableExpiredUsers(createStatusLockDb(true), 2);
      await trafficManager.checkAndDisableExpiredUsers(createStatusLockDb(false), 2);
      trafficRepository.disableUserByExpired = async () => ({
        disabled: false, notificationClaimed: false
      });
      await trafficManager.checkAndDisableExpiredUsers(createStatusLockDb(true), 2);
      assert.deepEqual(sent, []);
      events.length = 0;

      trafficRepository.disableUserByExpired = async () => ({
        disabled: true,
        notificationClaimed: true,
        renewalNoticeAttemptedAt: 1700000000002
      });
      xuiSyncTaskService.enqueueTask = async () => {
        events.push('enqueue-error');
        throw new Error('stub enqueue failure');
      };
      const queueErrorResult = await trafficManager.checkAndDisableExpiredUsers(
        createStatusLockDb(true),
        2
      );
      assert.equal(queueErrorResult.disabledCount, 1);
      assert.deepEqual(sent, [{ userId: 10, reason: 'expired' }]);
      assert.deepEqual(events, ['enqueue-error', 'email']);

      sent.length = 0;
      events.length = 0;
      renewalRequiredEmailService.sendRenewalRequiredEmail = async () => {
        throw new Error('stub email failure');
      };
      const errorResult = await trafficManager.checkAndDisableExpiredUsers(createStatusLockDb(true), 2);
      assert.equal(errorResult.disabledCount, 1);
    });

    await t.test('lifetime 无到期候选时不进入禁用仓储', async () => {
      let disableCalls = 0;
      trafficRepository.listExpiredEnabledUsers = async () => [];
      trafficRepository.disableUserByExpired = async () => {
        disableCalls++;
        return { disabled: true, notificationClaimed: true };
      };
      const result = await trafficManager.checkAndDisableExpiredUsers(createStatusLockDb(true), 2);
      assert.deepEqual(result, { disabledCount: 0, retryCount: 0 });
      assert.equal(disableCalls, 0);
    });
  } finally {
    Object.assign(trafficRepository, {
      findLatestUserDisableState: originals.findLatestUserDisableState,
      disableUserByTrafficLimit: originals.disableUserByTrafficLimit,
      listOnlineServers: originals.listOnlineServers,
      findUserEmailById: originals.findUserEmailById,
      listExpiredEnabledUsers: originals.listExpiredEnabledUsers,
      disableUserByExpired: originals.disableUserByExpired,
      withClaimedRenewalNotice: originals.withClaimedRenewalNotice
    });
    renewalRequiredEmailService.sendRenewalRequiredEmail = originals.sendRenewalRequiredEmail;
    xuiSyncTaskService.enqueueTask = originals.enqueueTask;
  }
});
