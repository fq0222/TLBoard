# User Home Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build user self-service home IP routing binding so a user can bind their purchased home proxy tag to one or two 3X-UI servers.

**Architecture:** Add a focused repository and user service for home routing state, plus subscription routes/controllers for options and updates. The service reads full Xray config per target server, extracts real `inbounds[*].tag`, removes stale matching routing rules, upserts the current user's rule, and saves local state only after all remote operations succeed.

**Tech Stack:** Node.js, Express, PostgreSQL through the existing db proxy, Vue 3, Vite, Element Plus, existing `XuiService`, existing `runWithConcurrency`.

**Spec:** `docs/superpowers/specs/2026-09-07-home-routing-design.md`

## Global Constraints

- 使用简体中文回答所有问题。
- 未经用户明确指示，禁止创建或切换新分支、禁止创建 Git worktree。
- 服务器修改后提醒用户重启后端服务，不自行启动后端。
- 新建文件和新增方法必须补充注释，至少说明职责、关键参数和核心分支语义。
- `inboundTag` 必须从每台服务器完整 Xray 配置的 `inbounds[*].tag` 读取，不从本地 `xui_nodes` 推断。
- 用户最多选择两台服务器，操作颗粒度只到服务器。
- 远端删除或写入失败时，不保存新的本地选择，不更新 `last_synced_at`，不触发 30 分钟冷却。
- 只有全部远端操作成功后，才保存本地绑定并记录 30 分钟冷却依据。
- 后端响应沿用 `legacySuccess` / `legacyFail` / `legacyValidationError`。
- 后端测试运行 `node server/test/test-user-home-routing-service.js`。
- 用户端构建运行 `cd client-user && npx vite build --minify esbuild`。

---

## File Structure

- Create `server/db/migrations/029-user-home-proxy-routes.js`: idempotent migration for `user_home_proxy_routes`.
- Modify `server/db/schema/tables.js`: add table definition for new installs.
- Modify `server/db/schema/indexes.js`: add indexes for route lookup.
- Create `server/repositories/user-home-routing-repository.js`: all SQL for entitlement, servers, route lookup, and route upsert.
- Create `server/services/user/home-routing-service.js`: business rules, cooldown, Xray config parsing, routing rule mutations, and remote sync orchestration.
- Modify `server/controllers/user/subscription-controller.js`: add option and update controller methods.
- Modify `server/routes/user/subscription.js`: add authenticated routes and validators.
- Modify `client-user/src/api/index.js`: add user API methods.
- Modify `client-user/src/views/user/Profile.vue`: add the home IP control UI below the subscription result area.
- Create `server/test/test-user-home-routing-service.js`: focused service tests with memory repository and fake XUI service.

---

### Task 1: Database Foundation

**Files:**
- Create: `server/db/migrations/029-user-home-proxy-routes.js`
- Modify: `server/db/schema/tables.js`
- Modify: `server/db/schema/indexes.js`
- Test: run migration script against configured database only if the developer intends to update local schema

**Interfaces:**
- Produces table `user_home_proxy_routes(user_id, home_proxy_tag, server_ids, last_synced_at, last_sync_status, last_sync_message, created_at, updated_at)`.
- Later tasks consume this table through `user-home-routing-repository.js`.

- [ ] **Step 1: Add the migration**

Create `server/db/migrations/029-user-home-proxy-routes.js` with this structure:

```javascript
/**
 * 数据库迁移脚本 029-user-home-proxy-routes
 * 职责：新增用户家宽 IP routing 绑定表，保存用户已成功同步到 3X-UI 的服务器选择。
 * 关键参数：无，直接使用本地数据库配置。
 * 核心分支：CREATE TABLE/INDEX 使用 IF NOT EXISTS，重复执行保持幂等。
 */

const { Pool } = require('pg');
const config = require('../../config');

async function migrate() {
  const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database
  });

  const client = await pool.connect();

  try {
    console.log('=== 迁移 029: user-home-proxy-routes ===\n');
    await client.query('BEGIN');

    console.log('[1/3] 创建 user_home_proxy_routes 表...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_home_proxy_routes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        home_proxy_tag VARCHAR(255) NOT NULL,
        server_ids TEXT NOT NULL DEFAULT '[]',
        last_synced_at BIGINT,
        last_sync_status VARCHAR(30) NOT NULL DEFAULT 'success',
        last_sync_message TEXT NOT NULL DEFAULT '',
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        UNIQUE(user_id)
      )
    `);

    console.log('\n[2/3] 创建用户索引...');
    await client.query('CREATE INDEX IF NOT EXISTS idx_user_home_proxy_routes_user_id ON user_home_proxy_routes(user_id)');

    console.log('\n[3/3] 创建家宽 tag 索引...');
    await client.query('CREATE INDEX IF NOT EXISTS idx_user_home_proxy_routes_home_proxy_tag ON user_home_proxy_routes(home_proxy_tag)');

    await client.query('COMMIT');
    console.log('\n=== 迁移完成 ===');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n迁移失败:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  migrate().then(() => {
    console.log('\n脚本执行成功');
    process.exit(0);
  }).catch((error) => {
    console.error('\n脚本执行失败:', error);
    process.exit(1);
  });
}

module.exports = { migrate };
```

- [ ] **Step 2: Add table definition for new installs**

In `server/db/schema/tables.js`, add a table definition after `home_proxies`:

```javascript
  {
    logMessage: '用户家宽 IP routing 绑定表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS user_home_proxy_routes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        home_proxy_tag VARCHAR(255) NOT NULL,
        server_ids TEXT NOT NULL DEFAULT '[]',
        last_synced_at BIGINT,
        last_sync_status VARCHAR(30) NOT NULL DEFAULT 'success',
        last_sync_message TEXT NOT NULL DEFAULT '',
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        UNIQUE(user_id)
      )
    `
  },
```

- [ ] **Step 3: Add indexes**

In `server/db/schema/indexes.js`, add:

```javascript
  'CREATE INDEX IF NOT EXISTS idx_user_home_proxy_routes_user_id ON user_home_proxy_routes(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_user_home_proxy_routes_home_proxy_tag ON user_home_proxy_routes(home_proxy_tag)',
```

- [ ] **Step 4: Commit database foundation**

```bash
git add server/db/migrations/029-user-home-proxy-routes.js server/db/schema/tables.js server/db/schema/indexes.js
git commit -m "feat: 添加用户家宽 routing 数据表"
```

---

### Task 2: Repository Layer

**Files:**
- Create: `server/repositories/user-home-routing-repository.js`
- Test: used by `server/test/test-user-home-routing-service.js` in Task 3

**Interfaces:**
- Produces `findHomeRoutingEntitlement(db, userId)`, `findUserHomeRoute(db, userId)`, `listOnlineServers(db)`, `listServersByIds(db, ids)`, and `upsertUserHomeRoute(db, payload)`.
- Consumes existing tables `users`, `plans`, `home_proxies`, `xui_servers`, and `user_home_proxy_routes`.

- [ ] **Step 1: Create repository with SQL methods**

Create `server/repositories/user-home-routing-repository.js`:

