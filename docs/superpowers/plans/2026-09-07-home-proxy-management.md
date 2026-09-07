# 家宽 IP 管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在管理端新增家宽 SOCKS 出站管理，并支持并发同步到在线 3X-UI 服务器。

**Architecture:** 后端新增 home-proxies 独立模块，沿用 routes/controller/service/repository 分层；远端同步通过扩展 XUI client 读取和回写完整 Xray 配置。前端新增 `HomeProxies.vue` 页面，复用管理端现有卡片式管理体验，所有远端同步均由管理员手动触发。

**Tech Stack:** Node.js Express、PostgreSQL、Axios、Vue 3、Vite、Element Plus、现有 `runWithConcurrency`。

**Spec:** `docs/superpowers/specs/2026-09-07-home-proxy-management-design.md`

## Global Constraints

- 使用简体中文回答和编写面向管理员的文案。
- 未经用户明确指示，不创建或切换 Git 分支，不创建 Git worktree。
- 新增和编辑保存时不自动同步远端服务器。
- `tag` 在本地全局唯一，必填，不预填默认值。
- 同步目标为所有已配置的 3X-UI 服务器中的在线服务器。
- 同步和删除远端 outbound 时使用现有并发组件，最大并发数为 10。
- 同步失败必须记录服务器 ID，UI 展示服务器名称。
- 部分失败后再次点击同步，只同步失败服务器；全部成功后再次同步，面向所有在线服务器。
- 删除远端 outbound 全部成功后才删除本地记录，删除失败时保留本地记录。
- 修改 `server/**/*.js` 后完成时提醒用户重启后端服务，不自行启动服务器。
- 后端修改后运行相关 `server/test/` 脚本；前端修改后执行管理端构建。

---

## File Structure

- Create `server/repositories/home-proxies-repository.js`：封装 `home_proxies` 表 CRUD、唯一性检查、失败服务器名称映射和在线服务器查询。
- Create `server/services/admin/home-proxies-service.js`：封装校验、outbound 生成、同步目标选择、并发同步、失败记录聚合和删除流程。
- Create `server/controllers/admin/home-proxies-controller.js`：处理请求校验结果、调用 service，并返回 legacy 响应。
- Create `server/routes/admin/home-proxies.js`：定义管理端鉴权路由和 express-validator 规则。
- Modify `server/bootstrap/register-admin-routes.js`：挂载 `/api/admin/home-proxies`。
- Modify `server/db/schema/tables.js`：初始化 `home_proxies` 表。
- Modify `server/db/schema/indexes.js`：增加 `home_proxies.tag` 唯一索引和状态索引。
- Create `server/db/migrations/027-home-proxies.js`：生产库幂等迁移。
- Modify `server/integrations/xui/xui-api-client-v302.js`：新增 Xray 配置读取和表单回写方法。
- Modify `server/integrations/xui/xui-service.js`：暴露 `getXrayConfig` 和 `updateXrayConfig` 包装方法。
- Create `server/test/test-home-proxies-service.js`：使用 fake db/repository 和 fake XUI service 验证核心业务逻辑。
- Modify `client-admin/src/api/index.js`：新增 home proxy API 封装，远端同步和删除使用 120 秒超时。
- Modify `client-admin/src/router/index.js`：新增 `/admin/home-proxies` 页面路由。
- Modify `client-admin/src/views/Layout.vue`：在服务器管理下方新增导航项。
- Create `client-admin/src/views/HomeProxies.vue`：新增管理页面和卡片 UI。

---

### Task 1: 数据库与仓储

**Files:**
- Modify: `server/db/schema/tables.js`
- Modify: `server/db/schema/indexes.js`
- Create: `server/db/migrations/027-home-proxies.js`
- Create: `server/repositories/home-proxies-repository.js`

**Interfaces:**
- Produces: `homeProxiesRepository.listHomeProxies(db): Promise<Array>`
- Produces: `homeProxiesRepository.findHomeProxyById(db, id): Promise<Object|undefined>`
- Produces: `homeProxiesRepository.findHomeProxyByTag(db, tag): Promise<Object|undefined>`
- Produces: `homeProxiesRepository.createHomeProxy(db, payload): Promise<Object>`
- Produces: `homeProxiesRepository.updateHomeProxy(db, id, payload): Promise<void>`
- Produces: `homeProxiesRepository.updateSyncState(db, id, payload): Promise<void>`
- Produces: `homeProxiesRepository.deleteHomeProxy(db, id): Promise<void>`
- Produces: `homeProxiesRepository.listOnlineServers(db): Promise<Array>`
- Produces: `homeProxiesRepository.listServersByIds(db, ids): Promise<Array>`

