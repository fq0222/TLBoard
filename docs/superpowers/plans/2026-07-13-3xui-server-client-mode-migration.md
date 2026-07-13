# 3X-UI 单用户关联多入站迁移实施计划

> **给自动化执行代理的要求：** 实施本计划时必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，并按任务逐项执行。步骤使用复选框（`- [ ]`）便于跟踪。

**目标：** 将项目切换到 3X-UI 3.4.2 的服务器级客户端模型，让每个本地用户在每台 3X-UI 服务器上只对应一个 `users.email` 客户端，并在迁移成功后立即删除旧后缀客户端。

**架构：** 先补齐 3X-UI clients API 的多入站能力，再把订单同步、订阅生成、流量统计、禁用启用、巡检补偿和管理端编辑统一切到 canonical email。每个用户在每台 3X-UI 服务器上创建一个全量 client，client 同时保存 UUID、密码、订阅 ID、Hysteria 认证等完整凭证，再通过 `inboundIds` 关联到该服务器的多个 inbound。`user_node_configs` 需要补充 `password` 字段，同一服务器下多个 inbound 继续保留多行，但写入同一组 `uuid/password/auth/sub_id`，以减少订阅生成链路的改动面。新增迁移审计表和脚本日志，不增加管理端迁移页面。

**技术栈：** Node.js、Express 服务层、PostgreSQL、现有 db 代理、3X-UI clients API、现有 `node server/test/*.js` 测试风格。

---

## 文件变更地图

- 修改 `server/integrations/xui/xui-api-client-v325.js`：支持一次创建客户端并关联多个 inbound，补充 attach/detach 接口。
- 修改 `server/integrations/xui/xui-service.js`：增加服务器级 client upsert、查询、关联和删除旧客户端辅助方法。
- 修改 `server/repositories/xui-sync-repository.js`：增加迁移审计写入、全量用户读取、流量基线重置、订阅缓存清理等方法。
- 修改 `server/db/schema/tables.js`：为 `user_node_configs` 新增 `password` 字段，并新增 `xui_client_model_migrations` 审计表。
- 修改 `server/db/schema/indexes.js`：新增审计表索引。
- 新增 `server/db/migrations/019-xui-client-model-migration-audit.js`：幂等补充 `user_node_configs.password` 并创建迁移审计表。
- 修改 `server/services/shared/order-service.js`：3.4.2+ 服务器只创建/更新服务器级 canonical client。
- 修改 `server/services/user/subscription-service.js`：订阅快照只识别 `client.email === user.email`。
- 修改 `server/services/shared/traffic-manager.js`：流量统计、禁用、启用只按 canonical email。
- 修改 `server/jobs/handlers/sync-xui-users.js`：巡检补偿只维护 canonical client。
- 修改 `server/services/admin/users-service.js`：管理端编辑只更新服务器级 canonical client。
- 新增 `server/scripts/migrate-xui-client-model-v342.js`：迁移全部用户。
- 新增 `server/scripts/verify-xui-client-model-v342.js`：验证迁移结果。
- 修改/新增相关 `server/test/*.js` 测试。

---

## 任务 1：补齐 3X-UI clients API 能力

**文件：**
- 修改：`server/integrations/xui/xui-api-client-v325.js`
- 修改：`server/integrations/xui/xui-service.js`
- 测试：`server/test/test-xui-api-client.js`
- 测试：`server/test/test-xui-service-v342-server-client.js`

- [ ] **步骤 1：先写失败测试**

在 `server/test/test-xui-api-client.js` 中追加测试，验证 3.2.5+/3.4.2 adapter 能发送多 inbound payload：

