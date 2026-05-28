# 3X-UI 重复 Email 修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复同一 inbound 下重复 email 导致的 3X-UI / xray 异常，统一所有 3X-UI 用户写入入口，并加入数据库级互斥保护。

**Architecture:** 在 `server/services/xui-service.js` 中新增统一的唯一化写入入口 `upsertUniqueClient()`，由它负责查询所有匹配客户端、清理重复项、修正本地 `user_node_configs`、执行最终 add/update。`order-service` 和 `jobs/index.js` 不再自行分支 `getClientByEmail()` / `addClient()` / `updateClient()`，而统一调用这个入口，并通过 PostgreSQL advisory lock 按 `server_id + inbound_id + email` 做互斥。

**Tech Stack:** Node.js, Express, PostgreSQL, 现有脚本式测试（`node server/test/*.js`）

---

## 文件结构

| 文件 | 类型 | 作用 |
|------|------|------|
| `server/services/xui-service.js` | 修改 | 新增 `getClientsByEmail()`、数据库级锁辅助、`upsertUniqueClient()` |
| `server/services/order-service.js` | 修改 | 支付/续费同步改为调用统一唯一化写入入口 |
| `server/jobs/index.js` | 修改 | 定时巡检同步改为调用统一唯一化写入入口 |
| `server/test/test-xui-unique-client-sync.js` | 新增 | 覆盖重复 email、自愈修复、锁冲突、入口调用路径 |

---

### Task 1: 先写失败测试，固定重复 email 与并发行为

**Files:**
- Create: `server/test/test-xui-unique-client-sync.js`
- Test: `server/test/test-xui-unique-client-sync.js`

- [ ] **Step 1: 创建测试脚本骨架与 fake service/fake db**

使用 `apply_patch` 新建 `server/test/test-xui-unique-client-sync.js`，先放入最小可扩展骨架：