- [ ] **Step 1: Add schema table**

Add this table definition after `xui_servers` in `server/db/schema/tables.js`:

```javascript
{
  logMessage: '家宽 IP 出站表初始化完成',
  sql: `
    CREATE TABLE IF NOT EXISTS home_proxies (
      id SERIAL PRIMARY KEY,
      tag VARCHAR(255) NOT NULL,
      address VARCHAR(255) NOT NULL,
      port INTEGER NOT NULL,
      username VARCHAR(255) NOT NULL,
      password TEXT NOT NULL,
      sync_status VARCHAR(30) NOT NULL DEFAULT 'pending',
      failed_server_ids TEXT NOT NULL DEFAULT '[]',
      last_sync_at BIGINT,
      last_sync_success_count INTEGER NOT NULL DEFAULT 0,
      last_sync_failed_count INTEGER NOT NULL DEFAULT 0,
      last_sync_message TEXT NOT NULL DEFAULT '',
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
      updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
    )
  `
}
```

- [ ] **Step 2: Add indexes**

Append to `server/db/schema/indexes.js`:

```javascript
'CREATE UNIQUE INDEX IF NOT EXISTS idx_home_proxies_tag ON home_proxies(tag)',
'CREATE INDEX IF NOT EXISTS idx_home_proxies_sync_status ON home_proxies(sync_status)'
```

- [ ] **Step 3: Add migration**

Create `server/db/migrations/027-home-proxies.js` with an exported async migration that runs:

```sql
CREATE TABLE IF NOT EXISTS home_proxies (...same fields as schema...);
CREATE UNIQUE INDEX IF NOT EXISTS idx_home_proxies_tag ON home_proxies(tag);
CREATE INDEX IF NOT EXISTS idx_home_proxies_sync_status ON home_proxies(sync_status);
```

Use `db.exec()` for DDL, following the local migration style.

- [ ] **Step 4: Add repository**

Create `server/repositories/home-proxies-repository.js` with documented methods. Store `failed_server_ids` as JSON text, and parse it in callers rather than inside SQL.

Required SQL:

```javascript
SELECT * FROM home_proxies ORDER BY created_at DESC
SELECT * FROM home_proxies WHERE id = ?
SELECT * FROM home_proxies WHERE tag = ?
INSERT INTO home_proxies (tag, address, port, username, password, sync_status, failed_server_ids) VALUES (?, ?, ?, ?, ?, 'pending', '[]')
UPDATE home_proxies SET tag = ?, address = ?, port = ?, username = ?, password = ?, sync_status = 'pending', failed_server_ids = '[]', updated_at = ? WHERE id = ?
UPDATE home_proxies SET sync_status = ?, failed_server_ids = ?, last_sync_at = ?, last_sync_success_count = ?, last_sync_failed_count = ?, last_sync_message = ?, updated_at = ? WHERE id = ?
DELETE FROM home_proxies WHERE id = ?
SELECT id, name, api_url, api_token, panel_version, status FROM xui_servers WHERE status = 1 ORDER BY created_at DESC
SELECT id, name, api_url, api_token, panel_version, status FROM xui_servers WHERE id = ANY($1)
```

If the db wrapper does not support `ANY($1)` through `prepare`, build a parameterized `IN (?, ?, ?)` placeholder list from numeric IDs only.

- [ ] **Step 5: Verify syntax**

Run:

```bash
node -c server/repositories/home-proxies-repository.js
node -c server/db/migrations/027-home-proxies.js
```

Expected: both commands exit with code 0.

---

### Task 2: Xray 配置读写能力

**Files:**
- Modify: `server/integrations/xui/xui-api-client-v302.js`
- Modify: `server/integrations/xui/xui-service.js`