```javascript
test('v325 addClient supports explicit inboundIds payload', async () => {
  const { client, requests } = createClient(XuiApiClientV325);
  await client.addClient({
    client: {
      email: 'u@example.com',
      id: 'uuid-1',
      enable: true,
      expiryTime: 0,
      totalGB: 1024,
      limitIp: 0,
      tgId: 0,
      subId: 'sub-1'
    },
    inboundIds: [10, 11]
  });

  assert.strictEqual(requests[0].method, 'post');
  assert.strictEqual(requests[0].url, '/panel/api/clients/add');
  assert.deepStrictEqual(requests[0].data.inboundIds, [10, 11]);
  assert.strictEqual(requests[0].data.client.email, 'u@example.com');
});

test('v325 attachClient and detachClient call clients routes', async () => {
  const { client, requests } = createClient(XuiApiClientV325);
  await client.attachClient('u@example.com', [10, 11]);
  await client.detachClient('u@example.com', [12]);

  assert.strictEqual(requests[0].url, '/panel/api/clients/u%40example.com/attach');
  assert.deepStrictEqual(requests[0].data, { inboundIds: [10, 11] });
  assert.strictEqual(requests[1].url, '/panel/api/clients/u%40example.com/detach');
  assert.deepStrictEqual(requests[1].data, { inboundIds: [12] });
});

test('v325 addClient sends full server client credentials', async () => {
  const { client, requests } = createClient(XuiApiClientV325);
  await client.addClient({
    client: {
      email: 'u@example.com',
      id: 'uuid-1',
      password: 'password-1',
      auth: 'hy2-secret',
      enable: true,
      expiryTime: 0,
      totalGB: 1024,
      limitIp: 0,
      tgId: 0,
      subId: 'sub-1'
    },
    inboundIds: [20, 21]
  });

  assert.strictEqual(requests[0].url, '/panel/api/clients/add');
  assert.deepStrictEqual(requests[0].data.inboundIds, [20, 21]);
  assert.strictEqual(requests[0].data.client.email, 'u@example.com');
  assert.strictEqual(requests[0].data.client.id, 'uuid-1');
  assert.strictEqual(requests[0].data.client.password, 'password-1');
  assert.strictEqual(requests[0].data.client.auth, 'hy2-secret');
  assert.strictEqual(requests[0].data.client.subId, 'sub-1');
});
```

- [ ] **步骤 2：运行测试确认失败**

```bash
node server/test/test-xui-api-client.js
```

预期：失败，因为当前 `addClient()` 仍按旧 settings 结构解析，且 `attachClient()` / `detachClient()` 不存在。

- [ ] **步骤 3：实现 adapter 方法**

在 `server/integrations/xui/xui-api-client-v325.js` 中更新 `addClient()`，并新增 attach/detach：

```javascript
  addClient(clientConfig) {
    if (clientConfig && clientConfig.client && Array.isArray(clientConfig.inboundIds)) {
      const payload = {
        client: this.buildClientApiPayload(clientConfig.client),
        inboundIds: clientConfig.inboundIds.map(Number).filter((id) => Number.isFinite(id) && id > 0)
      };
      return this.request('post', `${this.clientBasePath}/add`, payload);
    }

    const { inboundId, client } = this.parseLegacyClientConfig(clientConfig);
    const payload = {
      client: this.buildClientApiPayload(client),
      inboundIds: [inboundId]
    };
    return this.request('post', `${this.clientBasePath}/add`, payload);
  }

  attachClient(email, inboundIds) {
    return this.request('post', `${this.clientBasePath}/${encodeURIComponent(email)}/attach`, {
      inboundIds: (inboundIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0)
    });
  }

  detachClient(email, inboundIds) {
    return this.request('post', `${this.clientBasePath}/${encodeURIComponent(email)}/detach`, {
      inboundIds: (inboundIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0)
    });
  }
```

- [ ] **步骤 4：新增 XuiService 服务器级 client 测试**

创建 `server/test/test-xui-service-v342-server-client.js`：

