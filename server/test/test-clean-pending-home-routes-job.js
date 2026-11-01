/**
 * 家宽 routing 残留清理任务测试。
 * 隔离 cron、业务服务和日志，验证调度时间、执行汇总与异常收口。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

/** 保存 handler 的依赖替身和可观察副作用。 */
class PendingCleanupJobFixture {
  /**
   * @param {Function} cleanupPendingHomeRoutes - 家宽 routing 清理服务替身。
   * @param {{schedulerAccepts?:boolean}} options - 调度器是否接受本次入队。
   */
  constructor(cleanupPendingHomeRoutes, options = {}) {
    this.schedules = [];
    this.schedulerCalls = [];
    this.logs = [];
    const handlerPath = path.resolve(__dirname, '../jobs/handlers/clean-pending-home-routes.js');
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
      '../xui-job-scheduler': {
        schedule: (name, handler) => {
          this.schedulerCalls.push({ name, handler });
          return options.schedulerAccepts !== false;
        }
      },
      '../../services/shared/home-routing-service': { cleanupPendingHomeRoutes },
      '../../utils/logger': {
        createLogger: () => ({
          info: message => this.logs.push({ level: 'info', message }),
          error: message => this.logs.push({ level: 'error', message })
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
      Module._load = originalLoad;
      if (originalCache) require.cache[handlerPath] = originalCache;
      else delete require.cache[handlerPath];
    }
  }
}

test('统一入队入口提交固定任务名且队列执行前不清理', async () => {
  let cleanupCalls = 0;
  const db = { marker: 'manual-cleanup-db' };
  const fixture = new PendingCleanupJobFixture(async () => {
    cleanupCalls += 1;
    return { scannedUsers: 0, cleanedServers: 0, skippedOfflineServers: 0, failedServers: 0, invalidRoutes: 0 };
  });

  const queued = fixture.handler.schedulePendingHomeRouteCleanup(db);

  assert.equal(queued, true);
  assert.equal(fixture.schedulerCalls.length, 1);
  assert.equal(fixture.schedulerCalls[0].name, 'home-routing-pending-cleanup');
  assert.equal(cleanupCalls, 0);

  await fixture.schedulerCalls[0].handler();
  assert.equal(cleanupCalls, 1);
});

test('统一入队入口透传同名任务合并结果且不会直接清理', () => {
  let cleanupCalls = 0;
  const fixture = new PendingCleanupJobFixture(async () => {
    cleanupCalls += 1;
    return { scannedUsers: 0, cleanedServers: 0, skippedOfflineServers: 0, failedServers: 0, invalidRoutes: 0 };
  }, { schedulerAccepts: false });

  const queued = fixture.handler.schedulePendingHomeRouteCleanup({});

  assert.equal(queued, false);
  assert.equal(fixture.schedulerCalls.length, 1);
  assert.equal(fixture.schedulerCalls[0].name, 'home-routing-pending-cleanup');
  assert.equal(cleanupCalls, 0);
});

test('北京时间 12:00 到点后只入队，队列执行 handler 后才开始清理', async () => {
  let cleanupCalls = 0;
  const fixture = new PendingCleanupJobFixture(async () => {
    cleanupCalls += 1;
    return { scannedUsers: 0, cleanedServers: 0, skippedOfflineServers: 0, failedServers: 0, invalidRoutes: 0 };
  });
  const cronTasks = [];

  fixture.handler.registerPendingHomeRouteCleanupJob({ db: {}, cronTasks });
  await Promise.resolve();

  assert.equal(fixture.schedules.length, 1);
  assert.equal(fixture.schedules[0].expression, '0 12 * * *');
  assert.deepEqual(fixture.schedules[0].options, { timezone: 'Asia/Shanghai' });
  assert.deepEqual(cronTasks, [fixture.schedules[0]]);
  assert.equal(fixture.schedulerCalls.length, 0);
  assert.equal(cleanupCalls, 0);

  await fixture.schedules[0].callback();
  assert.equal(fixture.schedulerCalls.length, 1);
  assert.equal(fixture.schedulerCalls[0].name, 'home-routing-pending-cleanup');
  assert.equal(cleanupCalls, 0);

  await fixture.schedulerCalls[0].handler();
  assert.equal(cleanupCalls, 1);
});

test('同名任务被调度器合并时不会绕过队列直接清理', async () => {
  let cleanupCalls = 0;
  const fixture = new PendingCleanupJobFixture(async () => {
    cleanupCalls += 1;
    return { scannedUsers: 0, cleanedServers: 0, skippedOfflineServers: 0, failedServers: 0, invalidRoutes: 0 };
  }, { schedulerAccepts: false });
  const cronTasks = [];

  fixture.handler.registerPendingHomeRouteCleanupJob({ db: {}, cronTasks });
  await fixture.schedules[0].callback();

  assert.equal(fixture.schedulerCalls.length, 1);
  assert.equal(fixture.schedulerCalls[0].name, 'home-routing-pending-cleanup');
  assert.equal(cleanupCalls, 0);
});

test('执行完成后返回并记录清理数量和耗时', async t => {
  let now = 1800000000000;
  t.mock.method(Date, 'now', () => now);
  const db = { marker: 'pending-cleanup-db' };
  const calls = [];
  const summary = {
    scannedUsers: 3,
    cleanedServers: 2,
    skippedOfflineServers: 1,
    failedServers: 1,
    invalidRoutes: 0
  };
  const fixture = new PendingCleanupJobFixture(async (...args) => {
    calls.push(args);
    now += 17;
    return summary;
  });

  const result = await fixture.handler.runPendingHomeRouteCleanup(db);

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], db);
  assert.equal(calls[0].length, 2);
  assert.deepEqual(result, { success: true, ...summary });
  assert.equal(fixture.logs.length, 1);
  assert.equal(fixture.logs[0].level, 'info');
  assert.match(fixture.logs[0].message, /scanned=3, cleaned=2, offline=1, failed=1, invalid=0, duration=17ms/);
});

for (const scenario of [
  { name: 'Error', rejection: new Error('数据库不可用'), message: '数据库不可用' },
  { name: '非 Error', rejection: null, message: 'null' }
]) {
  test(`清理服务抛出${scenario.name}时返回失败且 cron 回调不拒绝`, async () => {
    const fixture = new PendingCleanupJobFixture(async () => {
      throw scenario.rejection;
    });
    const db = { marker: 'failed-db' };

    const result = await fixture.handler.runPendingHomeRouteCleanup(db);
    assert.deepEqual(result, { success: false, error: scenario.message });
    assert.equal(fixture.logs.at(-1).level, 'error');
    assert.match(fixture.logs.at(-1).message, new RegExp(`error=${scenario.message}`));

    const cronTasks = [];
    fixture.handler.registerPendingHomeRouteCleanupJob({ db, cronTasks });
    await fixture.schedules[0].callback();
    await assert.doesNotReject(() => fixture.schedulerCalls[0].handler());
  });
}