**Interfaces:**
- Consumes: existing `XuiApiClientV302.request(method, path, data, options)`
- Produces: `XuiApiClientV302.requestForm(method, path, data, options): Promise<Object>`
- Produces: `XuiApiClientV302.getXrayConfig(options): Promise<Object>`
- Produces: `XuiApiClientV302.updateXrayConfig(xraySetting, options): Promise<Object>`
- Produces: `XuiService.prototype.getXrayConfig(options): Promise<Object>`
- Produces: `XuiService.prototype.updateXrayConfig(xraySetting, options): Promise<Object>`

- [ ] **Step 1: Add form request helper**

In `xui-api-client-v302.js`, add `requestForm` beside `request`. It must use `URLSearchParams`, set `Content-Type: application/x-www-form-urlencoded`, respect `options.timeout`, and keep `xuiActivityTracker` begin/end semantics.

- [ ] **Step 2: Add Xray config methods**

Add:

```javascript
getXrayConfig(options = {}) {
  return this.request('post', '/panel/api/xray/', undefined, options);
}

updateXrayConfig(xraySetting, options = {}) {
  return this.requestForm('post', '/panel/api/xray/update', {
    xraySetting: typeof xraySetting === 'string' ? xraySetting : JSON.stringify(xraySetting)
  }, options);
}
```

- [ ] **Step 3: Expose service wrappers**

In `xui-service.js`, add documented wrappers:

```javascript
async getXrayConfig(options = {}) {
  return this.client.getXrayConfig(options);
}

async updateXrayConfig(xraySetting, options = {}) {
  return this.client.updateXrayConfig(xraySetting, options);
}
```

- [ ] **Step 4: Verify syntax**

Run:

```bash
node -c server/integrations/xui/xui-api-client-v302.js
node -c server/integrations/xui/xui-service.js
```

Expected: both commands exit with code 0.

---

### Task 3: 后端业务服务与 API

**Files:**
- Create: `server/services/admin/home-proxies-service.js`
- Create: `server/controllers/admin/home-proxies-controller.js`
- Create: `server/routes/admin/home-proxies.js`
- Modify: `server/bootstrap/register-admin-routes.js`
- Create: `server/test/test-home-proxies-service.js`

**Interfaces:**
- Consumes: Task 1 repository methods.
- Consumes: Task 2 XUI service methods.
- Produces: `homeProxiesService.listHomeProxies(db): Promise<{home_proxies: Array}>`
- Produces: `homeProxiesService.createHomeProxy(db, payload): Promise<Object>`
- Produces: `homeProxiesService.updateHomeProxy(db, id, payload): Promise<Object>`
- Produces: `homeProxiesService.deleteHomeProxy(db, id): Promise<Object>`
- Produces: `homeProxiesService.syncHomeProxy(db, id): Promise<Object>`

- [ ] **Step 1: Write service test skeleton**

Create `server/test/test-home-proxies-service.js` using Node `assert`. Mock repository state in memory and inject fake XUI service factory if the implementation exposes `setXuiServiceFactoryForTest(factory)` and `resetXuiServiceFactoryForTest()`.

Tests to include:

```javascript
await testCreateRejectsDuplicateTag();
await testUpdateResetsPendingAndFailedServers();
await testSyncAllOnlineServersWhenNoFailures();
await testSyncRetriesOnlyFailedServers();
await testSyncKeepsOfflineFailedServer();
await testDeleteKeepsLocalRecordWhenRemoteDeleteFails();
```

- [ ] **Step 2: Implement service constants and helpers**

In service file define:

```javascript
const HOME_PROXY_SYNC_CONCURRENCY = 10;
const SYNC_STATUS = {
  PENDING: 'pending',
  SUCCESS: 'success',
  PARTIAL_FAILED: 'partial_failed',
  FAILED: 'failed',
  DELETE_FAILED: 'delete_failed'
};
```

Add helpers:

```javascript
function createLegacyBusinessError(message, options = {}) {}
function parseFailedServerIds(value) {}
function buildSocksOutbound(homeProxy) {}
function upsertOutbound(xraySetting, outbound) {}
function removeOutboundByTag(xraySetting, tag) {}
function buildSyncState(totalTargets, successIds, failedIds, skippedIds, mode) {}
```

- [ ] **Step 3: Implement validation**

Validation rules in service:

```javascript
tag.trim() !== ''
address.trim() !== ''
Number.isInteger(port) && port >= 1 && port <= 65535
username.trim() !== ''
password.trim() !== ''
```

Duplicate tag check:

```javascript
const existing = await repository.findHomeProxyByTag(db, tag);
if (existing && Number(existing.id) !== Number(currentId)) throw createLegacyBusinessError('tag 已存在，请使用唯一 tag');
```

- [ ] **Step 4: Implement list formatting**

`listHomeProxies` must attach:

```javascript
failed_servers: [{ id, name, status }]
failed_server_names: ['服务器A', '服务器B']
```

Password should not be returned as plain text. Return `has_password: true` and `password_mask: '******'`.

- [ ] **Step 5: Implement create and update**

Create returns saved row with `message: '家宽 IP 添加成功，等待同步'`。

Update resets:

```javascript
sync_status = 'pending'
failed_server_ids = '[]'
last_sync_success_count = 0
last_sync_failed_count = 0
last_sync_message = '配置已更新，等待重新同步'
```

- [ ] **Step 6: Implement sync target selection**

If status is `partial_failed` or `failed` and failed IDs are non-empty:

```javascript
targets = onlineServers.filter(server => failedIds.includes(Number(server.id)));
skippedIds = failedIds.filter(id => !onlineServerIds.has(id));
```

Otherwise:

```javascript
targets = onlineServers;
skippedIds = [];
```

If `targets.length === 0` and `skippedIds.length === 0`, throw business error `当前没有在线的 3X-UI 服务器可同步`。

- [ ] **Step 7: Implement concurrent sync**

Use:

```javascript
const results = await runWithConcurrency(targets, HOME_PROXY_SYNC_CONCURRENCY, async (server) => {
  const xuiService = await xuiServiceFactory(server.api_url, server.api_token, {
    apiVersion: server.panel_version || '3.0.2'
  });
  const configResult = await xuiService.getXrayConfig({ timeout: 30000 });
  const xraySetting = normalizeXraySetting(configResult);
  upsertOutbound(xraySetting, buildSocksOutbound(homeProxy));
  await xuiService.updateXrayConfig(xraySetting, { timeout: 30000 });
  return { server_id: Number(server.id) };
});
```

Persist failed IDs from rejected results plus skipped offline IDs.

- [ ] **Step 8: Implement delete**

If never synced and no failures, delete local immediately.

Otherwise select delete targets:

```javascript
if (homeProxy.sync_status === 'delete_failed' && failedIds.length > 0) retry failed IDs only;
else target all online servers;
```

For each target, fetch config, remove outbound by tag, and update Xray config. If the tag does not exist, treat the server as success because remote state is already clean.

- [ ] **Step 9: Add controller and routes**

Routes:

```javascript
router.get('/', authenticateAdmin, controller.listHomeProxies);
router.post('/', authenticateAdmin, validators, controller.createHomeProxy);
router.put('/:id', authenticateAdmin, idValidator, validators, controller.updateHomeProxy);
router.delete('/:id', authenticateAdmin, idValidator, controller.deleteHomeProxy);
router.post('/:id/sync', authenticateAdmin, idValidator, controller.syncHomeProxy);
```

Validators:

```javascript
body('tag').trim().notEmpty()
body('address').trim().notEmpty()
body('port').isInt({ min: 1, max: 65535 })
body('user').trim().notEmpty()
body('pass').trim().notEmpty()
```

- [ ] **Step 10: Mount route**

In `register-admin-routes.js`:

```javascript
const adminHomeProxiesRoutes = require('../routes/admin/home-proxies');
app.use(`${adminPrefix}/home-proxies`, adminHomeProxiesRoutes);
```

- [ ] **Step 11: Run backend tests**

Run:

```bash
node server/test/test-home-proxies-service.js
node -c server/routes/admin/home-proxies.js
node -c server/controllers/admin/home-proxies-controller.js
node -c server/services/admin/home-proxies-service.js
```

Expected: all pass.

---

### Task 4: 管理端 API 与页面

**Files:**
- Modify: `client-admin/src/api/index.js`
- Modify: `client-admin/src/router/index.js`
- Modify: `client-admin/src/views/Layout.vue`
- Create: `client-admin/src/views/HomeProxies.vue`

