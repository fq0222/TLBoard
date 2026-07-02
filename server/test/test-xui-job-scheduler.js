const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { XuiJobScheduler } = require('../jobs/xui-job-scheduler');

/**
 * 等待指定毫秒数，用于控制异步任务的执行时序。
 * @param {number} ms 等待时长（毫秒）。
 * @returns {Promise<void>} 等待完成的 Promise。
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 轮询等待条件成立，超时后抛出明确错误。
 * @param {() => boolean} predicate 判断条件。
 * @param {number} timeoutMs 最大等待时长（毫秒）。
 * @returns {Promise<void>} 条件成立时完成的 Promise。
 */
async function waitFor(predicate, timeoutMs = 500) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error('等待条件超时');
    }
    await delay(2);
  }
}

/**
 * 使用隔离模块替身加载任务中心，并记录清理行为。
 * 注册异常分支由 throwOnRegister 控制；restore 必须在测试结束时调用以恢复模块缓存和全局函数。
 *
 * @param {{throwOnRegister: boolean}} options - 是否在第二个任务注册器中抛出异常
 * @returns {Object} 任务中心、观测函数与全局状态恢复函数
 */
function loadJobsIndexForTest({ throwOnRegister }) {
  const jobsIndexPath = require.resolve('../jobs');
  const schedulerPath = require.resolve('../jobs/xui-job-scheduler');
  const loggerPath = require.resolve('../utils/logger');
  const handlerStubs = [
    ['../jobs/handlers/mark-expired-orders', 'registerMarkExpiredJob'],
    ['../jobs/handlers/delete-expired-orders', 'registerDeleteExpiredJob'],
    ['../jobs/handlers/clean-zombie-users', 'registerCleanZombieUsersJob'],
    ['../jobs/handlers/sync-xui-users', 'registerXuiSyncJob'],
    ['../jobs/handlers/sync-xui-tasks', 'registerXuiSyncTaskJob'],
    ['../jobs/handlers/sync-traffic', 'registerTrafficSyncJob'],
    ['../jobs/handlers/auto-close-tickets', 'registerTicketAutoCloseJob'],
    ['../jobs/handlers/release-expired-sales', 'registerReleaseExpiredSalesJob'],
    ['../jobs/handlers/process-email-campaigns', 'registerEmailCampaignJob'],
    ['../jobs/handlers/clean-email-logs', 'registerCleanEmailLogsJob'],
    ['../jobs/handlers/backup-xui-db', 'registerBackupXuiDbJob'],
    ['../jobs/handlers/resume-batch-subscription-tasks', 'registerBatchSubscriptionTaskJob'],
    ['../jobs/handlers/telegram-server-health-check', 'registerTelegramServerHealthCheckJob']
  ];
  const stubPaths = [
    schedulerPath,
    loggerPath,
    ...handlerStubs.map(([request]) => require.resolve(request))
  ];
  const originalCache = new Map(
    [jobsIndexPath, ...stubPaths].map(modulePath => [
      modulePath,
      require.cache[modulePath]
    ])
  );
  const originalClearInterval = global.clearInterval;
  const originalClearTimeout = global.clearTimeout;
  const cleared = [];
  let stopCount = 0;

  const stubModule = (modulePath, exports) => {
    require.cache[modulePath] = {
      id: modulePath,
      filename: modulePath,
      loaded: true,
      exports
    };
  };

  global.clearInterval = handle => cleared.push(handle);
  global.clearTimeout = handle => cleared.push(handle);
  stubModule(schedulerPath, {
    stop: () => {
      stopCount += 1;
    }
  });
  stubModule(loggerPath, {
    createLogger: () => ({
      info: () => {},
      warn: () => {},
      error: () => {}
    })
  });

  handlerStubs.forEach(([request, exportName], index) => {
    stubModule(require.resolve(request), {
      [exportName]: context => {
        if (index === 0) {
          context.intervals.push('interval');
          context.timeouts.push('timeout');
          context.cronTasks.push({
            stop: () => cleared.push('cron')
          });
        }
        if (throwOnRegister && index === 1) {
          throw new Error('注册失败');
        }
      }
    });
  });

  delete require.cache[jobsIndexPath];
  const jobs = require(jobsIndexPath);

  return {
    jobs,
    schedulerStopCount: () => stopCount,
    clearedHandles: () => [...cleared],
    restore: () => {
      global.clearInterval = originalClearInterval;
      global.clearTimeout = originalClearTimeout;
      originalCache.forEach((cachedModule, modulePath) => {
        if (cachedModule) {
          require.cache[modulePath] = cachedModule;
        } else {
          delete require.cache[modulePath];
        }
      });
    }
  };
}

