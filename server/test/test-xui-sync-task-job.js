const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

/**
 * 使用替身加载 3X-UI 重试队列 handler，避免真实服务依赖影响调度间隔断言。
 * @returns {{handler:Object,logs:string[],restore:Function}} 已隔离的 handler 与恢复函数。
 */
function loadHandlerForTest() {
  const handlerPath = require.resolve('../jobs/handlers/sync-xui-tasks');
  const originalCache = require.cache[handlerPath];
  const originalLoad = Module._load;
  const logs = [];

  delete require.cache[handlerPath];
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../../services/shared/order-service') return {};
    if (request === '../../services/shared/traffic-manager') return {};
    if (request === '../../services/user/subscription-service') return {};
    if (request === '../../integrations/xui/xui-sync-task-service') return {};
    if (request === '../../repositories/xui-sync-repository') return {};
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
