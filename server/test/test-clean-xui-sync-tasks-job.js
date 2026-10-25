/**
 * 验证同步历史清理 handler 的调度和执行边界；隔离 cron、数据库和日志副作用。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

/** 保存清理 handler 的依赖替身、调度句柄和日志，避免测试启动真实定时任务。 */
class CleanupJobFixture {
  /**
   * @param {Function} deleteExpiredTerminalTasks - 仓储删除替身，按测试场景返回数量或拒绝。
   */
  constructor(deleteExpiredTerminalTasks = async () => 0) {
    this.schedules = [];
    this.logEntries = [];
    const handlerPath = path.resolve(__dirname, '../jobs/handlers/clean-xui-sync-tasks.js');
    const originalCache = require.cache[handlerPath];
    const originalLoad = Module._load;
    const dependencies = {
      'node-cron': {
        schedule: (expression, callback, options) => {
          const task = { expression, callback, options };
          this.schedules.push(task);
          return task;
        }
      },
      '../../repositories/xui-sync-repository': { deleteExpiredTerminalTasks },
      '../../utils/logger': {
        createLogger: () => ({
          info: message => this.logEntries.push({ level: 'info', message }),
          error: message => this.logEntries.push({ level: 'error', message })
        })
      }
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
      if (Object.prototype.hasOwnProperty.call(dependencies, request)) return dependencies[request];
      return originalLoad(request, parent, isMain);
    };
    try {
      this.handler = require(handlerPath);
    } finally {
      // 加载失败时也恢复全局加载器和缓存，避免 RED 污染其他用例。
      Module._load = originalLoad;
      if (originalCache) require.cache[handlerPath] = originalCache;
      else delete require.cache[handlerPath];
    }
  }
}

/** 错误的 cron 时间、时区、丢失句柄或启动补执行都会破坏每日注册契约。 */
test('清理任务只注册北京时间每天 12:00，不在启动时补执行', async () => {
  let cleanupCalls = 0;
  const fixture = new CleanupJobFixture(async () => {
    cleanupCalls++;
    return 0;
  });
  const cronTasks = [];
  fixture.handler.registerCleanXuiSyncTasksJob({ db: {}, cronTasks });
  await Promise.resolve();

  assert.equal(fixture.schedules.length, 1);
  assert.equal(fixture.schedules[0].expression, '0 12 * * *');
  assert.deepEqual(fixture.schedules[0].options, { timezone: 'Asia/Shanghai' });
  assert.deepEqual(cronTasks, [fixture.schedules[0]]);
  assert.equal(cleanupCalls, 0);
  assert.ok(fixture.logEntries.some(entry => entry.level === 'info'
    && entry.message.includes('每天 12:00') && entry.message.includes('北京时间')));

  await fixture.schedules[0].callback();
  assert.equal(cleanupCalls, 1, 'cron 到点后才执行清理');
});

/** 截止时间取整、保留期、批量上限或单次执行次数错误时，应无法满足调用契约。 */
test('清理按 15 天截止时间只删除一批最多 50 条并记录成功耗时', async (t) => {
  let now = 1800000000789;
  t.mock.method(Date, 'now', () => now);
  const db = { marker: 'cleanup-db' };
  const calls = [];
  const fixture = new CleanupJobFixture(async (...args) => {
    calls.push(args);
    now += 17;
    return 50;
  });

  const result = await fixture.handler.runXuiSyncTaskCleanup(db);

  assert.deepEqual(calls, [[db, 1798704000, 50]]);
  assert.deepEqual(result, { success: true, deleted: 50 });
  assert.deepEqual(fixture.logEntries.map(entry => entry.level), ['info']);
  assert.match(fixture.logEntries[0].message, /deleted=50, duration=17ms/);
});

/** 仓储拒绝不能逃逸到 cron，Error 和 null 必须保留可读原因及失败耗时。 */
for (const scenario of [
  { name: 'Error', rejection: new Error('历史清理数据库不可用'), message: '历史清理数据库不可用' },
  { name: 'null', rejection: null, message: 'null' }
]) {
  test(`仓储拒绝 ${scenario.name} 时正常 resolve 并记录失败原因和耗时`, async (t) => {
    let now = 1800000000789;
    t.mock.method(Date, 'now', () => now);
    const calls = [];
    const db = { marker: 'failed-cleanup-db' };
    const fixture = new CleanupJobFixture(async (...args) => {
      calls.push(args);
      now += 23;
      throw scenario.rejection;
    });

    const result = await fixture.handler.runXuiSyncTaskCleanup(db);

    assert.deepEqual(calls, [[db, 1798704000, 50]]);
    assert.deepEqual(result, { success: false, deleted: 0, error: scenario.message });
    assert.deepEqual(fixture.logEntries.map(entry => entry.level), ['error']);
    assert.ok(fixture.logEntries[0].message.includes(`error=${scenario.message}, duration=23ms`));

    const cronTasks = [];
    fixture.handler.registerCleanXuiSyncTasksJob({ db, cronTasks });
    await assert.doesNotReject(() => fixture.schedules[0].callback());
    assert.equal(calls.length, 2, 'cron 的一次回调也只尝试一批，且不得重试');
  });
}