test('仅三个指定定时任务接入统一调度器', () => {
  const handlersDir = path.join(__dirname, '..', 'jobs', 'handlers');
  const scheduledHandlers = fs.readdirSync(handlersDir)
    .filter(file => file.endsWith('.js'))
    .filter(file => fs.readFileSync(path.join(handlersDir, file), 'utf8')
      .includes('xuiJobScheduler.schedule'))
    .sort();

  assert.deepEqual(scheduledHandlers, [
    'sync-traffic.js',
    'sync-xui-users.js',
    'telegram-server-health-check.js'
  ]);
});

test('正常停止会停止调度器并清理全部已注册句柄', t => {
  const observation = loadJobsIndexForTest({ throwOnRegister: false });
  t.after(observation.restore);
  observation.jobs.startAllJobs({});
  observation.jobs.stopAllJobs();

  assert.equal(observation.schedulerStopCount(), 1);
  assert.deepEqual(observation.clearedHandles(), [
    'interval',
    'timeout',
    'cron'
  ]);
});

test('注册异常回滚会停止调度器并清理全部已注册句柄', t => {
  const observation = loadJobsIndexForTest({ throwOnRegister: true });
  t.after(observation.restore);

  assert.throws(
    () => observation.jobs.startAllJobs({}),
    /注册失败/
  );
  assert.equal(observation.schedulerStopCount(), 1);
  assert.deepEqual(observation.clearedHandles(), [
    'interval',
    'timeout',
    'cron'
  ]);
});

test('不同任务串行执行，并从上一个任务结束后计算冷却时间', async () => {
  const events = [];
  const scheduler = new XuiJobScheduler({ cooldownMs: 30 });

  try {
    scheduler.schedule('first', async () => {
      events.push({ name: 'first-start', at: Date.now() });
      await delay(15);
      events.push({ name: 'first-end', at: Date.now() });
    });
    await waitFor(
      () => events.some(event => event.name === 'first-start'),
      20
    );

    scheduler.schedule('second', async () => {
      events.push({ name: 'second-start', at: Date.now() });
    });

    await waitFor(() => events.some(event => event.name === 'second-start'));

    const firstEnd = events.find(event => event.name === 'first-end').at;
    const secondStart = events.find(event => event.name === 'second-start').at;
    assert.ok(secondStart - firstEnd >= 25);
    assert.deepEqual(events.map(event => event.name), [
      'first-start',
      'first-end',
      'second-start'
    ]);
  } finally {
    scheduler.stop();
  }
});

test('同名任务运行中或排队时只保留一次执行', async () => {
  const counts = { running: 0, queued: 0 };
  const scheduler = new XuiJobScheduler({ cooldownMs: 10 });

  try {
    scheduler.schedule('running', async () => {
      counts.running += 1;
      await delay(20);
    });
    scheduler.schedule('running', async () => {
      counts.running += 1;
    });
    scheduler.schedule('queued', async () => {
      counts.queued += 1;
    });
    scheduler.schedule('queued', async () => {
      counts.queued += 1;
    });

    await waitFor(() => counts.queued === 1);
    assert.deepEqual(counts, { running: 1, queued: 1 });
  } finally {
    scheduler.stop();
  }
});

test('任务失败后继续调度，停止后不再启动排队任务', async () => {
  const events = [];
  const scheduler = new XuiJobScheduler({ cooldownMs: 10 });

  try {
    scheduler.schedule('failure', async () => {
      events.push('failure');
      throw null;
    });
    scheduler.schedule('after-failure', async () => {
      events.push('after-failure');
    });

    await waitFor(() => events.includes('after-failure'));
    assert.deepEqual(events, ['failure', 'after-failure']);

    scheduler.schedule('blocker', async () => {
      events.push('blocker');
      await delay(20);
    });
    scheduler.schedule('discarded', async () => {
      events.push('discarded');
    });
    await waitFor(() => events.includes('blocker'));
    scheduler.stop();
    await delay(40);
    assert.equal(events.includes('discarded'), false);

    scheduler.schedule('restarted', async () => {
      events.push('restarted');
    });
    await waitFor(() => events.includes('restarted'));
    assert.equal(events.includes('discarded'), false);
  } finally {
    scheduler.stop();
  }
});
