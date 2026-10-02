const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * 使用可观测调度器加载用户巡检任务模块。
 * 关键参数 accepted 控制调度器接受或合并任务，用于验证手动入口的真实返回语义。
 *
 * @param {boolean} accepted - 调度器是否接受新任务
 * @returns {{ syncHandler: Object, scheduled: Array<Object>, restore: Function }} 隔离后的模块与恢复函数
 */
function loadSyncHandlerWithScheduler(accepted) {
  const handlerPath = require.resolve('../jobs/handlers/sync-xui-users');
  const schedulerPath = require.resolve('../jobs/xui-job-scheduler');
  const originalHandler = require.cache[handlerPath];
  const originalScheduler = require.cache[schedulerPath];
  const scheduled = [];

  require.cache[schedulerPath] = {
    id: schedulerPath,
    filename: schedulerPath,
    loaded: true,
    exports: {
      schedule(name, handler) {
        scheduled.push({ name, handler });
        return accepted;
      }
    }
  };
  delete require.cache[handlerPath];

  const syncHandler = require(handlerPath);
  return {
    syncHandler,
    scheduled,
    restore() {
      if (originalHandler) require.cache[handlerPath] = originalHandler;
      else delete require.cache[handlerPath];
      if (originalScheduler) require.cache[schedulerPath] = originalScheduler;
      else delete require.cache[schedulerPath];
    }
  };
}

/**
 * 隔离加载管理端服务器服务，并替换外部依赖。
 * 关键参数 scheduleResult 模拟统一队列的接受结果，避免测试访问真实 3X-UI。
 *
 * @param {boolean} scheduleResult - 是否成功加入队列
 * @returns {{ service: Object, restore: Function }} 服务实例与恢复函数
 */
function loadServersServiceWithSyncResult(scheduleResult) {
  const servicePath = require.resolve('../services/admin/servers-service');
  const handlerPath = require.resolve('../jobs/handlers/sync-xui-users');
  const originalService = require.cache[servicePath];
  const originalHandler = require.cache[handlerPath];

  require.cache[handlerPath] = {
    id: handlerPath,
    filename: handlerPath,
    loaded: true,
    exports: {
      scheduleXuiUserSync() {
        return scheduleResult;
      }
    }
  };
  delete require.cache[servicePath];

  const service = require(servicePath);
  return {
    service,
    restore() {
      if (originalService) require.cache[servicePath] = originalService;
      else delete require.cache[servicePath];
      if (originalHandler) require.cache[handlerPath] = originalHandler;
      else delete require.cache[handlerPath];
    }
  };
}

/**
 * 使用真实 Express 路由加载管理端同步接口，仅替换会访问外部 3X-UI 的队列入口。
 * 关键参数 scheduleResult 控制接口返回入队或合并结果。
 *
 * @param {boolean} scheduleResult - 是否成功加入队列
 * @returns {{ router: Object, restore: Function }} 服务器路由与模块缓存恢复函数
 */
function loadServersRouterWithSyncResult(scheduleResult) {
  const paths = [
    require.resolve('../routes/admin/servers'),
    require.resolve('../controllers/admin/servers-controller'),
    require.resolve('../services/admin/servers-service'),
    require.resolve('../jobs/handlers/sync-xui-users')
  ];
  const originals = new Map(paths.map(modulePath => [modulePath, require.cache[modulePath]]));
  const handlerPath = paths[3];

  require.cache[handlerPath] = {
    id: handlerPath,
    filename: handlerPath,
    loaded: true,
    exports: {
      scheduleXuiUserSync() {
        return scheduleResult;
      }
    }
  };
  paths.slice(0, 3).forEach(modulePath => delete require.cache[modulePath]);

  return {
    router: require(paths[0]),
    restore() {
      originals.forEach((cachedModule, modulePath) => {
        if (cachedModule) require.cache[modulePath] = cachedModule;
        else delete require.cache[modulePath];
      });
    }
  };
}

/**
 * 向临时 Express 服务发送 JSON 请求。
 *
 * @param {Object} server - 已监听的 HTTP Server
 * @param {{method: string, path: string, headers?: Object}} options - 请求参数
 * @returns {Promise<{statusCode: number, body: Object}>} HTTP 状态与 JSON 响应
 */
function requestJson(server, options) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port: address.port,
      method: options.method,
      path: options.path,
      headers: options.headers || {}
    }, response => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { raw += chunk; });
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        body: JSON.parse(raw)
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

test('手动触发与四小时定时任务使用同一个队列任务名', t => {
  const observation = loadSyncHandlerWithScheduler(true);
  t.after(observation.restore);

  const db = { marker: 'db' };
  const queued = observation.syncHandler.scheduleXuiUserSync(db);

  assert.equal(queued, true);
  assert.equal(observation.scheduled.length, 1);
  assert.equal(observation.scheduled[0].name, 'xui-user-sync');
  assert.equal(typeof observation.scheduled[0].handler, 'function');
});

test('启动延迟任务和四小时定时任务复用同一个同步入队入口', t => {
  const observation = loadSyncHandlerWithScheduler(true);
  const originalSetInterval = global.setInterval;
  const intervalCallbacks = [];
  const timeoutCallbacks = [];
  t.after(() => {
    global.setInterval = originalSetInterval;
    observation.restore();
  });
  global.setInterval = callback => {
    intervalCallbacks.push(callback);
    return { type: 'interval' };
  };

  observation.syncHandler.registerXuiSyncJob({
    db: {},
    intervals: [],
    registerTimeout(callback) {
      timeoutCallbacks.push(callback);
    }
  });

  assert.equal(timeoutCallbacks.length, 1);
  assert.equal(intervalCallbacks.length, 1);
  timeoutCallbacks[0]();
  intervalCallbacks[0]();
  assert.deepEqual(observation.scheduled.map(item => item.name), [
    'xui-user-sync',
    'xui-user-sync'
  ]);
});

test('管理端手动同步入口返回新任务已入队状态', t => {
  const observation = loadServersServiceWithSyncResult(true);
  t.after(observation.restore);

  assert.deepEqual(observation.service.runXuiUserSyncTask({}), {
    queued: true,
    merged: false,
    message: '同步任务已加入队列'
  });
});

test('已有四小时同步任务时管理端手动入口返回合并状态', t => {
  const observation = loadServersServiceWithSyncResult(false);
  t.after(observation.restore);

  assert.deepEqual(observation.service.runXuiUserSyncTask({}), {
    queued: false,
    merged: true,
    message: '已有同步任务正在执行或等待，已自动合并'
  });
});

test('手动同步 HTTP 接口拒绝未认证请求并向已认证管理员返回入队结果', async t => {
  const observation = loadServersRouterWithSyncResult(true);
  const app = express();
  app.locals.db = {};
  app.use('/api/admin/servers', observation.router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => {
    server.close();
    observation.restore();
  });

  const unauthorized = await requestJson(server, {
    method: 'POST',
    path: '/api/admin/servers/sync-users/run'
  });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.body.code, 1002);

  const token = jwt.sign({ username: 'test-admin' }, config.admin.jwtSecret, { expiresIn: '1m' });
  const authorized = await requestJson(server, {
    method: 'POST',
    path: '/api/admin/servers/sync-users/run',
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(authorized.statusCode, 200);
  assert.deepEqual(authorized.body, {
    code: 0,
    message: 'ok',
    data: {
      queued: true,
      merged: false,
      message: '同步任务已加入队列'
    }
  });
});
