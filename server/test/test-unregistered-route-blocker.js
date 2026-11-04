/**
 * 未注册路由封禁器行为测试：使用可推进时钟验证边界、IP 归一化及资源释放。
 * 直接执行本脚本即可验证，无需启动服务器、数据库或登录账号。
 */
const assert = require('node:assert/strict');
const { UnregisteredRouteBlocker, unregisteredRouteBlocker } = require('../middleware/unregistered-route-blocker');

/** 测试夹具负责创建独立状态；advance(ms) 推进毫秒时钟，不等待真实时间。 */
class BlockerFixture {
  constructor(options = {}) {
    this.time = 1000000;
    this.blocker = new UnregisteredRouteBlocker({ now: () => this.time, cleanupIntervalMs: 0, ...options });
  }

  /** 推进测试时间，用于命中尝试窗口与封禁到期的精确边界。 */
  advance(ms) {
    this.time += ms;
  }
}

/** 模拟 Express 响应边界，保留守卫返回的状态、响应头及 JSON。 */
class TestResponse {
  constructor() {
    this.headers = {};
  }

  /** 记录响应头，返回自身以兼容链式调用。 */
  setHeader(name, value) {
    this.headers[name.toLowerCase()] = String(value);
    return this;
  }

  /** 记录 HTTP 状态码。 */
  status(value) {
    this.statusCode = value;
    return this;
  }

  /** 记录 JSON 响应。 */
  json(value) {
    this.body = value;
    return this;
  }
}

const request = { ip: '127.0.0.1' };
let passed = 0;
let failed = 0;

