const assert = require('assert');
const express = require('express');
const { passwordResetSubmitLimiter } = require('../middleware/rate-limiter');

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

async function run() {
  await testResetPasswordSubmitRateLimit();
  console.log('password reset submit rate limiter tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
