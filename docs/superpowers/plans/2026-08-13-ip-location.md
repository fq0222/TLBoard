# 用户 IP 归属地记录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 登录和订阅访问成功后，仅将中国大陆 IP 的归属地写入 `users.ip_location` JSON 字段，并在管理端用户列表展示省市区或“暂未获取”。

**Architecture:** 使用 `ip2region-ts` 做离线 IPv4 查询，新增共享服务封装 IP 规范化、国内判断和 JSON 更新编排。登录和订阅控制器只调用一个非阻塞记录函数，管理端列表服务负责把 JSON 格式化成前端展示文本；IPv6 在当前 xdb 库下安全跳过。

**Tech Stack:** Node.js Express、PostgreSQL、CommonJS、ip2region-ts、Vue 3、Element Plus、node:test。

---

## File Structure

- Modify: `server/package.json`
  增加 `ip2region-ts` 依赖。
- Modify: `server/db/schema/tables.js`
  新库初始化时让 `users` 表包含 `ip_location TEXT DEFAULT '{}'`。
- Create: `server/db/migrations/024-user-ip-location.js`
  幂等添加 `users.ip_location` 字段。
- Create: `server/services/shared/ip-location-service.js`
  封装 IP 规范化、离线查询、国内判断、位置文本格式化和用户记录更新。
- Modify: `server/repositories/user-repository.js`
  查询用户列表时带出 `u.ip_location`，新增 `findUserIpLocationById()` 和 `updateUserIpLocation()`.
- Modify: `server/services/admin/users-service.js`
  用户列表返回 `ip_location_text`。
- Modify: `server/controllers/user/auth-controller.js`
  登录成功后尝试记录 `login` 来源归属地。
- Modify: `server/services/user/subscription-service.js`
  订阅内容内部返回 `userId`。
- Modify: `server/controllers/user/subscription-controller.js`
  订阅内容成功后尝试记录 `subscription` 来源归属地。
- Modify: `client-admin/src/views/Users.vue`
  用户列表新增“IP归属地”列。
- Modify: `server/test/test-user-onboarding.js`
  增加管理端列表格式化测试。
- Create: `server/test/test-ip-location-service.js`
  覆盖 JSON 更新、国内判断、位置文本格式化。
- Modify: `server/test/test-user-subscription-service.js`
  补充订阅内容返回内部 `userId` 的断言。
- Modify: `client-admin/test/users-edit-traffic-form.test.js`
  补充用户列表包含 IP 归属地列的断言。

## Task 1: Database Schema And Migration

**Files:**
- Modify: `server/db/schema/tables.js`
- Create: `server/db/migrations/024-user-ip-location.js`

- [ ] **Step 1: Add schema field for new installs**

In `server/db/schema/tables.js`, add `ip_location TEXT DEFAULT '{}'` inside the `users` table after `onboarding_completed INTEGER DEFAULT 0,`:

```js
        onboarding_completed INTEGER DEFAULT 0,
        ip_location TEXT DEFAULT '{}',
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
```

- [ ] **Step 2: Create migration script**

Create `server/db/migrations/024-user-ip-location.js`:

```js
/**
 * 数据库迁移脚本：024-user-ip-location
 *
 * 变更内容：
 * 1. users 表新增 ip_location 字段，用 JSON 字符串保存登录和订阅 IP 归属地。
 *
 * 使用方式：
 * node server/db/migrations/024-user-ip-location.js
 */

const databaseManager = require('../init');

/**
 * 检查 users 表中的指定字段是否存在。
 *
 * @param {import('pg').PoolClient} client - PostgreSQL 事务连接
 * @param {string} columnName - 需要检查的 users 字段名
 * @returns {Promise<boolean>} true 表示字段已存在
 */
async function columnExists(client, columnName) {
  const result = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = $1
  `, [columnName]);

  return result.rows.length > 0;
}

/**
 * 执行用户 IP 归属地字段迁移。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @returns {Promise<{addedColumns:string[],skippedColumns:string[]}>} 字段处理结果
 */
