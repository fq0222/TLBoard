const assert = require('assert');
const express = require('express');
const {
  passwordResetSubmitLimiter,
  subscriptionInvalidTokenLimiter
} = require('../middleware/rate-limiter');

/**
 * 启动仅用于限流验证的临时 HTTP 服务。
 * 职责：把密码重置提交限流器挂到测试路由上，避免依赖真实数据库和业务服务。
 *
 * @returns {Promise<{baseUrl:string,close:Function}>} 测试服务信息
 */
async function createTestServer() {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.post('/reset-password', passwordResetSubmitLimiter, (req, res) => {
    res.json({ code: 0, message: 'ok', data: null });
  });

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

/**
 * 启动订阅无效 token 限流测试服务。
 * 职责：隔离验证订阅限流器只统计失败响应，避免依赖真实订阅路由和数据库。
 *
 * @param {Function} handler - 测试路由处理函数
 * @returns {Promise<{baseUrl:string,close:Function}>} 临时服务信息
 */
async function createSubscriptionLimiterTestServer(handler) {
  const app = express();
  app.set('trust proxy', true);
  app.get('/sub/:token', subscriptionInvalidTokenLimiter, handler);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function postReset(baseUrl) {
  return fetch(`${baseUrl}/reset-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      token: 'a'.repeat(64),
      password: 'Newpass123'
    })
  });
}

async function getSubscription(baseUrl, token = 'missing-token', ip = '127.0.0.1') {
  return fetch(`${baseUrl}/sub/${token}`, {
    headers: {
      'X-Forwarded-For': ip
    }
  });
}

async function testResetPasswordSubmitRateLimit() {
  const server = await createTestServer();

  try {
    const statuses = [];
    for (let index = 0; index < 6; index += 1) {
      const response = await postReset(server.baseUrl);
      statuses.push(response.status);
    }

    assert.deepStrictEqual(statuses.slice(0, 5), [200, 200, 200, 200, 200]);
    assert.strictEqual(statuses[5], 429);
  } finally {
    await server.close();
  }
}

async function testInvalidSubscriptionTokenShouldBeLimitedAfterThreeFailures() {
  const server = await createSubscriptionLimiterTestServer((req, res) => {
    res.status(400).json({ code: 2004, message: '订阅链接无效或尚未生成', data: null });
  });

  try {
    const statuses = [];
    for (let index = 0; index < 4; index += 1) {
      const response = await getSubscription(server.baseUrl, 'missing-token', '192.0.2.10');
      statuses.push(response.status);
    }

    assert.deepStrictEqual(statuses, [400, 400, 400, 429]);
  } finally {
    await server.close();
  }
}

async function testSuccessfulSubscriptionShouldNotCountTowardInvalidTokenLimit() {
  let requestCount = 0;
  const server = await createSubscriptionLimiterTestServer((req, res) => {
    requestCount += 1;
    if (requestCount <= 3) {
      res.type('text/plain').send('fake subscription');
      return;
    }
    res.status(400).json({ code: 2004, message: '订阅链接无效或尚未生成', data: null });
  });

  try {
    const statuses = [];
    for (let index = 0; index < 4; index += 1) {
      const response = await getSubscription(server.baseUrl, `token-${index}`, '192.0.2.11');
      statuses.push(response.status);
    }

    assert.deepStrictEqual(statuses, [200, 200, 200, 400]);
  } finally {
    await server.close();
  }
}

async function run() {
  await testResetPasswordSubmitRateLimit();
  await testInvalidSubscriptionTokenShouldBeLimitedAfterThreeFailures();
  await testSuccessfulSubscriptionShouldNotCountTowardInvalidTokenLimit();
  console.log('rate limiter tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
