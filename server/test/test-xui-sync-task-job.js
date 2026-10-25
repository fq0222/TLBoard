const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

/**
 * 使用替身加载 3X-UI 重试队列 handler，避免真实服务依赖影响调度间隔断言。
 * @param {Object} overrides - 需要覆盖的服务与仓储依赖。
 * @returns {{handler:Object,logs:string[],logEntries:Object[],restore:Function}} 已隔离的 handler、分级日志与恢复函数。
 */
function loadHandlerForTest(overrides = {}) {
  const handlerPath = require.resolve('../jobs/handlers/sync-xui-tasks');
  const originalCache = require.cache[handlerPath];
  const originalLoad = Module._load;
  const logs = [];
  const logEntries = [];

  delete require.cache[handlerPath];
  const dependencies = {
    '../../services/shared/order-service': {},
    '../../services/shared/traffic-manager': {},
    '../../services/user/subscription-service': {},
    '../../services/user/subscription-credential-rotation-service': {},
    '../../integrations/xui/xui-sync-task-service': {},
    ...overrides,
    '../../repositories/xui-sync-repository': {
      deleteExpiredTerminalTasks: async () => 0,
      ...overrides['../../repositories/xui-sync-repository']
    }
  };

  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(dependencies, request)) return dependencies[request];
    if (request === '../../utils/logger') {
      return {
        createLogger: () => ({
          info: message => {
            logs.push(message);
            logEntries.push({ level: 'info', message });
          },
          warn: message => {
            logs.push(message);
            logEntries.push({ level: 'warn', message });
          },
          error: message => {
            logs.push(message);
            logEntries.push({ level: 'error', message });
          }
        })
      };
    }
    if (request === '../xui-job-scheduler') {
      return { schedule: () => {} };
    }
    return originalLoad(request, parent, isMain);
  };

  const handler = require(handlerPath);

  return {
    handler,
    logs,
    logEntries,
    restore: () => {
      Module._load = originalLoad;
      if (originalCache) {
        require.cache[handlerPath] = originalCache;
      } else {
        delete require.cache[handlerPath];
      }
    }
  };
}

test('3X-UI 同步重试队列每 3 分钟轮询一次', () => {
  const { handler, logs, restore } = loadHandlerForTest();
  const originalSetInterval = global.setInterval;
  const delays = [];

  global.setInterval = (callback, delay) => {
    delays.push(delay);
    return { callback, delay };
  };

  try {
    const intervals = [];
    let timeoutDelay = null;
    handler.registerXuiSyncTaskJob({
      db: {},
      intervals,
      registerTimeout: (callback, delay) => {
        timeoutDelay = delay;
        return { callback, delay };
      }
    });

    assert.equal(timeoutDelay, 30 * 1000);
    assert.deepEqual(delays, [3 * 60 * 1000]);
    assert.equal(intervals.length, 1);
    assert.ok(logs.some(message => message.includes('每3分钟执行一次')));
  } finally {
    global.setInterval = originalSetInterval;
    restore();
  }
});

/**
 * 验证 worker 将完整轮换任务交给专用处理器，而不是误入普通用户同步计划。
 * 生产缺陷：缺少独立分支时任务会按未知类型失败并永远重试。
 */
