/**
 * IP 限流安全回归测试。
 * 职责：在内存中执行真实 Express 与限流中间件，验证 /64 配额、地址规范化和失败窗口。
 * 边界：仅构造请求/响应，不监听端口，不连接数据库，不修改 trust proxy。
 */
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const test = require('node:test');
const express = require('express');
const { createIpLimiter, createAuthLimiter, passkeyLoginOptionsLimiter,
  passkeyLoginVerifyLimiter } = require('../middleware/rate-limiter');

/** 在内存执行 app；ip 写入真实 socket 地址，body 用于邮箱隔离，响应 finish 驱动失败计数。 */
async function request(app, ip, body = {}) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    Object.defineProperty(socket, 'remoteAddress', { value: ip });
    const req = new http.IncomingMessage(socket);
    req.method = 'POST';
    req.url = '/';
    req.headers = { host: 'test.invalid' };
    req.body = body;
    const res = new http.ServerResponse(req);
    res.end = function (chunk) {
      this.emit('finish');
      resolve({ status: this.statusCode, headers: this.getHeaders(), body: JSON.parse(String(chunk)) });
      return this;
    };
    app.handle(req, res, reject);
  });
}

/** 把 limiter 挂载到内存应用；status 控制成功或失败计数语义，不替换真实限流器。 */
function createApp(limiter, status = 200) {
  const app = express();
  app.post('/', limiter, (req, res) => res.status(status).json({ code: 0 }));
  return app;
}

test('同一 IPv6 /64 轮换地址共享 Passkey options 5 次签发额度，不同 /64 隔离', async () => {
  const app = createApp(passkeyLoginOptionsLimiter);
  for (let index = 1; index <= 5; index++) {
    assert.equal((await request(app, `2001:db8:100:200::${index.toString(16)}`)).status, 200);
  }
  const blocked = await request(app, '2001:0DB8:0100:0200:ffff:ffff:ffff:ffff');
  assert.equal(blocked.status, 429, '相同 /64 的新地址不能获取第 6 次签发额度');
  assert.ok(Number(blocked.headers['retry-after']) > 0);
  assert.ok(Number(blocked.headers['retry-after']) <= 60);
  assert.equal((await request(app, '2001:db8:100:201::1')).status, 200);
});

test('同一 IPv6 /64 轮换地址共享 Passkey verify 失败额度，options 窗口独立', async () => {
  const app = createApp(passkeyLoginVerifyLimiter, 401);
  for (let index = 1; index <= 3; index++) {
    assert.equal((await request(app, `2001:db8:300:400::${index}`)).status, 401);
  }
  const blocked = await request(app, '2001:db8:300:400:abcd::1');
  assert.equal(blocked.status, 429, '相同 /64 的新地址不能绕过三次失败窗口');
  assert.ok(Number(blocked.headers['retry-after']) > 0);
  assert.equal((await request(app, '2001:db8:300:401::1')).status, 401);
  assert.equal((await request(createApp(passkeyLoginOptionsLimiter), '2001:db8:300:400::1')).status, 200);
});

test('IPv4 继续按单个地址限流，相邻地址独立', async () => {
  const app = createApp(createIpLimiter({ max: 1 }));
  assert.equal((await request(app, '192.0.2.1')).status, 200);
  assert.equal((await request(app, '192.0.2.1')).status, 429);
  assert.equal((await request(app, '192.0.2.2')).status, 200);
});

test('IPv4-mapped IPv6 与原 IPv4 共享额度，十六进制映射形式不能绕过', async () => {
  const app = createApp(createIpLimiter({ max: 1 }));
  assert.equal((await request(app, '192.0.2.3')).status, 200);
  assert.equal((await request(app, '::ffff:192.0.2.3')).status, 429);
  assert.equal((await request(app, '0:0:0:0:0:ffff:c000:203')).status, 429);
  assert.equal((await request(app, '::ffff:192.0.2.4')).status, 200);
});

test('IP 加邮箱认证窗口同样归并 /64，保留邮箱隔离', async () => {
  const app = createApp(createAuthLimiter({ max: 1 }), 401);
  assert.equal((await request(app, '2001:db8:500:600::1', { email: 'one@example.test' })).status, 401);
  assert.equal((await request(app, '2001:db8:500:600::2', { email: 'one@example.test' })).status, 429);
  assert.equal((await request(app, '2001:db8:500:600::2', { email: 'two@example.test' })).status, 401);
  assert.equal((await request(app, '2001:db8:500:601::1', { email: 'one@example.test' })).status, 401);
});