```javascript
const assert = require('assert');
const XuiService = require('../integrations/xui/xui-service');

async function run() {
  const service = new XuiService('http://xui.local', 'token', { apiVersion: '3.4.2' });
  const calls = [];
  service.client = {
    supportsClientApi: true,
    addClient: async (payload) => {
      calls.push(['addClient', payload]);
      return { success: true, msg: 'ok' };
    },
    getClientByEmail: async () => ({
      success: false,
      msg: 'record not found'
    }),
    attachClient: async (email, inboundIds) => {
      calls.push(['attachClient', email, inboundIds]);
      return { success: true, msg: 'ok' };
    },
    updateClient: async (_email, payload) => {
      calls.push(['updateClient', payload]);
      return { success: true, msg: 'ok' };
    }
  };

  const result = await service.upsertServerClient({
    email: 'u@example.com',
    inboundIds: [1, 2],
    client: {
      id: 'uuid-1',
      password: 'password-1',
      email: 'u@example.com',
      auth: 'hy2-secret',
      enable: true,
      expiryTime: 0,
      totalGB: 1024,
      limitIp: 0,
      tgId: 0,
      subId: 'sub-1',
      flow: 'xtls-rprx-vision'
    }
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.action, 'add');
  assert.deepStrictEqual(calls[0][1].inboundIds, [1, 2]);
  assert.strictEqual(calls[0][1].client.email, 'u@example.com');
  assert.strictEqual(calls[0][1].client.id, 'uuid-1');
  assert.strictEqual(calls[0][1].client.auth, 'hy2-secret');
  assert.strictEqual(calls[0][1].client.subId, 'sub-1');

  console.log('xui service v342 server client tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **步骤 5：实现 XuiService 辅助方法**

在 `server/integrations/xui/xui-service.js` 中新增：

```javascript
  normalizeInboundIds(inboundIds) {
    return Array.from(new Set((inboundIds || [])
      .map(Number)
      .filter((id) => Number.isFinite(id) && id > 0)));
  }

  async getServerClientByEmail(email) {
    if (!this.usesClientApi()) {
      return { success: false, message: 'clients API is not supported' };
    }

    const result = await this.client.getClientByEmail(email);
    if (!result.success) {
      return { success: false, message: result.msg || 'client not found' };
    }

    const obj = result.obj || {};
    return {
      success: true,
      client: this.mapClientApiRecord(obj.client || obj),
      inboundIds: obj.inboundIds || []
    };
  }

  async upsertServerClient(payload = {}) {
    if (!this.usesClientApi()) {
      return { success: false, message: 'clients API is not supported' };
    }

    const inboundIds = this.normalizeInboundIds(payload.inboundIds);
    if (inboundIds.length === 0) {
      return { success: false, message: 'inboundIds is required' };
    }

    const email = String(payload.email || payload.client?.email || '').trim();
    if (!email) {
      return { success: false, message: 'email is required' };
    }

    const existing = await this.getServerClientByEmail(email);
    const client = {
      ...(payload.client || {}),
      email
    };

    if (!existing.success) {
      const result = await this.client.addClient({ client, inboundIds });
      return result.success
        ? { success: true, action: 'add', message: result.msg }
        : { success: false, message: result.msg || result.message };
    }

    const updateResult = await this.client.updateClient(email, {
      id: 0,
      settings: JSON.stringify({ clients: [client] })
    });
    if (!updateResult.success) {
      return { success: false, message: updateResult.msg || updateResult.message };
    }

    const existingIds = new Set((existing.inboundIds || []).map(Number));
    const missingIds = inboundIds.filter((id) => !existingIds.has(id));
    if (missingIds.length > 0) {
      const attachResult = await this.client.attachClient(email, missingIds);
      if (!attachResult.success) {
        return { success: false, message: attachResult.msg || attachResult.message };
      }
    }

    return { success: true, action: missingIds.length > 0 ? 'update-attach' : 'update' };
  }
```

- [ ] **步骤 6：运行测试**

```bash
node server/test/test-xui-api-client.js
node server/test/test-xui-service-v342-server-client.js
```

预期：全部通过。

---

## 任务 2：新增全量凭证字段与迁移审计表

**文件：**
- 修改：`server/db/schema/tables.js`
- 修改：`server/db/schema/indexes.js`
- 新增：`server/db/migrations/019-xui-client-model-migration-audit.js`
- 修改：`server/repositories/xui-sync-repository.js`
- 测试：`server/test/test-xui-client-model-migration.js`

- [ ] **步骤 1：先写审计表失败测试**

创建 `server/test/test-xui-client-model-migration.js`：

```javascript
const assert = require('assert');
const migration = require('../db/migrations/019-xui-client-model-migration-audit');
const repo = require('../repositories/xui-sync-repository');

function createDb() {
  const calls = [];
  return {
    calls,
    exec: async (sql) => calls.push(['exec', sql]),
    prepare(sql) {
      return {
        run: async (...params) => calls.push(['run', sql, params]),
        get: async (...params) => {
          calls.push(['get', sql, params]);
          return undefined;
        }
      };
    }
  };
}

async function testAuditMigrationAndWrite() {
  const db = createDb();
  await migration.up(db);
  assert.ok(db.calls.some(([type, sql]) => type === 'exec' && sql.includes('ADD COLUMN IF NOT EXISTS password')));
  assert.ok(db.calls.some(([type, sql]) => type === 'exec' && sql.includes('CREATE TABLE IF NOT EXISTS xui_client_model_migrations')));

  await repo.upsertClientModelMigrationAudit(db, {
    userId: 7,
    serverId: 3,
    status: 'success',
    oldEmails: ['u@example.com-cf'],
    newEmail: 'u@example.com',
    inboundIds: [1, 2],
    credentialSource: 'legacy',
    message: 'ok',
    migratedAt: 1800000000
  });

  const writeCall = db.calls.find(([type, sql]) => type === 'run' && sql.includes('INSERT INTO xui_client_model_migrations'));
  assert.ok(writeCall);
  assert.deepStrictEqual(JSON.parse(writeCall[2][3]), ['u@example.com-cf']);
  assert.deepStrictEqual(JSON.parse(writeCall[2][5]), [1, 2]);
}