```javascript
/**
 * 用户家宽 IP routing 仓储。
 * 职责：封装用户家宽权益、可选服务器、当前绑定和绑定持久化 SQL。
 */

/**
 * 查询用户当前有效家宽 IP 权益。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 当前用户 ID
 * @returns {Promise<Object|undefined>} 家宽权益记录
 */
async function findHomeRoutingEntitlement(db, userId) {
  return db.prepare(`
    SELECT
      u.id AS user_id,
      u.email,
      u.home_plan_id,
      u.home_expire_at,
      p.name AS home_plan_name,
      p.plan_type,
      p.home_proxy_tag,
      hp.id AS home_proxy_id,
      hp.tag AS proxy_tag
    FROM users u
    LEFT JOIN plans p ON p.id = u.home_plan_id
    LEFT JOIN home_proxies hp ON hp.tag = p.home_proxy_tag
    WHERE u.id = ?
  `).get(userId);
}

/**
 * 查询用户当前成功保存的家宽 routing 绑定。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 当前用户 ID
 * @returns {Promise<Object|undefined>} 当前绑定记录
 */
async function findUserHomeRoute(db, userId) {
  return db.prepare('SELECT * FROM user_home_proxy_routes WHERE user_id = ?').get(userId);
}

/**
 * 查询用户可选择的在线 3X-UI 服务器。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Promise<Array>} 在线服务器列表
 */
async function listOnlineServers(db) {
  return db.prepare(`
    SELECT id, name, api_url, api_token, panel_version, status
    FROM xui_servers
    WHERE status = 1
    ORDER BY created_at DESC
  `).all();
}

/**
 * 根据 ID 查询服务器记录，包含离线服务器，便于展示旧绑定名称。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number[]} ids - 服务器 ID 列表
 * @returns {Promise<Array>} 服务器列表
 */
async function listServersByIds(db, ids) {
  const normalizedIds = Array.from(new Set((ids || [])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0)));

  if (normalizedIds.length === 0) {
    return [];
  }

  const placeholders = normalizedIds.map(() => '?').join(', ');
  return db.prepare(`
    SELECT id, name, api_url, api_token, panel_version, status
    FROM xui_servers
    WHERE id IN (${placeholders})
    ORDER BY created_at DESC
  `).all(...normalizedIds);
}

/**
 * 保存用户家宽 routing 绑定，按 user_id 幂等覆盖。
 *
 * @param {Object} db - 数据库代理对象，成功同步后传入普通 db 或事务态 db
 * @param {Object} payload - 绑定数据
 * @param {number} payload.userId - 用户 ID
 * @param {string} payload.homeProxyTag - 家宽 outbound tag
 * @param {number[]} payload.serverIds - 已成功同步服务器 ID
 * @param {number} payload.syncedAt - 成功同步时间
 * @param {string} payload.message - 成功摘要
 * @returns {Promise<void>}
 */
async function upsertUserHomeRoute(db, payload) {
  await db.prepare(`
    INSERT INTO user_home_proxy_routes (
      user_id, home_proxy_tag, server_ids, last_synced_at, last_sync_status, last_sync_message, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, 'success', ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET
      home_proxy_tag = EXCLUDED.home_proxy_tag,
      server_ids = EXCLUDED.server_ids,
      last_synced_at = EXCLUDED.last_synced_at,
      last_sync_status = EXCLUDED.last_sync_status,
      last_sync_message = EXCLUDED.last_sync_message,
      updated_at = EXCLUDED.updated_at
  `).run(
    payload.userId,
    payload.homeProxyTag,
    JSON.stringify(payload.serverIds || []),
    payload.syncedAt,
    payload.message || '',
    payload.syncedAt,
    payload.syncedAt
  );
}

module.exports = {
  findHomeRoutingEntitlement,
  findUserHomeRoute,
  listOnlineServers,
  listServersByIds,
  upsertUserHomeRoute
};
```

- [ ] **Step 2: Commit repository layer**

```bash
git add server/repositories/user-home-routing-repository.js
git commit -m "feat: 添加用户家宽 routing 仓储"
```

---

### Task 3: Service Layer With Tests

**Files:**
- Create: `server/services/user/home-routing-service.js`
- Create: `server/test/test-user-home-routing-service.js`

**Interfaces:**
- Consumes repository functions from Task 2.
- Produces service methods `getHomeRoutingOptions(db, userId)` and `updateHomeRouting(db, userId, payload, logger)`.
- Produces test injection methods `setRepositoryForTest(repository)`, `setXuiServiceFactoryForTest(factory)`, and `resetTestDependencies()`.

- [ ] **Step 1: Write failing service tests**

Create `server/test/test-user-home-routing-service.js` with tests named:

```javascript
async function testRejectsMissingEntitlement() {}
async function testRejectsMoreThanTwoServers() {}
async function testBuildsInboundTagsFromXrayConfig() {}
async function testDeletesOldServerRuleAndWritesNewRule() {}
async function testRemoteDeleteFailureDoesNotSaveOrCooldown() {}
async function testRemoteWriteFailureDoesNotSaveOrCooldown() {}
async function testCooldownBlocksRecentSuccessfulChange() {}
async function testDuplicateRulesAreCollapsed() {}
```

Use an in-memory repository with this shape:

```javascript
function createMemoryRepository(initialState = {}) {
  const state = {
    entitlement: initialState.entitlement,
    route: initialState.route,
    servers: initialState.servers || [],
    savedRoutes: []
  };

  return {
    state,
    async findHomeRoutingEntitlement() {
      return state.entitlement ? clone(state.entitlement) : undefined;
    },
    async findUserHomeRoute() {
      return state.route ? clone(state.route) : undefined;
    },
    async listOnlineServers() {
      return clone(state.servers.filter((server) => Number(server.status) === 1));
    },
    async listServersByIds(db, ids) {
      const idSet = new Set((ids || []).map(Number));
      return clone(state.servers.filter((server) => idSet.has(Number(server.id))));
    },
    async upsertUserHomeRoute(db, payload) {
      state.savedRoutes.push(clone(payload));
      state.route = {
        user_id: payload.userId,
        home_proxy_tag: payload.homeProxyTag,
        server_ids: JSON.stringify(payload.serverIds),
        last_synced_at: payload.syncedAt,
        last_sync_status: 'success',
        last_sync_message: payload.message || ''
      };
    }
  };
}
```

Use fake XUI instances:

```javascript
function createFakeXuiFactory(configs, calls, failing = {}) {
  return async (apiUrl) => {
    const serverId = Number(String(apiUrl).replace('server-', ''));
    return {
      async getXrayConfig() {
        calls.get.push(serverId);
        if (failing.get?.includes(serverId)) throw new Error(`get failed ${serverId}`);
        return {
          success: true,
          obj: {
            xraySetting: configs[serverId],
            outboundTestUrl: 'https://www.google.com/generate_204'
          }
        };
      },
      async updateXrayConfig(xraySetting) {
        calls.update.push(serverId);
        if (failing.update?.includes(serverId)) throw new Error(`update failed ${serverId}`);
        configs[serverId] = clone(xraySetting);
        return { success: true, msg: 'ok' };
      }
    };
  };
}
```

Expected assertions:

```javascript
assert.deepStrictEqual(configs[1].routing.rules[0].inboundTag, ['in-21443-tcp', 'in-28905-udp']);
assert.strictEqual(configs[1].routing.rules[0].outboundTag, 'local-ip-lax');
assert.deepStrictEqual(configs[1].routing.rules[0].user, ['user@example.com']);
assert.strictEqual(repository.state.savedRoutes.length, 0);
assert.rejects(() => service.updateHomeRouting({}, 1, { server_ids: [1, 2, 3] }), /最多选择两台服务器/);
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node server/test/test-user-home-routing-service.js
```

Expected: fail because `server/services/user/home-routing-service.js` does not exist.

- [ ] **Step 3: Implement service helpers**

In `server/services/user/home-routing-service.js`, implement:

```javascript
const XuiService = require('../../integrations/xui/xui-service');
const { runWithConcurrency } = require('../../utils/concurrency');
let repository = require('../../repositories/user-home-routing-repository');

const HOME_ROUTING_SYNC_CONCURRENCY = 10;
const HOME_ROUTING_COOLDOWN_SECONDS = 30 * 60;
const XUI_XRAY_TIMEOUT = 30000;
let xuiServiceFactory = XuiService.getInstance.bind(XuiService);

function createLegacyBusinessError(message, options = {}) { ... }
function getNowTimestamp() { return Math.floor(Date.now() / 1000); }
function normalizeServerIds(serverIds) { ... }
function parseServerIds(value) { ... }
function parseJsonLikeConfig(value, label) { ... }
function normalizeXraySetting(response) { ... }
function extractOutboundTestUrl(response) { ... }
function ensureRoutingRules(xraySetting) { ... }
function extractInboundTags(xraySetting) { ... }
function isMatchingHomeRule(rule, homeProxyTag, email) { ... }
function removeMatchingHomeRules(xraySetting, homeProxyTag, email) { ... }
function upsertHomeRoutingRule(xraySetting, homeProxyTag, email) { ... }
```

Use the same parsing semantics as `server/services/admin/home-proxies-service.js` for `normalizeXraySetting()` and `extractOutboundTestUrl()`.

- [ ] **Step 4: Implement entitlement and option formatting**

Implement:

```javascript
function assertActiveHomeEntitlement(entitlement, now = getNowTimestamp()) {
  if (!entitlement || !entitlement.home_plan_id) throw createLegacyBusinessError('购买家宽 IP 套餐后可配置', { code: 4101 });
  if (Number(entitlement.home_expire_at || 0) <= now) throw createLegacyBusinessError('家宽 IP 套餐已到期，请先续费', { code: 4102 });
  if (String(entitlement.plan_type || '') !== 'home_ip') throw createLegacyBusinessError('当前家宽 IP 套餐配置异常，请联系客服', { code: 4103 });
  if (!String(entitlement.home_proxy_tag || '').trim()) throw createLegacyBusinessError('当前家宽 IP 未绑定 tag，请联系客服', { code: 4104 });
  if (!entitlement.home_proxy_id) throw createLegacyBusinessError('当前家宽 IP 配置不存在，请联系客服', { code: 4105 });
  return {
    userId: Number(entitlement.user_id),
    email: entitlement.email,
    homeProxyTag: String(entitlement.home_proxy_tag).trim(),
    homePlanName: entitlement.home_plan_name || '',
    homeExpireAt: Number(entitlement.home_expire_at)
  };
}
```

Implement `getHomeRoutingOptions(db, userId)` to return `available: false` instead of throwing when entitlement is missing or expired, plus online `servers`, formatted current `route`, and `cooldown_remaining_seconds`.

- [ ] **Step 5: Implement remote sync orchestration**

Implement:

```javascript
async function syncServerRoute(server, context) {
  const xuiService = await xuiServiceFactory(server.api_url, server.api_token, {
    apiVersion: server.panel_version || '3.0.2'
  });
  const configResult = await xuiService.getXrayConfig({ timeout: XUI_XRAY_TIMEOUT });
  const xraySetting = normalizeXraySetting(configResult);
  const outboundTestUrl = extractOutboundTestUrl(configResult);

  removeMatchingHomeRules(xraySetting, context.homeProxyTag, context.email);

  if (context.nextServerIds.includes(Number(server.id))) {
    upsertHomeRoutingRule(xraySetting, context.homeProxyTag, context.email);
  }

  const updateResult = outboundTestUrl === undefined
    ? await xuiService.updateXrayConfig(xraySetting, { timeout: XUI_XRAY_TIMEOUT })
    : await xuiService.updateXrayConfig(xraySetting, outboundTestUrl, { timeout: XUI_XRAY_TIMEOUT });

  if (updateResult && updateResult.success === false) {
    throw new Error(updateResult.msg || updateResult.message || '回写 Xray 配置失败');
  }

  return { server_id: Number(server.id), server_name: server.name };
}
```

Implement `updateHomeRouting(db, userId, payload, logger)`:

- normalize and validate `payload.server_ids`.
- enforce 30-minute cooldown using existing route `last_synced_at`.
- validate all selected servers are online.
- include old selected server IDs in involved server list, even if no longer selected.
- run `runWithConcurrency(involvedServers, HOME_ROUTING_SYNC_CONCURRENCY, worker)`.
- if any failed, throw `createLegacyBusinessError('家宽 IP routing 同步失败，请重试', { code: 4107, data: { failed_servers, retryable: true } })`.
- after all remote operations succeed, call `repository.upsertUserHomeRoute()`.

- [ ] **Step 6: Expose test hooks**

Export:

```javascript
module.exports = {
  HOME_ROUTING_COOLDOWN_SECONDS,
  getHomeRoutingOptions,
  updateHomeRouting,
  __testables: {
    normalizeServerIds,
    parseServerIds,
    normalizeXraySetting,
    extractInboundTags,
    removeMatchingHomeRules,
    upsertHomeRoutingRule,
    assertActiveHomeEntitlement
  },
  setRepositoryForTest(testRepository) {
    repository = testRepository;
  },
  setXuiServiceFactoryForTest(factory) {
    xuiServiceFactory = factory;
  },
  resetTestDependencies() {
    repository = require('../../repositories/user-home-routing-repository');
    xuiServiceFactory = XuiService.getInstance.bind(XuiService);
  }
};
```

- [ ] **Step 7: Run service tests**

```bash
node server/test/test-user-home-routing-service.js
```

Expected: prints `用户家宽 routing 服务层测试通过`.

- [ ] **Step 8: Commit service layer**

```bash
git add server/services/user/home-routing-service.js server/test/test-user-home-routing-service.js
git commit -m "feat: 添加用户家宽 routing 同步服务"
```

---

### Task 4: User API Endpoints

**Files:**
- Modify: `server/controllers/user/subscription-controller.js`
- Modify: `server/routes/user/subscription.js`
- Test: `node server/test/test-user-home-routing-service.js`

**Interfaces:**
- Consumes `homeRoutingService.getHomeRoutingOptions(db, userId)` and `homeRoutingService.updateHomeRouting(db, userId, req.body, logger)`.
- Produces `GET /api/user/subscription/home-routing/options` and `PUT /api/user/subscription/home-routing`.

- [ ] **Step 1: Add controller imports and handlers**

In `server/controllers/user/subscription-controller.js`, add:

```javascript
const homeRoutingService = require('../../services/user/home-routing-service');
```

Add handlers:

```javascript
/**
 * 获取当前用户家宽 IP routing 配置选项。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function getHomeRoutingOptions(req, res) {
  try {
    const data = await homeRoutingService.getHomeRoutingOptions(req.app.locals.db, req.user.id);
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '获取家宽 IP routing 配置', error);
  }
}

/**
 * 更新当前用户家宽 IP routing 绑定并同步到 3X-UI。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function updateHomeRouting(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const data = await homeRoutingService.updateHomeRouting(
      req.app.locals.db,
      req.user.id,
      req.body,
      logger
    );
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '同步家宽 IP routing', error);
  }
}
```

Export both handlers.

- [ ] **Step 2: Add route validators**

In `server/routes/user/subscription.js`, update imports:

```javascript
const { body, param, query } = require('express-validator');
```

Add before `router.get('/')`:

```javascript
router.get('/home-routing/options', authenticateUser, subscriptionController.getHomeRoutingOptions);

router.put('/home-routing', authenticateUser, [
  body('server_ids')
    .isArray({ min: 1, max: 2 })
    .withMessage('最多选择两台服务器'),
  body('server_ids.*')
    .isInt({ min: 1 })
    .withMessage('服务器ID必须是大于0的整数')
], subscriptionController.updateHomeRouting);
```

- [ ] **Step 3: Run API-adjacent service tests**

```bash
node server/test/test-user-home-routing-service.js
```

Expected: still passes.

- [ ] **Step 4: Commit user API**

```bash
git add server/controllers/user/subscription-controller.js server/routes/user/subscription.js
git commit -m "feat: 添加用户家宽 routing 接口"
```

---

### Task 5: User Frontend API

**Files:**
- Modify: `client-user/src/api/index.js`
- Test: `cd client-user && npx vite build --minify esbuild`

**Interfaces:**
- Consumes backend endpoints from Task 4.
- Produces `api.user.getHomeRoutingOptions()` and `api.user.updateHomeRouting(serverIds)`.

- [ ] **Step 1: Add API methods**

In `client-user/src/api/index.js`, after `replaceSubscriptionLink()`, add:

```javascript
  /**
   * 获取当前用户家宽 IP routing 配置选项。
   * @returns {Promise<Object>} 家宽 IP 权益、可选服务器和当前绑定
   */
  getHomeRoutingOptions() {
    return apiClient.get('/subscription/home-routing/options')
  },

  /**
   * 更新当前用户家宽 IP routing 绑定。
   * @param {Array<number>} serverIds - 目标 3X-UI 服务器 ID，最多两个
   * @returns {Promise<Object>} 更新后的绑定信息
   */
  updateHomeRouting(serverIds) {
    return apiClient.put('/subscription/home-routing', {
      server_ids: serverIds
    }, { timeout: 120000 })
  },
```

- [ ] **Step 2: Run frontend build after API syntax change**

```bash
cd client-user
npx vite build --minify esbuild
```

Expected: build succeeds.

- [ ] **Step 3: Commit frontend API**

```bash
git add client-user/src/api/index.js
git commit -m "feat: 添加用户家宽 routing 前端接口"
```

---

### Task 6: Profile UI

**Files:**
- Modify: `client-user/src/views/user/Profile.vue`
- Test: `cd client-user && npx vite build --minify esbuild`

**Interfaces:**
- Consumes `api.user.getHomeRoutingOptions()` and `api.user.updateHomeRouting(serverIds)` from Task 5.
- Produces visible “家宽 IP 控制” area and add/edit dialog.

- [ ] **Step 1: Add template section below subscription links**

Inside the subscription workspace article, immediately after the `subscription-links` block, add:

```vue
          <section v-if="homeRoutingOptions.available" class="home-routing-panel">
            <div class="home-routing-head">
              <h3 class="home-routing-title">家宽 IP 控制</h3>
              <el-button
                type="primary"
                :disabled="actionBusy || homeRoutingBusy || homeRoutingCooldownRemaining > 0"
                @click="openHomeRoutingDialog"
              >
                {{ homeRoutingRoute ? '修改' : '添加' }}
              </el-button>
            </div>

            <el-table
              v-if="homeRoutingRoute"
              :data="[homeRoutingRoute]"
              class="home-routing-table"
              size="large"
            >
              <el-table-column prop="home_proxy_tag" label="IP" min-width="160" />
              <el-table-column label="服务器" min-width="140">
                <template #default="{ row }">
                  {{ row.servers?.[0]?.name || '-' }}
                </template>
              </el-table-column>
              <el-table-column label="服务器" min-width="140">
                <template #default="{ row }">
                  {{ row.servers?.[1]?.name || '-' }}
                </template>
              </el-table-column>
              <el-table-column label="操作" width="110">
                <template #default>
                  <el-button
                    link
                    type="primary"
                    :disabled="homeRoutingCooldownRemaining > 0"
                    @click="openHomeRoutingDialog"
                  >
                    修改
                  </el-button>
                </template>
              </el-table-column>
            </el-table>

            <el-empty v-else description="暂未配置家宽 IP 服务器" />

            <p v-if="homeRoutingCooldownRemaining > 0" class="home-routing-tip">
              距离下次修改还需等待 {{ homeRoutingCooldownText }}
            </p>
          </section>
```

- [ ] **Step 2: Add dialog template before existing loading dialogs**

Add:

```vue
    <el-dialog
      v-model="homeRoutingDialogVisible"
      title="家宽 IP 控制"
      :width="homeRoutingDialogWidth"
      :close-on-click-modal="false"
    >
      <el-form label-position="top">
        <el-form-item label="家宽 IP">
          <el-select v-model="homeRoutingForm.home_proxy_tag" disabled style="width: 100%">
            <el-option
              :label="homeRoutingOptions.home_proxy_tag"
              :value="homeRoutingOptions.home_proxy_tag"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="服务器">
          <el-select v-model="homeRoutingForm.server_id_1" placeholder="请选择服务器" style="width: 100%">
            <el-option
              v-for="server in homeRoutingServers"
              :key="server.id"
              :label="server.name"
              :value="server.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="服务器">
          <el-select v-model="homeRoutingForm.server_id_2" clearable placeholder="可选第二台服务器" style="width: 100%">
            <el-option
              v-for="server in secondHomeRoutingServers"
              :key="server.id"
              :label="server.name"
              :value="server.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="homeRoutingDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="homeRoutingBusy" @click="submitHomeRouting">
          确定
        </el-button>
      </template>
    </el-dialog>
```

- [ ] **Step 3: Add script state and computed values**

In the script, add refs:

```javascript
const homeRoutingOptions = ref({ available: false })
const homeRoutingDialogVisible = ref(false)
const homeRoutingBusy = ref(false)
const homeRoutingForm = ref({
  home_proxy_tag: '',
  server_id_1: null,
  server_id_2: null
})
```

Add computed:

```javascript
const homeRoutingDialogWidth = computed(() => (windowWidth.value <= 768 ? '92vw' : '520px'))
const homeRoutingRoute = computed(() => homeRoutingOptions.value.route || null)
const homeRoutingServers = computed(() => homeRoutingOptions.value.servers || [])
const secondHomeRoutingServers = computed(() => homeRoutingServers.value.filter((server) => Number(server.id) !== Number(homeRoutingForm.value.server_id_1)))
const homeRoutingCooldownRemaining = computed(() => Number(homeRoutingOptions.value.cooldown_remaining_seconds || 0))
const homeRoutingCooldownText = computed(() => {
  const seconds = homeRoutingCooldownRemaining.value
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} 分钟`
})
```

- [ ] **Step 4: Add methods**

Add:

```javascript
async function loadHomeRoutingOptions() {
  try {
    const response = await api.user.getHomeRoutingOptions()
    homeRoutingOptions.value = response.data || { available: false }
  } catch (error) {
    homeRoutingOptions.value = { available: false }
  }
}

