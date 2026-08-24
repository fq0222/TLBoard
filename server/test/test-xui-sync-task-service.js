const assert = require('assert');
const syncTaskService = require('../integrations/xui/xui-sync-task-service');

function createFakeDb(initialTasks = []) {
  const tasks = initialTasks.map(task => ({ ...task }));

  return {
    tasks,
    prepare(sql) {
      return {
        async all(limit) {
          if (sql.includes('FROM xui_sync_tasks')) {
            const now = Math.floor(Date.now() / 1000);
            return tasks
              .filter(task => task.status === 'pending' && task.next_retry_at <= now)
              .sort((a, b) => a.next_retry_at - b.next_retry_at || a.id - b.id)
              .slice(0, limit);
          }
          throw new Error(`Unexpected all SQL: ${sql}`);
        },
        async run(...params) {
          if (sql.includes('被新的') || sql.includes('task_type IN')) {
            const userId = params[2];
            let changes = 0;
            for (const task of tasks) {
              if (
                task.user_id === userId &&
                task.status === 'pending' &&
                ['initial_user_sync', 'renew_sync', 'user_sync'].includes(task.task_type)
              ) {
                task.status = 'success';
                task.last_error = params[0];
                task.updated_at = params[1];
                changes++;
              }
            }
            return { changes };
          }

          if (sql.includes('INSERT INTO xui_sync_tasks')) {
            const id = tasks.length ? Math.max(...tasks.map(task => task.id)) + 1 : 1;
            tasks.push({
              id,
              user_id: params[0],
              task_type: params[1],
              status: 'pending',
              payload: params[2],
              attempts: 0,
              next_retry_at: params[3],
              created_at: params[4],
              updated_at: params[5]
            });
            return { changes: 1, lastInsertRowid: id };
          }

          if (sql.includes("SET status = 'processing'")) {
            const task = tasks.find(item => item.id === params[1]);
            task.status = 'processing';
            task.updated_at = params[0];
            return { changes: 1 };
          }

          if (sql.includes("SET status = 'success'")) {
            const task = tasks.find(item => item.id === params[1]);
            task.status = 'success';
            task.updated_at = params[0];
            return { changes: 1 };
          }

          if (sql.includes("SET status = 'pending'")) {
            const hasPayloadUpdate = sql.includes('payload = ?');
            const task = tasks.find(item => item.id === (hasPayloadUpdate ? params[5] : params[4]));
            task.status = 'pending';
            task.attempts = params[0];
            task.next_retry_at = params[1];
            task.last_error = params[2];
            if (hasPayloadUpdate) {
              task.payload = params[3];
              task.updated_at = params[4];
            } else {
              task.updated_at = params[3];
            }
            return { changes: 1 };
          }

          if (sql.includes("SET status = 'failed'")) {
            const task = tasks.find(item => item.id === params[3]);
            task.status = 'failed';
            task.attempts = params[0];
            task.last_error = params[1];
            task.updated_at = params[2];
            return { changes: 1 };
          }

          throw new Error(`Unexpected run SQL: ${sql}`);
        }
      };
    }
  };
}

async function testSuccessfulTaskIsMarkedSuccess() {
  const db = createFakeDb([
    {
      id: 1,
      task_type: 'renew_sync',
      status: 'pending',
      attempts: 0,
      payload: JSON.stringify({ user_id: 10 }),
      next_retry_at: Math.floor(Date.now() / 1000) - 1
    }
  ]);

  const result = await syncTaskService.processDueTasks(db, async task => {
    assert.strictEqual(task.id, 1);
    return { success: true };
  });

  assert.strictEqual(result.processed, 1);
  assert.strictEqual(result.success, 1);
  assert.strictEqual(db.tasks[0].status, 'success');
}