testAuditMigrationAndWrite().then(() => {
  console.log('xui client model migration tests passed');
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **步骤 2：运行测试确认失败**

```bash
node server/test/test-xui-client-model-migration.js
```

预期：失败，因为迁移文件、`password` 字段和 repository 方法尚不存在。

- [ ] **步骤 3：把 password 字段和审计表加入 schema**

在 `server/db/schema/tables.js` 的 `user_node_configs` 表中加入：

```sql
        password VARCHAR(100) NOT NULL DEFAULT '',
```

在 `server/db/schema/tables.js` 表定义数组中追加：

```javascript
    `CREATE TABLE IF NOT EXISTS xui_client_model_migrations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      server_id INTEGER NOT NULL,
      status VARCHAR(30) NOT NULL,
      old_emails TEXT NOT NULL DEFAULT '[]',
      new_email VARCHAR(255) NOT NULL,
      inbound_ids TEXT NOT NULL DEFAULT '[]',
      credential_source VARCHAR(50) NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      migrated_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      UNIQUE(user_id, server_id)
    )`
```

在 `server/db/schema/indexes.js` 追加：

```javascript
  'CREATE INDEX IF NOT EXISTS idx_xui_client_model_migrations_status ON xui_client_model_migrations(status)',
  'CREATE INDEX IF NOT EXISTS idx_xui_client_model_migrations_server_id ON xui_client_model_migrations(server_id)'
```

- [ ] **步骤 4：新增幂等迁移文件**

创建 `server/db/migrations/019-xui-client-model-migration-audit.js`：

```javascript
/**
 * 3X-UI 客户端模型迁移准备。
 * 职责：补齐全量 client 所需 password 字段，并记录每个 user_id + server_id 的迁移结果。
 */

async function up(dbOrPool) {
  const db = dbOrPool;
  await db.exec(`
    ALTER TABLE user_node_configs
    ADD COLUMN IF NOT EXISTS password VARCHAR(100) NOT NULL DEFAULT '';
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS xui_client_model_migrations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      server_id INTEGER NOT NULL,
      status VARCHAR(30) NOT NULL,
      old_emails TEXT NOT NULL DEFAULT '[]',
      new_email VARCHAR(255) NOT NULL,
      inbound_ids TEXT NOT NULL DEFAULT '[]',
      credential_source VARCHAR(50) NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      migrated_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      UNIQUE(user_id, server_id)
    );
    CREATE INDEX IF NOT EXISTS idx_xui_client_model_migrations_status
      ON xui_client_model_migrations(status);
    CREATE INDEX IF NOT EXISTS idx_xui_client_model_migrations_server_id
      ON xui_client_model_migrations(server_id);
  `);
  return { success: true };
}

module.exports = { up };
```

- [ ] **步骤 5：新增审计 repository 方法**

在 `server/repositories/xui-sync-repository.js` 中新增并导出：

```javascript
/**
 * 写入或更新 3X-UI 单用户模型迁移审计记录。
 *
 * @param {Object} db - 数据库代理
 * @param {Object} payload - 审计数据
 * @returns {Promise<void>}
 */
async function upsertClientModelMigrationAudit(db, payload) {
  const now = payload.migratedAt || Math.floor(Date.now() / 1000);
  await db.prepare(`
    INSERT INTO xui_client_model_migrations (
      user_id, server_id, status, old_emails, new_email, inbound_ids,
      credential_source, message, migrated_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, server_id) DO UPDATE SET
      status = EXCLUDED.status,
      old_emails = EXCLUDED.old_emails,
      new_email = EXCLUDED.new_email,
      inbound_ids = EXCLUDED.inbound_ids,
      credential_source = EXCLUDED.credential_source,
      message = EXCLUDED.message,
      migrated_at = EXCLUDED.migrated_at,
      updated_at = EXCLUDED.updated_at
  `).run(
    payload.userId,
    payload.serverId,
    payload.status,
    JSON.stringify(payload.oldEmails || []),
    payload.newEmail || '',
    JSON.stringify(payload.inboundIds || []),
    payload.credentialSource || '',
    String(payload.message || '').slice(0, 2000),
    now,
    now
  );
}
```

- [ ] **步骤 6：运行审计测试**

```bash
node server/test/test-xui-client-model-migration.js
```

预期：通过。

---

## 任务 3：订单同步切到服务器级 client

**文件：**
- 修改：`server/services/shared/order-service.js`
- 测试：`server/test/test-xui-unique-client-sync.js`

- [ ] **步骤 1：先写订单同步失败测试**

在 `server/test/test-xui-unique-client-sync.js` 中追加测试，断言 3.4.2 服务器只 upsert 一次 canonical client：

