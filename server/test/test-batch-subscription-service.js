/**
 * 管理端批量订阅生成服务测试。
 * 使用桩仓储验证任务创建与重启恢复分支，避免测试直接访问真实 3X-UI。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const batchSubscriptionService = require('../services/admin/batch-subscription-service');
const batchRepository = require('../repositories/batch-subscription-repository');
const usersService = require('../services/admin/users-service');
const XuiService = require('../integrations/xui/xui-service');
const { getServerInboundsSnapshot } = require('../integrations/xui/xui-sync');

/**
 * 临时替换对象方法，并在测试结束时恢复。
 *
 * @param {Object} target - 被替换对象
 * @param {Object} replacements - 方法替换表
 * @returns {Function} 恢复函数
 */
function replaceMethods(target, replacements) {
  const originals = {};
  Object.keys(replacements).forEach((key) => {
    originals[key] = target[key];
    target[key] = replacements[key];
  });

  return () => {
    Object.keys(originals).forEach((key) => {
      target[key] = originals[key];
    });
  };
}

/**
 * 临时替换 XuiService.getInstance，并在测试结束时恢复。
 *
 * @param {Array<Object>} results - 每次 getInbounds 返回的结果队列
 * @returns {{restore: Function, getCallCount: Function}} 恢复函数与调用计数读取器
 */
function stubGetInbounds(results) {
  const originalGetInstance = XuiService.getInstance;
  let callCount = 0;

  XuiService.getInstance = async () => ({
    async getInbounds() {
      callCount++;
      return results.shift();
    }
  });

  return {
    restore() {
      XuiService.getInstance = originalGetInstance;
    },
    getCallCount() {
      return callCount;
    }
  };
}

test('batch subscription service creates persistent task with selected users', async () => {
  const originalProcessTask = batchSubscriptionService.processTask;
  let processTaskId = null;
  batchSubscriptionService.processing = false;
  batchSubscriptionService.processTask = async (taskId) => {
    processTaskId = taskId;
  };

  const restoreRepository = replaceMethods(batchRepository, {
    findActiveTask: async () => null,
    listBatchUsers: async (db, options) => {
      assert.equal(options.cfOptimizedOnly, true);
      return [{ id: 1, email: 'user@example.com' }];
    },
    createTaskWithItems: async (db, payload) => {
      assert.equal(payload.cfOptimizedOnly, true);
      assert.equal(payload.users.length, 1);
      return {
        id: 10,
        status: 'pending',
        current_email: '',
        completed_count: 0,
        total_count: 1,
        failed_count: 0,
        filter_cf_optimized: 1
      };
    }
  });

  try {
    const status = await batchSubscriptionService.startTask({}, { cfOptimizedOnly: true });
    assert.equal(status.id, 10);
    assert.equal(status.total_count, 1);
    assert.equal(processTaskId, 10);
  } finally {
    restoreRepository();
    batchSubscriptionService.processTask = originalProcessTask;
  }
});

test('batch subscription service restores unfinished task after restart', async () => {
  const originalProcessTask = batchSubscriptionService.processTask;
  let resetTaskId = null;
  let updatedFields = null;
  let processTaskId = null;

  batchSubscriptionService.processing = false;
  batchSubscriptionService.processTask = async (taskId) => {
    processTaskId = taskId;
  };

  const restoreRepository = replaceMethods(batchRepository, {
    findActiveTask: async () => ({ id: 12, status: 'running' }),
    resetRunningItems: async (db, taskId) => {
      resetTaskId = taskId;
    },
    updateTask: async (db, taskId, fields) => {
      assert.equal(taskId, 12);
      updatedFields = fields;
    }
  });

  try {
    await batchSubscriptionService.resumeUnfinishedTask({});
    assert.equal(resetTaskId, 12);
    assert.equal(updatedFields.status, 'paused');
    assert.equal(updatedFields.current_email, '');
    assert.equal(processTaskId, 12);
  } finally {
    restoreRepository();
    batchSubscriptionService.processTask = originalProcessTask;
  }
});

test('batch repository overwrites existing user item when creating new task', async () => {
  const queries = [];
  const fakeDb = {
    pool: {
      async connect() {
        return {
          async query(sql, params) {
            queries.push({ sql, params });
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
              return { rows: [] };
            }
            if (sql.includes('INSERT INTO batch_subscription_tasks')) {
              return {
                rows: [{
                  id: 20,
                  status: 'pending',
                  current_email: '',
                  completed_count: 0,
                  total_count: 1,
                  failed_count: 0,
                  filter_cf_optimized: 1
                }]
              };
            }
            return { rows: [] };
          },
          release() {}
        };
      }
    }
  };

  await batchRepository.createTaskWithItems(fakeDb, {
    cfOptimizedOnly: true,
    users: [{ id: 31, email: 'start@163.com' }]
  });

  const itemInsert = queries.find(query => query.sql.includes('INSERT INTO batch_subscription_task_items'));
  assert.ok(itemInsert.sql.includes('ON CONFLICT (user_id) DO UPDATE'));
  assert.ok(itemInsert.sql.includes('task_id = EXCLUDED.task_id'));
  assert.equal(itemInsert.params[1], 31);
});

