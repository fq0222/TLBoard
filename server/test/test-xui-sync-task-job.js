const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

/**
 * 使用替身加载 3X-UI 重试队列 handler，避免真实服务依赖影响调度间隔断言。
 * @returns {{handler:Object,logs:string[],restore:Function}} 已隔离的 handler 与恢复函数。
 */
function loadHandlerForTest(overrides = {}) {
  const handlerPath = require.resolve('../jobs/handlers/sync-xui-tasks');
  const originalCache = require.cache[handlerPath];
  const originalLoad = Module._load;
  const logs = [];

  delete require.cache[handlerPath];
  const dependencies = {
    '../../services/shared/order-service': {},
    '../../services/shared/traffic-manager': {},
    '../../services/user/subscription-service': {},
    '../../services/user/subscription-credential-rotation-service': {},
    '../../integrations/xui/xui-sync-task-service': {},
    '../../repositories/xui-sync-repository': {},
    ...overrides
  };

  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(dependencies, request)) return dependencies[request];
    if (request === '../../utils/logger') {
      return {
        createLogger: () => ({
          info: message => logs.push(message),
          warn: () => {},
          error: () => {}
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