test('凭证轮换任务分发给专用处理器并保留完整任务', async () => {
  const task = {
    id: 41,
    user_id: 7,
    task_type: 'credential_rotation_sync',
    payload_data: { user_id: 7, serverIds: [2, 3] }
  };
  const calls = [];
  const syncTaskService = {
    TASK_TYPES: {
      INITIAL_USER_SYNC: 'initial_user_sync', RENEW_SYNC: 'renew_sync', USER_SYNC: 'user_sync',
      ENABLE_SYNC: 'enable_sync', DISABLE_SYNC: 'disable_sync', SUBSCRIPTION_SOURCE_REFRESH: 'subscription_source_refresh',
      CREDENTIAL_ROTATION_SYNC: 'credential_rotation_sync'
    },
    async processDueTasks(db, handler, options) {
      options.onStart([task]);
      const result = await handler(task);
      return { processed: 1, success: result.success ? 1 : 0, failed: result.success ? 0 : 1, finalFailed: 0 };
    }
  };
  const { handler, logs, restore } = loadHandlerForTest({
    '../../integrations/xui/xui-sync-task-service': syncTaskService,
    '../../repositories/xui-sync-repository': { findUserForSyncTask: async () => ({
      id: 7, email: 'u@example.com', traffic_limit: '11811160064', expire_at: 0
    }) },
    '../../services/user/subscription-credential-rotation-service': {
      processRotationTask: async (db, receivedTask) => {
        calls.push({ db, task: receivedTask });
        return { success: true, failedServerIds: [] };
      }
    }
  });

  try {
    const db = { marker: 'db' };
    await handler.runXuiSyncTasks(db);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].db, db);
    assert.equal(calls[0].task, task);
    assert.ok(logs.includes(
      '凭证轮换任务使用最新用户状态: task=41, user=u@example.com, traffic_limit=11811160064, expire_at=0'
    ));
    assert.ok(!logs.some(message => message.includes('traffic_limit=0->11811160064')));
  } finally {
    restore();
  }
});

/** 普通同步任务具有入队用户快照时，仍应保留旧值到新值的差异日志。 */
test('普通用户同步任务保留权益快照差异日志', async () => {
  const task = {
    id: 43,
    user_id: 7,
    task_type: 'user_sync',
    payload_data: { user: { id: 7, traffic_limit: 1024, expire_at: 100 }, plan: {} }
  };
  const syncTaskService = {
    TASK_TYPES: {
      INITIAL_USER_SYNC: 'initial_user_sync', RENEW_SYNC: 'renew_sync', USER_SYNC: 'user_sync',
      ENABLE_SYNC: 'enable_sync', DISABLE_SYNC: 'disable_sync', SUBSCRIPTION_SOURCE_REFRESH: 'subscription_source_refresh',
      CREDENTIAL_ROTATION_SYNC: 'credential_rotation_sync'
    },
    async processDueTasks(db, handler, options) {
      options.onStart([task]);
      const result = await handler(task);
      return { processed: 1, success: result.success ? 1 : 0, failed: result.success ? 0 : 1, finalFailed: 0 };
    }
  };
  const { handler, logs, restore } = loadHandlerForTest({
    '../../integrations/xui/xui-sync-task-service': syncTaskService,
    '../../repositories/xui-sync-repository': { findUserForSyncTask: async () => ({
      id: 7, email: 'u@example.com', traffic_limit: 2048, expire_at: 200
    }) },
    '../../services/shared/order-service': { syncUserToXuiServers: async () => ({ success: true }) }
  });

  try {
    await handler.runXuiSyncTasks({});
    assert.ok(logs.includes(
      '3X-UI 同步队列任务使用最新用户状态: task=43, user=u@example.com, traffic_limit=1024->2048, expire_at=100->200'
    ));
  } finally {
    restore();
  }
});

/**
 * 验证轮换任务关联用户已删除时按成功跳过，不调用远端处理器。
 * 生产缺陷：直接处理会让已无法完成的任务永久占用重试队列。
 */