async function up(pool) {
  const client = await pool.connect();
  const addedColumns = [];
  const skippedColumns = [];

  try {
    console.log('开始执行迁移：024-user-ip-location');
    await client.query('BEGIN');

    if (await columnExists(client, 'ip_location')) {
      skippedColumns.push('ip_location');
    } else {
      await client.query(`
        ALTER TABLE users
        ADD COLUMN ip_location TEXT DEFAULT '{}'
      `);
      addedColumns.push('ip_location');
    }

    await client.query('COMMIT');
    console.log('迁移完成：024-user-ip-location');

    return { addedColumns, skippedColumns };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('迁移失败：024-user-ip-location', error.message);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  databaseManager.init()
    .then((db) => up(db.pool))
    .finally(() => databaseManager.close());
}

module.exports = {
  up,
  columnExists
};
```

- [ ] **Step 3: Run existing migration-style test if available**

Run:

```bash
node server/test/test-xui-server-cascade-cleanup.js
```

Expected: existing migration tests pass and print their normal success output.

## Task 2: IP Location Service

**Files:**
- Modify: `server/package.json`
- Create: `server/services/shared/ip-location-service.js`
- Create: `server/test/test-ip-location-service.js`

- [ ] **Step 1: Add dependency**

Run:

```bash
cd server
npm install ip2region-ts
```

Expected: `server/package.json` and `server/package-lock.json` include `ip2region-ts`.

- [ ] **Step 2: Write service tests**

Create `server/test/test-ip-location-service.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const ipLocationService = require('../services/shared/ip-location-service');
const userRepository = require('../repositories/user-repository');

function replaceMethods(target, replacements) {
  const originals = {};
  Object.keys(replacements).forEach((key) => {
    originals[key] = target[key];
    target[key] = replacements[key];
  });

  return () => {
    Object.keys(originals).forEach((key) => {
      target[key] = originals[key];
    });
  };
}

test('formatIpLocationText prefers login location and joins province city district', () => {
  const text = ipLocationService.formatIpLocationText(JSON.stringify({
    login: {
      province: '广东省',
      city: '广州市',
      district: '天河区'
    },
    subscription: {
      province: '河南省',
      city: '郑州市',
      district: ''
    }
  }));

  assert.equal(text, '广东省 广州市 天河区');
});

test('formatIpLocationText falls back to subscription then default text', () => {
  assert.equal(ipLocationService.formatIpLocationText(JSON.stringify({
    subscription: {
      province: '河南省',
      city: '郑州市',
      district: ''
    }
  })), '河南省 郑州市');

  assert.equal(ipLocationService.formatIpLocationText('{}'), '暂未获取');
  assert.equal(ipLocationService.formatIpLocationText('not-json'), '暂未获取');
});

test('isMainlandChinaLocation rejects overseas and Hong Kong Macau Taiwan', () => {
  assert.equal(ipLocationService.isMainlandChinaLocation({
    country: '中国',
    province: '河南省'
  }), true);

  assert.equal(ipLocationService.isMainlandChinaLocation({
    country: '美国',
    province: '加利福尼亚'
  }), false);

  assert.equal(ipLocationService.isMainlandChinaLocation({
    country: '中国',
    province: '香港'
  }), false);
});

test('recordUserIpLocation skips non-mainland lookup result', async () => {
  const calls = [];
  const restore = replaceMethods(userRepository, {
    async updateUserIpLocation() {
      calls.push('update');
    }
  });

  try {
    const result = await ipLocationService.recordUserIpLocation({}, 1, 'login', '8.8.8.8', {
      lookupIpLocation: async () => ({
        ip: '8.8.8.8',
        country: '美国',
        province: '加利福尼亚',
        city: '',
        district: '',
        isp: '',
        updated_at: 1
      })
    });

    assert.deepEqual(result, { recorded: false, reason: 'non_mainland' });
    assert.deepEqual(calls, []);
  } finally {
    restore();
  }
});

test('recordUserIpLocation writes mainland lookup result', async () => {
  const calls = [];
  const restore = replaceMethods(userRepository, {
    async updateUserIpLocation(db, userId, source, location) {
      calls.push({ db, userId, source, location });
    }
  });
  const db = { name: 'fake-db' };

  try {
    const result = await ipLocationService.recordUserIpLocation(db, 7, 'subscription', '39.144.238.254', {
      lookupIpLocation: async () => ({
        ip: '39.144.238.254',
        country: '中国',
        province: '河南省',
        city: '郑州市',
        district: '',
        isp: '中国移动',
        updated_at: 1
      })
    });

    assert.deepEqual(result, { recorded: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].db, db);
    assert.equal(calls[0].userId, 7);
    assert.equal(calls[0].source, 'subscription');
    assert.equal(calls[0].location.city, '郑州市');
  } finally {
    restore();
  }
});
```

- [ ] **Step 3: Run test and verify it fails**

Run:

```bash
node server/test/test-ip-location-service.js
```

Expected: FAIL because `server/services/shared/ip-location-service.js` does not exist yet.

- [ ] **Step 4: Implement service**

Create `server/services/shared/ip-location-service.js`:

```js
/**
 * 用户 IP 归属地服务。
 * 职责：规范化请求 IP、查询离线归属地、过滤非中国大陆结果，并提供管理端展示格式化。
 */

const net = require('net');
const Searcher = require('ip2region-ts');
const userRepository = require('../../repositories/user-repository');

const MAINLAND_EXCLUDED_PROVINCES = ['香港', '澳门', '台湾', '香港特别行政区', '澳门特别行政区'];

let searcher;

/**
 * 获取秒级 Unix 时间戳。
 *
 * @returns {number} 当前秒级时间戳
 */
function getNowTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * 移除 IPv6 映射前缀、端口包裹和多级代理列表中的无效部分。
 *
 * @param {string} value - 原始 IP 字符串
 * @returns {string} 规范化后的 IP
 */
function normalizeIp(value) {
  if (!value) return '';
  const firstIp = String(value).split(',')[0].trim();
  if (!firstIp) return '';
  if (firstIp.startsWith('::ffff:')) return firstIp.slice(7);
  if (firstIp.startsWith('[') && firstIp.includes(']')) {
    return firstIp.slice(1, firstIp.indexOf(']'));
  }
  return firstIp;
}

/**
 * 判断 IP 是否属于不应该定位和记录的本地或保留地址。
 *
 * @param {string} ip - 规范化后的 IP
 * @returns {boolean} 是否应跳过
 */
function shouldSkipIp(ip) {
  if (!ip || net.isIP(ip) === 0) return true;
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (ip.startsWith('169.254.')) return true;
  if (ip.toLowerCase().startsWith('fe80:')) return true;
  if (ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd')) return true;
  return false;
}

/**
 * 懒加载 ip2region 查询器，避免模块加载时立即做文件 IO。
 *
 * @returns {Object} ip2region 查询器
 */
function getSearcher() {
  if (!searcher) {
    const buffer = Searcher.loadContentFromFile(Searcher.defaultDbFile);
    searcher = Searcher.newWithBuffer(buffer);
  }
  return searcher;
}

/**
 * 将 ip2region 的 region 字符串解析成统一结构。
 *
 * @param {string} ip - 查询 IP
 * @param {string} region - ip2region 返回的 region 字符串
 * @returns {Object|undefined} 归属地结构
 */
function parseRegion(ip, region) {
  if (!region) return undefined;
  const [country = '', , province = '', city = '', isp = ''] = String(region).split('|');
  return {
    ip,
    country,
    province: province === '0' ? '' : province,
    city: city === '0' ? '' : city,
    district: '',
    isp: isp === '0' ? '' : isp,
    updated_at: getNowTimestamp()
  };
}

/**
 * 查询 IP 归属地。
 *
 * @param {string} rawIp - 原始请求 IP
 * @returns {Promise<Object|undefined>} 归属地结构；不可记录时返回 undefined
 */
async function lookupIpLocation(rawIp) {
  const ip = normalizeIp(rawIp);
  if (shouldSkipIp(ip)) return undefined;

  const result = await getSearcher().search(ip);
  return parseRegion(ip, result && result.region);
}

/**
 * 判断归属地是否属于中国大陆。
 *
 * @param {Object|undefined} location - 归属地结构
 * @returns {boolean} 是否中国大陆
 */
function isMainlandChinaLocation(location) {
  if (!location) return false;
  const country = String(location.country || '').trim();
  const province = String(location.province || '').trim();
  const isChina = country === '中国' || country.toLowerCase() === 'china';
  if (!isChina) return false;
  return !MAINLAND_EXCLUDED_PROVINCES.some((name) => province.includes(name));
}

/**
 * 记录用户 IP 归属地。定位失败或非中国大陆时不写入。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @param {'login'|'subscription'} source - 记录来源
 * @param {string} rawIp - 原始请求 IP
 * @param {Object} [options] - 测试注入选项
 * @param {Function} [options.lookupIpLocation] - 自定义查询函数
 * @returns {Promise<{recorded:boolean,reason?:string}>} 记录结果
 */
async function recordUserIpLocation(db, userId, source, rawIp, options = {}) {
  const lookup = options.lookupIpLocation || lookupIpLocation;
  const location = await lookup(rawIp);
  if (!location) {
    return { recorded: false, reason: 'empty_location' };
  }
  if (!isMainlandChinaLocation(location)) {
    return { recorded: false, reason: 'non_mainland' };
  }

  await userRepository.updateUserIpLocation(db, userId, source, location);
  return { recorded: true };
}

/**
 * 管理端格式化展示用户归属地。
 *
 * @param {string|Object|undefined} value - users.ip_location 原始值
 * @returns {string} 省市区文本或“暂未获取”
 */
function formatIpLocationText(value) {
  try {
    const data = typeof value === 'string' ? JSON.parse(value || '{}') : (value || {});
    const location = data.login || data.subscription;
    if (!location) return '暂未获取';
    const text = [location.province, location.city, location.district]
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .join(' ');
    return text || '暂未获取';
  } catch (error) {
    return '暂未获取';
  }
}

module.exports = {
  normalizeIp,
  shouldSkipIp,
  lookupIpLocation,
  isMainlandChinaLocation,
  recordUserIpLocation,
  formatIpLocationText,
  __testables: {
    parseRegion
  }
};
```

- [ ] **Step 5: Run service test**

Run:

```bash
node server/test/test-ip-location-service.js
```

Expected: PASS.

## Task 3: User Repository JSON Update

**Files:**
- Modify: `server/repositories/user-repository.js`
- Modify: `server/test/test-ip-location-service.js`

- [ ] **Step 1: Extend repository test**

Append to `server/test/test-ip-location-service.js`:

```js
test('updateUserIpLocation preserves existing source and recovers invalid json', async () => {
  const updates = [];
  const db = {
    prepare(sql) {
      if (sql.includes('SELECT ip_location')) {
        return {
          get(userId) {
            assert.equal(userId, 9);
            return { ip_location: 'not-json' };
          }
        };
      }

      if (sql.includes('UPDATE users SET ip_location')) {
        return {
          run(ipLocation, userId) {
            updates.push({ ipLocation, userId });
          }
        };
      }

      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  await userRepository.updateUserIpLocation(db, 9, 'login', {
    ip: '39.144.238.254',
    country: '中国',
    province: '河南省',
    city: '郑州市',
    district: '',
    isp: '中国移动',
    updated_at: 1
  });

  assert.equal(updates.length, 1);
  assert.equal(updates[0].userId, 9);
  assert.deepEqual(JSON.parse(updates[0].ipLocation), {
    login: {
      ip: '39.144.238.254',
      country: '中国',
      province: '河南省',
      city: '郑州市',
      district: '',
      isp: '中国移动',
      updated_at: 1
    }
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
node server/test/test-ip-location-service.js
```

Expected: FAIL because `userRepository.updateUserIpLocation` is not implemented.

- [ ] **Step 3: Implement repository methods**

In `server/repositories/user-repository.js`, add after `updateUserFields()`:

```js
/**
 * 查询用户 IP 归属地 JSON。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<Object|undefined>} 用户 IP 归属地快照
 */
async function findUserIpLocationById(db, userId) {
  return db.prepare('SELECT ip_location FROM users WHERE id = ?').get(userId);
}

/**
 * 更新用户指定来源的 IP 归属地 JSON。
 * 职责：只更新 login/subscription 中的一个来源，保留另一个来源已有数据。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @param {'login'|'subscription'} source - 归属地来源
 * @param {Object} location - 已确认属于中国大陆的归属地结构
 * @returns {Promise<void>}
 */
async function updateUserIpLocation(db, userId, source, location) {
  const current = await findUserIpLocationById(db, userId);
  let data = {};

  try {
    data = JSON.parse(current?.ip_location || '{}');
  } catch (error) {
    data = {};
  }

  data[source] = location;
  await db.prepare('UPDATE users SET ip_location = ?, updated_at = EXTRACT(EPOCH FROM NOW()) WHERE id = ?')
    .run(JSON.stringify(data), userId);
}
```

Add both methods to `module.exports`.

- [ ] **Step 4: Include `ip_location` in admin list SQL**

In `listUsers()` select list, change:

```js
      u.expire_at, u.enabled, u.disable_reason, u.created_at,
```

to:

```js
      u.expire_at, u.enabled, u.disable_reason, u.ip_location, u.created_at,
```

- [ ] **Step 5: Run repository/service test**

Run:

```bash
node server/test/test-ip-location-service.js
```

Expected: PASS.

## Task 4: Admin List Response And UI

**Files:**
- Modify: `server/services/admin/users-service.js`
- Modify: `server/test/test-user-onboarding.js`
- Modify: `client-admin/src/views/Users.vue`
- Modify: `client-admin/test/users-edit-traffic-form.test.js`

- [ ] **Step 1: Add backend list test**

In `server/test/test-user-onboarding.js`, add this test after the traffic sort test:

```js
test('admin user list returns formatted ip location text', async () => {
  const { db, getListSql } = createListUsersDb([
    {
      id: 1,
      email: 'located@example.com',
      plan_id: 1,
      plan_name: '基础套餐',
      traffic_used: 0,
      traffic_limit: 1024,
      expire_at: 0,
      enabled: 1,
      disable_reason: null,
      ip_location: JSON.stringify({
        login: {
          province: '广东省',
          city: '广州市',
          district: '天河区'
        }
      }),
      created_at: 1
    },
    {
      id: 2,
      email: 'unknown@example.com',
      plan_id: 1,
      plan_name: '基础套餐',
      traffic_used: 0,
      traffic_limit: 1024,
      expire_at: 0,
      enabled: 1,
      disable_reason: null,
      ip_location: '{}',
      created_at: 2
    }
  ]);

  const result = await usersService.listUsers(db, { page: 1, limit: 15 });

  assert.match(getListSql(), /u\.ip_location/);
  assert.equal(result.list[0].ip_location_text, '广东省 广州市 天河区');
  assert.equal(result.list[1].ip_location_text, '暂未获取');
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
node server/test/test-user-onboarding.js
```

Expected: FAIL because `ip_location_text` is not returned yet.

- [ ] **Step 3: Implement admin formatting**

In `server/services/admin/users-service.js`, add import:

```js
const ipLocationService = require('../shared/ip-location-service');
```

In `listUsers()` map result, add:

```js
      ip_location_text: ipLocationService.formatIpLocationText(user.ip_location),
```

Place it near `created_at`.

- [ ] **Step 4: Add UI source test**

In `client-admin/test/users-edit-traffic-form.test.js`, add:

```js
test('用户列表展示 IP 归属地列', () => {
  assert.match(source, /prop="ip_location_text"/)
  assert.match(source, /label="IP归属地"/)
})
```

- [ ] **Step 5: Run UI test and verify it fails**

Run:

```bash
cd client-admin
node test/users-edit-traffic-form.test.js
```

Expected: FAIL because `Users.vue` does not contain the new column yet.

- [ ] **Step 6: Add admin table column**

In `client-admin/src/views/Users.vue`, add this column after the email column:

```vue
        <el-table-column prop="ip_location_text" label="IP归属地" min-width="150" />
```

- [ ] **Step 7: Run backend and UI tests**

Run:

```bash
node server/test/test-user-onboarding.js
cd client-admin
node test/users-edit-traffic-form.test.js
```

Expected: both PASS.

## Task 5: Login And Subscription Recording

**Files:**
- Modify: `server/controllers/user/auth-controller.js`
- Modify: `server/controllers/user/subscription-controller.js`
- Modify: `server/services/user/subscription-service.js`
- Modify: `server/test/test-user-subscription-service.js`

- [ ] **Step 1: Add internal userId assertion to subscription test**

In `server/test/test-user-subscription-service.js`, find the default subscription content test and add an assertion that the result includes the subscription user ID. If the test fixture user ID is `1`, add:

```js
  assert.strictEqual(result.userId, 1);
```

Use the actual fixture ID in that test.

- [ ] **Step 2: Run subscription test and verify it fails**

Run:

```bash
node server/test/test-user-subscription-service.js
```

Expected: FAIL because `getSubscriptionContent()` does not return `userId` yet.

- [ ] **Step 3: Return internal userId from subscription content**

In `server/services/user/subscription-service.js`, inside all successful `getSubscriptionContent()` response objects, include:

```js
      userId: subscription.user_id || subscription.id,
```

For fallback response objects where a user exists, include the same internal `userId` if the helper returns an object. Do not render `userId` into subscription body or headers.

- [ ] **Step 4: Import IP location service in controllers**

In both `server/controllers/user/auth-controller.js` and `server/controllers/user/subscription-controller.js`, add:

```js
const ipLocationService = require('../../services/shared/ip-location-service');
```

- [ ] **Step 5: Record login IP without blocking login response**

In `server/controllers/user/auth-controller.js`, after:

```js
    logger.info(`用户登录成功: ${req.body.email}`);
```

add:

```js
    ipLocationService.recordUserIpLocation(req.app.locals.db, data.user.id, 'login', req.ip || req.socket.remoteAddress)
      .catch((error) => logger.warn(`记录登录 IP 归属地失败: ${error.message}`));
```

- [ ] **Step 6: Record subscription IP without blocking subscription response**

In `server/controllers/user/subscription-controller.js`, after `const result = await subscriptionService.getSubscriptionContent(...)`, add:

```js
    if (result.userId) {
      ipLocationService.recordUserIpLocation(req.app.locals.db, result.userId, 'subscription', req.ip || req.socket.remoteAddress)
        .catch((error) => logger.warn(`记录订阅 IP 归属地失败: ${error.message}`));
    }
```

Keep response output unchanged:

```js
    res.setHeader('Content-Type', result.contentType);
```

- [ ] **Step 7: Run subscription test**

Run:

```bash
node server/test/test-user-subscription-service.js
```

Expected: PASS.

## Task 6: Verification

**Files:**
- No new files unless test output exposes a real issue.

- [ ] **Step 1: Run focused backend tests**

Run:

```bash
node server/test/test-ip-location-service.js
node server/test/test-user-onboarding.js
node server/test/test-user-subscription-service.js
```

Expected: all PASS.

- [ ] **Step 2: Run admin UI test**

Run:

```bash
cd client-admin
node test/users-edit-traffic-form.test.js
```

Expected: PASS.

- [ ] **Step 3: Build admin frontend**

Run:

```bash
cd client-admin
npm run build
```

Expected: Vite build succeeds. If terser-related build failure appears, use the project-approved fallback:

```bash
npx vite build --minify esbuild
```

- [ ] **Step 4: Check git diff**

Run:

```bash
git diff -- server/package.json server/package-lock.json server/db/schema/tables.js server/db/migrations/024-user-ip-location.js server/services/shared/ip-location-service.js server/repositories/user-repository.js server/services/admin/users-service.js server/controllers/user/auth-controller.js server/services/user/subscription-service.js server/controllers/user/subscription-controller.js server/test/test-ip-location-service.js server/test/test-user-onboarding.js server/test/test-user-subscription-service.js client-admin/src/views/Users.vue client-admin/test/users-edit-traffic-form.test.js
```

Expected: diff only contains IP 归属地相关 changes.

- [ ] **Step 5: Server restart note**

Because this plan modifies `server/**/*.js`, remind the user to restart the backend service after deployment or local testing. Do not start the server automatically.

## Self-Review

- Spec coverage: database field, login recording, subscription recording, mainland-only filter, empty-location skip, IPv6 safe skip, admin list display, fallback text, and non-blocking error handling are covered.
- Placeholder scan: no placeholder tasks remain.
- Type consistency: `ip_location`, `ip_location_text`, `login`, `subscription`, `recordUserIpLocation()`, and `formatIpLocationText()` names are consistent across tasks.