**Interfaces:**
- Consumes: backend `/api/admin/home-proxies` endpoints.
- Produces: `api.admin.getHomeProxies()`
- Produces: `api.admin.addHomeProxy(data)`
- Produces: `api.admin.updateHomeProxy(id, data)`
- Produces: `api.admin.deleteHomeProxy(id)`
- Produces: `api.admin.syncHomeProxy(id)`

- [ ] **Step 1: Add API methods**

In `client-admin/src/api/index.js`, add:

```javascript
getHomeProxies() {
  return apiClient.get('/home-proxies');
},
addHomeProxy(data) {
  return apiClient.post('/home-proxies', data);
},
updateHomeProxy(id, data) {
  return apiClient.put(`/home-proxies/${id}`, data);
},
deleteHomeProxy(id) {
  return apiClient.delete(`/home-proxies/${id}`, { timeout: 120000 });
},
syncHomeProxy(id) {
  return apiClient.post(`/home-proxies/${id}/sync`, {}, { timeout: 120000 });
}
```

- [ ] **Step 2: Add router entry**

In `client-admin/src/router/index.js`, add child route after `servers`:

```javascript
{
  path: 'home-proxies',
  name: 'HomeProxies',
  component: () => import('@/views/HomeProxies.vue'),
  meta: { title: '家宽 IP 管理' }
}
```

- [ ] **Step 3: Add navigation item**

In `Layout.vue`, import `Link` or another available Element Plus icon, then add below server management:

```vue
<router-link to="/admin/home-proxies" class="nav-item" active-class="active">
  <el-icon><Link /></el-icon>
  <span v-if="!isCollapsed">家宽 IP 管理</span>
</router-link>
```

- [ ] **Step 4: Build page component**

`HomeProxies.vue` responsibilities:

- Load list on mount.
- Show top action button “添加家宽 IP”。
- Render card grid with tag, address, port, username, sync status, last sync time, failed server names.
- Use add/edit dialog with five required fields.
- Save dialog calls add/update only.
- Sync button calls `syncHomeProxy(id)` and refreshes list.
- Delete button shows Chinese confirmation, calls `deleteHomeProxy(id)`, refreshes list.

- [ ] **Step 5: Implement UI status mapping**

Use:

```javascript
const statusMap = {
  pending: { type: 'warning', text: '待同步' },
  success: { type: 'success', text: '全部成功' },
  partial_failed: { type: 'danger', text: '部分失败' },
  failed: { type: 'danger', text: '全部失败' },
  delete_failed: { type: 'danger', text: '删除失败' }
};
```

- [ ] **Step 6: Verify front-end build**

Run:

```bash
cd client-admin
npx vite build --minify esbuild
```

Expected: build succeeds.

---

### Task 5: Final Verification

**Files:**
- No new files.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: verified working tree summary.

- [ ] **Step 1: Run backend service tests**

Run:

```bash
node server/test/test-home-proxies-service.js
```

Expected: all home proxy service tests pass.

- [ ] **Step 2: Run syntax checks**

Run:

```bash
node -c server/repositories/home-proxies-repository.js
node -c server/services/admin/home-proxies-service.js
node -c server/controllers/admin/home-proxies-controller.js
node -c server/routes/admin/home-proxies.js
node -c server/integrations/xui/xui-api-client-v302.js
node -c server/integrations/xui/xui-service.js
```

Expected: every command exits with code 0.

- [ ] **Step 3: Build admin frontend**

Run:

```bash
cd client-admin
npx vite build --minify esbuild
```

Expected: Vite build completes successfully.

- [ ] **Step 4: Inspect changes**

Run:

```bash
git status --short
git diff --stat
```

Expected: only files from this plan are changed.

- [ ] **Step 5: Final response**

Report:

- Files changed.
- Backend test result.
- Frontend build result.
- Any manual follow-up, especially database migration and backend restart.

---

## Self-Review

- Spec coverage: all confirmed requirements are covered by Tasks 1-5, including manual sync, failed-server persistence, retry-only-failed behavior, UI server-name display, delete failure handling, and concurrency limit 10.
- Placeholder scan: no TBD/TODO/fill-in-later placeholders remain.
- Type consistency: repository, service, controller, route, XUI client, and frontend API names are consistent across tasks.