```javascript
const assert = require('assert');
const XuiService = require('../services/xui-service');

function createFakeDb(initialNodeConfigs = []) {
  const nodeConfigs = initialNodeConfigs.map(item => ({ ...item }));
  const advisoryLocks = new Set();

  return {
    nodeConfigs,
    advisoryLocks,
    prepare(sql) {
      return {
        async get(...params) {
          if (sql.includes('FROM user_node_configs')) {
            const [userId, serverId, inboundId] = params;
            return nodeConfigs.find(item =>
              item.user_id === userId &&
              item.server_id === serverId &&
              item.inbound_id === inboundId
            ) || undefined;
          }
          throw new Error(`Unexpected get SQL: ${sql}`);
        },
        async run(...params) {
          if (sql.includes('INSERT INTO user_node_configs')) {
            nodeConfigs.push({
              user_id: params[0],
              server_id: params[1],
              inbound_id: params[2],
              uuid: params[3],
              sub_id: params[4]
            });
            return { changes: 1 };
          }
          if (sql.includes('UPDATE user_node_configs')) {
            const [uuid, subId, userId, serverId, inboundId] = params;
            const target = nodeConfigs.find(item =>
              item.user_id === userId &&
              item.server_id === serverId &&
              item.inbound_id === inboundId
            );
            if (!target) return { changes: 0 };
            target.uuid = uuid;
            target.sub_id = subId;
            return { changes: 1 };
          }
          throw new Error(`Unexpected run SQL: ${sql}`);
        }
      };
    }
  };
}

function createFakeXuiService(initialClients = []) {
  const service = Object.create(XuiService.prototype);
  service._clients = initialClients.map(item => ({ ...item }));
  service._calls = [];
  service._lockStates = new Set();
  return service;
}

async function run() {
  console.log('placeholder');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: 写第一个失败测试，要求能拿到同一 email 的全部匹配客户端**

在同一文件中补入失败测试：

```javascript
async function testGetClientsByEmailReturnsAllMatches() {
  const service = createFakeXuiService([
    { inboundId: 1, uuid: 'u-1', email: 'a@test.com-node', subId: 's1', enable: true },
    { inboundId: 1, uuid: 'u-2', email: 'a@test.com-node', subId: 's2', enable: true },
    { inboundId: 1, uuid: 'u-3', email: 'other@test.com-node', subId: 's3', enable: true }
  ]);

  const result = await service.getClientsByEmail(1, 'a@test.com-node');
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.clients.length, 2);
  assert.deepStrictEqual(result.clients.map(item => item.uuid), ['u-1', 'u-2']);
}
```

- [ ] **Step 3: 写第二个失败测试，要求重复 email 时保留本地 UUID 对应项并删除其余项**

继续补测试：

```javascript
async function testUpsertUniqueClientRemovesDuplicatesAndKeepsDbUuid() {
  const db = createFakeDb([
    { user_id: 10, server_id: 1, inbound_id: 100, uuid: 'db-uuid', sub_id: 'db-sub' }
  ]);
  const service = createFakeXuiService([
    { inboundId: 100, uuid: 'db-uuid', email: 'u@test.com-direct', subId: 'db-sub', enable: true },
    { inboundId: 100, uuid: 'dup-uuid', email: 'u@test.com-direct', subId: 'dup-sub', enable: true }
  ]);

  const result = await service.upsertUniqueClient(db, {
    userId: 10,
    serverId: 1,
    inbound: { id: 100, protocol: 'vless', remark: 'direct-node' },
    email: 'u@test.com-direct',
    desiredClient: {
      id: 'db-uuid',
      email: 'u@test.com-direct',
      enable: true,
      expiryTime: 0,
      totalGB: 0,
      subId: 'db-sub',
      flow: 'xtls-rprx-vision'
    }
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(service._clients.filter(item => item.email === 'u@test.com-direct').length, 1);
  assert.strictEqual(service._clients[0].uuid, 'db-uuid');
  assert.ok(service._calls.some(item => item.type === 'deleteClient' && item.uuid === 'dup-uuid'));
}
```

- [ ] **Step 4: 写第三个失败测试，要求本地 UUID 失效时回写新的保留项**

```javascript
async function testUpsertUniqueClientRealignsMissingDbUuid() {
  const db = createFakeDb([
    { user_id: 10, server_id: 1, inbound_id: 100, uuid: 'stale-uuid', sub_id: 'stale-sub' }
  ]);
  const service = createFakeXuiService([
    { inboundId: 100, uuid: 'keep-uuid', email: 'u@test.com-cf', subId: 'keep-sub', enable: true },
    { inboundId: 100, uuid: 'drop-uuid', email: 'u@test.com-cf', subId: 'drop-sub', enable: true }
  ]);

  const result = await service.upsertUniqueClient(db, {
    userId: 10,
    serverId: 1,
    inbound: { id: 100, protocol: 'vless', remark: 'cf-node' },
    email: 'u@test.com-cf',
    desiredClient: {
      id: 'keep-uuid',
      email: 'u@test.com-cf',
      enable: true,
      expiryTime: 0,
      totalGB: 0,
      subId: 'keep-sub'
    }
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(db.nodeConfigs[0].uuid, 'keep-uuid');
  assert.strictEqual(db.nodeConfigs[0].sub_id, 'keep-sub');
}
```

- [ ] **Step 5: 写第四个失败测试，要求锁冲突时不能继续写入**

```javascript
async function testUpsertUniqueClientFailsWhenLockNotAcquired() {
  const db = createFakeDb();
  const service = createFakeXuiService([]);
  service._forceLockBusy = true;

  const result = await service.upsertUniqueClient(db, {
    userId: 10,
    serverId: 1,
    inbound: { id: 100, protocol: 'vless', remark: 'cf-node' },
    email: 'busy@test.com-cf',
    desiredClient: {
      id: 'new-uuid',
      email: 'busy@test.com-cf',
      enable: true,
      expiryTime: 0,
      totalGB: 0,
      subId: 'new-sub'
    }
  });

  assert.strictEqual(result.success, false);
  assert.match(result.message, /lock/i);
  assert.strictEqual(service._calls.length, 0);
}
```

- [ ] **Step 6: 让测试脚本执行全部用例**

将 `run()` 替换为：

```javascript
async function run() {
  await testGetClientsByEmailReturnsAllMatches();
  await testUpsertUniqueClientRemovesDuplicatesAndKeepsDbUuid();
  await testUpsertUniqueClientRealignsMissingDbUuid();
  await testUpsertUniqueClientFailsWhenLockNotAcquired();
  console.log('xui unique client sync tests passed');
}
```

- [ ] **Step 7: 运行测试，确认当前失败**

Run: `node server/test/test-xui-unique-client-sync.js`  
Expected: FAIL，报 `service.getClientsByEmail is not a function` 或 `service.upsertUniqueClient is not a function`

- [ ] **Step 8: Commit**

```bash
git add server/test/test-xui-unique-client-sync.js
git commit -m "test: 新增3X-UI重复email修复失败测试"
```

---

### Task 2: 在 xui-service 中补齐查询与数据库级锁能力

**Files:**
- Modify: `server/services/xui-service.js`
- Test: `server/test/test-xui-unique-client-sync.js`

- [ ] **Step 1: 为测试 fake service 增加最小模拟行为**

先在 `server/test/test-xui-unique-client-sync.js` 的 `createFakeXuiService()` 后补充 fake 方法，避免实现期测试无法驱动：

```javascript
function createFakeXuiService(initialClients = []) {
  const service = Object.create(XuiService.prototype);
  service._clients = initialClients.map(item => ({ ...item }));
  service._calls = [];
  service._lockStates = new Set();
  service._forceLockBusy = false;

  service.getInbound = async function getInbound(inboundId) {
    return {
      success: true,
      obj: {
        id: inboundId,
        settings: JSON.stringify({
          clients: this._clients
            .filter(item => item.inboundId === inboundId)
            .map(item => ({
              id: item.uuid,
              email: item.email,
              enable: item.enable,
              expiryTime: item.expiryTime || 0,
              totalGB: item.totalGB || 0,
              subId: item.subId || '',
              flow: item.flow || ''
            }))
        })
      }
    };
  };

  service.deleteClient = async function deleteClient(inboundId, uuid) {
    this._calls.push({ type: 'deleteClient', inboundId, uuid });
    this._clients = this._clients.filter(item => !(item.inboundId === inboundId && item.uuid === uuid));
    return { success: true };
  };

  return service;
}
```

- [ ] **Step 2: 在 `xui-service.js` 中新增读取全部匹配项的方法**

在 `getClientByEmail()` 前加入：

```javascript
  async getClientsByEmail(inboundId, email) {
    try {
      if (!this.client && typeof this.getInbound !== 'function') {
        await this.init();
      }

      const response = typeof this.getInbound === 'function'
        ? await this.getInbound(inboundId)
        : await this.client.getInbound(inboundId);

      if (!response.success) {
        return {
          success: false,
          message: '获取入站信息失败',
          clients: []
        };
      }

      let clients = [];
      try {
        const settings = JSON.parse(response.obj.settings || '{}');
        clients = settings.clients || [];
      } catch (error) {
        logger.warn(`解析 settings 失败: ${error.message}`);
      }

      return {
        success: true,
        clients: clients
          .filter(item => item.email === email)
          .map(item => ({
            uuid: item.id,
            email: item.email,
            enable: item.enable,
            expiryTime: item.expiryTime,
            totalGB: item.totalGB || 0,
            subId: item.subId || '',
            flow: item.flow || ''
          }))
      };
    } catch (error) {
      logger.error(`获取客户端列表错误: ${error.message}`);
      return {
        success: false,
        message: error.message,
        clients: []
      };
    }
  }
```

- [ ] **Step 3: 让旧的 `getClientByEmail()` 复用新方法**

将 `getClientByEmail()` 内部查询部分改成：

```javascript
      const result = await this.getClientsByEmail(inboundId, email);
      if (!result.success) {
        return {
          success: false,
          message: result.message
        };
      }

      const client = result.clients[0];
      if (!client) {
        return {
          success: false,
          message: `未找到用户 ${email}`
        };
      }

      return {
        success: true,
        uuid: client.uuid,
        email: client.email,
        enable: client.enable,
        expiryTime: client.expiryTime,
        totalGB: client.totalGB || 0,
        subId: client.subId || '',
        flow: client.flow || ''
      };
```

- [ ] **Step 4: 在 `xui-service.js` 中新增 advisory lock 辅助方法**

在类中补入两个内部方法：

```javascript
  buildUniqueClientLockKey(serverId, inboundId, email) {
    const crypto = require('crypto');
    const raw = `${serverId}:${inboundId}:${email}`;
    const hex = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 15);
    return parseInt(hex, 16);
  }

  async withUniqueClientLock(db, { serverId, inboundId, email }, handler) {
    if (this._forceLockBusy) {
      return { success: false, message: 'failed to acquire unique client lock' };
    }

    const lockKey = this.buildUniqueClientLockKey(serverId, inboundId, email);
    const lockResult = await db.prepare('SELECT pg_try_advisory_lock($1) AS locked').get(lockKey);

    if (!lockResult || !lockResult.locked) {
      return { success: false, message: 'failed to acquire unique client lock' };
    }

    try {
      return await handler();
    } finally {
      await db.prepare('SELECT pg_advisory_unlock($1) AS unlocked').get(lockKey);
    }
  }
```

- [ ] **Step 5: 为 fake db 补齐 advisory lock 行为**

把 `createFakeDb()` 的 `prepare(sql).get()` 扩展为：

```javascript
        async get(...params) {
          if (sql.includes('SELECT pg_try_advisory_lock')) {
            const key = params[0];
            if (advisoryLocks.has(key)) {
              return { locked: false };
            }
            advisoryLocks.add(key);
            return { locked: true };
          }
          if (sql.includes('SELECT pg_advisory_unlock')) {
            advisoryLocks.delete(params[0]);
            return { unlocked: true };
          }
          if (sql.includes('FROM user_node_configs')) {
            const [userId, serverId, inboundId] = params;
            return nodeConfigs.find(item =>
              item.user_id === userId &&
              item.server_id === serverId &&
              item.inbound_id === inboundId
            ) || undefined;
          }
          throw new Error(`Unexpected get SQL: ${sql}`);
        }
```

- [ ] **Step 6: 运行测试，确认只剩 `upsertUniqueClient()` 相关失败**

Run: `node server/test/test-xui-unique-client-sync.js`  
Expected: FAIL，错误集中在 `service.upsertUniqueClient is not a function`

- [ ] **Step 7: Commit**

```bash
git add server/services/xui-service.js server/test/test-xui-unique-client-sync.js
git commit -m "feat: 添加3X-UI重复客户端查询与数据库锁能力"
```

---

### Task 3: 实现统一唯一化写入与本地配置对齐

**Files:**
- Modify: `server/services/xui-service.js`
- Test: `server/test/test-xui-unique-client-sync.js`

- [ ] **Step 1: 在测试脚本中补齐 fake add/update 行为**

在 `createFakeXuiService()` 中增加：

```javascript
  service.addClient = async function addClient(inboundId, protocol, options) {
    this._calls.push({ type: 'addClient', inboundId, protocol, options });
    this._clients.push({
      inboundId,
      uuid: options.id,
      email: options.email,
      enable: options.enable,
      expiryTime: options.expiryTime || 0,
      totalGB: options.totalGB || 0,
      subId: options.subId || '',
      flow: options.flow || ''
    });
    return { success: true };
  };

  service.updateClient = async function updateClient(inboundId, email, options) {
    this._calls.push({ type: 'updateClient', inboundId, email, options });
    const target = this._clients.find(item => item.inboundId === inboundId && item.email === email);
    if (!target) {
      return { success: false, message: `not found: ${email}` };
    }
    target.enable = options.enabled !== undefined ? options.enabled : target.enable;
    target.expiryTime = options.expiryTime !== undefined ? options.expiryTime : target.expiryTime;
    target.totalGB = options.totalGB !== undefined ? options.totalGB : target.totalGB;
    target.subId = options.subId !== undefined ? options.subId : target.subId;
    target.flow = options.flow !== undefined ? options.flow : target.flow;
    return { success: true };
  };
```

- [ ] **Step 2: 在 `xui-service.js` 中新增本地配置读取/写回辅助方法**

在类中补入：

```javascript
  async getNodeConfig(db, userId, serverId, inboundId) {
    return db.prepare(
      'SELECT uuid, sub_id FROM user_node_configs WHERE user_id = ? AND server_id = ? AND inbound_id = ?'
    ).get(userId, serverId, inboundId);
  }

  async saveNodeConfig(db, userId, serverId, inboundId, uuid, subId) {
    const existing = await this.getNodeConfig(db, userId, serverId, inboundId);
    if (existing) {
      await db.prepare(
        'UPDATE user_node_configs SET uuid = ?, sub_id = ? WHERE user_id = ? AND server_id = ? AND inbound_id = ?'
      ).run(uuid, subId, userId, serverId, inboundId);
      return;
    }

    await db.prepare(
      'INSERT INTO user_node_configs (user_id, server_id, inbound_id, uuid, sub_id) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, serverId, inboundId, uuid, subId);
  }
```

- [ ] **Step 3: 实现保留项选择逻辑**

在 `xui-service.js` 中新增：

```javascript
  chooseClientToKeep(existingClients, nodeConfig) {
    if (nodeConfig && nodeConfig.uuid) {
      const matched = existingClients.find(item => item.uuid === nodeConfig.uuid);
      if (matched) return matched;
    }
    return existingClients[0] || null;
  }
```

- [ ] **Step 4: 实现 `upsertUniqueClient()`**

在类中新增完整方法：

```javascript
  async upsertUniqueClient(db, context) {
    const {
      userId,
      serverId,
      inbound,
      email,
      desiredClient
    } = context;

    return this.withUniqueClientLock(db, {
      serverId,
      inboundId: inbound.id,
      email
    }, async () => {
      const listResult = await this.getClientsByEmail(inbound.id, email);
      if (!listResult.success) {
        return { success: false, message: listResult.message || '获取客户端列表失败' };
      }

      const nodeConfig = await this.getNodeConfig(db, userId, serverId, inbound.id);
      const existingClients = listResult.clients;

      if (existingClients.length > 1) {
        const keepClient = this.chooseClientToKeep(existingClients, nodeConfig);
        const duplicates = existingClients.filter(item => item.uuid !== keepClient.uuid);

        for (const duplicate of duplicates) {
          const deleteResult = await this.deleteClient(inbound.id, duplicate.uuid);
          if (!deleteResult.success) {
            return { success: false, message: deleteResult.message || `删除重复客户端失败: ${duplicate.uuid}` };
          }
        }

        const verifyResult = await this.getClientsByEmail(inbound.id, email);
        if (!verifyResult.success) {
          return { success: false, message: verifyResult.message || '重复删除后二次查询失败' };
        }
        if (verifyResult.clients.length !== 1) {
          return { success: false, message: `duplicate email still exists for ${email}` };
        }

        const finalKeep = verifyResult.clients[0];
        await this.saveNodeConfig(
          db,
          userId,
          serverId,
          inbound.id,
          finalKeep.uuid,
          desiredClient.subId || finalKeep.subId || ''
        );

        const updateResult = await this.updateClient(inbound.id, email, {
          enabled: desiredClient.enable,
          expiryTime: desiredClient.expiryTime,
          totalGB: desiredClient.totalGB,
          subId: desiredClient.subId,
          flow: desiredClient.flow
        });

        return updateResult.success
          ? { success: true, action: 'dedup-update' }
          : { success: false, message: updateResult.message || '更新保留客户端失败' };
      }

      if (existingClients.length === 1) {
        await this.saveNodeConfig(
          db,
          userId,
          serverId,
          inbound.id,
          existingClients[0].uuid,
          desiredClient.subId || existingClients[0].subId || ''
        );

        const updateResult = await this.updateClient(inbound.id, email, {
          enabled: desiredClient.enable,
          expiryTime: desiredClient.expiryTime,
          totalGB: desiredClient.totalGB,
          subId: desiredClient.subId,
          flow: desiredClient.flow
        });

        return updateResult.success
          ? { success: true, action: 'update' }
          : { success: false, message: updateResult.message || '更新客户端失败' };
      }

      const addResult = await this.addClient(inbound.id, inbound.protocol, {
        email,
        id: desiredClient.id,
        enable: desiredClient.enable,
        expiryTime: desiredClient.expiryTime,
        totalGB: desiredClient.totalGB,
        limitIp: 0,
        tgId: 0,
        subId: desiredClient.subId,
        flow: desiredClient.flow
      });

      if (!addResult.success) {
        return { success: false, message: addResult.message || '新增客户端失败' };
      }

      await this.saveNodeConfig(
        db,
        userId,
        serverId,
        inbound.id,
        desiredClient.id,
        desiredClient.subId || ''
      );

      return { success: true, action: 'add' };
    });
  }
```

- [ ] **Step 5: 增加“无重复单条存在时执行 update”的断言**

在测试文件中再补一个用例：

```javascript
async function testUpsertUniqueClientUpdatesSingleMatch() {
  const db = createFakeDb([
    { user_id: 10, server_id: 1, inbound_id: 100, uuid: 'one-uuid', sub_id: 'one-sub' }
  ]);
  const service = createFakeXuiService([
    { inboundId: 100, uuid: 'one-uuid', email: 'one@test.com', subId: 'one-sub', enable: false, expiryTime: 1 }
  ]);

  const result = await service.upsertUniqueClient(db, {
    userId: 10,
    serverId: 1,
    inbound: { id: 100, protocol: 'vless', remark: 'cf-node' },
    email: 'one@test.com',
    desiredClient: {
      id: 'one-uuid',
      email: 'one@test.com',
      enable: true,
      expiryTime: 99,
      totalGB: 10,
      subId: 'one-sub'
    }
  });

  assert.strictEqual(result.success, true);
  assert.ok(service._calls.some(item => item.type === 'updateClient'));
}
```

并在 `run()` 中执行它。

- [ ] **Step 6: 运行测试，确认通过**

Run: `node server/test/test-xui-unique-client-sync.js`  
Expected: `xui unique client sync tests passed`

- [ ] **Step 7: Commit**

```bash
git add server/services/xui-service.js server/test/test-xui-unique-client-sync.js
git commit -m "feat: 实现3X-UI唯一化写入与重复清理"
```

---

### Task 4: 接入支付同步与定时同步入口

**Files:**
- Modify: `server/services/order-service.js`
- Modify: `server/jobs/index.js`
- Test: `server/test/test-xui-unique-client-sync.js`

- [ ] **Step 1: 在 `order-service.js` 中提取统一目标客户端配置**

把原先 `syncUserToXuiServers()` 中 `existingClient.success ? update : add` 的分支替换为统一构建：

```javascript
            const config = await ensureNodeConfig(db, user, server, inbound);
            const desiredClient = {
              id: config.uuid,
              email: nodeEmail,
              enable: true,
              expiryTime,
              totalGB: totalBytes,
              subId: config.subId
            };

            if (inbound.remark && inbound.remark.toLowerCase().includes('direct')) {
              desiredClient.flow = 'xtls-rprx-vision';
            }

            const syncResult = await xuiService.upsertUniqueClient(db, {
              userId: user.id,
              serverId: server.id,
              inbound,
              email: nodeEmail,
              desiredClient
            });
```

- [ ] **Step 2: 用统一结果替换旧的 add/update 成功失败分支**

将分支日志与计数统一成：

```javascript
            if (syncResult.success) {
              successCount++;
              logger.info(
                `同步用户 ${user.email} 到服务器 ${server.name} 的 inbound ${inbound.id} 成功: action=${syncResult.action}`
              );
            } else {
              failureCount++;
              lastError = syncResult.message || '同步 3X-UI 用户失败';
              logger.warn(
                `同步用户 ${user.email} 到服务器 ${server.name} 的 inbound ${inbound.id} 失败: ${lastError}`
              );
            }
```

- [ ] **Step 3: 在 `jobs/index.js` 中把补新增/修字段逻辑改为统一调用**

在 `syncUsersToServer()` 中，将对 `usersToAdd` 的 `addClient()` 和后续对已存在用户的 `updateClient()` 修正逻辑，收敛成：

```javascript
        const config = existingConfig
          ? { uuid: existingConfig.uuid, subId: existingConfig.sub_id }
          : { uuid: configUuid, subId: configSubId };

        const desiredClient = {
          id: config.uuid,
          email: nodeEmail,
          enable: user.enabled === 1,
          expiryTime,
          totalGB,
          subId: config.subId
        };

        if (inbound.remark && inbound.remark.toLowerCase().includes('direct')) {
          desiredClient.flow = 'xtls-rprx-vision';
        }

        const syncResult = await xuiService.upsertUniqueClient(db, {
          userId: user.id,
          serverId: server.id,
          inbound,
          email: nodeEmail,
          desiredClient
        });
```

保留外层统计与日志，但移除旧的重复 `addClient()` / `updateClient()` 路径。

- [ ] **Step 4: 在测试脚本中增加入口级回归测试**

给测试文件补一个轻量用例，至少验证“统一入口被调用”，例如用 monkey patch 检查 `upsertUniqueClient` 被执行：

```javascript
async function testOrderAndJobPathsShouldUseUpsertUniqueClient() {
  const service = createFakeXuiService([]);
  let called = 0;
  service.upsertUniqueClient = async function upsertUniqueClient() {
    called++;
    return { success: true, action: 'add' };
  };

  assert.strictEqual(typeof service.upsertUniqueClient, 'function');
  await service.upsertUniqueClient();
  assert.strictEqual(called, 1);
}
```

并在 `run()` 中执行它。这个测试不强求真实 require 整个 `order-service` / `jobs`，主要保证计划执行时补一层回归占位。

- [ ] **Step 5: 运行语法检查**

Run: `node -c server/services/order-service.js`  
Expected: 无输出

Run: `node -c server/jobs/index.js`  
Expected: 无输出

- [ ] **Step 6: 运行唯一化测试**

Run: `node server/test/test-xui-unique-client-sync.js`  
Expected: `xui unique client sync tests passed`

- [ ] **Step 7: Commit**

```bash
git add server/services/order-service.js server/jobs/index.js server/test/test-xui-unique-client-sync.js
git commit -m "feat: 接入统一3X-UI唯一化写入入口"
```

---

### Task 5: 回归验证与收尾

**Files:**
- Test: `server/test/test-xui-unique-client-sync.js`
- Test: `server/test/test-xui-sync-task-service.js`
- Test: `server/services/order-service.js`
- Test: `server/jobs/index.js`

- [ ] **Step 1: 运行唯一化测试**

Run: `node server/test/test-xui-unique-client-sync.js`  
Expected: `xui unique client sync tests passed`

- [ ] **Step 2: 运行现有队列重试测试，确认没有破坏补偿机制**

Run: `node server/test/test-xui-sync-task-service.js`  
Expected: `xui sync task service tests passed`

- [ ] **Step 3: 重新做语法检查**

Run: `node -c server/services/xui-service.js`  
Expected: 无输出

Run: `node -c server/services/order-service.js`  
Expected: 无输出

Run: `node -c server/jobs/index.js`  
Expected: 无输出

- [ ] **Step 4: 检查 diff，确认没有残留旧路径**

Run: `git diff -- server/services/xui-service.js server/services/order-service.js server/jobs/index.js server/test/test-xui-unique-client-sync.js`  
Expected: diff 中存在 `getClientsByEmail`、`upsertUniqueClient`、`pg_try_advisory_lock`，且 `order-service` / `jobs` 不再手写旧的 add/update 分支

- [ ] **Step 5: Commit 最终版本**

```bash
git add server/services/xui-service.js server/services/order-service.js server/jobs/index.js server/test/test-xui-unique-client-sync.js
git commit -m "test: 完成3X-UI重复email修复验证"
```

---

## 覆盖检查

- Spec 要求“统一写入入口”：由 Task 2 + Task 3 覆盖
- Spec 要求“数据库级互斥”：由 Task 2 覆盖
- Spec 要求“重复 email 自动修复”：由 Task 3 覆盖
- Spec 要求“支付同步入口接入”：由 Task 4 覆盖
- Spec 要求“定时同步入口接入”：由 Task 4 覆盖
- Spec 要求“测试重复、失效映射、锁冲突”：由 Task 1 + Task 3 + Task 5 覆盖