function openHomeRoutingDialog() {
  const routeServerIds = homeRoutingRoute.value?.server_ids || []
  homeRoutingForm.value = {
    home_proxy_tag: homeRoutingOptions.value.home_proxy_tag || '',
    server_id_1: routeServerIds[0] || null,
    server_id_2: routeServerIds[1] || null
  }
  homeRoutingDialogVisible.value = true
}

function buildHomeRoutingServerIds() {
  return [homeRoutingForm.value.server_id_1, homeRoutingForm.value.server_id_2]
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0)
}

async function submitHomeRouting() {
  const serverIds = buildHomeRoutingServerIds()
  if (serverIds.length === 0) {
    ElMessage.warning('请选择至少一台服务器')
    return
  }
  if (new Set(serverIds).size !== serverIds.length) {
    ElMessage.warning('两台服务器不能重复')
    return
  }

  homeRoutingBusy.value = true
  try {
    const response = await api.user.updateHomeRouting(serverIds)
    homeRoutingOptions.value = {
      ...homeRoutingOptions.value,
      ...(response.data || {})
    }
    homeRoutingDialogVisible.value = false
    ElMessage.success('家宽 IP 配置已同步')
    await loadHomeRoutingOptions()
  } catch (error) {
    const failedServers = error.response?.data?.data?.failed_servers || []
    if (failedServers.length > 0) {
      ElMessage.error(`同步失败：${failedServers.map((server) => server.name).join('、')}，请重试`)
    } else {
      ElMessage.error(error.userMessage || '家宽 IP 配置同步失败')
    }
  } finally {
    homeRoutingBusy.value = false
  }
}
```

Call `await loadHomeRoutingOptions()` from the existing page initialization path after profile/subscription data loads. If the existing `onMounted()` calls `loadData()` or similar, add it there rather than creating a second race-prone initialization path.

- [ ] **Step 5: Add styles**

Add CSS:

```css
.home-routing-panel {
  margin-top: 22px;
  padding-top: 20px;
  border-top: 1px solid #e2e8f0;
}