/** 每项断言使用独立封禁器，并在失败时继续释放清理定时器。 */
function test(name, run) {
  const fixture = new BlockerFixture();
  try {
    run(fixture);
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}: ${error.stack}`);
  } finally {
    fixture.blocker.close();
  }
}

test('首次记录不封禁', ({ blocker }) => {
  assert.deepEqual(blocker.recordNotFound(request), { blocked: false, blockedUntil: null, ipKey: '127.0.0.1', blockDurationMs: 1800000 });
});

test('10 分钟内第二次建立 30 分钟封禁', fixture => {
  fixture.blocker.recordNotFound(request);
  fixture.advance(599999);
  assert.deepEqual(fixture.blocker.recordNotFound(request), {
    blocked: true, blockedUntil: 3399999, ipKey: '127.0.0.1', blockDurationMs: 1800000
  });
});

test('守卫返回 429、JSON 包装和正确 Retry-After', fixture => {
  fixture.blocker.recordNotFound(request);
  fixture.blocker.recordNotFound(request);
  fixture.advance(1001);
  const response = new TestResponse();
  fixture.blocker.createGuardMiddleware()(request, response, () => assert.fail('有效封禁不能放行'));
  assert.equal(response.statusCode, 429);
  assert.equal(response.headers['retry-after'], '1799');
  assert.equal(response.body.code, 429);
  assert.equal(typeof response.body.message, 'string');
  assert.ok(response.body.message.length > 0);
  assert.equal(response.body.data, null);
});

test('第二次记录自身仍可由兜底处理器返回 404', ({ blocker }) => {
  const guard = blocker.createGuardMiddleware();
  for (let index = 0; index < 2; index += 1) {
    const response = new TestResponse();
    guard(request, response, () => {
      blocker.recordNotFound(request);
      response.status(404).json({ code: 404, message: '未找到路由', data: null });
    });
    assert.equal(response.statusCode, 404);
  }
});

test('封禁到期后放行并重新从 1 计数', fixture => {
  fixture.blocker.recordNotFound(request);
  fixture.blocker.recordNotFound(request);
  fixture.advance(1800000);
  let nextCalls = 0;
  fixture.blocker.createGuardMiddleware()(request, new TestResponse(), () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
  assert.equal(fixture.blocker.recordNotFound(request).blocked, false);
});

test('尝试窗口到期后重新从 1 计数', fixture => {
  fixture.blocker.recordNotFound(request);
  fixture.advance(600000);
  assert.equal(fixture.blocker.recordNotFound(request).blocked, false);
  assert.equal(fixture.blocker.recordNotFound(request).blocked, true);
});

test('IPv4 与 IPv4-mapped IPv6 共享状态', ({ blocker }) => {
  blocker.recordNotFound(request);
  assert.equal(blocker.recordNotFound({ ip: '::ffff:127.0.0.1' }).blocked, true);
});

test('同一 IPv6 /64 共享状态，不同 /64 隔离', ({ blocker }) => {
  blocker.recordNotFound({ ip: '2001:db8:abcd:1234::1' });
  assert.equal(blocker.recordNotFound({ ip: '2001:db8:abcd:1234::ffff' }).blocked, true);
  assert.equal(blocker.recordNotFound({ ip: '2001:db8:abcd:1235::1' }).blocked, false);
});

test('req.ip 缺失时使用 socket 地址且不信任转发头', ({ blocker }) => {
  blocker.recordNotFound(request);
  assert.equal(blocker.recordNotFound({ socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: { 'x-forwarded-for': '10.0.0.1' } }).blocked, true);
});

test('cleanupExpired 删除过期尝试且保留有效封禁', fixture => {
  fixture.blocker.recordNotFound(request);
  fixture.blocker.recordNotFound({ ip: '10.0.0.1' });
  fixture.blocker.recordNotFound({ ip: '10.0.0.1' });
  fixture.advance(600000);
  fixture.blocker.cleanupExpired();
  assert.equal(fixture.blocker.records.size, 1);
  fixture.advance(1200000);
  fixture.blocker.cleanupExpired();
  assert.equal(fixture.blocker.records.size, 0);
});

test('可注入时长、阈值及 now', () => {
  const fixture = new BlockerFixture({ windowMs: 100, maxAttempts: 3, blockMs: 200 });
  try {
    assert.equal(fixture.blocker.recordNotFound(request).blocked, false);
    assert.equal(fixture.blocker.recordNotFound(request).blocked, false);
    assert.equal(fixture.blocker.recordNotFound(request).blockedUntil, 1000200);
  } finally {
    fixture.blocker.close();
  }
});

test('定时器调用 unref，close 清理定时器且可重复调用', () => {
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  let unrefCalls = 0;
  let clearCalls = 0;
  let callback;
  const timer = { unref: () => { unrefCalls += 1; } };
  let blocker;
  try {
    global.setInterval = (run, interval) => {
      assert.equal(interval, 50);
      callback = run;
      return timer;
    };
    global.clearInterval = handle => {
      assert.equal(handle, timer);
      clearCalls += 1;
    };
    blocker = new UnregisteredRouteBlocker({ cleanupIntervalMs: 50, now: () => 0 });
    assert.equal(unrefCalls, 1);
    assert.equal(typeof callback, 'function');
    blocker.recordNotFound(request);
    callback();
    assert.equal(blocker.records.size, 1);
    blocker.close();
    blocker.close();
    assert.equal(clearCalls, 1);
  } finally {
    if (blocker) blocker.close();
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  }
});

/** 隔离旧配置与环境变量并重新加载真实共享实例；结束后恢复模块缓存和进程配置。 */
function testConfiguration(securityValues, environmentValues, run) {
  const config = require('../config');
  const fields = ['unregisteredRouteWindowMs', 'unregisteredRouteMaxAttempts', 'unregisteredRouteBlockMs'];
  const variables = ['UNREGISTERED_ROUTE_WINDOW_MS', 'UNREGISTERED_ROUTE_MAX_ATTEMPTS', 'UNREGISTERED_ROUTE_BLOCK_MS'];
  const originalSecurity = config.security;
  const originalEnvironment = variables.map(key => process.env[key]);
  const modulePath = require.resolve('../middleware/unregistered-route-blocker');
  const originalModule = require.cache[modulePath];
  let blocker;
  try {
    config.security = { ...originalSecurity };
    fields.forEach((key, index) => { config.security[key] = securityValues[index]; });
    variables.forEach((key, index) => {
      if (environmentValues[index] === undefined) delete process.env[key];
      else process.env[key] = String(environmentValues[index]);
    });
    delete require.cache[modulePath];
    blocker = require(modulePath).unregisteredRouteBlocker;
    let time = 1000000;
    blocker.now = () => time;
    run(blocker, ms => { time += ms; });
  } finally {
    if (blocker) blocker.close();
    config.security = originalSecurity;
    variables.forEach((key, index) => {
      if (originalEnvironment[index] === undefined) delete process.env[key];
      else process.env[key] = originalEnvironment[index];
    });
    require.cache[modulePath] = originalModule;
  }
}

test('旧配置缺少字段时共享实例第二次仍封禁且一天后清理全部状态', () => {
  testConfiguration([], [], (blocker, advance) => {
    assert.equal(blocker.recordNotFound(request).blocked, false);
    const result = blocker.recordNotFound(request);
    assert.equal(result.blocked, true);
    assert.equal(result.blockedUntil, 2800000);
    blocker.recordNotFound({ ip: '10.0.0.1' });
    advance(86400000);
    blocker.cleanupExpired();
    assert.equal(blocker.records.size, 0);
  });
});

test('旧配置缺少字段时未封禁的尝试窗口到期可以清理', () => {
  testConfiguration([], [], (blocker, advance) => {
    blocker.recordNotFound(request);
    advance(86400000);
    blocker.cleanupExpired();
    assert.equal(blocker.records.size, 0);
  });
});

test('环境变量优先于配置字段并影响窗口、封禁阈值和实际时长', () => {
  testConfiguration([5000, 3, 9000], [4000, 2, 6500], (blocker, advance) => {
    blocker.recordNotFound(request);
    advance(4000);
    assert.equal(blocker.recordNotFound(request).blocked, false);
    assert.equal(blocker.recordNotFound(request).blockedUntil, 1010500);
    const response = new TestResponse();
    blocker.createGuardMiddleware()(request, response, () => assert.fail('环境变量必须生效'));
    assert.equal(response.headers['retry-after'], '7');
  });
});

test('非法环境变量回退到有效配置字段，非法配置回退内置默认值', () => {
  for (const invalid of [undefined, '', 0, -1, 1.5, Infinity, NaN, 'invalid', '10ms']) {
    testConfiguration([5000, 3, 9000], [invalid, invalid, invalid], (blocker, advance) => {
      blocker.recordNotFound(request);
      advance(5000);
      assert.equal(blocker.recordNotFound(request).blocked, false);
      assert.equal(blocker.recordNotFound(request).blocked, false);
      assert.equal(blocker.recordNotFound(request).blockedUntil, 1014000);
    });
    testConfiguration([invalid, invalid, invalid], [invalid, invalid, invalid], (blocker, advance) => {
      blocker.recordNotFound(request);
      advance(600000);
      assert.equal(blocker.recordNotFound(request).blocked, false);
      assert.equal(blocker.recordNotFound(request).blockedUntil, 3400000);
    });
  }
});

test('recordNotFound 返回非默认实际封禁时长供安全日志使用', () => {
  const fixture = new BlockerFixture({ blockMs: 6500 });
  try {
    fixture.blocker.recordNotFound(request);
    assert.equal(fixture.blocker.recordNotFound(request).blockDurationMs, 6500);
  } finally {
    fixture.blocker.close();
  }
});

assert.ok(unregisteredRouteBlocker instanceof UnregisteredRouteBlocker);
console.log(`封禁器行为测试：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exitCode = 1;