```javascript
test('3.4.2 sync creates one canonical client per server with all inbound ids', async () => {
  const calls = [];
  const db = createFakeDb([]);
  const service = createFakeXuiService([]);
  service.upsertServerClient = async (payload) => {
    calls.push(payload);
    return { success: true, action: 'add' };
  };

  const orderService = require('../services/shared/order-service');
  const result = await orderService.__testables.syncUserToSingleServerWithService(
    db,
    {
      id: 10,
      email: 'u@example.com',
      enabled: 1,
      expire_at: 0,
      traffic_limit: 1024
    },
    {
      id: 3,
      name: 's1',
      api_url: 'http://xui.local',
      api_token: 'token',
      panel_version: '3.4.2'
    },
    {
      inbounds: [
        { id: 1, protocol: 'vless', remark: 'cf', settings: '{"clients":[]}' },
        { id: 2, protocol: 'vless', remark: 'direct', settings: '{"clients":[]}' }
      ],
      xuiService: service
    }
  );

  assert.strictEqual(result.failureCount, 0);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].email, 'u@example.com');
  assert.deepStrictEqual(calls[0].inboundIds, [1, 2]);
});
```

- [ ] **步骤 2：运行测试确认失败**

```bash
node server/test/test-xui-unique-client-sync.js
```

预期：失败，因为当前同步仍逐 inbound 创建旧后缀客户端。

- [ ] **步骤 3：新增版本判断和服务器级凭证辅助函数**

在 `server/services/shared/order-service.js` 中新增：

```javascript
function isPanelVersionAtLeast(version, minimum) {
  const left = String(version || '').split('.').map(Number);
  const right = String(minimum || '').split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const a = Number.isFinite(left[index]) ? left[index] : 0;
    const b = Number.isFinite(right[index]) ? right[index] : 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

async function ensureServerNodeConfigs(db, user, server, inbounds, existingClient = null) {
  const firstInbound = inbounds[0];
  const firstConfig = firstInbound
    ? await xuiSyncRepository.findUserNodeConfig(db, user.id, server.id, firstInbound.id)
    : null;
  const generated = generateServerClientCredentials();
  const uuid = existingClient?.uuid || existingClient?.id || firstConfig?.uuid || generated.uuid;
  const password = existingClient?.password || firstConfig?.password || generated.password;
  const auth = existingClient?.auth || firstConfig?.auth || generated.auth;
  const subId = existingClient?.subId || firstConfig?.sub_id || generated.subId;

  for (const inbound of inbounds) {
    await xuiSyncRepository.saveUserNodeConfig(db, {
      userId: user.id,
      serverId: server.id,
      inboundId: inbound.id,
      uuid,
      password,
      auth,
      subId
    });
    await clearSubscriptionSourceCache(db, user.id, server.id, inbound.id);
  }

  return { uuid, password, auth, subId };
}
```

- [ ] **步骤 4：实现 3.4.2 同步分支**

在 `syncUserToSingleServer()` 的 per-inbound 循环前增加：

```javascript
    if (isPanelVersionAtLeast(server.panel_version, '3.4.2')) {
      const inbounds = inboundsResult.data || [];
      if (inbounds.length === 0) {
        return { successCount, failureCount: failureCount + 1, lastError: '服务器没有可关联 inbound' };
      }

      const existing = await xuiService.getServerClientByEmail(user.email);
      const existingClient = existing.success ? existing.client : null;
      const config = await ensureServerNodeConfigs(db, user, server, inbounds, existingClient);
      const totalBytes = getXuiTotalTrafficLimit(user, plan);
      const client = {
        id: config.uuid,
        password: config.password,
        auth: config.auth,
        email: user.email,
        enable: normalizeUserEnabled(user.enabled),
        expiryTime: user.expire_at ? Number(user.expire_at) * 1000 : 0,
        totalGB: totalBytes,
        limitIp: 0,
        tgId: 0,
        subId: config.subId,
        flow: 'xtls-rprx-vision'
      };

      const syncResult = await xuiService.upsertServerClient({
        email: user.email,
        inboundIds: inbounds.map((inbound) => inbound.id),
        client
      });

      if (!syncResult.success) {
        return {
          successCount,
          failureCount: failureCount + 1,
          lastError: syncResult.message || '同步服务器级 3X-UI 用户失败'
        };
      }

      if (shouldResetClientTraffic(plan)) {
        const resetResult = await xuiService.resetClientTraffic(0, user.email);
        if (!resetResult.success) {
          return {
            successCount,
            failureCount: failureCount + 1,
            lastError: resetResult.message || '重置服务器级客户端流量失败'
          };
        }
      }

      return { successCount: successCount + inbounds.length, failureCount, lastError };
    }
```

- [ ] **步骤 5：导出测试辅助方法**

在 `server/services/shared/order-service.js` 的 `module.exports` 中增加：

```javascript
  __testables: {
    isPanelVersionAtLeast,
    ensureServerNodeConfigs,
    syncUserToSingleServer
  }
```