.home-routing-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.home-routing-title {
  margin: 0;
  color: #0f172a;
  font-size: 18px;
  line-height: 1.35;
}

.home-routing-table {
  width: 100%;
}

.home-routing-tip {
  margin: 10px 0 0;
  color: #b45309;
  font-size: 13px;
}
```

Add responsive rules under the existing `@media (max-width: 768px)`:

```css
  .home-routing-panel {
    margin-top: 16px;
    padding-top: 16px;
  }

  .home-routing-head {
    align-items: flex-start;
  }

  .home-routing-title {
    font-size: 16px;
  }
```

- [ ] **Step 6: Run frontend build**

```bash
cd client-user
npx vite build --minify esbuild
```

Expected: build succeeds.

- [ ] **Step 7: Commit profile UI**

```bash
git add client-user/src/views/user/Profile.vue
git commit -m "feat: 添加用户家宽 IP 控制界面"
```

---

### Task 7: Final Verification

**Files:**
- Verify all files changed in Tasks 1-6.

**Interfaces:**
- Consumes complete backend and frontend implementation.
- Produces final test evidence and ready-to-review branch state.

- [ ] **Step 1: Run backend service test**

```bash
node server/test/test-user-home-routing-service.js
```

Expected: `用户家宽 routing 服务层测试通过`.

- [ ] **Step 2: Run existing related backend test**

```bash
node server/test/test-home-proxies-service.js
```

Expected: `家宽 IP 服务层测试通过`.

- [ ] **Step 3: Run user frontend build**

```bash
cd client-user
npx vite build --minify esbuild
```

Expected: Vite build succeeds.

- [ ] **Step 4: Inspect git history and status**

```bash
git log --oneline -5
git status --short
```

Expected: implementation commits are present; worktree contains only intentional changes.

- [ ] **Step 5: Final response**

Tell the user:

- which files changed,
- the exact test commands and key success output,
- that `server/**/*.js` changed and the backend needs a restart,
- that no `git push` was performed.

