/**
 * 未注册路由封禁 HTTP 集成测试：运行真实双端应用与路由，验证共享封禁和业务响应隔离。
 * 使用随机端口、可推进时钟及禁止访问的数据库边界，无需登录账号或外部服务。
 */
const assert = require('node:assert/strict');
const http = require('node:http');
const createUserApp = require('../bootstrap/create-user-app');
const createAdminApp = require('../bootstrap/create-admin-app');
const { UnregisteredRouteBlocker } = require('../middleware/unregistered-route-blocker');

/** 管理两个临时 HTTP 服务和共享封禁状态；所有服务在 finally 中关闭。 */
class HttpFixture {
  constructor(options = {}) {
    this.time = 1000000;
    this.blocker = new UnregisteredRouteBlocker({ now: () => this.time, cleanupIntervalMs: 0, ...options });
    this.servers = [];
    this.warnings = { user: [], admin: [] };
    this.errors = { user: [], admin: [] };
    this.info = { user: [], admin: [] };
  }

  /** 创建真实双端应用；数据库方法被意外调用时立即失败，防止测试访问外部资源。 */
  async start() {
    const db = new Proxy({}, {
      get(_target, key) { throw new Error(`本测试不得访问数据库: ${String(key)}`); }
    });
    for (const [side, createApp] of [['user', createUserApp], ['admin', createAdminApp]]) {
      const logger = {
        info: message => this.info[side].push(message),
        warn: message => this.warnings[side].push(message),
        error: message => this.errors[side].push(message)
      };
      const app = createApp({ db, logger, routeBlocker: this.blocker });
      const server = await new Promise((resolve, reject) => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
        instance.once('error', reject);
      });
      this.servers.push(server);
      this[side] = server.address().port;
    }
  }

  /** 推进毫秒时钟，在封禁到期边界验证放行，无需真实等待。 */
  advance(ms) {
    this.time += ms;
  }

  /** 请求真实路由；rawBody 支持损坏 JSON，空响应用于验证原有 CORS 预检语义。 */
  request(side, path, { method = 'GET', body, rawBody, headers = {} } = {}) {
    const payload = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port: this[side], path, method,
        headers: { ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }
      }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          try {
            const text = Buffer.concat(chunks).toString();
            resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : null });
          } catch (error) { reject(error); }
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end(payload);
    });
  }

  /** 关闭已启动的全部随机端口和封禁清理器，即使启动或断言失败也可安全调用。 */
  async close() {
    await Promise.all(this.servers.map(server => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    })));
    this.blocker.close();
  }
}

/** 独立断言最终兜底响应契约，触发封禁的第二次请求仍必须返回原有 404。 */
function assertFallback(response) {
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { code: 404, message: '接口不存在', data: null });
}

/** 两端均拒绝被封禁 IP，统一 JSON 和 1800 秒重试时间必须保持一致。 */
async function assertBothBlocked(fixture) {
  for (const side of ['user', 'admin']) {
    const response = await fixture.request(side, '/health');
    assert.equal(response.status, 429, `${side} 健康检查必须被共享守卫拦截`);
    assert.equal(response.headers['retry-after'], '1800');
    assert.deepEqual(response.body, { code: 429, message: '请求过于频繁，请稍后再试', data: null });
  }
}