如测试需要注入 fake service/inbounds，则优先把 `syncUserToSingleServer()` 改为读取 `plan.dependencies?.getServerInboundsSnapshot`，避免 monkey patch。

- [ ] **步骤 6：运行订单同步测试**

```bash
node server/test/test-xui-unique-client-sync.js
```

预期：通过。

---

## 任务 4：订阅生成只识别 canonical email

**文件：**
- 修改：`server/services/user/subscription-service.js`
- 测试：`server/test/test-xui-client-model-subscription.js`

- [ ] **步骤 1：先写订阅快照失败测试**

创建 `server/test/test-xui-client-model-subscription.js`：

```javascript
const assert = require('assert');
const subscriptionService = require('../services/user/subscription-service');

const { inspectUserInNodeSnapshot } = subscriptionService.__testables;

const user = { id: 1, email: 'u@example.com' };
const config = {
  user_id: 1,
  server_id: 1,
  inbound_id: 10,
  remark: 'cf',
  protocol: 'vless',
  uuid: 'uuid-1',
  auth: '',
  sub_id: 'sub-1',
  settings: JSON.stringify({
    clients: [{
      email: 'u@example.com',
      id: 'uuid-1',
      subId: 'sub-1',
      enable: true
    }]
  }),
  stream_settings: '{}'
};

const result = inspectUserInNodeSnapshot(user, config);
assert.strictEqual(result.trusted, true);
assert.strictEqual(result.reason, 'ok');
console.log('xui client model subscription tests passed');
```

- [ ] **步骤 2：运行测试确认失败**

```bash
node server/test/test-xui-client-model-subscription.js
```

预期：失败，因为当前逻辑还在找 `u@example.com-cf`。

- [ ] **步骤 3：修改快照校验**

在 `inspectUserInNodeSnapshot()` 中替换 expected email 逻辑：

```javascript
  const expectedEmail = user.email;
  const matchingClients = settings.clients.filter(
    (client) => client && client.email === expectedEmail
  );
```

- [ ] **步骤 4：修改节点配置解析**

在 `parseNodeConfig()` 中只按 canonical email 查找：

```javascript
    const userClient = clients.find((client) => client.email === userEmail);
```

只有 `userEmail` 为空时才允许使用第一个 client 作为兜底，不再查找后缀 email。

- [ ] **步骤 5：运行订阅相关测试**

```bash
node server/test/test-xui-client-model-subscription.js
node server/test/test-user-subscription-service.js
node server/test/test-subscription-snapshot-reuse.js
```

预期：全部通过；如旧测试 fixture 使用后缀 email，需要改成 canonical email。

---

## 任务 5：流量统计与禁用启用只使用 canonical email

**文件：**
- 修改：`server/services/shared/traffic-manager.js`
- 测试：`server/test/test-xui-client-model-traffic.js`
- 测试：`server/test/test-traffic-manager.js`
- 测试：`server/test/test-traffic-disabled-compensation.js`

- [ ] **步骤 1：先写流量计算失败测试**

创建 `server/test/test-xui-client-model-traffic.js`：

```javascript
const assert = require('assert');
const trafficManager = require('../services/shared/traffic-manager');
const trafficRepository = require('../repositories/traffic-repository');

async function run() {
  const originals = {
    listEnabledUsersForTrafficSync: trafficRepository.listEnabledUsersForTrafficSync,
    withTrafficSyncTransaction: trafficRepository.withTrafficSyncTransaction,
    listTrafficSyncLogs: trafficRepository.listTrafficSyncLogs,
    upsertTrafficSyncLogs: trafficRepository.upsertTrafficSyncLogs,
    findTrafficUsageMultiplierSetting: trafficRepository.findTrafficUsageMultiplierSetting
  };

  const updates = [];
  trafficRepository.listEnabledUsersForTrafficSync = async () => [{
    id: 1,
    email: 'u@example.com',
    enabled: 1,
    traffic_used: 100,
    traffic_limit: 10000
  }];
  trafficRepository.findTrafficUsageMultiplierSetting = async () => ({ value: '1' });
  trafficRepository.withTrafficSyncTransaction = async (_db, fn) => fn({});
  trafficRepository.listTrafficSyncLogs = async () => [{ user_id: 1, server_id: 3, last_sync_traffic: 50 }];
  trafficRepository.upsertTrafficSyncLogs = async (_client, payload) => updates.push(...payload);

  const result = await trafficManager.calculateUserTotalTraffic({}, {
    3: {
      'u@example.com': { total: 300, enabled: true, enabledKnown: true },
      'u@example.com-cf': { total: 999999, enabled: true, enabledKnown: true }
    }
  });

  assert.strictEqual(result[1].trafficUsed, 350);
  assert.strictEqual(updates[0].currentTraffic, 300);
  Object.assign(trafficRepository, originals);
  console.log('xui client model traffic tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **步骤 2：运行测试确认失败**

```bash
node server/test/test-xui-client-model-traffic.js
```

预期：失败，因为当前流量计算仍使用后缀 email 汇总。

- [ ] **步骤 3：修改快照匹配方法**

在 `server/services/shared/traffic-manager.js` 中改为：

```javascript
function getUserClientSnapshotEntries(email, clientStatusSnapshot = {}) {
  const entries = [];

  for (const serverSnapshot of Object.values(clientStatusSnapshot || {})) {
    const snapshotClient = serverSnapshot?.[email];
    if (snapshotClient) {
      entries.push(snapshotClient);
    }
  }

  return entries;
}
```

- [ ] **步骤 4：修改流量计算**

在 `calculateUserTotalTraffic()` 中，把 `email.startsWith(user.email + '-')` 汇总逻辑替换为：

```javascript
          const data = serverData[user.email];
          if (!data) {
            continue;
          }

          const lastSyncTraffic = syncLogMap.get(`${user.id}-${serverId}`) || 0;
          const currentTraffic = Number(data.total || 0);