test('batch subscription status query wakes pending task processor', async () => {
  const originalProcessTask = batchSubscriptionService.processTask;
  let processTaskId = null;

  batchSubscriptionService.processing = false;
  batchSubscriptionService.processTask = async (taskId) => {
    processTaskId = taskId;
  };

  const restoreRepository = replaceMethods(batchRepository, {
    findLatestTask: async () => ({
      id: 33,
      status: 'pending',
      current_email: '',
      completed_count: 0,
      total_count: 75,
      failed_count: 0,
      filter_cf_optimized: 1
    })
  });

  try {
    const status = await batchSubscriptionService.getLatestStatus({});
    assert.equal(status.id, 33);
    assert.equal(status.status_text, '等待中');
    assert.equal(processTaskId, 33);
  } finally {
    restoreRepository();
    batchSubscriptionService.processTask = originalProcessTask;
  }
});

test('batch subscription processor shares inbound snapshot cache across users in one task', async () => {
  const seenCaches = [];
  const pendingItems = [
    { id: 101, user_id: 501, email: 'first@example.com' },
    { id: 102, user_id: 502, email: 'second@example.com' }
  ];
  const fakeDb = {};

  batchSubscriptionService.bindDb(fakeDb);
  batchSubscriptionService.processing = false;

  const restoreRepository = replaceMethods(batchRepository, {
    getTaskById: async () => ({
      id: 40,
      status: 'pending',
      current_email: '',
      completed_count: 0,
      total_count: 2,
      failed_count: 0,
      filter_cf_optimized: 1
    }),
    findNextPendingItem: async () => pendingItems.shift() || null,
    updateTask: async () => {},
    markItemRunning: async () => {},
    markItemSuccess: async () => {},
    markItemFailed: async () => {},
    refreshTaskCounters: async () => ({
      id: 40,
      status: 'running',
      current_email: '',
      completed_count: seenCaches.length,
      total_count: 2,
      failed_count: 0,
      filter_cf_optimized: 1
    })
  });
  const restoreUsersService = replaceMethods(usersService, {
    generateSubscription: async (db, userId, logger, options) => {
      assert.equal(db, fakeDb);
      assert.ok([501, 502].includes(userId));
      assert.ok(options && options.inboundSnapshotCache, '应传入批量任务级 inbound 快照缓存');
      seenCaches.push(options.inboundSnapshotCache);
      return {
        sub_id: `sub-${userId}`,
        node_count: 1
      };
    }
  });

  try {
    await batchSubscriptionService.processTask(40);

    assert.equal(seenCaches.length, 2);
    assert.strictEqual(seenCaches[0], seenCaches[1], '同一批量任务内应复用同一个 inbound 快照缓存实例');
  } finally {
    restoreUsersService();
    restoreRepository();
    batchSubscriptionService.processing = false;
    batchSubscriptionService.bindDb(null);
  }
});

test('inbound snapshot cache reuses successful snapshot by server id', async () => {
  const successResult = {
    success: true,
    data: [{ id: 1, remark: 'cf-node' }]
  };
  const stub = stubGetInbounds([successResult]);
  const cache = new Map();
  const server = {
    id: 8,
    api_url: 'http://xui.local',
    api_token: 'token',
    panel_version: '3.0.2'
  };

  try {
    const first = await getServerInboundsSnapshot(server, { inboundSnapshotCache: cache });
    const second = await getServerInboundsSnapshot(server, { inboundSnapshotCache: cache });

    assert.strictEqual(first, successResult);
    assert.strictEqual(second, successResult);
    assert.equal(stub.getCallCount(), 1);
  } finally {
    stub.restore();
  }
});

test('inbound snapshot cache does not cache failed result', async () => {
  const failedResult = {
    success: false,
    message: 'temporary failure'
  };
  const successResult = {
    success: true,
    data: [{ id: 2, remark: 'direct-node' }]
  };
  const stub = stubGetInbounds([failedResult, successResult]);
  const cache = new Map();
  const server = {
    id: 9,
    api_url: 'http://xui.local',
    api_token: 'token',
    panel_version: '3.0.2'
  };

  try {
    const first = await getServerInboundsSnapshot(server, { inboundSnapshotCache: cache });
    const second = await getServerInboundsSnapshot(server, { inboundSnapshotCache: cache });

    assert.strictEqual(first, failedResult);
    assert.strictEqual(second, successResult);
    assert.equal(stub.getCallCount(), 2);
  } finally {
    stub.restore();
  }
});

test('inbound snapshot cache refreshes after one hour', async () => {
  const firstResult = {
    success: true,
    data: [{ id: 3, remark: 'old-node' }]
  };
  const secondResult = {
    success: true,
    data: [{ id: 3, remark: 'new-node' }]
  };
  const originalDateNow = Date.now;
  const stub = stubGetInbounds([firstResult, secondResult]);
  const cache = new Map();
  const server = {
    id: 10,
    api_url: 'http://xui.local',
    api_token: 'token',
    panel_version: '3.0.2'
  };

  try {
    Date.now = () => 1000;
    const first = await getServerInboundsSnapshot(server, { inboundSnapshotCache: cache });

    Date.now = () => 1000 + (60 * 60 * 1000) + 1;
    const second = await getServerInboundsSnapshot(server, { inboundSnapshotCache: cache });

    assert.strictEqual(first, firstResult);
    assert.strictEqual(second, secondResult);
    assert.equal(stub.getCallCount(), 2);
  } finally {
    Date.now = originalDateNow;
    stub.restore();
  }
});