/** 捕获缺失用户守卫、全局统计业务错误、端间状态隔离及封禁到期不放行等错误。 */
async function testUserBlockingAndDynamicRouteIsolation(fixture) {
  assertFallback(await fixture.request('user', '/unknown-first?token=private-query'));
  const businessCases = [
    ['/api/user/subscription/sub/test?clash=invalid', {}, 400],
    ['/api/user/download/short-token', {}, 400],
    ['/api/user/reset-password', { method: 'POST', body: { token: 'short-reset-token' } }, 400],
    ['/api/user/help/images/not-found.png', {}, 404]
  ];
  for (const [path, options, status] of businessCases) {
    const response = await fixture.request('user', path, options);
    assert.equal(response.status, status, `${path} 应保留原有业务响应`);
    assert.notEqual(response.body.message, '接口不存在');
    assert.equal((await fixture.request('user', '/health')).status, 200, `${path} 不得增加兜底计数`);
    assert.equal((await fixture.request('admin', '/health')).status, 200);
    assert.deepEqual(fixture.warnings, { user: [], admin: [] });
  }
  console.log('PASS 已注册订阅/下载/密码重置 token 路由与帮助图片业务 404 均不计数');
  assertFallback(await fixture.request('user', '/unknown-second?token=private-query'));
  await assertBothBlocked(fixture);
  assert.equal((await fixture.request('user', '/unknown-while-blocked')).status, 429);
  assert.equal(fixture.warnings.user.length, 1, '只在首次建立封禁时输出警告');
  assert.equal(fixture.warnings.admin.length, 0);
  assert.match(fixture.warnings.user[0], /127\.0\.0\.1/);
  assert.match(fixture.warnings.user[0], /30\s*分钟/);
  assert.doesNotMatch(fixture.warnings.user[0], /unknown|token|private-query|short-reset-token|\?|\/api\//);
  console.log('PASS 用户端第二次未知路径仍返回 404，随后双端共享 429 与 Retry-After=1800');
  fixture.advance(30 * 60 * 1000);
  for (const side of ['user', 'admin']) {
    assert.equal((await fixture.request(side, '/health')).status, 200);
  }
  console.log('PASS 推进 30 分钟后用户端、管理端健康检查均恢复 200');
}

/** 管理端兜底也必须计数，捕获仅接入用户端或管理端缺失警告的回归。 */
async function testAdminBlocking(fixture) {
  assertFallback(await fixture.request('admin', '/admin-unknown-first?token=private-admin-query'));
  assert.equal((await fixture.request('user', '/health')).status, 200);
  assertFallback(await fixture.request('admin', '/admin-unknown-second?token=private-admin-query'));
  await assertBothBlocked(fixture);
  assert.equal((await fixture.request('admin', '/admin-unknown-while-blocked')).status, 429);
  assert.equal(fixture.warnings.admin.length, 1);
  assert.equal(fixture.warnings.user.length, 0);
  assert.match(fixture.warnings.admin[0], /127\.0\.0\.1/);
  assert.match(fixture.warnings.admin[0], /30\s*分钟/);
  assert.doesNotMatch(fixture.warnings.admin[0], /unknown|token|private-admin-query|\?/);
  console.log('PASS 管理端兜底触发共享封禁，双端警告仅包含归一化 IP 和封禁时长');
}

/** 正常 OPTIONS 保持 204；封禁后预检必须先到守卫，并且不再产生 Morgan 访问日志。 */
async function testBlockedOptions(fixture, side) {
  const options = { method: 'OPTIONS', headers: { Origin: 'https://example.test', 'Access-Control-Request-Method': 'POST' } };
  assert.equal((await fixture.request(side, '/health', options)).status, 204);
  assertFallback(await fixture.request(side, '/unknown-first'));
  assertFallback(await fixture.request(side, '/unknown-second'));
  const infoCount = fixture.info[side].length;
  const response = await fixture.request(side, '/health', options);
  assert.equal(response.status, 429, `${side} 封禁后 OPTIONS 必须先被守卫拒绝`);
  assert.equal(response.headers['retry-after'], '1800');
  assert.equal(response.body.code, 429);
  assert.equal(fixture.info[side].length, infoCount);
  console.log(`PASS ${side} 正常 OPTIONS=204，封禁后 OPTIONS=429 + Retry-After，跳过 Morgan`);
}

/** 损坏 JSON 不得绕过封禁或进入解析错误处理器，同时验证守卫早于 Morgan。 */
async function testBlockedMalformedJson(fixture, side) {
  assertFallback(await fixture.request(side, '/unknown-first'));
  assertFallback(await fixture.request(side, '/unknown-second'));
  const infoCount = fixture.info[side].length;
  const response = await fixture.request(side, '/health', { method: 'POST', rawBody: '{"broken":' });
  assert.equal(response.status, 429, `${side} 损坏 JSON 必须先被守卫拒绝`);
  assert.equal(response.headers['retry-after'], '1800');
  assert.equal(response.body.code, 429);
  assert.deepEqual(fixture.errors[side], [], '不得进入 JSON 解析错误处理器');
  assert.equal(fixture.info[side].length, infoCount);
  console.log(`PASS ${side} 封禁后损坏 JSON POST=429 + Retry-After，未进入解析错误处理器或 Morgan`);
}

/** 非默认时长必须与封禁响应一致，警告变量只包含归一化 IP 和时长。 */
async function testCustomDurationLog(fixture, side) {
  assertFallback(await fixture.request(side, '/unknown-first?token=secret-duration'));
  assertFallback(await fixture.request(side, '/unknown-second?token=secret-duration'));
  const response = await fixture.request(side, '/health');
  assert.equal(response.headers['retry-after'], '90');
  assert.equal(fixture.warnings[side].length, 1);
  assert.match(fixture.warnings[side][0], /127\.0\.0\.1/);
  assert.match(fixture.warnings[side][0], /1\.5\s*分钟/);
  assert.doesNotMatch(fixture.warnings[side][0], /30\s*分钟|unknown|token|secret-duration|\?/);
  console.log(`PASS ${side} 非默认封禁 90 秒日志显示实际 1.5 分钟且不含路径、查询参数或 token`);
}

/** 顺序执行独立状态场景，任何断言失败时先释放 HTTP 服务再报告失败。 */
async function run() {
  const cases = [
    [testUserBlockingAndDynamicRouteIsolation], [testAdminBlocking],
    ...['user', 'admin'].flatMap(side => [
      [testBlockedOptions, side], [testBlockedMalformedJson, side],
      [testCustomDurationLog, side, { blockMs: 90000 }]
    ])
  ];
  let failed = 0;
  for (const [test, side, options] of cases) {
    const fixture = new HttpFixture(options);
    try {
      await fixture.start();
      await test(fixture, side);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${test.name} ${side || ''}: ${error.stack}`);
    } finally {
      await fixture.close();
    }
  }
  console.log(`unregistered route HTTP tests: ${cases.length - failed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