async function testFailedTaskSchedulesRetry() {
  const db = createFakeDb([
    {
      id: 2,
      task_type: 'renew_sync',
      status: 'pending',
      attempts: 0,
      payload: JSON.stringify({ user_id: 10 }),
      next_retry_at: Math.floor(Date.now() / 1000) - 1
    }
  ]);

  const before = Math.floor(Date.now() / 1000);
  const result = await syncTaskService.processDueTasks(db, async () => {
    throw new Error('xui offline');
  });

  assert.strictEqual(result.processed, 1);
  assert.strictEqual(result.failed, 1);
  assert.strictEqual(db.tasks[0].status, 'pending');
  assert.strictEqual(db.tasks[0].attempts, 1);
  assert.strictEqual(db.tasks[0].last_error, 'xui offline');
  assert.ok(db.tasks[0].next_retry_at >= before + 60);
}

/**
 * 验证用户同步任务部分失败时，下一轮只重试失败服务器。
 *
 * 职责：覆盖 3X-UI 用户同步补偿队列的局部重试语义。
 * 关键参数：handler 返回 failedServerIds，代表本轮未完成的服务器 ID。
 * 核心分支：任务继续 pending，但 payload.plan.serverIds 被缩小到失败服务器集合。
 *
 * @returns {Promise<void>}
 */
async function testFailedUserSyncTaskNarrowsRetryServerIds() {
  const db = createFakeDb([
    {
      id: 7,
      task_type: 'renew_sync',
      status: 'pending',
      attempts: 0,
      payload: JSON.stringify({
        user: { id: 10, email: 'user@example.com' },
        plan: { id: 3, serverIds: [1, 2, 3] }
      }),
      next_retry_at: Math.floor(Date.now() / 1000) - 1
    }
  ]);

  await syncTaskService.processDueTasks(db, async () => ({
    success: false,
    message: 'server 2 timeout',
    failedServerIds: [2]
  }));

  assert.strictEqual(db.tasks[0].status, 'pending');
  assert.deepStrictEqual(JSON.parse(db.tasks[0].payload).plan.serverIds, [2]);
}

async function testExhaustedTaskIsMarkedFailed() {
  const db = createFakeDb([
    {
      id: 3,
      task_type: 'renew_sync',
      status: 'pending',
      attempts: 9,
      payload: JSON.stringify({ user_id: 10 }),
      next_retry_at: Math.floor(Date.now() / 1000) - 1
    }
  ]);

  await syncTaskService.processDueTasks(db, async () => ({ success: false, message: 'bad token' }), {
    maxAttempts: 10
  });

  assert.strictEqual(db.tasks[0].status, 'failed');
  assert.strictEqual(db.tasks[0].attempts, 10);
  assert.strictEqual(db.tasks[0].last_error, 'bad token');
}

async function testNewUserSyncTaskSupersedesOldPendingTask() {
  const db = createFakeDb([
    {
      id: 4,
      user_id: 10,
      task_type: 'initial_user_sync',
      status: 'pending',
      attempts: 1,
      payload: JSON.stringify({ user: { id: 10, traffic_limit: 10 } }),
      next_retry_at: Math.floor(Date.now() / 1000) + 300
    },
    {
      id: 5,
      user_id: 10,
      task_type: 'disable_sync',
      status: 'pending',
      attempts: 0,
      payload: '{}',
      next_retry_at: Math.floor(Date.now() / 1000)
    }
  ]);

  const taskId = await syncTaskService.enqueueTask(db, {
    userId: 10,
    taskType: syncTaskService.TASK_TYPES.RENEW_SYNC,
    payload: { user: { id: 10, traffic_limit: 20 } }
  });

  assert.strictEqual(taskId, 6);
  assert.strictEqual(db.tasks[0].status, 'success');
  assert.strictEqual(db.tasks[0].last_error, '被新的 renew_sync 任务取代');
  assert.strictEqual(db.tasks[1].status, 'pending');
  assert.strictEqual(db.tasks[2].status, 'pending');
  assert.strictEqual(db.tasks[2].task_type, 'renew_sync');
}

async function run() {
  await testSuccessfulTaskIsMarkedSuccess();
  await testFailedTaskSchedulesRetry();
  await testFailedUserSyncTaskNarrowsRetryServerIds();
  await testExhaustedTaskIsMarkedFailed();
  await testNewUserSyncTaskSupersedesOldPendingTask();
  console.log('xui sync task service tests passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
