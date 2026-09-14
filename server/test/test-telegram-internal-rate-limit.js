const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');

const TEST_SECRET = 'telegram-rate-limit-test-secret';

/**
 * 清理内部接口模块缓存，确保每个测试使用独立的内存限流状态。
 * @param {string} modulePath - 相对当前测试文件的模块路径
 */
function purgeModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

/**
 * 生成符合现有协议的内部接口签名请求头。
 * @param {string} path - 包含查询字符串的请求路径
 * @param {string} [clientIp] - 由可信反向代理写入的客户端 IP
 * @returns {Object} HTTP 请求头
 */
function buildSignedHeaders(path, clientIp = '198.51.100.10') {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const payload = `GET\n${path}\n${timestamp}\n`;
  const signature = crypto.createHmac('sha256', TEST_SECRET).update(payload).digest('hex');

  return {
    'X-Forwarded-For': clientIp,
    'X-Internal-Client': 'telegram-bot',
    'X-Internal-Timestamp': timestamp,
    'X-Internal-Signature': signature
  };
}

/**
 * 向临时测试服务器发送 GET 请求并读取 JSON 响应。
 * @param {number} port - 临时服务器端口
 * @param {string} path - 请求路径
 * @param {Object} headers - HTTP 请求头
 * @returns {Promise<{statusCode:number, body:Object}>} 响应结果
 */
function requestJson(port, path, headers) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path, headers }, (response) => {
      let raw = '';
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        body: raw ? JSON.parse(raw) : null
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

/**
 * 创建带可信代理配置的 Telegram 内部接口测试服务器。
 * @returns {Promise<{server: import('http').Server, port:number}>} 服务器及端口
 */
async function createTestServer() {
  process.env.TELEGRAM_INTERNAL_API_ENABLED = 'true';
  process.env.TELEGRAM_INTERNAL_API_SECRET = TEST_SECRET;

  purgeModule('../config');
  purgeModule('../middleware/auth-internal-telegram');
  purgeModule('../middleware/telegram-internal-rate-limit');
  purgeModule('../routes/internal/telegram');

  const express = require('express');
  const router = require('../routes/internal/telegram');
  const app = express();
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    req.rawBody = '';
    next();
  });
  app.use(router);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  return { server, port: server.address().port };
}

test('鉴权失败按真实 IP 在 15 分钟内最多放行 5 次失败响应', async (t) => {
  const { server, port } = await createTestServer();
  t.after(() => server.close());
  const path = '/api/internal/telegram/health';
  const invalidHeaders = {
    ...buildSignedHeaders(path, '198.51.100.20'),
    'X-Internal-Signature': 'invalid-signature'
  };

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await requestJson(port, path, invalidHeaders);
    assert.equal(response.statusCode, 401);
  }

  const blockedResponse = await requestJson(port, path, invalidHeaders);
  assert.equal(blockedResponse.statusCode, 429);

  const otherIpResponse = await requestJson(port, path, {
    ...invalidHeaders,
    'X-Forwarded-For': '198.51.100.21'
  });
  assert.equal(otherIpResponse.statusCode, 401);
});

test('鉴权成功请求按内部客户端在 5 分钟内最多访问 20 次', async (t) => {
  const { server, port } = await createTestServer();
  t.after(() => server.close());
  const path = '/api/internal/telegram/health';

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const response = await requestJson(
      port,
      path,
      buildSignedHeaders(path, `198.51.100.${attempt}`)
    );
    assert.equal(response.statusCode, 200);
  }

  const blockedResponse = await requestJson(port, path, buildSignedHeaders(path, '203.0.113.10'));
  assert.equal(blockedResponse.statusCode, 429);
});

test('同一 IPv6 的不同文本形式共享鉴权失败配额', async (t) => {
  const { server, port } = await createTestServer();
  t.after(() => server.close());
  const path = '/api/internal/telegram/health';
  const equivalentAddresses = [
    '2001:db8::1',
    '2001:0db8:0:0:0:0:0:1',
    '2001:db8:0:0::1'
  ];

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await requestJson(port, path, {
      ...buildSignedHeaders(path, equivalentAddresses[attempt % equivalentAddresses.length]),
      'X-Internal-Signature': 'invalid-signature'
    });
    assert.equal(response.statusCode, 401);
  }

  const blockedResponse = await requestJson(port, path, {
    ...buildSignedHeaders(path, equivalentAddresses[2]),
    'X-Internal-Signature': 'invalid-signature'
  });
  assert.equal(blockedResponse.statusCode, 429);
});

test('鉴权失败配额不会侵占合法内部客户端的成功配额', async (t) => {
  const { server, port } = await createTestServer();
  t.after(() => server.close());
  const path = '/api/internal/telegram/health';
  const clientIp = '203.0.113.30';

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await requestJson(port, path, {
      ...buildSignedHeaders(path, clientIp),
      'X-Internal-Signature': 'invalid-signature'
    });
    assert.equal(response.statusCode, 401);
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await requestJson(port, path, buildSignedHeaders(path, clientIp));
    assert.equal(response.statusCode, 200);
  }

  const blockedResponse = await requestJson(port, path, buildSignedHeaders(path, clientIp));
  assert.equal(blockedResponse.statusCode, 429);
});