test('凭证轮换任务用户不存在时安全结束', async () => {
  const task = { id: 42, user_id: 8, task_type: 'credential_rotation_sync', payload_data: { user_id: 8, serverIds: [2] } };
  let rotationCalls = 0;
  let handlerResult;
  const syncTaskService = {
    TASK_TYPES: {
      INITIAL_USER_SYNC: 'initial_user_sync', RENEW_SYNC: 'renew_sync', USER_SYNC: 'user_sync',
      ENABLE_SYNC: 'enable_sync', DISABLE_SYNC: 'disable_sync', SUBSCRIPTION_SOURCE_REFRESH: 'subscription_source_refresh',
      CREDENTIAL_ROTATION_SYNC: 'credential_rotation_sync'
    },
    async processDueTasks(db, handler, options) {
      options.onStart([task]);
      handlerResult = await handler(task);
      return { processed: 1, success: handlerResult.success ? 1 : 0, failed: handlerResult.success ? 0 : 1, finalFailed: 0 };
    }
  };
  const { handler, restore } = loadHandlerForTest({
    '../../integrations/xui/xui-sync-task-service': syncTaskService,
    '../../repositories/xui-sync-repository': { findUserForSyncTask: async () => null },
    '../../services/user/subscription-credential-rotation-service': {
      processRotationTask: async () => { rotationCalls++; return { success: true }; }
    }
  });

  try {
    await handler.runXuiSyncTasks({});
    assert.equal(rotationCalls, 0);
    assert.deepEqual(handlerResult, { success: true, message: '用户不存在，任务已跳过' });
  } finally {
    restore();
  }
});

/** 缺少批次末尾清理、截止时间或批量参数错误时，应无法满足仓储调用及完成日志契约。 */
test('同步批次结束后按 15 天截止时间清理最多 50 条', async () => {
  const originalNow = Date.now;
  let now = 1800000000789;
  Date.now = () => now;
  const db = { marker: 'cleanup-db' };
  const calls = [];
  const { handler, logs, logEntries, restore } = loadHandlerForTest({
    '../../integrations/xui/xui-sync-task-service': {
      async processDueTasks(receivedDb) {
        assert.equal(receivedDb, db);
        calls.push('process-start');
        await Promise.resolve();
        now += 10;
        calls.push('process-end');
        return { processed: 4, success: 2, failed: 1, finalFailed: 1 };
      }
    },
    '../../repositories/xui-sync-repository': {
      async deleteExpiredTerminalTasks(receivedDb, cutoff, limit) {
        calls.push('cleanup');
        assert.equal(receivedDb, db);
        assert.equal(cutoff, 1798704000);
        assert.equal(limit, 50);
        now += 7;
        return 3;
      }
    }
  });

  try {
    await assert.doesNotReject(() => handler.runXuiSyncTasks(db));
    assert.deepEqual(calls, ['process-start', 'process-end', 'cleanup']);
    const summaryIndex = logs.findIndex(message => message.includes('status=success, processed=4, success=2, failed=1, finalFailed=1, duration=10ms'));
    const cleanupIndex = logs.findIndex(message => message.includes('deleted=3, duration=7ms'));
    assert.ok(summaryIndex >= 0);
    assert.ok(cleanupIndex > summaryIndex);
    assert.ok(logEntries.some(entry => entry.level === 'info' && entry.message.includes('deleted=3, duration=7ms')));
    assert.ok(!logEntries.some(entry => entry.level === 'error'));
  } finally {
    Date.now = originalNow;
    restore();
  }
});

/** 空队列不能提前结束 worker，否则没有新增任务时过期历史将永远得不到清理。 */
test('没有到期同步任务时仍执行历史清理', async () => {
  const originalNow = Date.now;
  Date.now = () => 1800000000789;
  const calls = [];
  const { handler, logEntries, restore } = loadHandlerForTest({
    '../../integrations/xui/xui-sync-task-service': {
      async processDueTasks() {
        calls.push('process');
        return { processed: 0, success: 0, failed: 0, finalFailed: 0 };
      }
    },
    '../../repositories/xui-sync-repository': {
      async deleteExpiredTerminalTasks() {
        calls.push('cleanup');
        return 0;
      }
    }
  });

  try {
    await assert.doesNotReject(() => handler.runXuiSyncTasks({}));
    assert.deepEqual(calls, ['process', 'cleanup']);
    assert.ok(logEntries.some(entry => entry.level === 'info' && entry.message.includes('deleted=0, duration=0ms')));
  } finally {
    Date.now = originalNow;
    restore();
  }
});

