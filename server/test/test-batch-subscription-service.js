/**
 * 管理端批量订阅生成服务测试。
 * 使用桩仓储验证任务创建与重启恢复分支，避免测试直接访问真实 3X-UI。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const batchSubscriptionService = require('../services/admin/batch-subscription-service');
const batchRepository = require('../repositories/batch-subscription-repository');

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
