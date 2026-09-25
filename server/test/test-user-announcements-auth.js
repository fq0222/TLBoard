/**
 * 用户公告接口认证测试。
 * 职责：验证公告列表拒绝匿名请求，并允许携带有效用户 Token 的请求继续读取公告。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const config = require('../config');
const announcementsRouter = require('../routes/user/announcements');

/**
 * 创建只支持公告列表查询的数据库桩。
 * @returns {Object} 公告仓储所需的最小数据库接口
 */
function createAnnouncementsDb() {
  return {
    prepare(sql) {
      return {
        async get() {
          if (sql.includes('COUNT(*)')) {
            return { count: 1 };
          }
          throw new Error(`未预期的 get 查询: ${sql}`);
        },
        async all() {
          if (sql.includes('FROM announcements')) {
            return [{ id: 1, title: '会员公告', content: '仅登录后可见' }];
          }
          throw new Error(`未预期的 all 查询: ${sql}`);
        }
      };
    }
  };
}

/**
 * 在临时端口启动用户公告路由并执行测试请求。
 * @param {Object} options - 请求配置
 * @param {string} [options.token] - 可选的用户 JWT
 * @returns {Promise<{status:number,body:Object}>} HTTP 状态码和响应体
 */
async function requestAnnouncements({ token } = {}) {
  const app = express();
  app.locals.db = createAnnouncementsDb();
  app.use('/api/user/announcements', announcementsRouter);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  try {
    const { port } = server.address();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const response = await fetch(`http://127.0.0.1:${port}/api/user/announcements`, { headers });
    return {
      status: response.status,
      body: await response.json()
    };
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('用户公告列表拒绝未登录访问', async () => {
  const response = await requestAnnouncements();

  assert.equal(response.status, 401);
  assert.equal(response.body.code, 1002);
});

test('用户公告列表允许有效用户 Token 访问', async () => {
  const token = jwt.sign(
    { id: 7, email: 'member@example.com' },
    config.user.jwtSecret,
    { expiresIn: '5m' }
  );

  const response = await requestAnnouncements({ token });

  assert.equal(response.status, 200);
  assert.equal(response.body.code, 0);
  assert.equal(response.body.data.list[0].title, '会员公告');
});