/** 清理放在正常成功分支会遗漏同步异常路径；异常不能向调度器传播。 */
test('同步处理抛错后仍执行历史清理', async () => {
  const originalNow = Date.now;
  Date.now = () => 1800000000789;
  const calls = [];
  const { handler, logEntries, restore } = loadHandlerForTest({
    '../../integrations/xui/xui-sync-task-service': {
      async processDueTasks() {
        calls.push('process');
        throw new Error('同步处理失败');
      }
    },
    '../../repositories/xui-sync-repository': {
      async deleteExpiredTerminalTasks() {
        calls.push('cleanup');
        return 0;
      }
    }
  });

  try {
    await assert.doesNotReject(() => handler.runXuiSyncTasks({}));
    assert.deepEqual(calls, ['process', 'cleanup']);
    assert.ok(logEntries.some(entry => entry.level === 'error' && entry.message.includes('同步处理失败')));
    assert.ok(logEntries.some(entry => entry.level === 'info' && entry.message.includes('deleted=0, duration=0ms')));
  } finally {
    Date.now = originalNow;
    restore();
  }
});

/** 清理异常必须被隔离并释放锁，否则异常会终止 worker 或让下一轮永久跳过。 */
test('历史清理失败只写错误日志且不影响下一轮执行', async () => {
  const originalNow = Date.now;
  let now = 1800000000789;
  Date.now = () => now;
  let processCalls = 0;
  let cleanupCalls = 0;
  const { handler, logEntries, restore } = loadHandlerForTest({
    '../../integrations/xui/xui-sync-task-service': {
      async processDueTasks() {
        processCalls++;
        return { processed: 0, success: 0, failed: 0, finalFailed: 0 };
      }
    },
    '../../repositories/xui-sync-repository': {
      async deleteExpiredTerminalTasks() {
        cleanupCalls++;
        if (cleanupCalls === 1) {
          now += 17;
          throw new Error('历史清理数据库不可用');
        }
        return 0;
      }
    }
  });

  try {
    await assert.doesNotReject(() => handler.runXuiSyncTasks({}));
    assert.equal(cleanupCalls, 1);
    assert.deepEqual(logEntries.map(entry => entry.level), ['error']);
    assert.ok(logEntries[0].message.includes('error=历史清理数据库不可用, duration=17ms'));
    await assert.doesNotReject(() => handler.runXuiSyncTasks({}));
    assert.equal(processCalls, 2);
    assert.equal(cleanupCalls, 2);
    assert.equal(logEntries.filter(entry => entry.level === 'error').length, 1);
    assert.ok(logEntries.some(entry => entry.level === 'info' && entry.message.includes('deleted=0, duration=0ms')));
  } finally {
    Date.now = originalNow;
    restore();
  }
});

/** 仓储拒绝值未携带 message 时，也必须记录原因并保持 worker 正常结束。 */
test('历史清理抛出 null 时仍隔离错误并记录耗时', async () => {
  const originalNow = Date.now;
  Date.now = () => 1800000000789;
  const { handler, logEntries, restore } = loadHandlerForTest({
    '../../integrations/xui/xui-sync-task-service': {
      processDueTasks: async () => ({ processed: 0, success: 0, failed: 0, finalFailed: 0 })
    },
    '../../repositories/xui-sync-repository': {
      async deleteExpiredTerminalTasks() {
        throw null;
      }
    }
  });

  try {
    await assert.doesNotReject(() => handler.runXuiSyncTasks({}));
    assert.equal(logEntries.length, 1);
    assert.equal(logEntries[0].level, 'error');
    assert.ok(logEntries[0].message.includes('error=null, duration=0ms'));
  } finally {
    Date.now = originalNow;
    restore();
  }
});