```

后续增量、回退、倍率和写入逻辑保持不变。

- [ ] **步骤 5：修改禁用/启用同步**

在 `syncDisableStatusToXui()` 中直接查 `clientStatusSnapshot[server.id][user.email]`。无快照时，拉取该服务器 inboundIds，再调用 `upsertServerClient()` 一次更新 canonical client 的 `enable` 状态。

- [ ] **步骤 6：运行流量相关测试**

```bash
node server/test/test-xui-client-model-traffic.js
node server/test/test-traffic-manager.js
node server/test/test-traffic-disabled-compensation.js
```

预期：全部通过；如旧测试 fixture 使用后缀 email，需要改成 canonical email。

---

## 任务 6：巡检补偿只维护 canonical client

**文件：**
- 修改：`server/jobs/handlers/sync-xui-users.js`
- 测试：`server/test/test-telegram-health-sync.js`

- [ ] **步骤 1：先写巡检断言**

在 `server/test/test-telegram-health-sync.js` 中已有 `registerXuiSyncJob` stub 附近补断言：

```javascript
assert.ok(
  capturedDesiredClients.every((client) => client.email === 'sync-user@example.com'),
  '巡检补偿不得创建旧后缀客户端'
);
```

- [ ] **步骤 2：运行测试确认失败**

```bash
node server/test/test-telegram-health-sync.js
```

预期：失败，因为当前巡检仍构造 `nodeEmail`。

- [ ] **步骤 3：替换 per-inbound 巡检同步**

在 `syncUsersToServer()` 中：

- 保留拉取 inbounds 和刷新 `xui_nodes` 快照。
- 对 `server.panel_version >= 3.4.2` 的服务器，每个用户只调用一次 `upsertServerClient()`。
- 写入所有 inbound 的 `user_node_configs`，但凭证保持一致。
- 删除所有创建或修复 `user.email-remark` 的逻辑。

- [ ] **步骤 4：运行巡检测试**

```bash
node server/test/test-telegram-health-sync.js
node server/test/test-xui-job-scheduler.js
```

预期：通过。

---

## 任务 7：管理端用户编辑只更新 canonical server client

**文件：**
- 修改：`server/services/admin/users-service.js`
- 测试：`server/test/test-user-onboarding.js`

- [ ] **步骤 1：先写管理端同步断言**

在管理端用户编辑相关测试里 stub XuiService，并断言不会出现后缀 email：

```javascript
assert.ok(updateCalls.every((call) => call.email === 'u@example.com'));
assert.ok(updateCalls.every((call) => Array.isArray(call.inboundIds)));
```

- [ ] **步骤 2：运行测试确认失败**

```bash
node server/test/test-user-onboarding.js
```

预期：失败，因为 `server/services/admin/users-service.js` 仍逐 inbound 更新后缀 email。

- [ ] **步骤 3：替换管理端同步实现**

修改内部 `syncUserToXuiServers()`：

- 按服务器收集 inboundIds。
- 读取该用户该服务器的第一条 `user_node_configs` 作为凭证来源。
- 调用 `xuiService.upsertServerClient()` 更新 `user.email`。
- 不再调用 `updateClientByContext(inboundId, nodeEmail, ...)`。

- [ ] **步骤 4：运行管理端测试**

```bash
node server/test/test-user-onboarding.js
```

预期：通过。

---

## 任务 8：迁移与验证脚本

**文件：**
- 新增：`server/scripts/migrate-xui-client-model-v342.js`
- 新增：`server/scripts/verify-xui-client-model-v342.js`
- 修改：`server/repositories/xui-sync-repository.js`
- 测试：`server/test/test-xui-client-model-migration.js`

- [ ] **步骤 1：扩展迁移测试**

在 `server/test/test-xui-client-model-migration.js` 中增加断言：

```javascript
assert.ok(selectionSql.includes('FROM users'));
assert.ok(!selectionSql.includes('enabled = 1'));
assert.ok(!selectionSql.includes('payment_count > 0'));
assert.ok(auditPayload.status === 'success');
assert.deepStrictEqual(auditPayload.oldEmails, ['u@example.com-cf', 'u@example.com-direct']);
```

- [ ] **步骤 2：新增 repository 方法**

在 `server/repositories/xui-sync-repository.js` 中新增并导出：

```javascript
async function listAllUsersForClientModelMigration(db) {
  return db.prepare(`
    SELECT id, email, enabled, traffic_limit, expire_at, sub_id
    FROM users
    ORDER BY id ASC
  `).all();
}

