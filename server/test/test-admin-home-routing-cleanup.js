/**
 * 管理端家宽 routing 残留清理手动入口测试。
 * 隔离 XUI 队列，仅验证管理服务返回语义、HTTP 鉴权和接口响应。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * 隔离加载家宽 IP 管理服务，并替换残留清理任务的入队入口。
 * @param {boolean} scheduleResult - 队列是否接受新任务。
 * @returns {{service: Object, calls: Array<Object>, restore: Function}} 服务、调用记录和恢复函数。
 */
function loadHomeProxiesServiceWithCleanupResult(scheduleResult) {
  const servicePath = require.resolve('../services/admin/home-proxies-service');
  const handlerPath = require.resolve('../jobs/handlers/clean-pending-home-routes');
  const originalService = require.cache[servicePath];
  const originalHandler = require.cache[handlerPath];
  const calls = [];

  require.cache[handlerPath] = {
    id: handlerPath,
    filename: handlerPath,
    loaded: true,
    exports: {
      schedulePendingHomeRouteCleanup(db) {
        calls.push(db);
        return scheduleResult;
      }
    }
  };
  delete require.cache[servicePath];

  return {
    service: require(servicePath),
    calls,
    restore() {
      if (originalService) require.cache[servicePath] = originalService;
      else delete require.cache[servicePath];
      if (originalHandler) require.cache[handlerPath] = originalHandler;
      else delete require.cache[handlerPath];
    }
  };
}

/**
 * 使用真实 Express 路由加载家宽 routing 清理接口，仅替换队列入口。
 * @param {boolean} scheduleResult - 队列是否接受新任务。
 * @returns {{router: Object, restore: Function}} 路由和模块缓存恢复函数。
 */
function loadHomeProxiesRouterWithCleanupResult(scheduleResult) {
  const paths = [
    require.resolve('../routes/admin/home-proxies'),
    require.resolve('../controllers/admin/home-proxies-controller'),
    require.resolve('../services/admin/home-proxies-service'),
    require.resolve('../jobs/handlers/clean-pending-home-routes')
  ];
  const originals = new Map(paths.map(modulePath => [modulePath, require.cache[modulePath]]));
  const handlerPath = paths[3];

  require.cache[handlerPath] = {
    id: handlerPath,
    filename: handlerPath,
    loaded: true,
    exports: {
      schedulePendingHomeRouteCleanup() {
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
 * 向临时 Express 服务发送请求并解析 JSON。
 * @param {Object} server - 已监听的 HTTP Server。
 * @param {{method: string, path: string, headers?: Object}} options - 请求参数。
 * @returns {Promise<{statusCode: number, body: Object}>} HTTP 状态与响应体。
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

test('管理端手动清理入口返回新任务已入队状态', t => {
  const observation = loadHomeProxiesServiceWithCleanupResult(true);
  t.after(observation.restore);
  const db = { marker: 'cleanup-db' };

  const result = observation.service.runPendingHomeRouteCleanupTask(db);

  assert.deepEqual(observation.calls, [db]);
  assert.deepEqual(result, {
    queued: true,
    merged: false,
    message: '残留路由清理任务已加入队列'
  });
});

test('已有残留清理任务时管理端手动入口返回合并状态', t => {
  const observation = loadHomeProxiesServiceWithCleanupResult(false);
  t.after(observation.restore);

  const result = observation.service.runPendingHomeRouteCleanupTask({});

  assert.deepEqual(result, {
    queued: false,
    merged: true,
    message: '已有残留路由清理任务正在执行或等待，已自动合并'
  });
});

test('手动清理 HTTP 接口拒绝未认证请求并向已认证管理员返回入队结果', async t => {
  const observation = loadHomeProxiesRouterWithCleanupResult(true);
  const app = express();
  app.locals.db = {};
  app.use('/api/admin/home-proxies', observation.router);
  app.use((req, res) => res.status(404).json({ code: 404, message: 'not found', data: null }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => {
    server.close();
    observation.restore();
  });

  const unauthorized = await requestJson(server, {
    method: 'POST',
    path: '/api/admin/home-proxies/cleanup-routes/run'
  });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.body.code, 1002);

  const token = jwt.sign({ username: 'test-admin' }, config.admin.jwtSecret, { expiresIn: '1m' });
  const authorized = await requestJson(server, {
    method: 'POST',
    path: '/api/admin/home-proxies/cleanup-routes/run',
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(authorized.statusCode, 200);
  assert.deepEqual(authorized.body, {
    code: 0,
    message: 'ok',
    data: {
      queued: true,
      merged: false,
      message: '残留路由清理任务已加入队列'
    }
  });
});