async function resetTrafficSyncBaseline(db, userId, serverId, currentTraffic, now) {
  await db.prepare(`
    INSERT INTO traffic_sync_log (user_id, server_id, last_sync_traffic, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, server_id) DO UPDATE SET
      last_sync_traffic = EXCLUDED.last_sync_traffic,
      updated_at = EXCLUDED.updated_at
  `).run(userId, serverId, currentTraffic, now);
}

async function clearUserSubscriptionCachesForMigration(db, userId) {
  await db.prepare('DELETE FROM user_subscription_sources WHERE user_id = ?').run(userId);
  await db.prepare('DELETE FROM user_subscriptions WHERE user_id = ?').run(userId);
}
```

- [ ] **步骤 3：新增迁移脚本**

创建 `server/scripts/migrate-xui-client-model-v342.js`，职责：

- 只处理 `panel_version >= 3.4.2` 的在线服务器。
- 读取全部用户，包括历史禁用用户。
- 为每个用户在每台服务器创建或更新 canonical client。
- 关联该服务器全部 inbound。
- 更新 `user_node_configs` 为统一凭证。
- 重建 `xui_nodes`、订阅源缓存、最终订阅缓存。
- 迁移验证成功后立即删除旧后缀 client。
- 重置 `traffic_sync_log` 基线。
- 写入 `xui_client_model_migrations` 审计记录。

- [ ] **步骤 4：新增验证脚本**

创建 `server/scripts/verify-xui-client-model-v342.js`，职责：

- 只读检查 canonical client 是否存在。
- 检查 canonical client 是否关联全部目标 inbound。
- 检查旧后缀 client 是否还残留。
- 任一失败时 `process.exit(1)`。

- [ ] **步骤 5：运行迁移测试**

```bash
node server/test/test-xui-client-model-migration.js
```

预期：通过。

---

## 任务 9：完整验证

**文件：**
- 若前面测试暴露问题，再按失败点修改对应文件。

- [ ] **步骤 1：运行后端目标测试**

```bash
node server/test/test-xui-api-client.js
node server/test/test-xui-service-v342-server-client.js
node server/test/test-xui-unique-client-sync.js
node server/test/test-xui-client-model-subscription.js
node server/test/test-xui-client-model-traffic.js
node server/test/test-xui-client-model-migration.js
node server/test/test-user-subscription-service.js
node server/test/test-subscription-snapshot-reuse.js
node server/test/test-traffic-manager.js
node server/test/test-traffic-disabled-compensation.js
node server/test/test-telegram-health-sync.js
node server/test/test-user-onboarding.js
```

预期：全部通过。

- [ ] **步骤 2：迁移脚本 dry-run**

```bash
node server/scripts/migrate-xui-client-model-v342.js --dry-run
```

预期：

- 日志只出现 `panel_version >= 3.4.2` 的目标服务器。
- 日志显示全部本地用户都会被纳入迁移。
- dry-run 不删除旧后缀客户端。

- [ ] **步骤 3：写入生产执行顺序**

在设计文档或发布说明中补充：

```markdown
生产迁移顺序：
1. 暂停 3X-UI 巡检、流量同步、xui_sync_tasks 队列和订单即时同步。
2. 执行 `server/db/migrations/019-xui-client-model-migration-audit.js`。
3. 运行 `node server/scripts/migrate-xui-client-model-v342.js --dry-run`。
4. 确认 dry-run 日志。
5. 运行 `node server/scripts/migrate-xui-client-model-v342.js`。
6. 运行 `node server/scripts/verify-xui-client-model-v342.js`。
7. 恢复暂停的任务。
8. 提醒用户刷新订阅。
```

- [ ] **步骤 4：最终工作区检查**

```bash
git status --short
```

预期：只出现本计划涉及的文件。除非用户明确要求提交，否则不要 `git add`。
